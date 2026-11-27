import * as SecureStore from 'expo-secure-store';
import { createAiClient, type AiConfigStore } from './aiClient.ts';
import type { AiConfig } from './aiCore.ts';

/** 手机端 AI 配置保存在系统安全存储，密钥不上传、不进日志。 */
const storageKey = 'run-coach.ai-config';

const secureStore: AiConfigStore = {
  async load() {
    try {
      const raw = await SecureStore.getItemAsync(storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<AiConfig>;
      if (!parsed?.endpoint || !parsed?.model || !parsed?.apiKey) return null;
      return { endpoint: parsed.endpoint, model: parsed.model, apiKey: parsed.apiKey };
    } catch {
      return null;
    }
  },
  async save(config) {
    if (!config) {
      await SecureStore.deleteItemAsync(storageKey);
      return;
    }
    await SecureStore.setItemAsync(storageKey, JSON.stringify(config));
  },
};

const client = createAiClient({ store: secureStore });

/** 原生端直接请求用户配置的模型服务；参数与浏览器端 aiRequest 保持一致。 */
export function nativeAiRequest<T>(path: string, method: string = 'GET', body?: object): Promise<T> {
  return client.request<T>(path, method, body);
}
