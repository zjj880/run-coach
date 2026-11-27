/** AI 服务商预设：点一下自动填好接口地址与推荐模型，用户只需要粘密钥。 */
export type AiProvider = {
  id: string;
  label: string;
  /** 填写到「接口地址」的值；空字符串表示自定义 */
  endpoint: string;
  /** 推荐模型；空字符串表示自定义 */
  model: string;
  /** 创建/管理密钥的页面 */
  keyPage?: string;
  note?: string;
};

export const garminKeyPage = 'https://connect.garmin.cn/app/settings/personalApiToken';

export const aiProviders: AiProvider[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    keyPage: 'https://platform.deepseek.com/api_keys',
    note: '国内访问快、价格低。评估想要更强推理可把模型改成 deepseek-reasoner。',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    endpoint: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    keyPage: 'https://platform.openai.com/api-keys',
    note: '需要能访问 OpenAI 的网络环境；图片识别可选支持视觉的模型。',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1',
    model: 'deepseek/deepseek-chat',
    keyPage: 'https://openrouter.ai/keys',
    note: '一个密钥聚合多家模型，模型名用「厂商/模型」的写法。',
  },
  {
    id: 'custom',
    label: '自定义',
    endpoint: '',
    model: '',
    note: '填写任何兼容 Chat Completions 的 HTTPS 地址。',
  },
];

export const providerById = (id: string): AiProvider | undefined => aiProviders.find((provider) => provider.id === id);

/** 根据已保存的接口地址反推服务商，方便重新打开设置时高亮正确的一项。 */
export function matchProvider(endpoint: string): AiProvider | undefined {
  const value = (endpoint || '').replace(/\/+$/, '');
  if (!value) return undefined;
  return aiProviders.find((provider) => provider.endpoint && value.startsWith(provider.endpoint.replace(/\/+$/, '')));
}

/** 桌面端允许用系统浏览器打开的外部页面（与 desktop/main.mjs 的白名单对应）。 */
export const allowedExternalUrls: string[] = [
  garminKeyPage,
  ...aiProviders.map((provider) => provider.keyPage).filter((page): page is string => Boolean(page)),
];
