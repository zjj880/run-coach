import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { mergeStates } from '../src/sync.ts';

/** 局域网同步：电脑端生成 6 位配对码，手机在同一 Wi-Fi 下提交本机数据，服务端合并后双方各存一份。 */

const pairingTtlMs = 5 * 60 * 1000;
const bodyLimit = 12 * 1024 * 1024;

export function createSyncStore() {
  let pairing = null;
  let attempts = 0;

  const cleanup = () => {
    if (pairing && pairing.expiresAt < Date.now()) pairing = null;
  };

  return {
    host(state, port) {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      pairing = { code, hostState: state, port, expiresAt: Date.now() + pairingTtlMs, summary: null, joined: false };
      attempts = 0;
      return { code, port, expiresAt: new Date(pairing.expiresAt).toISOString(), urls: lanUrls(port) };
    },
    pairing() {
      cleanup();
      return pairing ? { code: pairing.code, expiresAt: new Date(pairing.expiresAt).toISOString(), joined: pairing.joined } : null;
    },
    join(code, phoneState) {
      cleanup();
      if (!pairing) throw Object.assign(new Error('配对码已过期，请在电脑上重新生成。'), { status: 410 });
      if (pairing.code !== String(code ?? '').trim()) {
        attempts += 1;
        if (attempts > 20) { pairing = null; throw Object.assign(new Error('配对码错误次数过多，已失效，请重新生成。'), { status: 429 }); }
        throw Object.assign(new Error('配对码不正确，请核对电脑上显示的 6 位数字。'), { status: 403 });
      }
      const merged = mergeStates(pairing.hostState, phoneState);
      pairing.hostState = merged.state;
      pairing.summary = merged.summary;
      pairing.joined = true;
      return { summary: merged.summary, state: merged.state };
    },
    fetch() {
      cleanup();
      if (!pairing) throw Object.assign(new Error('没有进行中的配对，请重新生成配对码。'), { status: 410 });
      if (!pairing.joined) throw Object.assign(new Error('手机还没有连上来，请先在手机上完成同步。'), { status: 409 });
      const result = { summary: pairing.summary, state: pairing.hostState };
      pairing = null;
      return result;
    },
    cancel() {
      pairing = null;
      return { ok: true };
    },
  };
}

export function lanUrls(port) {
  const urls = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const entry of list ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      if (!/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address)) continue;
      urls.push('http://' + entry.address + ':' + port);
    }
  }
  return urls;
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > bodyLimit) throw Object.assign(new Error('数据过大，请先精简后再同步。'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('请求内容不是有效 JSON。'), { status: 400 });
  }
}

/** 手机侧访问的局域网服务：只提供配对与合并，必须带正确的配对码。 */
export function createSyncLanServer(store, { port = 8093 } = {}) {
  const server = createServer(async (request, response) => {
    const send = (status, data) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(data));
    };
    if (request.method === 'OPTIONS') {
      response.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
      return response.end();
    }
    const route = request.method + ' ' + (request.url ?? '').split('?')[0];
    try {
      if (route === 'GET /sync/ping') return send(200, { ok: true, app: 'jiaowopao' });
      if (route === 'POST /sync/join') {
        const data = await readJson(request);
        if (!data?.code || !data?.state || typeof data.state !== 'object') throw Object.assign(new Error('缺少配对码或本机数据。'), { status: 400 });
        const result = store.join(data.code, data.state);
        return send(200, result);
      }
      send(404, { error: '找不到这个接口。' });
    } catch (error) {
      send(error.status ?? 500, { error: error.message ?? '同步失败，请重试。' });
    }
  });
  return { server, port, listen: () => new Promise((ready, failed) => {
    server.once('error', failed);
    server.listen(port, '0.0.0.0', () => ready(server.address().port));
  }) };
}
