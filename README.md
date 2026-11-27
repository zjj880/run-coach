# 跑步教练

[![CI](https://github.com/zjj880/run-coach/actions/workflows/ci.yml/badge.svg)](https://github.com/zjj880/run-coach/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/zjj880/run-coach?include_prereleases&label=release)](https://github.com/zjj880/run-coach/releases)

Expo + React Native + TypeScript 试用版，支持在手机或浏览器上查看。演示课表和反馈保存在当前设备。

> ⚠️ **下载前请先阅读 [《使用指南》](docs/使用指南.md)** —— 安装启动、佳明绑定、AI 接口配置、Excel/CSV 导入、训练周期与常见问题都在里面。先读指南再下载，能少走很多弯路。

## 下载

> 📖 **下载前请先读 [《使用指南》](docs/使用指南.md)**（约 10 分钟）。安装包不含使用说明文档，遇到问题先对照指南的「常见问题」一节。

| 平台 | 安装包 | 说明 |
| --- | --- | --- |
| Windows x64 | [Jiaowopao-Windows-0.9.0-x64.zip](https://github.com/zjj880/run-coach/releases/download/v0.9.0/Jiaowopao-Windows-0.9.0-x64.zip) | 解压后双击 `RunCoach.exe`，目录内文件需放在一起 |
| Linux x64 | [Jiaowopao-Linux-0.9.0-x64.tar.gz](https://github.com/zjj880/run-coach/releases/download/v0.9.0/Jiaowopao-Linux-0.9.0-x64.tar.gz) | 解压后 `chmod +x RunCoach chrome-sandbox`，再 `./RunCoach` |
| Android（arm64 内测） | [Jiaowopao-Android-0.9.0.apk](https://github.com/zjj880/run-coach/releases/download/v0.9.0/Jiaowopao-Android-0.9.0.apk) | 本地调试签名，仅 arm64 设备，需允许安装未知来源应用 |

全部版本、大小与 SHA-256 见 [Releases](https://github.com/zjj880/run-coach/releases)。

开发协作和功能边界见 [HANDOFF.md](HANDOFF.md)；**AI 智能体（ChatGPT/Codex 等）接手开发请先读 [AGENTS.md](AGENTS.md)**。

## 启动

使用 Node.js 24，在本目录执行：

~~~powershell
npm ci
npm run web -- --localhost --port 8090
~~~

浏览器打开 http://localhost:8090。要用手机体验，运行 npm start -- --lan，手机与电脑连接同一网络，在支持此项目 Expo SDK 的 Expo Go 中扫终端二维码。

同一 Wi-Fi 上也可使用网页版手机体验。先运行 npm run phone:build，再运行 npm run phone:serve，在手机浏览器打开终端打印的局域网地址。Safari 可通过分享菜单添加到主屏幕。此预览服务只提供构建后的网页资源；手机浏览器预览的 AI 仍需本机服务，原生 App 可直接配置模型接口。

### Windows 电脑版

完整解压电脑内测包，双击目录内的 `RunCoach.exe`。程序内置运行环境和本机接口服务，可在「我的」绑定佳明中国区和设置 AI 接口。密钥由 Windows 加密保存在当前用户配置中。课表、活动归类和打卡同样保存在当前电脑。电脑和手机可分别从同一佳明账号读取手表数据。

开发时在 Windows x64 执行 `npm ci`，再执行 `npm run windows:build`。输出默认在 `dist/RunCoach-Windows-版本号`。如果运行时尚未下载，先执行 `node node_modules/electron/install.js`。生成的整个目录可用于分发。

### 本地构建安卓验证包

准备 JDK 17 和与 Expo SDK 58 匹配的 Android SDK，在项目目录运行 npx expo prebuild --platform android。Windows 上进入生成的 android 目录，运行 .\gradlew.bat :app:assembleRelease。APK 位于 android/app/build/outputs/apk/release。预览包名为 com.runcoach.preview。Expo 模板的本地签名适用于内测，发布时须改为团队正式签名。

Windows 上请把项目解压到较短的英文路径，例如 C:\src\run-coach，以减少 CMake 对象文件路径超限的情况。

~~~powershell
npm run typecheck
npm test
~~~

## AI 识别导入课表

在另一个终端运行 npm run ai，启动仅监听 127.0.0.1:8091 的开发服务。使用电脑浏览器的 App 预览完成下列操作。

1. 进入「我的 → 设置 AI 接口」，输入兼容 Chat Completions 的 HTTPS 基础地址、模型名称和 API 密钥，点击「测试并保存」。基础地址应包含服务商要求的版本路径，例如 /v1，也可填完整的 /chat/completions 地址。配置保存在本机服务内存里。
2. 进入「课表 → 识别导入」，粘贴训练文字或选择 PNG、JPEG、WebP、TXT、CSV 文件。图片需要支持视觉输入的模型。材料仅在点「让 AI 识别」后发给配置的服务。
3. 课表用“第几周、周几”时，指定第 1 周周一的日期。返回的训练可以改日期、类型、时长和内容，也可跳过某条。只有里程或组次的训练可留空时长。
4. 确认导入后显示结果。相同训练跳过，同一天的不同训练可追加。若已选「替换未修改的示例课表」，原先调整过的课和手动录入的课仍保留。

AI 设置支持 Windows 电脑版和电脑浏览器开发预览。手机端可直接在「我的 → AI 接口」填写模型接口，密钥保存在手机系统安全存储；电脑版与浏览器预览走本机服务。

## AI 训练评估与晨间打卡

- 「今天」首页直接点选今早起床感受，建议随之更新。「补充晨间打卡」可填写不适、可用时间和日程。
- 在「今天 → 和 AI 教练聊聊」参考课表、打卡、恢复指标和近期训练继续对话。AI 可先追问，再给出训练、休息和饮食方案。点「确认今日方案」后显示在首页。改课仍由你在课表确认。
- 「课表」的第三列是「训练评估」。先查看计划、实际总量和时长差，再点「用 AI 评估」。有活动即可评估，待归类活动计入总量。生成后可就同一份评估继续追问。
- 自动归类会结合计划时长、配速、可用心率和活动先后顺序。手动标记活动归属后，后续同步会保留该标记。运动明细和 FIT 曲线可以在评估面板展开查看。
- 评估只发送所选日期的生效课表和活动摘要。页面展示计划与执行、配速与心率、下次建议和数据局限。评估保存在当前设备。课表或活动变更后标注「待重新评估」。
- 对已同步的佳明活动，可在评估窗点「同步佳明明细与 FIT」。应用读取详情 JSON，并从佳明下载原始活动 FIT，用官方 SDK 解析实际记录圈和心率采样。圈配速使用该圈计时器时长和距离。数据取决于设备记录，图中长时间缺采样会留空。
- 「展开运动数据和曲线」可查看逐圈配速柱状图和时间心率曲线。点圈速柱查看该圈配速和心率，点心率图读取附近的采样。
- 每节活动可填 RPE（0–10）、心率来源、读数是否存疑、天气偏冷以及课后备注。评估会结合体感、计划、设备圈和心率分段统计。原始 FIT、GPS 和完整采样序列留在评估请求之外。保存体感或同步数据后，之前的评估会标记待重新评估。
- 打开「补充晨间打卡」，可选腿痛、脚痛等常见项目，展开更多选项或填写其他不适。填好心情、备注后可生成 AI 回应，生成时只发送这两项，保存打卡后可在首页查看。

## 同步佳明中国区

1. 在安卓内测 App 打开「我的 → 连接佳明」，输入中国区 Garmin Connect 的个人 API 密钥，点「连接并同步」。密钥保存在手机的系统凭据存储中，手机直接访问佳明中国区。
2. 在「今天」查看当天睡眠、夜间 HRV 和静息心率。已同步的数据和晨间打卡、当天课表一起参与建议计算。手表没有上传的指标显示为未同步。
3. 训练后先在 Garmin Connect 确认活动已经上传。打开或回到本 App 会自动检查更新，也可在「课表」点「立即同步佳明」。每次拉取最近 14 天活动，按开始日期写入实际执行。重复同步按佳明活动 ID 合并，保留你确认的主课、次课、热身和冷身。

自动检查在 App 启动或回到前台时触发。同一设备上的桌面浏览器可用 `npm run ai` 启动本机代理，密钥只保存在服务内存，服务重启后需重新连接。

## 日程与训练时间

- 浏览器可从「今天 → 日程与训练时间」导入 .ics，或手动添加忙碌时段。从当前选中日期起导入 60 天，日程数据保存在当前设备。日历变更后可重新导入文件。
- 选中日期的空档按训练时间范围减去忙碌时段计算。点一个空档，或自定义其中的一段，标为该日训练时间。当天建议会考虑选中的时长。重新同步造成冲突时，请重新标注。
- 手机的「读取系统日历」需要由项目生成的 iOS/Android 开发构建及系统权限。Expo Go 可使用文件导入和手动时段，不含系统日历模块。

## 试用步骤

1. 打开「今天」，做一次晨间打卡。选「偏累」，把训练时间改成 25 分钟。与 AI 教练聊出方案后确认。
2. 在「课表」查看当前训练、原课和调整原因。可设置起始日期和周数，或按日添加和调整训练。
3. 在「我的」点「同步演示跑步」。回到课表，把间歇跑标为主课、晚间轻松跑标为次课，再把两条晨跑分别归到主课的热身和冷身。重复同步应保留归类，整日共 70 分钟。
4. 回到「今天」查看训练后建议。选「发热」重新打卡，观察系统是否改为休息。
5. 在「我的」切换「模拟数据缺失」，验证首页还能依据课表和打卡给出建议。

## 后续接入

- App 入口在 App.tsx，课表调整、活动归类和建议规则在 src/training.ts，关键场景放在 test/training.test.mjs。
- 佳明接口适配器在 src/garmin.ts，连接入口和本机凭据管理在 src/GarminSetup.tsx。每日建议由本地规则生成。
- 当前保存本机数据。多人协作阶段，将课表版本、改课记录和活动归类迁移到后端存储，并按用户授权共享。
