const { contextBridge, ipcRenderer } = require('electron')

/**
 * The only surface the page can reach the arm through.
 *
 * Every method takes structured values — an address string, an axis letter, a
 * number — and never a URL, a path or a query. That is what keeps the desktop
 * build from being a worse browser: main decides what request gets made, so a
 * script that gets into the renderer inherits the ability to move a robot arm,
 * not the ability to fetch arbitrary hosts on the user's network. See
 * `electron/arm.cjs` for the rest of that argument.
 *
 * The web build has no preload, so `window.hcrArm` is undefined there and the
 * UI hides itself. That is the intended difference between the two builds, not
 * a degraded mode: a browser tab genuinely cannot do this.
 */
contextBridge.exposeInMainWorld('hcrArm', {
  /** Present so the renderer can feature-detect without probing methods. */
  available: true,

  getAddress: () => ipcRenderer.invoke('arm:get-address'),
  setAddress: (address) => ipcRenderer.invoke('arm:set-address', address),

  /** `GET /health`, for the Test button. */
  check: () => ipcRenderer.invoke('arm:check'),
  /** Where the arm is on the upstream network, if it has joined one. */
  discover: () => ipcRenderer.invoke('arm:discover'),

  readAngles: () => ipcRenderer.invoke('arm:read-angles'),
  home: () => ipcRenderer.invoke('arm:home'),

  /** Play a validated timeline. Resolves when it finishes or is aborted. */
  run: (plan) => ipcRenderer.invoke('arm:run', plan),
  abort: () => ipcRenderer.invoke('arm:abort'),

  /**
   * Subscribe to per-step progress. Returns an unsubscribe function.
   *
   * The listener is wrapped so the renderer never sees the Electron event
   * object, which carries a `sender` it has no business holding.
   */
  onProgress: (listener) => {
    const wrapped = (_event, payload) => listener(payload)
    ipcRenderer.on('arm:progress', wrapped)
    return () => ipcRenderer.removeListener('arm:progress', wrapped)
  },
})

/** App lifecycle only; no generic IPC surface is exposed to the renderer. */
contextBridge.exposeInMainWorld('hcrApp', {
  available: true,
  close: () => ipcRenderer.invoke('app:close'),
})
