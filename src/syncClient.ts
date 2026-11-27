import type { CoachState } from './training';
import { normalizeSyncAddress } from './dataBundle.ts';
import type { SyncSummary } from './sync.ts';

/** 手机侧：把本机数据提交给电脑的配对服务，拿回合并后的结果。 */

export type JoinResult = { summary: SyncSummary; state: CoachState };

export async function joinDesktop(input: {
  address: string;
  code: string;
  state: CoachState;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<JoinResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const code = (input.code || '').trim();
  if (!/^\d{6}$/.test(code)) throw new Error('请输入电脑上显示的 6 位配对码。');
  const base = normalizeSyncAddress(input.address);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 60_000);
  let response: Response;
  try {
    response = await fetchImpl(base + '/sync/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, state: input.state }),
      signal: controller.signal,
    });
  } catch (error) {
    const aborted = controller.signal.aborted;
    throw new Error(aborted
      ? '连接电脑超时：确认手机和电脑在同一个 Wi-Fi，且电脑上的配对码还在有效期内。'
      : '连不上电脑：确认地址正确、电脑开着，并和手机在同一个 Wi-Fi（校园网可能隔离设备）。');
  } finally {
    clearTimeout(timer);
  }
  const data = (await response.json().catch(() => null)) as (JoinResult & { error?: string }) | null;
  if (!response.ok || !data?.state) {
    throw new Error(data?.error || '同步失败：电脑没有返回数据，请重试。');
  }
  return { summary: data.summary, state: data.state };
}
