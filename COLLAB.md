# COLLAB.md — 双智能体协作说明

> 本文件写给**另一个参与本项目的 AI 智能体**（以及接手的人类开发者）。
> 读法：先读本文件 → 再读 [`AGENTS.md`](AGENTS.md)（架构与领域模型）→ 再读 [`HANDOFF.md`](HANDOFF.md)（产品边界）。
> 更新时间：2026-11-25 00:05（Asia/Shanghai）

## 1. 仓库信息（唯一事实来源）

| 项 | 值 |
| --- | --- |
| 仓库 | **https://github.com/zjj880/run-coach** |
| 可见性 | **public** |
| 默认分支 | `main`（开发直接提交或用短期分支合并） |
| 本地路径 | `C:\Users\Administrator\Documents\ChatGPT\开发 2\run-coach`（路径含中文和空格，构建请用短路径，见第 5 节） |
| Issues | 已开启（可用作任务看板） |
| Topics | ai-coach, electron, expo, fitness, garmin, local-first, offline-first, react-native, running, training, typescript |
| 仓库描述 | 跑步教练 · Expo + React Native + Electron 本地优先训练 App |
| 当前 HEAD（截至本文） | `6aa40de`，共 11 个提交，45 个受控文件 |
| 已发布标签 | `v0.1.3`、`v0.1.4`、`v0.1.6`、`v0.1.7` |

## 2. 项目与技术栈（一段话）

本地优先的跑步训练 App：三个页面（今天 / 课表 / 我的），动态课表、晨间打卡、日程空档、佳明中国区同步（睡眠/HRV/静息心率/活动/FIT）、AI 课表识别、训练评估与追问。
技术栈：Expo SDK 58 + React Native 0.88 + TypeScript 6（strict）+ Electron 45；一套代码产出 **Android APK / 浏览器预览 / Windows exe / Linux 桌面** 四种形态；数据全在本机（AsyncStorage 或 Electron userData），无账号无云端。

## 3. 版本与已发布产物

| 版本 | 状态 | 产物 |
| --- | --- | --- |
| v0.1.3 | 已发布（预发布） | Windows x64 zip（152.2 MB） |
| v0.1.4 | 已发布（预发布） | Windows x64 zip（156.3 MB）+ Android arm64 APK（21.9 MB） |
| v0.1.6 | 已发布（预发布） | Windows x64 zip + Android arm64 APK（FIT 逐圈配速/心率图） |
| v0.1.7 | 本次发布 | Windows x64 zip + Linux x64 tar.gz + Android arm64 APK（活动天气 + FIT 下载健壮性 + 天气开关） |

- 发布页：https://github.com/zjj880/run-coach/releases
- **`app.json` 为版本单一来源**：`expo.version`（如 0.1.5）+ `android.versionCode`（如 6）必须同步递增。
- 仓库**只存源码**；安装包一律走 GitHub Releases，绝不提交进仓库（`.gitignore` 已挡住 `*.apk/*.zip/*.exe`）。
- 每个 APK/zip 在 Release 说明里都带 **SHA-256**。

## 4. 环境与命令

```powershell
# Node.js 24（已验证 v24.20）
npm ci
npm run typecheck        # tsc --noEmit，必须 0 错误
npm test                 # node --test；若环境限制 spawn（EPERM），逐文件跑：

Get-ChildItem test\*.mjs | ForEach-Object { node $_.FullName; if ($LASTEXITCODE) { Write-Error $_ } }

npm run web -- --localhost --port 8090   # 浏览器预览
npm run ai                                # 本机 AI/佳明代理，仅 127.0.0.1:8091
npm run phone:build && npm run phone:serve  # 手机同 Wi-Fi 预览（8092）
npm run windows:build                     # Electron 打包 → dist/RunCoach-Windows-<version>
```

当前基线：typecheck 通过，**7 个测试文件、28+ 用例全绿**；GitHub Actions（`.github/workflows/ci.yml`）在每次 push/PR 自动跑 `npm ci → typecheck → 测试`。

## 5. 构建安装包（Windows / Android）

- **Windows**：`npm run windows:build`，产物在 `dist/RunCoach-Windows-<version>`，打包成 zip 后作为 Release 附件。
- **Android**：需要 JDK 17 + Android SDK（本机已装：`C:\Program Files\Eclipse Adoptium\jdk-17.0.21.10002-hotspot`、`D:\AndroidSdk`，含 platform 37 / build-tools 37 / NDK 27.1 / CMake）。
  1. 把项目克隆到**短路径**（如 `C:\rc`），中文/空格路径会让 Gradle 和 CMake 出问题；
  2. `npx expo prebuild --platform android --no-install`
  3. `android\gradlew.bat :app:assembleRelease -PreactNativeArchitectures=arm64-v8a`
  4. 产物 `android\app\build\outputs\apk\release\app-release.apk`
  - 注意：Windows 上 CMake 生成路径会超 260 字符，需把 `D:\AndroidSdk\cmake\3.22.1\bin\ninja.exe` 换成 **ninja 1.12+**（本机已换，原文件备份为 `ninja.exe.bak`）。
  - 当前 APK 为**调试签名 + arm64 only**，仅内测；正式发布需改签名并考虑多 ABI。

