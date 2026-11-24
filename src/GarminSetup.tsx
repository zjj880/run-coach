import { useEffect, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { aiRequest, Button, Dialog, errorMessage, Field, isWindowsDesktop } from './AiTools';
import { syncGarminDaily, syncGarminDetails, validateGarminKey, type GarminSnapshot, type GarminSync } from './garmin';

const secretName = 'run-coach.garmin-cn.personal-key';
const chinaKeyPage = 'https://connect.garmin.cn/app/settings/personalApiToken';

function desktopPreview() {
  return isWindowsDesktop() || Platform.OS !== 'web' || (typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname));
}

async function nativeStorage() {
  const storage = await import('expo-secure-store');
  if (!await storage.isAvailableAsync()) throw new Error('系统凭据存储不可用，请用新的安卓内测包。');
  return storage;
}

async function isConnected() {
  if (Platform.OS === 'web') return (await aiRequest<{ connected: boolean }>('/garmin/settings')).connected;
  return Boolean(await (await nativeStorage()).getItemAsync(secretName));
}

export async function pullGarmin(date: string, input?: string): Promise<GarminSync> {
  if (!desktopPreview()) throw new Error('请在手机原生 App 或电脑本机预览中连接佳明。');
  if (Platform.OS === 'web') {
    return aiRequest<GarminSync>(input ? '/garmin/connect' : '/garmin/sync', 'POST', input ? { date, key: input } : { date });
  }
  const storage = await nativeStorage();
  const key = input ? validateGarminKey(input) : await storage.getItemAsync(secretName);
  if (!key) throw new Error('请先连接佳明。');
  const snapshot = await syncGarminDaily(key, date);
  if (input) await storage.setItemAsync(secretName, key);
  return snapshot;
}

export async function pullGarminDetails(ids: string[]) {
  if (Platform.OS === 'web') {
    if (!desktopPreview()) throw new Error('请在电脑 App 或手机原生 App 同步佳明明细。');
    return (await aiRequest<{ details: Awaited<ReturnType<typeof syncGarminDetails>> }>('/garmin/details', 'POST', { ids })).details;
  }
  const key = await (await nativeStorage()).getItemAsync(secretName);
  if (!key) throw new Error('请先连接佳明。');
  return syncGarminDetails(key, ids);
}

export function GarminSetup({ date, latest, onSync, onDisconnect, onClose }: {
  date: string; latest?: GarminSnapshot; onSync: (data: GarminSync) => void; onDisconnect: () => void; onClose: () => void;
}) {
  const [input, setInput] = useState('');
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  const canConnect = desktopPreview();
  useEffect(() => {
    let alive = true;
    if (!canConnect) { setBusy(false); return; }
    isConnected().then((result) => { if (alive) setConnected(result); })
      .catch((error) => { if (alive) setMessage(errorMessage(error)); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [canConnect]);

  async function run(withKey: boolean) {
    setBusy(true);
    setMessage('');
    try {
      const data = await pullGarmin(date, withKey ? validateGarminKey(input) : undefined);
      onSync(data);
      setConnected(true);
      setInput('');
      setMessage(data.unavailable.length ? '已更新可用数据。缺少：' + data.unavailable.join('、') + '。' : '已同步今日指标和近期活动。');
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }

  async function disconnect() {
    setBusy(true);
    try {
      if (Platform.OS === 'web') await aiRequest('/garmin/settings', 'DELETE');
      else await (await nativeStorage()).deleteItemAsync(secretName);
      setConnected(false);
      setInput('');
      onDisconnect();
      setMessage('已断开佳明连接。');
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }

  return <Dialog title="连接佳明中国区" onClose={onClose}>
    <Text style={styles.body}>同步当天睡眠、夜间 HRV、静息心率和最近 14 天活动。训练结束后，先打开 Garmin Connect，让手表完成同步。</Text>
    {canConnect ? <>
      <Text style={styles.label}>{connected ? '已连接' : '尚未连接'}</Text>
      {latest && <Text style={styles.body}>最近同步 · {new Date(latest.syncedAt).toLocaleString('zh-CN')}</Text>}
      <Field label="佳明个人 API 密钥" value={input} onChangeText={setInput} secure placeholder={connected ? '填写新密钥可重新绑定' : '在中国区 Garmin Connect 创建'} maxLength={246} />
      <View style={styles.actions}>
        <Button label={busy ? '同步中…' : '连接并同步'} onPress={() => run(true)} disabled={busy || !input.trim()} />
        {connected && <Button label="立即同步" secondary onPress={() => run(false)} disabled={busy} />}
        {connected && <Button label="断开连接" secondary onPress={disconnect} disabled={busy} />}
      </View>
      <Button label="去佳明创建密钥" secondary onPress={() => { Linking.openURL(chinaKeyPage).catch(() => setMessage('请打开中国区 Garmin Connect 网页创建密钥。')); }} />
      <Text style={styles.body}>{isWindowsDesktop() ? '密钥由 Windows 加密并保存在这台电脑上。'
        : Platform.OS === 'web' ? '网页预览的密钥保存在电脑本机服务内存中。' : '手机的密钥保存在系统凭据存储中。'}</Text>
    </> : <Text style={styles.label}>请在原生 App 或电脑本机预览中绑定佳明。</Text>}
    {message !== '' && <Text accessibilityRole="alert" style={styles.message}>{message}</Text>}
  </Dialog>;
}

const styles = StyleSheet.create({
  body: { fontSize: 13, lineHeight: 20, color: '#566960' },
  label: { fontSize: 14, color: '#162f29', fontWeight: '700' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  message: { fontSize: 13, lineHeight: 20, color: '#162f29', backgroundColor: '#e6f1e7', borderRadius: 8, padding: 9 },
});
