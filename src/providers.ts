/** AI 服务商预设：点一下自动填好接口地址与推荐模型，用户只需要粘密钥。 */

/** 可选模型：会显示成可点的标签，选中后自动填入「模型」输入框。 */
export type AiModelOption = { id: string; label: string; note: string };

export type AiProvider = {
  id: string;
  label: string;
  /** 填写到「接口地址」的值；空字符串表示自定义 */
  endpoint: string;
  /** 推荐模型；空字符串表示自定义 */
  model: string;
  /** 该服务商常用/可切换的模型 */
  models?: AiModelOption[];
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
    note: '国内访问快、价格低。日常对话与课表识别用 flash 一类即可；训练复盘想要更强推理再切 reasoner 或 pro。',
    models: [
      { id: 'deepseek-chat', label: 'deepseek-chat', note: 'V4-Flash 非思考 · 最快最省（推荐）' },
      { id: 'deepseek-reasoner', label: 'deepseek-reasoner', note: 'V4-Flash 思考模式 · 推理更强' },
      { id: 'deepseek-v4-flash', label: 'deepseek-v4-flash', note: 'V4-Flash 直连名称' },
      { id: 'deepseek-v4-pro', label: 'deepseek-v4-pro', note: 'V4-Pro · 最强，也更贵更慢' },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    endpoint: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    keyPage: 'https://platform.openai.com/api-keys',
    note: '需要能访问 OpenAI 的网络环境；图片识别可选支持视觉的模型。',
    models: [
      { id: 'gpt-4o-mini', label: 'gpt-4o-mini', note: '便宜、够用' },
      { id: 'gpt-4o', label: 'gpt-4o', note: '更强，支持看图' },
    ],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1',
    model: 'deepseek/deepseek-chat',
    keyPage: 'https://openrouter.ai/keys',
    note: '一个密钥聚合多家模型，模型名用「厂商/模型」的写法。',
    models: [
      { id: 'deepseek/deepseek-chat', label: 'deepseek/deepseek-chat', note: '便宜、够用' },
      { id: 'deepseek/deepseek-r1', label: 'deepseek/deepseek-r1', note: '推理更强' },
      { id: 'openai/gpt-4o-mini', label: 'openai/gpt-4o-mini', note: 'OpenAI 小模型' },
    ],
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

/** 判断当前模型是预设里的哪一个（用于高亮模型标签）。 */
export function matchModel(provider: AiProvider | undefined, model: string): AiModelOption | undefined {
  return provider?.models?.find((option) => option.id === model.trim());
}

/** 桌面端允许用系统浏览器打开的外部页面（与 desktop/main.mjs 的白名单对应）。 */
export const allowedExternalUrls: string[] = [
  garminKeyPage,
  ...aiProviders.map((provider) => provider.keyPage).filter((page): page is string => Boolean(page)),
];
