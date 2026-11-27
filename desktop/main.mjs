import { app, BrowserWindow, dialog, Menu, protocol, shell } from 'electron';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAiServer } from '../server/ai.mjs';
import { credentials } from './credentials.mjs';
import { allowedExternalUrls } from '../src/providers.ts';

const scheme = 'run-coach';
const home = 'run-coach://app/';
const webFolder = fileURLToPath(new URL('../web/', import.meta.url));
const allowedExternal = new Set(allowedExternalUrls);
const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'";
const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css',
  '.ico': 'image/x-icon', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.json': 'application/json' };

protocol.registerSchemesAsPrivileged([{ scheme, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
app.setAppUserModelId('RunCoach.Windows');
let window;
let server;

async function start() {
  const vault = credentials(app.getPath('userData'));
  const [initialAiConfig, initialGarminKey] = await Promise.all([vault.read('ai'), vault.read('garmin')]);
  const desktopToken = randomBytes(32).toString('hex');
  server = createAiServer({ desktopToken, initialAiConfig, initialGarminKey: initialGarminKey ?? '', saveCredential: vault.write });
  await new Promise((ready, failed) => server.once('error', failed).listen(0, '127.0.0.1', ready));
  const api = 'http://127.0.0.1:' + server.address().port;

  protocol.handle(scheme, async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'app' || url.username || url.password) return new Response(null, { status: 404 });
    if (/^\/(?:ai|garmin)\//.test(url.pathname)) {
      if (!['GET', 'POST', 'DELETE'].includes(request.method) || url.search) return new Response(null, { status: 405 });
      try {
        const contentType = request.headers.get('content-type');
        const headers = { 'x-run-coach-desktop': desktopToken };
        if (contentType) headers['Content-Type'] = contentType;
        const response = await fetch(api + url.pathname, { method: request.method, headers, body: request.body ?? undefined, duplex: 'half', redirect: 'error' });
        return new Response(response.body, { status: response.status, headers: {
          'Content-Type': response.headers.get('content-type') ?? 'application/json',
          'Cache-Control': 'no-store',
        } });
      } catch {
        return Response.json({ error: '本机服务暂时无法连接，请重新打开交我跑。' }, { status: 502 });
      }
    }
    if (request.method !== 'GET') return new Response(null, { status: 405 });
    try {
      const file = resolve(webFolder, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!file.startsWith(webFolder + (webFolder.endsWith(sep) ? '' : sep))) return new Response(null, { status: 404 });
      const type = types[extname(file)];
      if (!type) return new Response(null, { status: 404 });
      return new Response(await readFile(file), { headers: { 'Content-Type': type, 'Content-Security-Policy': csp, 'X-Content-Type-Options': 'nosniff' } });
    } catch {
      return new Response(null, { status: 404 });
    }
  });

  Menu.setApplicationMenu(null);
  window = new BrowserWindow({
    title: '交我跑', width: 1240, height: 900, minWidth: 700, minHeight: 540,
    backgroundColor: '#F7F1E8', show: false, icon: resolve(webFolder, 'favicon.ico'),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false },
  });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.on('will-navigate', (event, address) => {
    if (address === home) return;
    event.preventDefault();
    if (allowedExternal.has(address)) void shell.openExternal(address);
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (allowedExternal.has(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.once('ready-to-show', () => window.show());
  await window.loadURL(home);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => server?.close());
  app.whenReady().then(start).catch(() => {
    dialog.showErrorBox('交我跑', '启动失败。请完整解压电脑版本，再打开 RunCoach.exe。');
    app.quit();
  });
}