## 6. 协作规则（重要，避免互相踩踏）

1. **动手前先 `git status`**：工作区可能已有**另一方未提交的改动**。
   ❌ 不要 `git add -A` 一把梭 —— 曾发生：一方的未提交功能改动被另一方的文档提交顺手带走（提交信息与实际内容不符）。✅ 只 `git add <你自己的文件>`。
2. **按模块分工**，避免同时改同一文件：
   - 共享文件（`App.tsx`、`app.json`、`README.md`、`AGENTS.md`、`server/ai.mjs`）由**合并方统一改**，另一方向合并方提需求。
   - 领域数据侧：`src/training.ts`、`src/garmin.ts`、`src/fit.ts`、`test/*`。
   - 展示/图表侧：`src/FitReview.tsx`、`src/fitCharts.ts`、`src/*Dialog.tsx`、`src/AiTools.tsx`。
3. **一次只改一个模块**，提交信息写清「场景 / 实现 / 验证」。
4. 提交前必须：`npm run typecheck` + 相关测试通过；涉及 UI 的写清手工验证路径。
5. **隐私红线**：绝不让密钥、佳明原始健康数据、私人日程、`.env`、FIT 原始文件进入仓库或提交给代码库。AI 请求只发送完成当前任务所需字段（详见 `AGENTS.md` 第 6 节）。
6. 新增/修改 AI 提示词时，同步更新 `AGENTS.md` 的白名单说明。
7. 大文件（APK/zip/exe/视频）不进仓库，走 Releases。
8. 改动测试基线（用例数/行为）时，同步更新本文件和 `AGENTS.md` 里的数字。

## 7. 当前能力清单（截至本文）

| 模块 | 状态 |
| --- | --- |
| 三页面 UI、晨间打卡、动态课表、日程空档、ICS 导入 | ✅ 已实现 |
| 佳明中国区同步（日指标、14 天活动、活动明细、FIT 圈/心率解析） | ✅ 已实现 |
| 历史活动范围同步（按起止日期分页拉取并自动归类） | ✅ 0.1.8 |
| AI 课表识别导入、训练评估、心情回应、教练对话 | ✅ 已实现（需自备 Chat Completions 接口） |
| **活动自动归类**（按心率/配速/时序，手动优先） | ✅ 0.1.4 上线（`src/autoclassify.ts`） |
| **评估结果继续追问**（`POST /ai/review-chat`） | ✅ 0.1.4 上线 |
| 评估数据精简展示（浮点取整、分段类型中文化、计划/实际对比） | ✅ 0.1.4 上线 |
| **FIT 图表**（逐圈配速图、心率图选点、`src/fitCharts.ts`） | ✅ 0.1.6 上线 |
| **活动天气估计**（Open-Meteo 温湿度、`src/activityWeather.ts`、可取整坐标/可关闭） | ✅ 0.1.7 上线 |
| **FIT 下载健壮性**（同域重定向、超时/超限分类、失败不丢明细） | ✅ 0.1.7 上线 |
| 手机端 AI 后端、系统日历、正式签名多 ABI 分发 | ⏳ 待办 |

## 8. 已知坑（改动前必看）

- `App.tsx` 是 800+ 行单文件巨石（状态、三页面、五个内联表单、全部样式），拆分前先补测试。
- `src/*.ts` 被 Node 直接 import 跑测试：新增运行时 import 必须写扩展名（`./training.ts`），类型导入可省略。
- `.mjs` 测试文件里**不能写 TypeScript 语法**（类型注解/`type` 导入都会让 node 报 SyntaxError）。
- `deliverables/`（1.58 GB 构建产物）在仓库外层，永不入库。
- `README.md` 的下载链接需要跟随最新 Release 更新。
- 详细技术债见 `AGENTS.md` 第 8 节。

## 9. 给另一个 AI 的开场提示词（可直接粘贴）

> 你要接手 https://github.com/zjj880/run-coach （public）这个「跑步教练」项目。
> 先 `git clone` 并依次读完仓库根目录的 **COLLAB.md → AGENTS.md → HANDOFF.md → README.md**，再动手。
> 规则：动手前先 `git status`（可能有另一方未提交的改动，**只 `git add` 你自己的文件，不要 `git add -A`**）；一次只改一个模块；提交前必须 `npm run typecheck` 且相关测试通过；共享文件（App.tsx、app.json、README、AGENTS.md）改动前先说明并等确认；密钥/健康数据/日程/大文件绝不入库。
> 你的分工范围：FIT 图表与数据可视化（`src/FitReview.tsx`、`src/fitCharts.ts`）及其测试；领域数据与佳明接口的改动请先提需求。
> 新版本号规则：`app.json` 的 `expo.version` 与 `android.versionCode` 同步 +1，安装包走 GitHub Releases，不提交进仓库。

---

## 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-11-24 | 建立仓库与 CI；发布 v0.1.3（Windows）、v0.1.4（Windows + Android）；上线自动归类、评估追问、展示精简、AI 会话头修复 |
| 2026-11-25 | 新增本协作说明；FIT 图表重构进行中（目标 0.1.6） |
