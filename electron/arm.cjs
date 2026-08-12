const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

/**
 * Everything that speaks to the physical arm.
 *
 * # Why the renderer never sends a URL
 *
 * A browser flatly refuses to let an HTTPS page call `http://192.168.4.1`, and
 * the arm cannot serve TLS. Moving the request into main removes that refusal —
 * which is the point, but it is also the danger. If main fetched whatever URL
 * the page handed it, the desktop build would be strictly *more* exposed than
 * the browser it replaced: any injected script (a dependency, a challenge
 * description, a Blockly plugin) would gain a general-purpose HTTP client
 * pointed at the user's home network, able to read router admin pages and
 * internal services and ship the replies back through the same channel.
 *
 * So the trust boundary is here. The renderer sends an axis letter and a
 * number. Main owns the host, picks the path from a fixed table, and
 * re-serializes the query itself from values it has re-validated. No string the
 * renderer produced ever reaches a URL.
 *
 * # What the limits mirror
 *
 * The ranges below are the firmware's, from `hcr-fw/docs/API.md`. Duplicating
 * them is deliberate: the arm rejects out-of-range values with `422`, but by
 * then a partly-applied multi-axis write may already have moved the earlier
 * servos, because `/api/angles` is validation-atomic and not
 * hardware-transactional. Checking here means a bad plan never starts.
 */

/** Servo travel per axis, mirrored from the firmware's `AXES`. */
const AXES = {
  X: { min: 0, max: 180 },
  Y: { min: 0, max: 180 },
  Z: { min: 0, max: 180 },
  B: { min: 0, max: 180 },
  E: { min: 45, max: 100 },
}

/**
 * The AP address. The arm always answers here when you are joined to its own
 * `HCR-Gateway` network, so it is the one address that needs no discovery.
 */
const DEFAULT_ADDRESS = '192.168.4.1'
const DEFAULT_PORT = 80

/**
 * A wrong address on a live subnet does not fail fast — the SYN is dropped and
 * the OS retries for over a minute. Every request gets an explicit deadline so
 * a typo surfaces as an error while the user is still looking at the field.
 */
const REQUEST_TIMEOUT_MS = 3000

let cached

/**
 * Electron is required here rather than at module scope so the validation above
 * can be exercised by the ordinary test runner. Address parsing and range
 * checks are the parts most worth testing and the parts that need Electron
 * least; making the whole module unloadable outside the app would have put them
 * out of reach.
 */
function settingsFile() {
  const { app } = require('electron')
  return path.join(app.getPath('userData'), 'arm.json')
}

/** The stored address, or the AP default on first run or unreadable state. */
function load() {
  if (cached) {
    return cached
  }
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))
    cached = parseAddress(`${raw.host}:${raw.port}`)
  } catch {
    cached = { host: DEFAULT_ADDRESS, port: DEFAULT_PORT }
  }
  return cached
}

function save(target) {
  cached = target
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify(target), 'utf8')
  } catch {
    // A read-only profile should not stop the arm working for this session;
    // the address simply reverts to the default next launch.
  }
}

/**
 * Parse `host` or `host:port` into a validated target.
 *
 * Only IPv4 literals on private, loopback or link-local ranges are accepted.
 *
 * Hostnames are refused rather than resolved. The firmware has no mDNS
 * (`API.md`, "Not implemented"), so a name could only come from DNS — which
 * would hand the renderer an outbound lookup it cannot otherwise make, and buy
 * nothing, because there is no name the arm actually answers to.
 *
 * Public addresses are refused for the same reason the renderer cannot choose
 * the path: this client exists to reach one device on the local network, and
 * anything that widens it past that is a bug rather than a feature.
 */
function parseAddress(input) {
  const text = String(input ?? '').trim()
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{1,5}))?$/.exec(text)
  if (!match) {
    throw new Error(
      'Enter the arm as an IPv4 address, optionally with a port — for ' +
        `example ${DEFAULT_ADDRESS} or ${DEFAULT_ADDRESS}:80.`,
    )
  }

  const octets = match[1].split('.').map(Number)
  if (octets.some((octet) => octet > 255)) {
    throw new Error(`"${match[1]}" is not a valid IPv4 address.`)
  }

  const port = match[2] === undefined ? DEFAULT_PORT : Number(match[2])
  if (port < 1 || port > 65535) {
    throw new Error(`Port ${port} is outside 1–65535.`)
  }

  if (!isLocalIpv4(octets)) {
    throw new Error(
      `${match[1]} is a public address. The arm lives on your local network — ` +
        `its access point answers at ${DEFAULT_ADDRESS}, or use the LAN ` +
        'address it reports once it has joined your Wi-Fi.',
    )
  }

  return { host: match[1], port }
}

