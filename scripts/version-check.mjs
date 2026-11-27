import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 版本号单一来源校验：app.json 是唯一真源，package.json 与 git tag 必须一致。 */
const project = fileURLToPath(new URL('../', import.meta.url));
const app = JSON.parse(readFileSync(join(project, 'app.json'), 'utf8')).expo;
const pkg = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8'));

const problems = [];
const version = app.version;
const versionCode = app.android?.versionCode;

if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) problems.push('app.json 的 expo.version 必须是 x.y.z 形式，当前：' + version);
if (!Number.isInteger(versionCode) || versionCode < 1) problems.push('app.json 的 expo.android.versionCode 必须是正整数，当前：' + versionCode);
if (pkg.version !== version) problems.push('package.json version（' + pkg.version + '）必须与 app.json（' + version + '）一致');

// 版本号与 versionCode 的历史序列（新增版本时在这里追加一行）
const history = [
  ['0.1.3', 4], ['0.1.4', 5], ['0.1.6', 7], ['0.1.7', 8],
  ['0.4.1', 15], ['0.5.0', 16], ['0.6.0', 17], ['0.7.0', 18], ['0.7.1', 19], ['0.8.0', 20],
];
const known = history.find(([v]) => v === version);
if (!known) problems.push('版本 ' + version + ' 未登记在 scripts/version-check.mjs 的 history 里');
else if (known[1] !== versionCode) problems.push('版本 ' + version + ' 的 versionCode 应为 ' + known[1] + '，当前 ' + versionCode);
else {
  const index = history.indexOf(known);
  if (index > 0) {
    const [previousVersion, previousCode] = history[index - 1];
    const toNumber = (v) => v.split('.').map(Number);
    const [a, b] = [toNumber(previousVersion), toNumber(version)];
    const ordered = a[0] !== b[0] ? b[0] > a[0] : a[1] !== b[1] ? b[1] > a[1] : b[2] > a[2];
    if (!ordered) problems.push('版本号没有递增：' + previousVersion + ' → ' + version);
    if (versionCode <= previousCode) problems.push('versionCode 没有递增：' + previousCode + ' → ' + versionCode);
  }
}

if (problems.length) {
  console.error('版本号校验失败：');
  for (const problem of problems) console.error('  - ' + problem);
  process.exit(1);
}
console.log('版本号校验通过：app ' + version + '（versionCode ' + versionCode + '），package.json 一致');
