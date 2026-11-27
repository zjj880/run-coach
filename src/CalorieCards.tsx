import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Dialog, Field } from './AiTools';
import {
  activityLevels, dailyCalories, goals, profileIsComplete, quickFoods, sexes,
  type ActivityLevel, type Goal, type IntakeEntry, type Profile, type Sex, type WaterEntry,
} from './nutrition';
import { brandTheme } from './brandTheme';
import type { CoachState } from './training';

const today = () => new Date().toISOString().slice(0, 10);
const newId = (prefix: string) => prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);

export function ProfileEditor({ profile, onSave, onClose }: {
  profile?: Profile;
  onSave: (profile: Profile) => void;
  onClose: () => void;
}) {
  const [sex, setSex] = useState<Sex>(profile?.sex ?? '男');
  const [age, setAge] = useState(String(profile?.age ?? 25));
  const [heightCm, setHeight] = useState(String(profile?.heightCm ?? 175));
  const [weightKg, setWeight] = useState(String(profile?.weightKg ?? 65));
  const [bodyFat, setBodyFat] = useState(profile?.bodyFatPct ? String(profile.bodyFatPct) : '');
  const [level, setLevel] = useState<ActivityLevel>(profile?.activityLevel ?? '轻度');
  const [goal, setGoal] = useState<Goal>(profile?.goal ?? '维持');
  const [rate, setRate] = useState(profile?.rateKgPerWeek ? String(profile.rateKgPerWeek) : '');
  const [target, setTarget] = useState(profile?.targetIntake ? String(profile.targetIntake) : '');
  const [notice, setNotice] = useState('');

  function save() {
    const values = {
      age: Number(age), heightCm: Number(heightCm), weightKg: Number(weightKg),
      bodyFatPct: bodyFat.trim() ? Number(bodyFat) : undefined,
      rateKgPerWeek: rate.trim() ? Number(rate) : undefined,
      targetIntake: target.trim() ? Number(target) : undefined,
    };
    if (!(values.age >= 10 && values.age <= 100)) { setNotice('年龄请填 10–100 之间的数字。'); return; }
    if (!(values.heightCm >= 120 && values.heightCm <= 230)) { setNotice('身高请填 120–230 厘米。'); return; }
    if (!(values.weightKg >= 30 && values.weightKg <= 200)) { setNotice('体重请填 30–200 公斤。'); return; }
    if (values.bodyFatPct !== undefined && !(values.bodyFatPct >= 3 && values.bodyFatPct <= 60)) { setNotice('体脂率请填 3–60（%）之间，不确定就留空。'); return; }
    if (values.targetIntake !== undefined && !(values.targetIntake >= 800 && values.targetIntake <= 6000)) { setNotice('每日目标请填 800–6000 千卡，或留空自动计算。'); return; }
    onSave({ sex, activityLevel: level, goal, ...values });
  }

  return <Dialog title="个人信息" onClose={onClose} footer={<Button label="保存" onPress={save} />}>
    <Text style={styles.body}>用于计算基础代谢和每日热量预算。只保存在本机；不填体脂率也能算，填了会更准。</Text>
    <Text style={styles.label}>性别</Text>
    <Chips values={sexes.map((item) => ({ id: item, label: item }))} selected={sex} onSelect={(id) => setSex(id as Sex)} />
    <Field label="年龄" value={age} onChangeText={setAge} placeholder="例如 25" />
    <Field label="身高（厘米）" value={heightCm} onChangeText={setHeight} placeholder="例如 175" />
    <Field label="体重（公斤）" value={weightKg} onChangeText={setWeight} placeholder="例如 65" />
    <Field label="体脂率 %（选填）" value={bodyFat} onChangeText={setBodyFat} placeholder="例如 16，不知道就留空" />
    <Text style={styles.label}>日常活动水平（不含正式训练）</Text>
    <Chips values={activityLevels.map((item) => ({ id: item, label: item }))} selected={level} onSelect={(id) => setLevel(id as ActivityLevel)} />
    <Text style={styles.label}>目标</Text>
    <Chips values={goals.map((item) => ({ id: item, label: item }))} selected={goal} onSelect={(id) => setGoal(id as Goal)} />
    {goal !== '维持' && <Field label={goal === '减脂' ? '每周减重（公斤，选填）' : '每周增重（公斤，选填）'}
      value={rate} onChangeText={setRate} placeholder={goal === '减脂' ? '默认 0.5' : '默认 0.25'} />}
    <Field label="每日目标摄入（千卡，选填）" value={target} onChangeText={setTarget} placeholder="留空按公式自动算" />
    {notice !== '' && <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text>}
  </Dialog>;
}

