# ChatGPT（OpenAI）接入教程（交我跑 · 手机 / 电脑通用）

> 先说结论：**「ChatGPT 网页版 / App 会员」不能用在这个 App 里**。想调用 ChatGPT 同款模型，需要 OpenAI 平台的 **API 密钥**（按用量单独计费）。
> 如果你只是想要"能用的 AI 教练"，DeepSeek 更简单更便宜（见《DeepSeek 接入教程》）；本文给需要 GPT 的人。

---

## 一、要准备什么

| 项目 | 值 |
|---|---|
| 接口地址 | `https://api.openai.com/v1`（App 里点 **OpenAI** 预设会自动填） |
| 模型 | `gpt-4o-mini`（便宜、日常够用）<br>`gpt-4o`（更强，**支持看图**） |
| API 密钥 | `sk-...`，在 platform.openai.com 创建 |

> ChatGPT Plus / Pro 订阅 ≠ API 额度。两者是分开计费的：会员是网页/App 用，API 是按 token 计费。

---

## 二、获取 OpenAI API 密钥

1. 打开 <https://platform.openai.com/> 注册/登录（需要能访问该站点）
2. 进入 **Billing / 计费**，绑定支付方式并充值（新账号通常需要先充值才能调用）
3. 进入 **API keys** → **Create new secret key** → 命名（如 `jiaowopao-phone`）
4. **立刻复制** `sk-...`（只显示一次）
5. （可选）在 **Limits / Usage limits** 里给项目设一个月度上限，防止额度过快消耗

> 提示：用项目密钥（Project API key）更规范；一个应用一个密钥，方便单独停用。

---

## 三、填进「交我跑」

### 手机 App

1. 我的 → **AI 接口**
2. 服务商点 **OpenAI** → 接口地址自动填 `https://api.openai.com/v1`，模型自动填 `gpt-4o-mini`
3. 点「模型」里的标签可切换：**gpt-4o-mini**（快省）/ **gpt-4o**（支持看图）
4. 点 **「打开 OpenAI 密钥页」** → 网页创建密钥 → 复制
5. 回 App 点 **「粘贴密钥」**
6. 点 **「测试并保存」** → 显示「已连接 · gpt-4o-mini」即完成

### Windows / Linux 桌面版

同样路径：我的 → AI 接口 → OpenAI。电脑版密钥由系统加密保存在本机。

### 浏览器预览（开发用）

先在项目目录运行 `npm run ai`，再在浏览器里填同样三项。

---

## 四、网络不通怎么办

国内直连 `api.openai.com` 经常不通。三种替代：

| 方式 | 接口地址 | 说明 |
|---|---|---|
| **OpenRouter**（推荐中转） | `https://openrouter.ai/api/v1` | 一个密钥可调 `openai/gpt-4o-mini` 等；App 里有预设 |
| Azure OpenAI | `https://<资源名>.openai.azure.com/...` | 需要按 Azure 的路径格式，属于"自定义"服务商，模型填部署名 |
| 自建网关/中转 | `https://你的域名/v1` | 只用自己的或可信的；来源不明的中转站可能记录你的密钥 |

> 注意：App 只接受 **https://** 地址；`http://` 会被拒绝（防密钥明文泄漏）。

---

## 五、模型怎么选

| 场景 | 建议 |
|---|---|
| 日常教练对话、心情回应、课表文字识别 | `gpt-4o-mini`（便宜、响应快） |
| 训练复盘（要分析） | `gpt-4o` 或 `gpt-4o-mini` 先试，不够再升 |
| **课表图片识别** | 必须用**支持视觉**的模型，`gpt-4o` 可以；`*-mini` 部分版本也支持，以文档为准 |
| 省钱 | 默认 `gpt-4o-mini`，只在复盘/看图时临时切 `gpt-4o` |

> 切换模型不需要重填密钥，点标签 → 「测试并保存」即可。

---

## 六、常见报错

| App 提示 | 原因 | 处理 |
|---|---|---|
| `HTTP 401` | 密钥错误/停用 | 重新创建密钥；确认复制完整 |
| `HTTP 403` | 项目无权限 / 地区限制 | 检查项目与密钥权限；确认网络可达 |
| `HTTP 429` | 额度用完或请求过快 | 充值 / 设限后重试 |
| `HTTP 404` | 模型名或地址错 | 地址 `https://api.openai.com/v1`；模型 `gpt-4o-mini` |
| `无法连接 AI 服务` | 网络不通（最常见） | 换网络/代理，或改用 OpenRouter 中转 |
| `模型没有返回可读取的文本` | 内容被安全策略拦截或格式异常 | 换措辞/换模型重试 |

---

## 七、安全和费用

1. 密钥只填在 App 的「API 密钥」输入框，**不要**拼到地址里（App 会拒绝 `?key=` 或 `user:pass@`）
2. 一个人一个密钥；怀疑泄漏就删除重建
3. 在 OpenAI 平台设置月度用量上限，避免意外扣费
4. 课表识别、训练评估单次通常几千 token；`gpt-4o-mini` 成本很低，`gpt-4o` 明显更贵（尤其带图片）

---

## 八、附：命令行自测

```bash
curl https://api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-你的密钥" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"你好"}]}'
```

返回 `choices[0].message.content` 有内容即密钥可用。
