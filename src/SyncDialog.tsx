import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { aiRequest, Button, Dialog, errorMessage, Field } from './AiTools';
import { encodeBundle, decodeBundle, normalizeSyncAddress } from './dataBundle';
import { pickBundleText, shareBundleText } from './fileTransfer';
import { joinDesktop } from './syncClient';
import { mergeStates, type SyncSummary } from './sync';
import { writeClipboardText } from './externalLinks';
import { brandTheme } from './brandTheme';
import type { CoachState } from './training';

type HostInfo = { code: string; port: number; urls: string[]; expiresAt?: string };

const summaryText = (summary: SyncSummary): string =>
  '活动 +' + summary.activities.added + ' / 更新 ' + summary.activities.updated +
  '，计划 +' + summary.plan.added + '，笔记 +' + summary.notes +
  '，饮食 +' + summary.intake + '，喝水 +' + summary.water;

export function SyncDialog({ role, state, onMerged, onClose }: {
  role: 'desktop' | 'mobile';
  state: CoachState;
  onMerged: (state: CoachState, message: string) => void;
  onClose: () => void;
}) {
  const [host, setHost] = useState<HostInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  async function startHosting() {
    setBusy(true);
    setNotice('');
    try {
      const info = await aiRequest<HostInfo>('/sync/host', 'POST', { state });
      setHost(info);
      if (timer.current) clearInterval(timer.current);
      timer.current = setInterval(async () => {
        try {
          const result = await aiRequest<{ summary: SyncSummary; state: CoachState }>('/sync/fetch', 'POST', {});
          if (timer.current) clearInterval(timer.current);
          setHost(null);
          onMerged(result.state, '已与手机完成同步：' + summaryText(result.summary));
        } catch {
          // 手机还没连上来，继续等待
        }
      }, 2000);
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setBusy(false); }
  }

  async function cancelHosting() {
    if (timer.current) clearInterval(timer.current);
    setHost(null);
    try { await aiRequest('/sync/cancel', 'POST', {}); } catch { /* 忽略 */ }
  }

  async function join() {
    setBusy(true);
    setNotice('');
    try {
      const result = await joinDesktop({ address, code, state });
      onMerged(result.state, '已与电脑合并：' + summaryText(result.summary));
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setBusy(false); }
  }

  async function exportBundle() {
    setBusy(true);
    setNotice('');
    try {
      const mode = await shareBundleText(encodeBundle(state));
      setNotice(mode === 'downloaded' ? '数据包已开始下载，把它发到另一台设备后导入即可。' : '已打开分享面板，选择微信等发到另一台设备。');
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setBusy(false); }
  }

  async function importBundle() {
    setBusy(true);
    setNotice('');
    try {
      const picked = await pickBundleText();
      if (!picked) { setBusy(false); return; }
      const decoded = decodeBundle(picked.text);
      const merged = mergeStates(state, decoded.state);
      onMerged(merged.state, '已导入并合并：' + summaryText(merged.summary));
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setBusy(false); }
  }

  async function copyAddress(value: string) {
    const saved = await writeClipboardText(value);
    setNotice(saved ? '地址已复制，可以在手机里粘贴。' : '复制失败，请手动输入：' + value);
  }

  return <Dialog title="设备同步" onClose={onClose} footer={<>
    {role === 'mobile'
      ? <Button label={busy ? '同步中…' : '连接并合并'} onPress={join} disabled={busy || !address.trim() || !code.trim()} />
      : host
        ? <Button secondary label="取消配对" onPress={() => void cancelHosting()} />
        : <Button label={busy ? '生成中…' : '生成配对码'} onPress={() => void startHosting()} disabled={busy} />}
  </>}>
    {role === 'desktop' ? <>
      <Text style={styles.body}>手机与这台电脑连同一个 Wi-Fi 后，在手机「我的 → 设备同步」输入下面的地址和配对码，就能双向合并训练记录、打卡、笔记、饮食。</Text>
      {!host && <Text style={styles.muted}>点「生成配对码」后，配对码 5 分钟内有效。</Text>}
      {host && <>
        <Text style={styles.label}>配对码</Text>
        <Text style={styles.code}>{host.code}</Text>
        <Text style={styles.label}>手机里填的地址</Text>
        {host.urls.length === 0 && <Text style={styles.muted}>没有找到局域网地址，请确认电脑已连上 Wi-Fi。</Text>}
        {host.urls.map((url) => <Pressable key={url} accessibilityRole="button" onPress={() => void copyAddress(url.replace('http://', ''))} style={styles.urlRow}>
          <Text style={styles.url}>{url.replace('http://', '')}</Text>
          <Text style={styles.copy}>复制</Text>
        </Pressable>)}
        <Text style={styles.muted}>正在等待手机连入…（手机完成合并后这里会自动关闭）</Text>
      </>}
      <View style={styles.divider} />
      <Text style={styles.label}>连不上？用数据包</Text>
      <Text style={styles.muted}>在电脑上导出数据包，发到手机后导入合并；反向也行。</Text>
      <View style={styles.row}>
        <Button secondary label="导出数据包" onPress={() => void exportBundle()} disabled={busy} />
        <Button secondary label="导入数据包" onPress={() => void importBundle()} disabled={busy} />
      </View>
    </> : <>
      <Text style={styles.body}>在电脑上打开「我的 → 设备同步」生成配对码，然后把地址和 6 位数字填到这里。手机和电脑需要在同一个 Wi-Fi。</Text>
      <Field label="电脑地址" value={address} onChangeText={setAddress} placeholder="例如 10.181.114.174:8093" />
      <Field label="配对码" value={code} onChangeText={(text) => setCode(text.replace(/\D/g, '').slice(0, 6))} placeholder="电脑上显示的 6 位数字" />
      <Text style={styles.muted}>地址填一次即可，下次只需要配对码。{address.trim() ? '（' + normalizeSyncAddress(address) + '）' : ''}</Text>
      <View style={styles.divider} />
      <Text style={styles.label}>连不上？用数据包</Text>
      <Text style={styles.muted}>导出数据包发到电脑导入，或导入电脑发来的数据包。</Text>
      <View style={styles.row}>
        <Button secondary label="导出数据包" onPress={() => void exportBundle()} disabled={busy} />
        <Button secondary label="导入数据包" onPress={() => void importBundle()} disabled={busy} />
      </View>
    </>}
    {notice !== '' && <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text>}
  </Dialog>;
}

const styles = StyleSheet.create({
  body: { fontSize: 13, lineHeight: 20, color: brandTheme.muted },
  muted: { fontSize: 12, lineHeight: 18, color: brandTheme.hint },
  label: { fontSize: 14, fontWeight: '700', color: brandTheme.ink },
  code: { fontSize: 40, fontWeight: '800', letterSpacing: 9, color: brandTheme.accent },
  urlRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: brandTheme.border, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 8 },
  url: { fontSize: 14, color: brandTheme.ink, fontWeight: '700' },
  copy: { fontSize: 13, color: brandTheme.accent, fontWeight: '700' },
  divider: { height: 1, backgroundColor: brandTheme.border, marginVertical: 4 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  notice: { backgroundColor: brandTheme.tint, color: brandTheme.ink, fontSize: 13, lineHeight: 19, borderRadius: 8, padding: 9 },
});