/** RFC 1918 private space, loopback, and RFC 3927 link-local. */
function isLocalIpv4([a, b]) {
  if (a === 10 || a === 127) {
    return true
  }
  if (a === 192 && b === 168) {
    return true
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true
  }
  return a === 169 && b === 254
}

/**
 * Format an angle the way the firmware's parser demands: decimal digits, at
 * most one fractional digit, never negative. Anything else comes back as
 * `400 invalid angle`.
 */
function formatAngle(axis, value) {
  const limits = AXES[axis]
  if (!limits) {
    throw new Error(`Unknown axis "${axis}". The arm has X, Y, Z, B and E.`)
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Axis ${axis} needs a finite angle, got ${value}.`)
  }
  const rounded = Math.round(value * 10) / 10
  if (rounded < limits.min || rounded > limits.max) {
    throw new Error(
      `${rounded}° is outside axis ${axis}, which travels ` +
        `${limits.min}–${limits.max}°.`,
    )
  }
  return rounded.toFixed(1)
}

/**
 * One request, one connection.
 *
 * The firmware answers every request with `Connection: close` and handles a
 * single request per socket, so pooling would only produce sockets that are
 * already dead when reused. `agent: false` keeps Node from trying.
 */
function request(routePath) {
  const target = load()
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        host: target.host,
        port: target.port,
        path: routePath,
        agent: false,
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        const chunks = []
        let size = 0
        res.on('data', (chunk) => {
          size += chunk.length
          // The firmware caps a whole response at 2048 bytes. Anything larger
          // is not the arm, so stop reading rather than buffer a stranger.
          if (size > 8192) {
            req.destroy()
            reject(new Error(`${target.host} sent an oversized reply; is that the arm?`))
            return
          }
          chunks.push(chunk)
        })
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8')
          if (res.statusCode !== 200) {
            reject(new Error(`Arm returned ${res.statusCode}: ${body.trim()}`))
            return
          }
          try {
            resolve(JSON.parse(body))
          } catch {
            reject(new Error(`Arm sent a reply that is not JSON: ${body.slice(0, 120)}`))
          }
        })
      },
    )
    req.on('timeout', () => {
      req.destroy()
      reject(
        new Error(
          `No answer from ${target.host}:${target.port} within ` +
            `${REQUEST_TIMEOUT_MS / 1000}s. Check the address, and that you are ` +
            'on the same network as the arm.',
        ),
      )
    })
    req.on('error', (error) => {
      reject(new Error(`Could not reach ${target.host}:${target.port} — ${error.message}`))
    })
  })
}

/** `GET /health` — the reachability check behind the Test button. */
async function health() {
  const body = await request('/health')
  if (body.status !== 'ok') {
    throw new Error(`Arm reports status "${body.status}".`)
  }
  return { runtime: String(body.runtime ?? 'unknown') }
}

/** Current angles, straight from the arm. */
function readAngles() {
  return request('/api/angles')
}

/**
 * Station status, including the address the arm holds on the upstream network.
 *
 * The firmware never returns saved passwords over HTTP, so this is safe to
 * surface; `address` is the field worth having, because it is how you stop
 * needing the arm's own access point.
 */
function readWifi() {
  return request('/api/wifi')
}

/**
 * Move one or more axes.
 *
 * Every value is re-validated and re-formatted here; the caller's numbers are
 * read but never forwarded verbatim.
 *
 * `async` so a rejected range check and a failed socket reach the caller the
 * same way. Without it, validation threw synchronously while the network failed
 * as a rejection, and a caller written as `setAngles(...).catch(...)` would
 * handle one and be killed by the other.
 */
async function setAngles(moves) {
  if (!Array.isArray(moves) || moves.length === 0) {
    throw new Error('Nothing to move.')
  }
  const query = moves
    .map(({ axis, value }) => `${axisName(axis)}=${formatAngle(axisName(axis), value)}`)
    .join('&')
  return request(`/api/angles?${query}`)
}

/** `POST`-free homing: the firmware accepts GET on every control route. */
function home() {
  return request('/api/home')
}

function axisName(axis) {
  const name = String(axis ?? '').toUpperCase()
  if (!Object.hasOwn(AXES, name)) {
    throw new Error(`Unknown axis "${axis}". The arm has X, Y, Z, B and E.`)
  }
  return name
}

module.exports = {
  AXES,
  DEFAULT_ADDRESS,
  getAddress: () => {
    const { host, port } = load()
    return port === DEFAULT_PORT ? host : `${host}:${port}`
  },
  setAddress: (input) => {
    save(parseAddress(input))
  },
  parseAddress,
  formatAngle,
  axisName,
  health,
  readAngles,
  readWifi,
  setAngles,
  home,
}