export function IntakeDialog({ entries, onAdd, onDelete, onClose }: {
  entries: IntakeEntry[];
  onAdd: (entry: IntakeEntry) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState('');
  const [kcal, setKcal] = useState('');
  const [notice, setNotice] = useState('');
  const list = entries.filter((entry) => entry.date === today());
  const total = list.reduce((sum, entry) => sum + entry.kcal, 0);

  function add(value: number, name?: string) {
    if (!(value > 0 && value <= 5000)) { setNotice('热量请填 1–5000 千卡。'); return; }
    onAdd({ id: newId('intake'), date: today(), kcal: Math.round(value), label: (name ?? label).trim() || undefined });
    setLabel('');
    setKcal('');
    setNotice('');
  }

  return <Dialog title="记一笔饮食" onClose={onClose} footer={<Button label="完成" onPress={onClose} />}>
    <Text style={styles.body}>今天已记录 {list.length} 笔，共 {total} 千卡。</Text>
    <Text style={styles.label}>快捷添加</Text>
    <View style={styles.chips}>{quickFoods.map((food) => <Pressable key={food.label} accessibilityRole="button"
      onPress={() => add(food.kcal, food.label)} style={styles.chip}>
      <Text style={styles.chipText}>{food.label} · {food.kcal}</Text></Pressable>)}</View>
    <Field label="热量（千卡）" value={kcal} onChangeText={setKcal} placeholder="例如 350" />
    <Field label="备注（选填）" value={label} onChangeText={setLabel} placeholder="例如 食堂午餐" maxLength={40} />
    <View style={styles.row}><Button label="添加" onPress={() => add(Number(kcal))} /></View>
    {list.length > 0 && <>
      <Text style={styles.label}>今天已记</Text>
      {list.map((entry) => <View key={entry.id} style={styles.listRow}>
        <Text style={styles.listText}>{entry.label ?? '饮食'} · {entry.kcal} 千卡</Text>
        <Pressable accessibilityRole="button" onPress={() => onDelete(entry.id)}><Text style={styles.remove}>删除</Text></Pressable>
      </View>)}
    </>}
    {notice !== '' && <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text>}
  </Dialog>;
}

export function WaterDialog({ entries, goal, onAdd, onDelete, onClose }: {
  entries: WaterEntry[];
  goal: number;
  onAdd: (entry: WaterEntry) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [ml, setMl] = useState('');
  const [notice, setNotice] = useState('');
  const list = entries.filter((entry) => entry.date === today());
  const total = list.reduce((sum, entry) => sum + entry.ml, 0);

  function add(value: number) {
    if (!(value > 0 && value <= 5000)) { setNotice('水量请填 1–5000 毫升。'); return; }
    onAdd({ id: newId('water'), date: today(), ml: Math.round(value) });
    setMl('');
    setNotice('');
  }

  return <Dialog title="喝水记录" onClose={onClose} footer={<Button label="完成" onPress={onClose} />}>
    <Text style={styles.body}>今天 {total} 毫升 / 目标 {goal} 毫升。</Text>
    <View style={styles.chips}>{[200, 300, 500].map((value) => <Pressable key={value} accessibilityRole="button"
      onPress={() => add(value)} style={styles.chip}><Text style={styles.chipText}>＋ {value} ml</Text></Pressable>)}</View>
    <Field label="自定义（毫升）" value={ml} onChangeText={setMl} placeholder="例如 250" />
    <View style={styles.row}><Button label="添加" onPress={() => add(Number(ml))} /></View>
    {list.length > 0 && <>
      <Text style={styles.label}>今天已记</Text>
      {list.map((entry) => <View key={entry.id} style={styles.listRow}>
        <Text style={styles.listText}>{entry.ml} 毫升</Text>
        <Pressable accessibilityRole="button" onPress={() => onDelete(entry.id)}><Text style={styles.remove}>删除</Text></Pressable>
      </View>)}
    </>}
    {notice !== '' && <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text>}
  </Dialog>;
}

export function CalorieCards({ state, date, onProfile, onIntake, onWater }: {
  state: CoachState;
  date: string;
  onProfile: () => void;
  onIntake: () => void;
  onWater: () => void;
}) {
  const summary = dailyCalories({
    profile: state.profile,
    activities: state.activities,
    intake: state.intake ?? [],
    water: state.water ?? [],
    date,
  });
  if (!summary) {
    return <View style={styles.card}>
      <Text style={styles.cardTitle}>饮食热量</Text>
      <Text style={styles.empty}>填写个人信息后，这里会显示每天还能吃多少千卡。</Text>
      <View style={styles.row}><Button label="填写个人信息" onPress={onProfile} /></View>
    </View>;
  }
  const progress = summary.waterGoal ? Math.min(1, summary.water / summary.waterGoal) : 0;
  const over = summary.remaining < 0;
  return <>
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.cardTitle}>饮食热量</Text>
        <Pressable accessibilityRole="button" onPress={onIntake} style={styles.smallButton}><Text style={styles.smallButtonText}>＋ 记一笔</Text></Pressable>
      </View>
      <Text style={styles.muted}>{summary.eaten > 0 ? '今日已记录 ' + summary.eaten + ' 千卡' : '今日未记录'}</Text>
      <Text style={styles.label}>还可吃</Text>
      <Text style={[styles.big, over && styles.over]}>{summary.remaining} <Text style={styles.unit}>千卡</Text></Text>
      <Text style={styles.muted}>目标 {summary.target} · 基础代谢 {summary.bmr} · 活动 {summary.exercise}</Text>
      <Text style={styles.tiny}>{summary.method}｜日常 {summary.neat} 千卡 + 运动 {summary.exercise} 千卡{summary.manualTarget ? '（手动目标）' : ''}</Text>
    </View>
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.cardTitle}>喝水</Text>
        <Pressable accessibilityRole="button" onPress={onWater} style={styles.smallButton}><Text style={styles.smallButtonText}>＋</Text></Pressable>
      </View>
      <Text style={styles.label}>今日</Text>
      <Text style={styles.big}>{summary.water} <Text style={styles.unit}>毫升</Text></Text>
      <Text style={styles.muted}>目标 {summary.waterGoal} 毫升</Text>
      <View style={styles.bar}><View style={[styles.barFill, { width: Math.round(progress * 100) + '%' }]} /></View>
    </View>
  </>;
}

