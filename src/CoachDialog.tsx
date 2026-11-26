import { brandTheme } from './brandTheme';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { aiRequest, Button, Dialog, errorMessage, Field } from './AiTools';
import type { CoachDay, CoachTurn } from './coach';

const empty: CoachDay = { messages: [] };

export function CoachDialog({ day = empty, context, onSave, onClose }: {
  day?: CoachDay; context: object; onSave: (day: CoachDay) => void; onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const signature = JSON.stringify(context);
  const draft = day.draft?.signature === signature ? day.draft.proposal : undefined;
  const confirmed = day.confirmed?.signature === signature;

  async function send(message: string) {
    const input = message.trim();
    if (busy || !input) return;
    setBusy(true);
    setError('');
    const messages = [...day.messages, { role: 'user' as const, text: input }];
    try {
      const { reply, proposal } = await aiRequest<CoachTurn>('/ai/coach', 'POST', { context, messages: messages.slice(-13) });
      onSave({ ...day, messages: [...messages, { role: 'assistant', text: reply }],
        draft: proposal ? { signature, proposal } : undefined });
      setText('');
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }

  return <Dialog title="今日教练对话" followContent onClose={() => { if (!busy) onClose(); }}
    footer={<>
      <Button label={busy ? '教练正在回复…' : '发送'} onPress={() => void send(text)} disabled={busy || !text.trim()} />
      {draft && <Button secondary label="确认今日方案" onPress={() => {
        onSave({ ...day, confirmed: { signature, proposal: draft }, draft: undefined });
        onClose();
      }} disabled={busy || Boolean(text.trim())} />}
    </>}>
    <Text style={styles.body}>教练会参考今日课表、打卡、恢复指标和近期训练。你可以补充情况、要求换个方案，满意后再确认。</Text>
    {confirmed && <Text style={styles.body}>当前已确认 · {day.confirmed?.proposal.title}</Text>}
    {day.messages.map((message, index) => <View key={index} style={[styles.bubble, message.role === 'user' && styles.mine]}>
      <Text style={styles.label}>{message.role === 'user' ? '你' : 'AI 教练'}</Text>
      <Text style={styles.body}>{message.text}</Text>
    </View>)}
    {draft && <View style={styles.bubble}><Text style={styles.label}>待确认 · {draft.title}</Text>
      <Text style={styles.body}>训练 · {draft.training}</Text>
      <Text style={styles.body}>休息 · {draft.recovery}</Text>
      <Text style={styles.body}>饮食 · {draft.nutrition}</Text>
    </View>}
    {day.messages.length === 0 && <Button secondary label="根据今天的情况开始聊" disabled={busy}
      onPress={() => void send('请根据今天的情况和我一起定方案。先告诉我你看到了什么，有影响决定的信息请向我确认。')} />}
    <Field label="补充情况或提出调整" multiline maxLength={600} value={text} onChangeText={setText} placeholder="例：我今天只能抽出 20 分钟，课表怎么调整？" />
    {error !== '' && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
  </Dialog>;
}

const styles = StyleSheet.create({
  bubble: { backgroundColor: brandTheme.soft, borderRadius: 10, padding: 10, gap: 4 },
  mine: { marginLeft: 28, backgroundColor: brandTheme.paper },
  body: { color: brandTheme.bodyInk, fontSize: 14, lineHeight: 21 },
  label: { color: brandTheme.ink, fontWeight: '700', fontSize: 14 },
  error: { color: '#8c2929', fontSize: 14 },
});
