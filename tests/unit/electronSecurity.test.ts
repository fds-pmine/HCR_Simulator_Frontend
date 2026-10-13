// @vitest-environment node
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as arm from '../../electron/arm.cjs';

const require = createRequire(import.meta.url);

async function desktop(packaged = true, ownsLock = true) {
  const app = Object.assign(new EventEmitter(), {
    isPackaged: packaged,
    requestSingleInstanceLock: vi.fn(() => ownsLock),
    quit: vi.fn(),
    whenReady: () => Promise.resolve(),
  });
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const windows: FakeWindow[] = [];
  class FakeWindow extends EventEmitter {
    webContents = Object.assign(new EventEmitter(), {
      session: { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() },
      setWindowOpenHandler: vi.fn(),
      getURL: () => this.url,
      send: vi.fn(),
    });
    url = '';
    constructor(readonly options: unknown) { super(); windows.push(this); }
    loadURL(url: string) { this.url = url; }
    isDestroyed() { return false; }
    isMinimized() { return false; }
    focus() { /* No OS window in a unit test. */ }
    static getAllWindows() { return windows; }
  }
  const shell = { openExternal: vi.fn(() => Promise.resolve()) };
  const device = { getAddress: vi.fn(), setAddress: vi.fn(), home: vi.fn() };
  const sequencer = { isRunning: vi.fn(() => false), abort: vi.fn(), shutdown: vi.fn(() => Promise.resolve()) };
  const electron = {
    app, BrowserWindow: FakeWindow, shell,
    Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn() },
    ipcMain: { handle: (name: string, fn: (...args: unknown[]) => unknown) => handlers.set(name, fn) },
    protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
  };
  vm.runInNewContext(readFileSync('electron/main.cjs', 'utf8'), {
    require: (name: string) => name === 'electron' ? electron
      : name === './arm.cjs' ? device : name === './sequencer.cjs' ? sequencer : require(name),
    __dirname: `${process.cwd()}/electron`,
    process: { platform: 'linux', env: { ELECTRON_START_URL: 'http://localhost:5173' } },
    console, URL, Response, Headers,
  });
  await Promise.resolve();
  return { app, windows, shell, device, sequencer, handlers };
}

describe('Electron trust boundary', () => {
  it('ignores development URLs when packaged and explicitly sandboxes the page', async () => {
    const { windows } = await desktop();
    expect(windows[0].url).toBe('hcr://app/index.html');
    expect(windows[0].options).toMatchObject({ webPreferences: { sandbox: true } });
  });

  it('opens HTTPS links only and handles OS launch failures', async () => {
    const { windows, shell } = await desktop();
    const handler = windows[0].webContents.setWindowOpenHandler.mock.calls[0][0];
    for (const url of ['file:///tmp/test', 'smb://host/share', 'javascript:alert(1)', 'http://host', 'invalid']) {
      expect(handler({ url })).toEqual({ action: 'deny' });
      const event = { preventDefault: vi.fn() };
      windows[0].webContents.emit('will-navigate', event, url);
      expect(event.preventDefault).toHaveBeenCalled();
    }
    expect(shell.openExternal).not.toHaveBeenCalled();
    shell.openExternal.mockRejectedValueOnce(new Error('no handler'));
    handler({ url: 'https://hcr.rs/' });
    await Promise.resolve();
    expect(shell.openExternal).toHaveBeenCalledWith('https://hcr.rs/');
  });

  it('denies device permissions, preserves trusted clipboard writes and refuses a second arm owner', async () => {
    const { windows } = await desktop();
    const session = windows[0].webContents.session;
    const answer = vi.fn();
    session.setPermissionRequestHandler.mock.calls[0][0](null, 'media', answer);
    expect(answer).toHaveBeenCalledWith(false);
    expect(session.setPermissionCheckHandler.mock.calls[0][0]()).toBe(false);
    const check = session.setPermissionCheckHandler.mock.calls[0][0];
    const request = session.setPermissionRequestHandler.mock.calls[0][0];
    const trusted = { isMainFrame: true, requestingUrl: 'hcr://app/index.html' };
    expect(check(windows[0].webContents, 'clipboard-sanitized-write', 'hcr://app', trusted)).toBe(true);
    request(windows[0].webContents, 'clipboard-sanitized-write', answer, trusted);
    expect(answer).toHaveBeenLastCalledWith(true);
    for (const details of [{ ...trusted, isMainFrame: false }, { ...trusted, requestingUrl: 'https://evil.test/' }]) {
      expect(check(windows[0].webContents, 'clipboard-sanitized-write', 'hcr://app', details)).toBe(false);
    }
    expect(check(windows[0].webContents, 'clipboard-read', 'hcr://app', trusted)).toBe(false);
    const duplicate = await desktop(true, false);
    expect(duplicate.app.quit).toHaveBeenCalled();
    expect(duplicate.windows).toHaveLength(0);
  });

  it('rejects Home and address changes during a run and aborts on reload or renderer loss', async () => {
    const { windows, handlers, sequencer, device } = await desktop();
    sequencer.isRunning.mockReturnValue(true);
    for (const channel of ['arm:home', 'arm:set-address']) {
      expect(await handlers.get(channel)?.({}, '192.168.4.2')).toMatchObject({ ok: false });
    }
    expect(device.home).not.toHaveBeenCalled();
    expect(device.setAddress).not.toHaveBeenCalled();
    windows[0].webContents.emit('did-start-navigation', {}, 'hcr://app/index.html', false, true);
    windows[0].webContents.emit('render-process-gone');
    expect(sequencer.abort).toHaveBeenCalledTimes(2);
    windows[0].emit('closed');
    expect(sequencer.shutdown).toHaveBeenCalled();
  });
});

afterEach(() => arm.setAddress(arm.DEFAULT_ADDRESS));

async function serve(handler: http.RequestListener) {
  const server = http.createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing local test port.');
  arm.setAddress(`127.0.0.1:${address.port}`);
  return () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); });
}

describe('arm HTTP boundary', () => {
  it('canonicalizes IPv4 octets before passing the address to Node', () => {
    expect(arm.parseAddress('010.010.010.010')).toEqual({ host: '10.10.10.10', port: 80 });
    expect(arm.parseAddress('192.168.4.09')).toEqual({ host: '192.168.4.9', port: 80 });
  });

  it('rejects a truncated response instead of leaving the arm running forever', async () => {
    const close = await serve((_req, res) => {
      res.writeHead(200, { 'Content-Length': 100 });
      res.write('{');
      setTimeout(() => res.destroy(), 20);
    });
    try { await expect(arm.readAngles()).rejects.toThrow(); } finally { await close(); }
  });

  it('enforces an absolute deadline even while the device trickles bytes', async () => {
    const close = await serve((_req, res) => {
      res.writeHead(200);
      res.write('{');
      const timer = setInterval(() => res.write(' '), 50);
      res.on('close', () => clearInterval(timer));
    });
    const started = Date.now();
    try {
      await expect(arm.readAngles()).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(4500);
    } finally { await close(); }
  }, 6000);

  it('keeps LAN response bodies out of errors', async () => {
    for (const status of [200, 403]) {
      const close = await serve((_req, res) => { res.writeHead(status); res.end('private-router-secret'); });
      try { await expect(arm.readAngles()).rejects.toThrow(/^(?!.*private-router-secret)/); } finally { await close(); }
    }
  });
});
