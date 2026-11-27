import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const version = JSON.parse(readFileSync(join(project, 'app.json'), 'utf8')).expo.version;
const output = resolve(process.argv[2] ?? join(project, 'dist', 'RunCoach-Windows-' + version));
const web = join(project, '.expo', 'windows-web');
const electronFolder = dirname(require('electron'));
const appIcon = join(project, 'assets', 'app.ico');

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('请在 Windows x64 上构建电脑版本。');
if (existsSync(output)) throw new Error('请选择新的输出目录，避免覆盖已有内测包。');
const build = spawnSync(process.execPath, [join(project, 'node_modules', 'expo', 'bin', 'cli'),
  'export', '--platform', 'web', '--output-dir', web], { cwd: project, stdio: 'inherit' });
if (build.status !== 0) throw new Error('电脑界面构建失败。');
cpSync(electronFolder, output, { recursive: true });
renameSync(join(output, 'electron.exe'), join(output, 'RunCoach.exe'));

const runtime = join(output, 'resources', 'app');
mkdirSync(runtime, { recursive: true });
writeFileSync(join(runtime, 'package.json'), JSON.stringify({
  name: 'RunCoach', version, main: 'desktop/main.mjs', type: 'module',
}));
for (const folder of ['desktop', 'server']) cpSync(join(project, folder), join(runtime, folder), { recursive: true });
mkdirSync(join(runtime, 'src'));
for (const file of ['training.ts', 'garmin.ts', 'fit.ts', 'activityWeather.ts', 'aiCore.ts', 'providers.ts']) cpSync(join(project, 'src', file), join(runtime, 'src', file));
for (const dependency of ['@garmin/fitsdk', 'fflate']) cpSync(join(project, 'node_modules', dependency), join(runtime, 'node_modules', dependency), { recursive: true });
cpSync(web, join(runtime, 'web'), { recursive: true });

// 品牌图标：放进安装目录，并写进 exe 资源（桌面/任务栏/开始菜单都显示这个）
cpSync(appIcon, join(output, 'app.ico'));
cpSync(appIcon, join(runtime, 'web', 'favicon.ico'));

// 改 exe 的版本信息与图标：用户在「属性」里看到的是 0.7.1 而不是 Electron 的 45.4.1
const rceditPath = join(project, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe');
if (existsSync(rceditPath)) {
  const result = spawnSync(rceditPath, [
    join(output, 'RunCoach.exe'),
    '--set-icon', appIcon,
    '--set-file-version', version,
    '--set-product-version', version,
    '--set-version-string', 'ProductName', '交我跑',
    '--set-version-string', 'FileDescription', '交我跑 · 跑步训练助手',
    '--set-version-string', 'CompanyName', '交我跑',
    '--set-version-string', 'OriginalFilename', 'RunCoach.exe',
    '--set-version-string', 'LegalCopyright', 'Copyright (c) 交我跑',
  ], { stdio: 'inherit' });
  if (result.status !== 0) console.warn('警告：写入 exe 版本信息失败，图标/版本号可能仍是 Electron 默认值。');
} else {
  console.warn('警告：未找到 rcedit，跳过 exe 版本信息与图标设置（先运行 npm i -D rcedit）。');
}

writeFileSync(join(output, '使用说明.txt'), '\ufeff交我跑 Windows x64 内测版 ' + version +
  '\r\n完整解压后，双击 RunCoach.exe。运行文件与目录请放在一起。\r\n' +
  '首次使用建议双击「创建桌面快捷方式.cmd」，会在桌面放一个带图标的「交我跑」快捷方式。\r\n' +
  '佳明绑定：我的 → 连接佳明 → 打开佳明密钥页 → 粘贴密钥 → 连接并同步。\r\n' +
  'AI 配置：我的 → AI 接口 → 点服务商（DeepSeek/OpenAI/OpenRouter）→ 粘贴密钥 → 测试并保存。\r\n' +
  '手机和电脑各自保存课表与打卡。分别绑定同一佳明账号，可各自读取手表数据。\r\n');

writeFileSync(join(output, '创建桌面快捷方式.cmd'), [
  '@echo off',
  'chcp 65001 >nul',
  'set HERE=%~dp0',
  'set TARGET=%HERE%RunCoach.exe',
  'set ICON=%HERE%app.ico',
  'powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath(\'Desktop\')+\'\\交我跑.lnk\'); $s.TargetPath=\'%TARGET%\'; $s.WorkingDirectory=\'%HERE%\'; if (Test-Path \'%ICON%\') { $s.IconLocation=\'%ICON%\',0 }; $s.Description=\'交我跑\'; $s.Save()"',
  'echo 已在桌面创建「交我跑」快捷方式，双击即可启动。',
  'pause',
].join('\r\n'), 'utf8');

console.log('Windows App:', join(output, 'RunCoach.exe'), '(版本 ' + version + ')');
