const { app, BrowserWindow, Menu, ipcMain, net, protocol, shell } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const arm = require('./arm.cjs')
const sequencer = require('./sequencer.cjs')

// Set by `npm run electron:dev`. When packaged there is no such variable, so
// the built files are served over `hcr://app` instead.
const startUrl = process.env.ELECTRON_START_URL

/**
 * The packaged app's own origin.
 *
 * `loadFile` would serve the bundle from `file://`, which sends `Origin: null`
 * on every cross-origin request — the same value any sandboxed iframe on the
 * web sends. An API cannot allow that without allowing all of them, so the
 * packaged app would be permanently locked out of `api.hcr.rs`. Serving the
 * identical files over a registered scheme gives the desktop build a stable,
 * nameable origin that the backend can allowlist on its own merits.
 */
const APP_SCHEME = 'hcr'
const APP_ORIGIN = `${APP_SCHEME}://app`
const DIST = path.join(__dirname, '..', 'dist')

// Must run before `app.whenReady`. `standard` gives the scheme normal URL
// parsing and a real origin; `secure` makes it a secure context, so the
// renderer keeps the APIs a page served over HTTPS would have.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
])

/**
 * Which API the packaged bundle was built against.
 *
 * Only used to write the `connect-src` below. It defaults to the production
 * host and must be overridden alongside `VITE_HCR_API_BASE_URL` if a build is
 * pointed somewhere else, or the policy will block the very requests the bundle
 * was built to make.
 */
const API_ORIGIN = process.env.HCR_API_ORIGIN ?? 'https://api.hcr.rs'

/**
 * The packaged app's Content-Security-Policy.
 *
 * The web build gets this from `public/_headers`, which Cloudflare serves and
 * this scheme obviously does not, so without setting it here the desktop build
 * would be the *less* protected of the two — Electron says as much on startup.
 * Same shape as the web policy, with `connect-src` naming the API this bundle
 * was built against. The arm is absent from it on purpose: the renderer never
 * calls the arm directly, main does, so no policy needs to permit it.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${API_ORIGIN}`,
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ')

/**
 * Serve the built bundle, refusing anything outside it.
 *
 * The containment check is not ceremony: without it a request for
 * `hcr://app/../../../etc/passwd` would resolve outside `dist` and be read
 * happily, since this handler runs with the app's own file access.
 */
function registerAppProtocol() {
  protocol.handle(APP_SCHEME, async (request) => {
    const { pathname } = new URL(request.url)
    const resolved = path.normalize(path.join(DIST, decodeURIComponent(pathname)))
    if (resolved !== DIST && !resolved.startsWith(DIST + path.sep)) {
      return new Response('Not found', { status: 404 })
    }
    const target = pathname === '/' ? path.join(DIST, 'index.html') : resolved
    const response = await net.fetch(pathToFileURL(target).toString())
    const headers = new Headers(response.headers)
    headers.set('Content-Security-Policy', CSP)
    return new Response(response.body, {
      status: response.status,
      headers,
    })
  })
}

let mainWindow

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1180,
    minHeight: 720,
    backgroundColor: '#0b1017',
    title: 'HCR Simulator',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (startUrl) {
    win.loadURL(startUrl)
  } else {
    win.loadURL(`${APP_ORIGIN}/index.html`)
  }

  // Renderer console into main's stdout, so `npm run electron:dev` shows page
  // errors in the same terminal as the arm's own logging. Off unless asked for:
  // a packaged app should not write the user's session to stdout, and DevTools
  // is the better tool when a window is actually in front of you.
  if (startUrl || process.env.HCR_DEBUG) {
    const levels = ['debug', 'info', 'warning', 'error']
    win.webContents.on('console-message', (...args) => {
      // Electron changed this event's shape mid-33; accept either form rather
      // than print `undefined` on whichever one this build happens to send.
      const [first, ...rest] = args
      const { level, message, lineNumber, sourceId } =
        typeof first === 'object' && first !== null && 'message' in first
          ? first
          : { level: rest[0], message: rest[1], lineNumber: rest[2], sourceId: rest[3] }
      const name = typeof level === 'number' ? (levels[level] ?? level) : level
      console.log(`[renderer:${name}] ${message}  (${sourceId}:${lineNumber})`)
    })
  }

  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`[window] failed to load ${url} — ${description} (${code})`)
  })

  // External links belong in the system browser; without this they replace the
  // workbench and take a half-written program with them.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  return win
}

/**
 * Wrap a handler so a thrown error crosses IPC as a result rather than a
 * rejection.
 *
 * `ipcRenderer.invoke` rejections arrive in the renderer with a mangled message
 * and an Electron stack prefix, which is unusable in a UI that has to explain
 * "the arm is not at that address". A tagged result keeps the wording intact.
 */
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, value: await fn(...args) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
}

function registerArmHandlers() {
  handle('arm:get-address', () => arm.getAddress())
  handle('arm:set-address', (address) => {
    arm.setAddress(address)
    return arm.getAddress()
  })
  handle('arm:check', () => arm.health())
  handle('arm:read-angles', () => arm.readAngles())
  handle('arm:home', () => arm.home())

  /**
   * Ask the arm where it is on the upstream network.
   *
   * Worth its own route because of how the hardware is actually used: you join
   * the arm's own access point to reach `192.168.4.1`, but that AP usually
   * costs you the internet. The firmware runs AP+STA and reports its LAN
   * address, so one call from the AP tells you the address to use from then on.
   */
  handle('arm:discover', async () => {
    const status = await arm.readWifi()
    return {
      station: status.station,
      address: status.address ?? undefined,
      selected: status.selected ?? undefined,
    }
  })

  handle('arm:run', async (plan) => {
    const target = mainWindow
    return sequencer.run(plan, (progress) => {
      if (!target?.isDestroyed()) {
        target?.webContents.send('arm:progress', progress)
      }
    })
  })
  handle('arm:abort', () => sequencer.abort())
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'togglefullscreen' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'toggleDevTools' },
        ],
      },
      { role: 'windowMenu' },
    ]),
  )

  registerAppProtocol()
  registerArmHandlers()
  mainWindow = createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    }
  })
})

/**
 * Park the arm before the process goes away.
 *
 * A run abandoned mid-program leaves servos holding whatever angle they last
 * received, which on this arm can be a pose leaning into the head. Quitting is
 * deferred once, long enough to abort and home.
 */
let parking = false
app.on('before-quit', (event) => {
  if (parking || !sequencer.isRunning()) {
    return
  }
  event.preventDefault()
  parking = true
  sequencer.shutdown().finally(() => app.quit())
})

app.on('window-all-closed', () => {
  sequencer.abort()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
