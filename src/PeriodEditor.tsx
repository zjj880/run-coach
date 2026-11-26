import { brandTheme } from './brandTheme';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Dialog, Field } from './AiTools';
import { addDays, dateIsValid, dateLabel, periodPresets, type TrainingPeriod } from './training';

const newId = () => 'period-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);

export function PeriodEditor({ periods, today, onSave, onClose }: {
  periods: TrainingPeriod[];
  today: string;
  onSave: (periods: TrainingPeriod[]) => void;
  onClose: () => void;
}) {
  const [list, setList] = useState<TrainingPeriod[]>(periods);
  const [name, setName] = useState<string>(periodPresets[0]);
  const [from, setFrom] = useState(addDays(today, -55));
  const [to, setTo] = useState(today);
  const [notice, setNotice] = useState('');

  function add() {
    const start = from.trim();
    const end = to.trim();
    const label = name.trim();
    if (!label) { setNotice('请填写周期名称。'); return; }
    if (!dateIsValid(start) || !dateIsValid(end)) { setNotice('请输入 YYYY-MM-DD 格式的有效日期。'); return; }
    if (start > end) { setNotice('开始日期不能晚于结束日期。'); return; }
    const overlap = list.find((period) => start <= period.to && end >= period.from);
    if (overlap) { setNotice('与「' + overlap.name + '」的日期重叠，请调整后再添加。'); return; }
    setList([...list, { id: newId(), name: label, from: start, to: end }].sort((left, right) => left.from.localeCompare(right.from)));
    setNotice('');
  }

  function remove(id: string) {
    setList(list.filter((period) => period.id !== id));
    setNotice('');
  }

  return <Dialog title="训练周期" onClose={onClose} footer={<>
    <Button label="保存周期" onPress={() => onSave(list)} />
  </>}>
    <Text style={styles.body}>按日期区间划分训练阶段（如基础期、专项期、调整期）。「记录」页会按阶段统计里程和天数，课表也会显示当天属于哪个阶段。</Text>

    <Text style={styles.label}>已有周期</Text>
    {list.length === 0 && <Text style={styles.small}>还没有周期，用下面表单添加第一个。</Text>}
    {list.map((period) => <View key={period.id} style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.label}>{period.name}</Text>
        <Text style={styles.small}>{dateLabel(period.from)} ~ {dateLabel(period.to)}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={'删除 ' + period.name} onPress={() => remove(period.id)}>
        <Text style={styles.remove}>删除</Text>
      </Pressable>
    </View>)}

    <Text style={styles.label}>添加周期</Text>
    <View style={styles.presets}>{periodPresets.map((preset) => <Pressable key={preset} accessibilityRole="button"
      onPress={() => setName(preset)} style={[styles.preset, name === preset && styles.presetActive]}>
      <Text style={[styles.small, name === preset && styles.presetTextActive]}>{preset}</Text>
    </Pressable>)}</View>
    <Field label="名称" value={name} onChangeText={setName} placeholder="例如 基础期" maxLength={20} />
    <Field label="开始日期" value={from} onChangeText={setFrom} placeholder="YYYY-MM-DD" />
    <Field label="结束日期" value={to} onChangeText={setTo} placeholder="YYYY-MM-DD" />
    <View style={styles.buttons}><Button secondary label="添加到列表" onPress={add} /></View>
    {notice !== '' && <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text>}
  </Dialog>;
}

const styles = StyleSheet.create({
  body: { fontSize: 13, lineHeight: 20, color: brandTheme.muted },
  label: { color: brandTheme.ink, fontSize: 14, fontWeight: '700' },
  small: { color: brandTheme.muted, fontSize: 12, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderWidth: 1, borderColor: brandTheme.border, borderRadius: 10, padding: 10 },
  rowText: { flex: 1, gap: 2 },
  remove: { color: '#8c2929', fontSize: 13, fontWeight: '700' },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  preset: { borderWidth: 1, borderColor: brandTheme.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  presetActive: { backgroundColor: brandTheme.tint, borderColor: brandTheme.selectedBorder },
  presetTextActive: { color: brandTheme.accent, fontWeight: '800' },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  notice: { backgroundColor: brandTheme.tint, color: brandTheme.ink, fontSize: 13, lineHeight: 19, borderRadius: 8, padding: 10 },
});
