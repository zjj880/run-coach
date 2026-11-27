import {
  AiError, buildCoachMessages, buildImportMessages, buildMoodMessages, buildReviewChatMessages, buildReviewMessages,
  complete, decodeCoach, decodeReview, decodeRows, publicConfig, toConfig,
  type AiConfig, type FetchLike,
} from './aiCore.ts';

export type AiConfigStore = {
  load: () => Promise<AiConfig | null>;
  save: (config: AiConfig | null) => Promise<void>;
};

export type AiClientOptions = {
  store: AiConfigStore;
  fetchImpl?: FetchLike;
  sessionId?: string;
};

/**
 * 手机/离线场景下的 AI 客户端：直接调用用户配置的 HTTPS 模型接口，
 * 复用与服务端完全相同的提示词、校验与解码逻辑（src/aiCore.ts）。
 */
export function createAiClient({ store, fetchImpl = fetch, sessionId }: AiClientOptions) {
  const session = sessionId ?? 'run-coach-' + Math.random().toString(36).slice(2, 10);

  async function call(config: AiConfig, messages: Parameters<typeof complete>[2]) {
    return complete(fetchImpl, config, messages, session);
  }

  return {
    async request<T>(path: string, method: string = 'GET', body?: unknown): Promise<T> {
      if (path === '/ai/settings' && method === 'GET') return publicConfig(await store.load()) as T;
      if (path === '/ai/settings' && method === 'DELETE') {
        await store.save(null);
        return publicConfig(null) as T;
      }
      if (path === '/ai/settings' && method === 'POST') {
        const pending = toConfig(body, await store.load());
        await call(pending, [{ role: 'user', content: 'Reply only: OK' }]);
        await store.save(pending);
        return publicConfig(pending) as T;
      }

      const known = new Set(['/ai/recognize', '/ai/review', '/ai/review-chat', '/ai/coach', '/ai/mood']);
      if (!known.has(path)) throw new AiError(404, '找不到这个接口。');

      const config = await store.load();
      if (!config) throw new AiError(409, '请先在「我的 → AI 接口」测试并保存配置。');

      if (path === '/ai/recognize' && method === 'POST') {
        return { rows: decodeRows(await call(config, buildImportMessages(body))) } as T;
      }
      if (path === '/ai/review' && method === 'POST') {
        return { review: decodeReview(await call(config, buildReviewMessages(body))) } as T;
      }
      if (path === '/ai/review-chat' && method === 'POST') {
        const reply = (await call(config, buildReviewChatMessages(body))).trim().slice(0, 800);
        if (!reply) throw new AiError(502, '模型没有返回可读取的回答。');
        return { reply } as T;
      }
      if (path === '/ai/coach' && method === 'POST') {
        return decodeCoach(await call(config, buildCoachMessages(body))) as T;
      }
      if (path === '/ai/mood' && method === 'POST') {
        const reply = (await call(config, buildMoodMessages(body))).trim().slice(0, 420);
        if (!reply) throw new AiError(502, '模型没有返回可读取的回应。');
        return { reply } as T;
      }
      throw new AiError(404, '找不到这个接口。');
    },
  };
}

export type AiClient = ReturnType<typeof createAiClient>;
