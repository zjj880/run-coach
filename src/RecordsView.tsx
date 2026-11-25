import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { dateLabel, periodTotals, visibleActivities, type Activity, type CoachState, type TrainingPeriod } from './training';

const pace = (activity: Activity) => {
  if (!activity.km || !activity.minutes) return undefined;
  const seconds = Math.round(activity.minutes * 60 / activity.km);
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
};
const round1 = (value: number) => Math.round(value * 10) / 10;
const monthLabel = (date: string) => Number(date.slice(5, 7)) + ' 月';

export function RecordsView({ state, onEditPeriods, onImportRecords, onClassify, onReview }: {
  state: CoachState;
  onEditPeriods: () => void;
  onImportRecords?: () => void;
  onClassify: (activity: Activity) => void;
  onReview: (date: string) => void;
}) {
  const activities = useMemo(() => [...visibleActivities(state)].sort((left, right) => (right.date + right.time).localeCompare(left.date + left.time)), [state]);
  const totals = useMemo(() => periodTotals(state), [state]);
  const [filter, setFilter] = useState<string>('全部');
  const periods = state.periods ?? [];
  const shown = filter === '全部' ? activities : activities.filter((item) => {
    const period = periods.find((entry) => entry.id === filter);
    return period ? item.date >= period.from && item.date <= period.to : true;
  });

  const groups: { month: string; items: Activity[] }[] = [];
  for (const activity of shown) {
    const month = monthLabel(activity.date);
    const last = groups[groups.length - 1];
    if (last && last.month === month) last.items.push(activity);
    else groups.push({ month, items: [activity] });
  }
  const totalKm = round1(shown.reduce((sum, item) => sum + item.km, 0));

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.heading}>
        <View>
          <Text style={styles.sub}>{shown.length} 条活动 · 共 {totalKm} 公里</Text>
          <Text accessibilityRole="header" style={styles.title}>记录</Text>
        </View>
        <View style={styles.headActions}>
          {onImportRecords && <Pressable accessibilityRole="button" onPress={onImportRecords} style={styles.button}>
            <Text style={styles.buttonText}>导入记录</Text>
          </Pressable>}
          <Pressable accessibilityRole="button" onPress={onEditPeriods} style={styles.button}>
            <Text style={styles.buttonText}>训练周期</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.chips}>
        <Chip label="全部" active={filter === '全部'} onPress={() => setFilter('全部')} />
        {totals.map(({ period }) => <Chip key={period.id} label={period.name} active={filter === period.id} onPress={() => setFilter(period.id)} />)}
      </View>

      {periods.length === 0 && (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>还没有划分训练周期</Text>
          <Text style={styles.small}>把训练过程划成基础期、专项期、调整期等阶段，就能按阶段统计里程和天数。</Text>
        </View>
      )}

      {totals.filter(({ period }) => filter === '全部' || filter === period.id).map(({ period, activities, days, km }) => (
        <View key={period.id} style={styles.periodCard}>
          <View style={styles.rowBetween}>
            <Text style={styles.periodName}>{period.name}</Text>
            <Text style={styles.small}>{period.from.slice(5)} ~ {period.to.slice(5)}</Text>
          </View>
          <Text style={styles.small}>{days} 天训练 · {activities} 条活动 · {km} 公里</Text>
        </View>
      ))}

      {groups.map((group) => (
        <View key={group.month} style={styles.group}>
          <Text style={styles.groupLabel}>{group.month}</Text>
          {group.items.map((activity) => {
            const period = periods.find((entry) => activity.date >= entry.from && activity.date <= entry.to);
            const metrics = [
              activity.km > 0 ? round1(activity.km) + ' 公里' : undefined,
              activity.minutes > 0 ? round1(activity.minutes) + ' 分钟' : undefined,
              pace(activity) ? pace(activity) + '/公里' : undefined,
              activity.averageHr ? '均心率 ' + activity.averageHr : undefined,
            ].filter(Boolean).join(' · ');
            return <Pressable key={activity.id} accessibilityRole="button" onPress={() => onClassify(activity)} style={styles.activity}>
              <View style={styles.rowBetween}>
                <Text style={styles.activityTitle}>{activity.title}</Text>
                <Text style={styles.small}>{activity.date.slice(5)}</Text>
              </View>
              <Text style={styles.small}>{dateLabel(activity.date)} · {activity.time || '—'} · {activity.role}{period ? ' · ' + period.name : ''}</Text>
              {metrics !== '' && <Text style={styles.metrics}>{metrics}</Text>}
              <View style={styles.actions}>
                <Text style={styles.link} onPress={() => onClassify(activity)}>改归属</Text>
                <Text style={styles.link} onPress={() => onReview(activity.date)}>查看评估</Text>
              </View>
            </Pressable>;
          })}
        </View>
      ))}

      {shown.length === 0 && (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>这段时间没有活动</Text>
          <Text style={styles.small}>在「我的 → 同步历史活动」里按日期范围拉取佳明记录，或补记活动。</Text>
        </View>
      )}
    </ScrollView>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress}
    style={[styles.chip, active && styles.chipActive]}><Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text></Pressable>;
}

export type { TrainingPeriod };

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { width: '100%', maxWidth: 1120, alignSelf: 'center', paddingHorizontal: 18, paddingTop: 18, paddingBottom: 24, gap: 10 },
  heading: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  headActions: { flexDirection: 'row', gap: 8 },
  sub: { color: '#256447', fontSize: 13, fontWeight: '700', marginBottom: 3 },
  title: { color: '#162f29', fontSize: 35, fontWeight: '800', letterSpacing: -1.1 },
  button: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#cadace', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  buttonText: { color: '#256447', fontSize: 14, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderColor: '#dfe7df', borderRadius: 9, paddingHorizontal: 11, paddingVertical: 8, backgroundColor: '#fff' },
  chipActive: { backgroundColor: '#e6f1e7', borderColor: '#8cb49a' },
  chipText: { color: '#162f29', fontSize: 13 },
  chipTextActive: { color: '#256447', fontWeight: '800' },
  periodCard: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#dfe7df', borderRadius: 14, padding: 13, gap: 4 },
  periodName: { color: '#162f29', fontSize: 15, fontWeight: '800' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  group: { gap: 6 },
  groupLabel: { color: '#566960', fontSize: 13, fontWeight: '800', marginTop: 6 },
  activity: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#dfe7df', borderRadius: 12, padding: 12, gap: 3 },
  activityTitle: { color: '#162f29', fontSize: 15, fontWeight: '700', flexShrink: 1 },
  metrics: { color: '#354d40', fontSize: 13, lineHeight: 19 },
  small: { color: '#566960', fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 14, marginTop: 3 },
  link: { color: '#256447', fontSize: 13, fontWeight: '700', paddingVertical: 2 },
  empty: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#dfe7df', borderRadius: 14, padding: 16, gap: 5 },
  emptyTitle: { color: '#162f29', fontSize: 15, fontWeight: '800' },
});
