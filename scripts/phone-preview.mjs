import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../.expo/phone-web/', import.meta.url));
const port = 8092;
const privateIp = (value) => /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(value);
const interfaces = Object.entries(networkInterfaces()).flatMap(([name, addresses]) =>
  (addresses ?? []).filter((item) => item.family === 'IPv4' && !item.internal && privateIp(item.address))
    .map(({ address }) => ({ name, address })));
const requested = process.argv[2];
const preferred = interfaces.find(({ name }) => /wi-fi|wlan|wireless|以太网|ethernet/i.test(name)) ?? interfaces[0];
const host = requested ?? preferred?.address;
if (!host || (host !== '127.0.0.1' && !interfaces.some(({ address }) => address === host))) {
  console.error('无法找到指定的本机局域网地址。电脑预览可传入 127.0.0.1。');
  process.exit(1);
}

const manifest = JSON.stringify({
  name: '交我跑 · 手机体验版', short_name: '交我跑', lang: 'zh-CN', start_url: '/',
  display: 'standalone', background_color: '#f4f6f2', theme_color: '#f4f6f2',
  icons: [{ src: '/preview-icon.png', sizes: '1024x1024', type: 'image/png' }],
});
const meta = [
  '<link rel="manifest" href="/phone.webmanifest">',
  '<link rel="apple-touch-icon" href="/preview-icon.png">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-title" content="交我跑">',
].join('');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };

await readFile(resolve(root, 'index.html')).catch(() => {
  console.error('请先运行 npm run phone:build 生成手机预览。');
  process.exit(1);
});

createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') return response.writeHead(405).end();
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const send = (data, mime) => response.writeHead(200, {
      'Content-Type': mime, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff',
    }).end(request.method === 'HEAD' ? undefined : data);
    if (path === '/phone.webmanifest') return send(manifest, 'application/manifest+json');
    if (path === '/preview-icon.png') return send(await readFile(new URL('../assets/icon.png', import.meta.url)), 'image/png');
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(resolve(root) + sep)) return response.writeHead(404).end();
    const value = await readFile(file);
    const mime = types[extname(file)] ?? 'application/octet-stream';
    send(path === '/' ? value.toString('utf8').replace('</head>', meta + '</head>') : value, mime);
  } catch {
    response.writeHead(404).end();
  }
}).listen(port, host, () => console.log('手机同一 Wi-Fi 打开 http://' + host + ':' + port));