function Chips({ values, selected, onSelect }: { values: { id: string; label: string }[]; selected: string; onSelect: (id: string) => void }) {
  return <View style={styles.chips}>{values.map((item) => <Pressable key={item.id} accessibilityRole="button"
    accessibilityState={{ selected: item.id === selected }} onPress={() => onSelect(item.id)}
    style={[styles.chip, item.id === selected && styles.chipActive]}>
    <Text style={[styles.chipText, item.id === selected && styles.chipTextActive]}>{item.label}</Text></Pressable>)}</View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: 'white', borderWidth: 1, borderColor: brandTheme.border, borderRadius: 14, padding: 13, gap: 5 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: brandTheme.ink },
  muted: { fontSize: 12, color: brandTheme.muted, lineHeight: 18 },
  tiny: { fontSize: 11, color: brandTheme.hint, lineHeight: 16 },
  label: { fontSize: 13, color: brandTheme.muted, marginTop: 2 },
  big: { fontSize: 34, fontWeight: '800', color: brandTheme.ink, letterSpacing: -0.5 },
  over: { color: '#A83B2D' },
  unit: { fontSize: 14, fontWeight: '700', color: brandTheme.muted },
  empty: { fontSize: 13, color: brandTheme.muted, lineHeight: 20 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 4 },
  smallButton: { borderWidth: 1, borderColor: brandTheme.controlBorder, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 6 },
  smallButtonText: { fontSize: 13, fontWeight: '700', color: brandTheme.accent },
  bar: { height: 8, borderRadius: 4, backgroundColor: brandTheme.soft, overflow: 'hidden', marginTop: 4 },
  barFill: { height: 8, backgroundColor: '#3E8E7E' },
  body: { fontSize: 13, lineHeight: 20, color: brandTheme.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderColor: brandTheme.border, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 7 },
  chipActive: { backgroundColor: brandTheme.tint, borderColor: brandTheme.selectedBorder },
  chipText: { fontSize: 13, color: brandTheme.ink },
  chipTextActive: { fontWeight: '800', color: brandTheme.accent },
  listRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: brandTheme.border, paddingVertical: 7 },
  listText: { fontSize: 13, color: brandTheme.ink },
  remove: { fontSize: 13, color: '#8c2929', fontWeight: '700' },
  notice: { backgroundColor: brandTheme.tint, color: brandTheme.ink, fontSize: 13, lineHeight: 19, borderRadius: 8, padding: 9 },
});

export { profileIsComplete };
