import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate';
import type { CoachState } from './training';

/** 数据包（C 方案兜底）：把整个 CoachState 压成可发送的文本，换设备时导入合并。 */

export const bundlePrefix = 'JIAOWOPAO-BUNDLE-1:';

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  if (typeof btoa === 'function') return btoa(binary);
  // Node / 测试环境
  return Buffer.from(bytes).toString('base64');
};

const fromBase64 = (text: string): Uint8Array => {
  if (typeof atob === 'function') {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }
  return new Uint8Array(Buffer.from(text, 'base64'));
};

export function encodeBundle(state: CoachState): string {
  const payload = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), state });
  return bundlePrefix + toBase64(gzipSync(strToU8(payload)));
}

export type DecodedBundle = { state: CoachState; exportedAt?: string };

export function decodeBundle(text: string): DecodedBundle {
  const trimmed = (text || '').trim();
  try {
    if (trimmed.startsWith(bundlePrefix)) {
      const payload = strFromU8(gunzipSync(fromBase64(trimmed.slice(bundlePrefix.length))));
      const parsed = JSON.parse(payload) as { state?: CoachState; exportedAt?: string };
      if (!parsed?.state || typeof parsed.state !== 'object') throw new Error('empty');
      return { state: parsed.state, exportedAt: parsed.exportedAt };
    }
    const parsed = JSON.parse(trimmed) as { state?: CoachState; exportedAt?: string };
    if (!parsed?.state || typeof parsed.state !== 'object') throw new Error('empty');
    return { state: parsed.state, exportedAt: parsed.exportedAt };
  } catch {
    throw new Error('数据包无法解析，请确认文件没有损坏或是本 App 导出的。');
  }
}

export function bundleFilename(date = new Date()): string {
  const stamp = date.toISOString().slice(0, 10);
  return 'jiaowopao-data-' + stamp + '.jwx';
}

/** 手机端输入的电脑地址做归一化：允许只填 IP、带不带 http:// 都行。 */
export function normalizeSyncAddress(input: string, port = 8093): string {
  const raw = (input || '').trim();
  if (!raw) throw new Error('请填写电脑上显示的地址。');
  const withScheme = /^https?:\/\//i.test(raw) ? raw : 'http://' + raw;
  let url: URL;
  try { url = new URL(withScheme); } catch { throw new Error('地址格式不对，例如 10.181.114.174:8093。'); }
  const host = url.hostname;
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(host) && host !== 'localhost') throw new Error('请填写电脑的局域网 IP 地址。');
  const finalPort = url.port || String(port);
  return 'http://' + host + ':' + finalPort;
}
