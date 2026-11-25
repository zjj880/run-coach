import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Button, Dialog, errorMessage, Field } from './AiTools';
import { pullGarminHistory } from './GarminSetup';
import { addDays, dateIsValid } from './training';
import type { GarminHistory } from './garmin';

export function HistorySync({ today, onDone, onClose }: {
  today: string;
  onDone: (history: GarminHistory) => void;
  onClose: () => void;
}) {
  const [from, setFrom] = useState(addDays(today, -55));
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  async function run() {
    const start = from.trim();
    const end = to.trim();
    if (!dateIsValid(start) || !dateIsValid(end)) { setNotice('请输入 YYYY-MM-DD 格式的有效日期。'); return; }
    if (start > end) { setNotice('起始日期不能晚于结束日期。'); return; }
    setBusy(true);
    setNotice('正在从佳明拉取活动，活动较多时可能需要一两分钟…');
    try {
      const history = await pullGarminHistory(start, end);
      if (!history.activities.length) { setNotice('这个日期范围内没有读到活动。'); return; }
      onDone(history);
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setBusy(false); }
  }

  return <Dialog title="同步历史活动" onClose={onClose} footer={<>
    <Button label={busy ? '同步中…' : '开始同步'} onPress={() => void run()} disabled={busy} />
  </>}>
    <Text style={styles.body}>按日期范围从佳明中国区拉取活动摘要，每页 100 条自动翻页，一次最多 366 天。只导入活动，睡眠/HRV/静息心率仍按每日同步。</Text>
    <Field label="开始日期" value={from} onChangeText={setFrom} placeholder="YYYY-MM-DD" />
    <Field label="结束日期" value={to} onChangeText={setTo} placeholder="YYYY-MM-DD" />
    <Text style={styles.small}>导入后会自动按心率/配速归类；已存在的同一活动会保留你手动确认过的归属。想同步更早的记录，改日期段再跑一次即可。</Text>
    {notice !== '' && <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text>}
  </Dialog>;
}

const styles = StyleSheet.create({
  body: { fontSize: 13, lineHeight: 20, color: '#566960' },
  small: { color: '#566960', fontSize: 12, lineHeight: 18 },
  notice: { backgroundColor: '#e6f1e7', color: '#162f29', fontSize: 13, lineHeight: 19, borderRadius: 8, padding: 10 },
});
