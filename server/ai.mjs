import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { dateIsValid, workoutTypes } from '../src/training.ts';
import { syncGarminDaily, syncGarminDetails, syncGarminHistory, validateGarminKey } from '../src/garmin.ts';
import {
  AiError as ApiError, buildCoachMessages, buildImportMessages, buildMoodMessages, buildReviewChatMessages,
  buildReviewMessages, complete, decodeCoach, decodeReview, decodeRows, field, publicConfig, toConfig,
} from '../src/aiCore.ts';

const origins = new Set(['http://localhost:8090', 'http://127.0.0.1:8090', 'http://localhost:8089', 'http://127.0.0.1:8089']);
const bodyLimit = 9 * 1024 * 1024;

async function readJson(request) {
  if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
    throw new ApiError(415, '请求格式需要是 JSON。');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > bodyLimit) {
      request.resume();
      throw new ApiError(413, '文件太大，请拆成较小的图片或文本。');
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ApiError(400, '请求内容不是有效 JSON。');
  }
}

export function createAiServer({ fetchImpl = fetch, garminFetchImpl = fetch, desktopToken,
  initialAiConfig = null, initialGarminKey = '', saveCredential, syncStore = null, syncPort = 8093 } = {}) {
  let config = initialAiConfig;
  let revision = 0;
  let garminKey = initialGarminKey;
  let garminRevision = 0;
  const sessionId = randomUUID();
  const callModel = (profile, messages) => complete(fetchImpl, profile, messages, sessionId);
  return createServer(async (request, response) => {
    const origin = request.headers.origin;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Vary', 'Origin');
    const send = (status, data) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(data));
    };
    const isSyncRoute = (request.url ?? '').startsWith('/sync');
    const hostOk = /^((localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)([^/:]+)?)(:\d+)?$/.test(request.headers.host ?? '');
    if (!hostOk || (!isSyncRoute && origin && !origins.has(origin)) ||
      (!isSyncRoute && desktopToken && request.headers['x-run-coach-desktop'] !== desktopToken)) {
      return send(403, { error: '此开发服务仅供本机 App 调用。' });
    }
    if (origin) response.setHeader('Access-Control-Allow-Origin', origin);
    if (request.method === 'OPTIONS') {
      response.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
      return response.end();
    }
    try {
      const route = request.method + ' ' + request.url;
      if (route === 'GET /garmin/settings') return send(200, { connected: Boolean(garminKey) });
      if (route === 'DELETE /garmin/settings') {
        garminRevision += 1;
        if (saveCredential) await saveCredential('garmin', null);
        garminKey = '';
        return send(200, { connected: false });
      }
      if (route === 'POST /garmin/connect' || route === 'POST /garmin/sync') {
        const data = await readJson(request);
        const date = field(data, 'date');
        if (!dateIsValid(date)) throw new ApiError(400, '同步日期无效。');
        const connecting = route === 'POST /garmin/connect';
        let key = garminKey;
        if (connecting) {
          try { key = validateGarminKey(field(data, 'key')); }
          catch (error) { throw new ApiError(400, error.message); }
        }
        if (!key) throw new ApiError(409, '请先在「我的 → 连接佳明」填写密钥。');
        const version = connecting ? ++garminRevision : garminRevision;
        let snapshot;
        try { snapshot = await syncGarminDaily(key, date, garminFetchImpl); }
        catch (error) { throw new ApiError(502, error.message); }
        if (version !== garminRevision) throw new ApiError(409, '佳明连接已更改，请重新同步。');
        if (connecting) {
          if (saveCredential) await saveCredential('garmin', key);
          garminKey = key;
        }
        return send(200, snapshot);
      }
      if (route === 'POST /garmin/history') {
        if (!garminKey) throw new ApiError(409, '请先在「我的 → 连接佳明」填写密钥。');
        const data = await readJson(request);
        const from = field(data, 'from');
        const to = field(data, 'to');
        if (!dateIsValid(from) || !dateIsValid(to)) throw new ApiError(400, '请输入有效的起止日期。');
        const version = garminRevision;
        let history;
        try { history = await syncGarminHistory(garminKey, from, to, garminFetchImpl); }
        catch (error) { throw new ApiError(502, error.message); }
        if (version !== garminRevision) throw new ApiError(409, '佳明连接已更改，请重新同步。');
        return send(200, history);
      }
      if (route === 'POST /garmin/details') {
        if (!garminKey) throw new ApiError(409, '请先在「我的 → 连接佳明」填写密钥。');
        const data = await readJson(request);
        if (!Array.isArray(data?.ids) || data.ids.some((id) => typeof id !== 'string')) throw new ApiError(400, '需要有效的佳明活动。');
        const version = garminRevision;
        let details;
        try { details = await syncGarminDetails(garminKey, [...new Set(data.ids)], garminFetchImpl, { weather: data.weather !== false }); }
        catch (error) { throw new ApiError(502, error.message); }
        if (version !== garminRevision) throw new ApiError(409, '佳明连接已更改，请重新同步。');
        return send(200, { details });
      }
      if (syncStore && route === 'POST /sync/host') {
        const data = await readJson(request);
        if (!data?.state || typeof data.state !== 'object') throw new ApiError(400, '缺少本机数据，无法生成配对码。');
        return send(200, syncStore.host(data.state, syncPort));
      }
      if (syncStore && route === 'GET /sync/status') return send(200, { pairing: syncStore.pairing() });
      if (syncStore && route === 'POST /sync/fetch') {
        return send(200, syncStore.fetch());
      }
      if (syncStore && route === 'POST /sync/cancel') return send(200, syncStore.cancel());
      if (route === 'GET /ai/settings') return send(200, publicConfig(config));
      if (route === 'DELETE /ai/settings') {
        revision += 1;
        if (saveCredential) await saveCredential('ai', null);
        config = null;
        return send(200, publicConfig(config));
      }
      if (route === 'POST /ai/settings') {
        const version = ++revision;
        const pending = toConfig(await readJson(request), config);
        await callModel(pending, [{ role: 'user', content: 'Reply only: OK' }]);
        if (revision !== version) throw new ApiError(409, 'AI 设置已更新，请重新打开查看。');
        if (saveCredential) await saveCredential('ai', pending);
        config = pending;
        return send(200, publicConfig(config));
      }
      if (route === 'POST /ai/recognize') {
        if (!config) throw new ApiError(409, '请先在「我的 → AI 接口」测试并保存配置。');
        const active = config;
        const data = await readJson(request);
        const result = await callModel(active, buildImportMessages(data));
        return send(200, { rows: decodeRows(result) });
      }
      if (route === 'POST /ai/review') {
        if (!config) throw new ApiError(409, '请先在「我的 → AI 接口」测试并保存配置。');
        const active = config;
        const data = await readJson(request);
        const result = await callModel(active, buildReviewMessages(data));
        return send(200, { review: decodeReview(result) });
      }
      if (route === 'POST /ai/review-chat') {
        if (!config) throw new ApiError(409, '请先在「我的 → AI 接口」测试并保存配置。');
        const active = config;
        const messages = buildReviewChatMessages(await readJson(request));
        const text = (await callModel(active, messages)).trim().slice(0, 800);
        if (!text) throw new ApiError(502, '模型没有返回可读取的回答。');
        return send(200, { reply: text });
      }
      if (route === 'POST /ai/coach') {
        if (!config) throw new ApiError(409, '请先在「我的 → AI 接口」测试并保存配置。');
        const active = config;
        const messages = buildCoachMessages(await readJson(request));
        return send(200, decodeCoach(await callModel(active, messages)));
      }
      if (route === 'POST /ai/mood') {
        if (!config) throw new ApiError(409, '请先在「我的 → AI 接口」测试并保存配置。');
        const active = config;
        const messages = buildMoodMessages(await readJson(request));
        return send(200, { reply: (await callModel(active, messages)).trim().slice(0, 420) });
      }
      send(404, { error: '找不到这个接口。' });
    } catch (error) {
      const status = error instanceof ApiError ? error.status : (typeof error?.status === 'number' ? error.status : 500);
      if (!response.headersSent) send(status, { error: error instanceof ApiError || typeof error?.status === 'number' ? error.message : '本机 AI 服务出了问题，请重试。' });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createAiServer();
  server.listen(8091, '127.0.0.1', () => console.log('AI 接口服务已启动（仅本机） http://127.0.0.1:8091'));
}
