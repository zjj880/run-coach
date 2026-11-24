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
for (const file of ['training.ts', 'garmin.ts', 'fit.ts']) cpSync(join(project, 'src', file), join(runtime, 'src', file));
for (const dependency of ['@garmin/fitsdk', 'fflate']) cpSync(join(project, 'node_modules', dependency), join(runtime, 'node_modules', dependency), { recursive: true });
cpSync(web, join(runtime, 'web'), { recursive: true });
writeFileSync(join(output, '使用说明.txt'), '\ufeff跑步教练 Windows x64 内测版 ' + version +
  '\r\n完整解压后，双击 RunCoach.exe。运行文件与目录请放在一起。\r\n' +
  '佳明绑定：我的 → 连接佳明 → 填写中国区个人 API 密钥 → 连接并同步。\r\n' +
  '手机和电脑各自保存课表与打卡。分别绑定同一佳明账号，可各自读取手表数据。\r\n');
console.log('Windows App:', join(output, 'RunCoach.exe'));
