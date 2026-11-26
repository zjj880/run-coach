import { brandTheme } from './brandTheme';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Dialog, Field } from './AiTools';
import type { Activity, ActivityFeedback } from './training';

const empty: ActivityFeedback = { effort: null, sensor: '未注明', heartRateTrust: '未评估', cold: false, note: '' };

export function ActivityFeedbackDialog({ activity, onSave, onClose }: {
  activity: Activity; onSave: (feedback: ActivityFeedback | undefined) => void; onClose: () => void;
}) {
  const [feedback, setFeedback] = useState(activity.feedback ?? empty);
  const update = <K extends keyof ActivityFeedback>(key: K, value: ActivityFeedback[K]) => {
    setFeedback((previous) => ({ ...previous, [key]: value }));
  };

  function save() {
    const next = { ...feedback, note: feedback.note.trim() };
    onSave(next.effort !== null || next.sensor !== '未注明' || next.heartRateTrust !== '未评估' || next.cold || next.note ? next : undefined);
  }

  return <Dialog title="这节课的体感" onClose={onClose}
    footer={<Button label="保存课后体感" onPress={save} />}>
    <Text style={styles.info}>{activity.title} · {activity.time} · {activity.role}</Text>
    <Text style={styles.label}>主观用力程度（RPE）</Text>
    <Text style={styles.info}>0 几乎没用力 · 5 中等吃力 · 10 接近极限</Text>
    <View style={styles.options}>
      <Choice value="未填" selected={feedback.effort === null} onPress={() => update('effort', null)} />
      {Array.from({ length: 11 }, (_, score) => <Choice key={score} value={String(score)} label={`RPE ${score}`}
        selected={feedback.effort === score} onPress={() => update('effort', score)} />)}
    </View>
    <Text style={styles.label}>心率来源</Text>
    <View style={styles.options}>{(['未注明', '腕式', '胸带'] as const).map((value) => <Choice key={value} value={value}
      selected={feedback.sensor === value} onPress={() => update('sensor', value)} />)}</View>
    <Text style={styles.label}>这次心率读数</Text>
    <View style={styles.options}>{(['未评估', '可信', '存疑'] as const).map((value) => <Choice key={value} value={value}
      selected={feedback.heartRateTrust === value} onPress={() => update('heartRateTrust', value)} />)}
      <Choice value="天气偏冷" selected={feedback.cold} onPress={() => update('cold', !feedback.cold)} />
    </View>
    <Field label="课后备注" value={feedback.note} onChangeText={(value) => update('note', value)} multiline maxLength={400}
      placeholder="例如：呼吸轻松但腿很重，前 10 分钟腕表心率跳高。" />
  </Dialog>;
}

function Choice({ value, label, selected, onPress }: { value: string; label?: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label ?? value} accessibilityState={{ selected }}
    onPress={onPress} style={[styles.choice, selected && styles.selected]}>
    <Text style={styles.label}>{value}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  choice: { paddingHorizontal: 10, paddingVertical: 8, minWidth: 35, alignItems: 'center', borderRadius: 8, borderWidth: 1, borderColor: brandTheme.controlBorder },
  selected: { backgroundColor: brandTheme.tint, borderColor: brandTheme.selectedBorder },
  label: { color: brandTheme.ink, fontSize: 14, fontWeight: '700' },
  info: { color: brandTheme.muted, fontSize: 13, lineHeight: 19 },
});
