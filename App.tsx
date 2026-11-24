import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { AppState, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AiSettings, errorMessage, PlanImport, requestMoodReply, TrainingReviewDialog } from './src/AiTools';
import { ActivityFeedbackDialog } from './src/ActivityFeedbackDialog';
import { CoachDialog } from './src/CoachDialog';
import type { CoachDay } from './src/coach';
import { canReviewTraining, trainingReviewInput, type SavedReview } from './src/evaluation';
import { GarminSetup, pullGarmin, pullGarminDetails } from './src/GarminSetup';
import type { GarminSync } from './src/garmin';
import { ScheduleEditor } from './src/ScheduleEditor';
import { emptySchedule, rangeLabel, scheduleForDay, type ScheduleBook } from './src/schedule';
import {
  addDays, applyGarminSync, changePlan, classifyActivity, cycleContains, dateIsValid, dateLabel, defaultCheckIn, demoHealth,
  commonSymptoms, emptyHealth, getAdvice, importDemo, importPlan, initialState, isDefaultDemoPlan, localDate, makeEntry, moreSymptoms, roles, sensations, weekStart,
  visibleActivities, workoutLabel, workoutTypes, type Activity, type ActivityFeedback, type ChangeAction, type ChangeReason, type CheckIn, type CoachState, type ImportRow,
  type PlanEntry, type Role, type Sensation, type Symptom, type WorkoutType,
} from './src/training';
import { autoClassifyDates, autoClassifyDay, pendingDates } from './src/autoclassify';

const ink = '#162f29';
const muted = '#566960';
const green = '#256447';
const paper = '#f4f6f2';
const border = '#dfe7df';
const mint = '#e6f1e7';
const key = 'run-coach/v1';
const tabs = ['今天', '课表', '我的'] as const;
type Tab = (typeof tabs)[number];
type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];
type EditorSheet =
  | { type: 'checkin' }
  | { type: 'cycle' }
  | { type: 'workout'; date: string; entry?: PlanEntry }
  | { type: 'log'; date: string }
  | { type: 'classify'; activity: Activity; returnToReview?: string };
type Sheet = EditorSheet | { type: 'aiSettings' } | { type: 'planImport' } | { type: 'review'; date: string } | { type: 'schedule'; date: string } | { type: 'garmin' } | { type: 'coach' }
  | { type: 'activityFeedback'; activity: Activity; returnToReview?: string };

const tabIcons: Record<Tab, IconName> = { 今天: 'view-dashboard-outline', 课表: 'calendar-outline', 我的: 'account-circle-outline' };
const changeActions: ChangeAction[] = ['缩短', '降强度', '换课', '取消', '改期'];
const changeReasons: ChangeReason[] = ['日程冲突', '疲劳', '身体不适', '其他'];

export default function App() {
  return <SafeAreaProvider><CoachApp /></SafeAreaProvider>;
}

function Icon({ name, color = green, size = 20 }: { name: IconName; color?: string; size?: number }) {
  return <MaterialCommunityIcons name={name} color={color} size={size} />;
}

function Action({ label, onPress, secondary = false, icon, disabled = false }: {
  label: string; onPress: () => void; secondary?: boolean; icon?: IconName; disabled?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.action, secondary && styles.actionSecondary, (pressed || disabled) && styles.dim]}>
      {icon && <Icon name={icon} color={secondary ? green : 'white'} size={18} />}
      <Text style={[styles.actionLabel, secondary && styles.secondaryLabel]}>{label}</Text>
    </Pressable>
  );
}

function Options<T extends string>({ values, selected, onPress }: { values: readonly T[]; selected: readonly T[]; onPress: (item: T) => void }) {
  return (
    <View style={styles.options}>
      {values.map((item) => {
        const active = selected.includes(item);
        return <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => onPress(item)}
          style={[styles.option, active && styles.activeOption]}>
          <Text style={[styles.optionText, active && styles.activeText]}>{item}</Text>
        </Pressable>;
      })}
    </View>
  );
}

function Input({ label, value, onChangeText, placeholder, numeric = false, multiline = false, maxLength }: {
  label: string; value: string; onChangeText: (value: string) => void; placeholder?: string; numeric?: boolean; multiline?: boolean; maxLength?: number;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} placeholder={placeholder}
        placeholderTextColor="#62756a" autoCorrect={false} keyboardType={numeric ? 'number-pad' : 'default'}
        multiline={multiline} maxLength={maxLength} style={[styles.input, multiline && styles.multiline]} />
    </View>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

function CoachApp() {
  const date = localDate();
  const wide = useWindowDimensions().width >= 820;
  const [state, setState] = useState(() => initialState(date));
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>('今天');
  const [week, setWeek] = useState(0);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [notice, setNotice] = useState('');
  const [storageError, setStorageError] = useState(false);
  const [details, setDetails] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const syncLock = useRef(false);
  const lastAutoAttempt = useRef(0);

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(key).then((saved) => {
      if (mounted && saved) {
        const loaded = JSON.parse(saved) as CoachState;
        setState(autoClassifyDates(loaded, pendingDates(loaded)).state);
      }
    }).catch(() => { if (mounted) setStorageError(true); }).finally(() => {
      if (mounted) setReady(true);
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (ready && !storageError) AsyncStorage.setItem(key, JSON.stringify(state)).catch(() => setStorageError(true));
  }, [ready, state, storageError]);

  const workouts = state.plan.filter((entry) => entry.date === date && entry.current);
  const active = workouts[0];
  const activitiesInUse = visibleActivities(state);
  const actualToday = activitiesInUse.filter((activity) => activity.date === date);
  const reviewActivities = sheet?.type === 'review' ? activitiesInUse.filter((activity) => activity.date === sheet.date) : [];
  const garmin = state.garmin;
  const health = garmin ? garmin.date === date ? garmin.health : emptyHealth : state.demoMetrics ? demoHealth : emptyHealth;
  const book = state.availability ?? emptySchedule;
  const todaySchedule = scheduleForDay(book, date);
  const chosen = todaySchedule.selected;
  const advice = getAdvice(state, date, health, chosen ? chosen.end - chosen.start : undefined);
  const todayCheckIn = state.checkIns[date];
  const coachContext = {
    date,
    initialAdvice: { title: advice.title, reason: advice.reason },
    plan: workouts.slice(0, 12).map((entry) => entry.current),
    recovery: { source: garmin ? '佳明' : state.demoMetrics ? '演示' : '未同步', ...health },
    checkIn: todayCheckIn ? {
      sensation: todayCheckIn.sensation, symptoms: todayCheckIn.symptoms, customSymptom: todayCheckIn.customSymptom,
      timeMinutes: todayCheckIn.timeEstimated ? undefined : todayCheckIn.minutes,
    } : null,
    availableMinutes: chosen ? chosen.end - chosen.start : null,
    recent: activitiesInUse.filter((item) => item.date >= addDays(date, -3) && item.date <= date)
      .slice(-20).map(({ date, minutes, km, role, averageHr }) => ({ date, minutes, km, role, averageHr })),
  };
  const coaching = state.coaching?.[date];
  const confirmed = coaching?.confirmed?.signature === JSON.stringify(coachContext) ? coaching.confirmed.proposal : undefined;
  const savedReply = todayCheckIn?.moodReply;
  const pending = actualToday.filter((item) => item.role === '待归类').length;
  const displayedWeek = Math.min(week, state.weeks - 1);
  const first = addDays(state.cycleStart, displayedWeek * 7);
  const days = Array.from({ length: 7 }, (_, index) => addDays(first, index));
  const weekActivities = activitiesInUse.filter((item) => item.date >= first && item.date <= days[6]);
  const syncText = state.lastSync ? new Date(state.lastSync).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '尚未同步';
  const garminTime = garmin ? new Date(garmin.syncedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';

  const refreshGarmin = useCallback(async (manual: boolean) => {
    if (!ready || !garmin || sheet?.type === 'garmin' || syncLock.current) return;
    const target = localDate();
    const now = Date.now();
    if (!manual && (now - lastAutoAttempt.current < 30_000 ||
      (garmin.date === target && now - Date.parse(garmin.syncedAt) < 60_000))) return;
    lastAutoAttempt.current = now;
    syncLock.current = true;
    setSyncing(true);
    if (manual) setNotice('');
    try {
      const data = await pullGarmin(target);
      setState((current) => {
        if (current.garmin !== garmin) return current;
        const synced = applyGarminSync(current, data);
        return autoClassifyDates(synced, data.activities.map((item) => item.date)).state;
      });
      if (manual) setNotice(data.unavailable.length ? '已更新可用数据，缺少' + data.unavailable.join('、') + '。' : '已同步晨间数据和训练记录，并自动归类活动。');
    } catch (error) {
      if (manual) setNotice(errorMessage(error));
    } finally {
      syncLock.current = false;
      setSyncing(false);
    }
  }, [ready, garmin, sheet?.type]);

  useEffect(() => {
    if (AppState.currentState !== 'background') void refreshGarmin(false);
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refreshGarmin(false);
    });
    return () => subscription.remove();
  }, [refreshGarmin]);

  function startGarminSync() {
    if (garmin) void refreshGarmin(true);
    else open({ type: 'garmin' });
  }

  function saveGarmin(data: GarminSync) {
    lastAutoAttempt.current = Date.now();
    setState((current) => {
      const synced = applyGarminSync(current, data);
      return autoClassifyDates(synced, data.activities.map((item) => item.date)).state;
    });
  }

  function disconnectGarmin() {
    setState((current) => {
      const next = { ...current, demoMetrics: false };
      delete next.garmin;
      return next;
    });
  }

  function update(transform: (current: CoachState) => CoachState, message: string) {
    try {
      const next = transform(state);
      setState(next);
      setSheet(sheet?.type === 'classify' && sheet.returnToReview ? { type: 'review', date: sheet.returnToReview } : null);
      setNotice(message);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '暂时无法保存，请重试。');
    }
  }

  function open(next: Sheet) {
    setNotice('');
    setSheet(next);
  }

  function closeSheet() {
    setNotice('');
    setSheet(null);
  }

  function saveFeeling(sensation: Sensation) {
    const initialMinutes = active?.current?.minutes ?? defaultCheckIn.minutes;
    setNotice('');
    setState((current) => {
      const previous = current.checkIns[date] ?? { ...defaultCheckIn, minutes: initialMinutes, timeEstimated: true };
      return { ...current, checkIns: { ...current.checkIns, [date]: { ...previous, sensation } } };
    });
  }

  function saveReview(day: string, review: SavedReview) {
    setState((current) => ({ ...current, reviews: { ...current.reviews, [day]: review } }));
  }

  function saveCoaching(day: CoachDay) {
    setState((current) => ({ ...current, coaching: { ...current.coaching, [date]: day } }));
  }

  async function syncReviewDetails(day: string) {
    const ids = activitiesInUse.filter((item) => item.date === day && item.id.startsWith('garmin-cn-')).map((item) => item.id);
    const data = await pullGarminDetails(ids);
    const details = new Map(data.map((record) => [record.id, record]));
    setState((current) => autoClassifyDay({ ...current, activities: current.activities.map((item) => {
      const record = details.get(item.id);
      return record ? { ...item, detail: record.detail ?? item.detail, fit: record.fit ?? item.fit } : item;
    }) }, day).state);
    return { details: data.filter(({ detail }) => detail).length, parsed: data.filter(({ fit }) => fit).length, requested: ids.length };
  }

  function finishFeedback(target: Extract<Sheet, { type: 'activityFeedback' }>, feedback?: ActivityFeedback, save = false) {
    if (save) setState((current) => autoClassifyDay({
      ...current, activities: current.activities.map((item) => item.id === target.activity.id ? { ...item, feedback } : item),
    }, target.activity.date).state);
    if (target.returnToReview) open({ type: 'review', date: target.returnToReview });
    else {
      closeSheet();
      if (save) setNotice(feedback ? '课后体感已保存。' : '课后体感已清空。');
    }
  }

  function saveSchedule(change: (book: ScheduleBook) => ScheduleBook) {
    setState((current) => ({ ...current, availability: change(current.availability ?? emptySchedule) }));
  }

  function saveImportedPlan(rows: ImportRow[], replaceDemo: boolean) {
    const result = importPlan(state, rows, replaceDemo);
    const firstDate = rows.map((row) => row.date).sort()[0];
    if (firstDate) {
      setWeek(Math.max(0, Math.floor((Date.parse(firstDate) - Date.parse(result.state.cycleStart)) / (86_400_000 * 7))));
    }
    setState(autoClassifyDates(result.state, rows.map((row) => row.date)).state);
    setSheet(null);
    setNotice('已导入 ' + result.added + ' 条训练' + (result.duplicates ? '，跳过 ' + result.duplicates + ' 条重复训练。' : '。'));
  }

  function selectTab(next: Tab) {
    setNotice('');
    setTab(next);
    if (next === '课表') {
      const daysSinceStart = (Date.parse(date) - Date.parse(state.cycleStart)) / 86_400_000;
      setWeek(Math.max(0, Math.min(state.weeks - 1, Math.floor(daysSinceStart / 7))));
    }
  }

  function syncDemo() {
    update((current) => autoClassifyDay(importDemo(current, date), date).state,
      '已同步演示跑步并按心率/配速自动归类，可在课表手动修改。');
  }

  function todayContent() {
    const metricItems: { label: string; value: string; icon: IconName }[] = [
      { label: '睡眠时长', value: health.sleepMinutes === null ? '未同步' : Math.floor(health.sleepMinutes / 60) + ' 小时 ' + health.sleepMinutes % 60 + ' 分', icon: 'moon-waning-crescent' },
      { label: '夜间 HRV', value: health.hrv === null ? '未同步' : health.hrv + ' ms', icon: 'pulse' },
      { label: '静息心率', value: health.restingHr === null ? '未同步' : health.restingHr + ' 次/分', icon: 'heart-outline' },
    ];
    return (
      <>
        <View style={styles.pageHeading}>
          <View><Text style={styles.date}>{dateLabel(date)}</Text><Text accessibilityRole="header" style={styles.heading}>今天</Text></View>
          <View style={styles.pill}><Icon name={garmin ? 'watch-variant' : state.demoMetrics ? 'flask-outline' : 'sync'} size={15} />
            <Text style={styles.pillText}>{garmin ? '佳明中国区' : state.demoMetrics ? '演示数据' : '待同步'}</Text></View>
        </View>
        <View style={[styles.pageGrid, wide && styles.pageGridWide]}>
          <View style={[styles.column, wide && styles.mainColumn]}>
            <Card>
              <Text style={styles.cardTitle}>今早起床感受</Text>
              <Options values={sensations} selected={state.checkIns[date] ? [state.checkIns[date].sensation] : []} onPress={saveFeeling} />
              <Pressable accessibilityRole="button" onPress={() => open({ type: 'checkin' })} style={styles.textButton}>
                <Text style={styles.link}>补充晨间打卡 · 不适、心情和备注</Text><Icon name="chevron-right" size={16} />
              </Pressable>
            </Card>
            <View style={styles.hero}>
              <View style={styles.heroTop}><Icon name="run-fast" color="#bfe9c6" size={23} />
                <Text style={styles.heroLabel}>{confirmed ? '已确认方案' : '初步建议 · ' + advice.label}</Text></View>
              <Text style={styles.heroTitle}>{confirmed?.title ?? advice.title}</Text>
              <Text style={styles.heroReason}>{confirmed?.training ?? advice.reason}</Text>
              <View style={styles.heroDivider} />
              <Text style={styles.heroPlan}>当前课表  ·  {active?.current ? workoutLabel(active.current) : '休息或未安排'}</Text>
            </View>
            <View style={styles.actions}>
              <Action label={coaching?.messages.length ? '继续和 AI 教练聊' : '和 AI 教练聊聊'} icon="chat-outline" onPress={() => open({ type: 'coach' })} />
              {active && <Action label="调整课表" secondary onPress={() => open({ type: 'workout', date, entry: active })} />}
            </View>
            {!confirmed && coaching?.confirmed && <Text style={styles.small}>今天的数据已更新，可继续对话并重新确认方案。</Text>}
            {pending > 0 && <Card><Text style={styles.cardTitle}>{pending} 条活动待归类</Text>
              <View style={styles.actions}>
                <Action label="自动归类" icon="auto-fix" onPress={() => update((current) => autoClassifyDates(current, pendingDates(current)).state, '已按心率/配速自动归类，可在课表手动修改。')} />
                <Action label="打开课表" secondary onPress={() => selectTab('课表')} />
              </View>
            </Card>}
          </View>
          <View style={[styles.column, wide && styles.sideColumn]}>
            <Card>
              <Text style={styles.cardTitle}>今日可训练时段</Text>
              <Text style={styles.body}>{chosen ? '已标注 ' + rangeLabel(chosen) + ' · ' + (chosen.end - chosen.start) + ' 分钟'
                : todaySchedule.hasConflict ? '原时段与日程冲突，请重新选择。'
                  : todaySchedule.covered || todaySchedule.supplied.length
                    ? todaySchedule.available.slice(0, 2).map(rangeLabel).join(' · ') || '计算范围内暂无空档。'
                    : '同步日历或手动添加忙碌时段，查看当天空档。'}</Text>
              <Pressable accessibilityRole="button" onPress={() => open({ type: 'schedule', date })} style={styles.textButton}>
                <Text style={styles.link}>日程与训练时间</Text><Icon name="chevron-right" size={16} />
              </Pressable>
            </Card>
            {savedReply && savedReply.mood === todayCheckIn.mood.trim() && savedReply.note === (todayCheckIn.note ?? '').trim() &&
              <Card><Text style={styles.cardTitle}>AI 心情回应</Text><Text style={styles.body}>{savedReply.text}</Text></Card>}
            <Card>
              <View style={styles.rowBetween}><Text style={styles.cardTitle}>晨间数据</Text><Text style={styles.small}>
                {garmin ? garmin.date === date ? '今天 ' + garminTime : '今天尚未同步' : state.demoMetrics ? '演示数据' : '尚未同步'}
              </Text></View>
              <View style={styles.metricGrid}>
                {metricItems.map((item) => <View key={item.label} style={styles.metric}>
                  <Icon name={item.icon} size={17} /><Text style={styles.metricValue}>{item.value}</Text><Text style={styles.small}>{item.label}</Text>
                </View>)}
              </View>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: details }} onPress={() => setDetails(!details)} style={styles.textButton}>
                <Text style={styles.link}>{details ? '收起依据' : '查看依据'}</Text><Icon name={details ? 'chevron-up' : 'chevron-down'} size={17} />
              </Pressable>
              <Action label={syncing ? '同步中…' : garmin ? '立即同步佳明' : '连接佳明'} secondary disabled={syncing} onPress={startGarminSync} />
              {details && <Text style={styles.small}>{garmin && garmin.date === date
                ? '建议结合佳明已同步指标、课表、近期训练和晨间反馈。' + (garmin.unavailable.length ? ' 缺少：' + garmin.unavailable.join('、') + '。' : '')
                : !garmin && state.demoMetrics ? '建议结合演示指标、课表、近期训练和晨间反馈。' : '建议依据课表、近期训练和晨间反馈。'}</Text>}
            </Card>
            <Card>
              <View style={styles.tip}><Icon name="power-sleep" /><View style={styles.tipText}><Text style={styles.cardTitle}>休息</Text><Text style={styles.body}>{confirmed?.recovery ?? advice.recovery}</Text></View></View>
              <View style={styles.rule} />
              <View style={styles.tip}><Icon name="food-apple-outline" /><View style={styles.tipText}><Text style={styles.cardTitle}>饮食</Text><Text style={styles.body}>{confirmed?.nutrition ?? advice.nutrition}</Text></View></View>
            </Card>
          </View>
        </View>
      </>
    );
  }

  function activityItem(item: Activity) {
    const parent = activitiesInUse.find((entry) => entry.id === item.parentId);
    return (
      <View key={item.id} style={styles.activity}>
      <Pressable accessibilityRole="button" accessibilityLabel={'归类 ' + item.title} onPress={() => open({ type: 'classify', activity: item })}>
        <View style={styles.rowBetween}><Text style={styles.activityName}>{item.title}</Text><Icon name="chevron-right" size={17} /></View>
        <Text style={styles.small}>{item.time} · {item.minutes} 分钟 · {item.km.toFixed(1)} 公里</Text>
        {item.averageHr !== undefined && <Text style={styles.small}>平均心率 {item.averageHr} 次/分</Text>}
        <Text style={styles.role}>{item.role}{item.roleSource === 'auto' ? ' · 自动' : ''}{parent ? ' · ' + parent.title : ''}</Text>
        {item.core && <Text style={styles.small}>核心段 {item.core}</Text>}
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={'课后体感 ' + item.title}
        onPress={() => open({ type: 'activityFeedback', activity: item })}>
        <Text style={styles.link}>{item.feedback?.effort != null ? '体感 RPE ' + item.feedback.effort + '/10' : item.feedback ? '已填体感' : '填写课后体感'}</Text>
      </Pressable>
      </View>
    );
  }

  function planContent() {
    return (
      <View style={styles.column}>
        <View style={styles.pageHeading}>
          <View><Text style={styles.date}>训练周期 · {state.weeks} 周</Text><Text accessibilityRole="header" style={styles.heading}>课表</Text></View>
          <View style={styles.actions}>
            <Action label="设置周期" secondary onPress={() => open({ type: 'cycle' })} />
            <Action label="识别导入" icon="file-import-outline" onPress={() => open({ type: 'planImport' })} />
          </View>
        </View>
        <Card>
          <View style={styles.actions}><Action label={syncing ? '同步中…' : '立即同步佳明'} icon="sync" secondary disabled={syncing} onPress={startGarminSync} /></View>
          <View style={styles.rowBetween}>
            <Action label="上一周" secondary disabled={displayedWeek === 0} onPress={() => setWeek(displayedWeek - 1)} />
            <View style={styles.weekCenter}><Text style={styles.cardTitle}>第 {displayedWeek + 1} 周</Text><Text style={styles.small}>{first.slice(5)} 至 {days[6].slice(5)}</Text></View>
            <Action label="下一周" secondary disabled={displayedWeek + 1 >= state.weeks} onPress={() => setWeek(displayedWeek + 1)} />
          </View>
          <Text style={styles.body}>本周已记录 {weekActivities.length} 条活动 · {weekActivities.reduce((sum, item) => sum + item.km, 0).toFixed(1)} 公里</Text>
          <View style={[styles.splitRow, styles.tableHeader]}>
            <Text style={styles.planLabel}>计划</Text><Text style={styles.planLabel}>实际执行</Text><Text style={styles.planLabel}>训练评估</Text>
          </View>
          {days.map((day) => {
            const plan = state.plan.filter((entry) => entry.date === day);
            const activities = activitiesInUse.filter((item) => item.date === day);
            const input = trainingReviewInput(day, plan, activities);
            const review = state.reviews?.[day];
            const eligible = canReviewTraining(input);
            const stale = review && review.signature !== JSON.stringify(input);
            return (
              <View key={day} style={[styles.day, day === date && styles.currentDay]}>
                <View style={styles.rowBetween}>
                  <Text style={styles.label}>{dateLabel(day)}{day === date ? ' · 今天' : ''}</Text>
                  <View style={styles.actions}>
                    <Pressable accessibilityRole="button" accessibilityLabel={'日程 ' + dateLabel(day)} onPress={() => open({ type: 'schedule', date: day })}>
                      <Text style={styles.link}>日程</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel={'添加训练 ' + dateLabel(day)} onPress={() => open({ type: 'workout', date: day })}>
                      <Text style={styles.link}>＋ 添加训练</Text>
                    </Pressable>
                  </View>
                </View>
                <View style={styles.splitRow}>
                  <View style={styles.cell}>
                    {plan.length === 0 && <Text style={styles.small}>未安排</Text>}
                    {plan.map((entry) => {
                      const latest = entry.changes.at(-1);
                      return <View key={entry.id} style={styles.planItem}>
                        <Text style={styles.activityName}>{entry.current ? workoutLabel(entry.current) : latest?.action === '改期' ? '已改至 ' + latest.targetDate?.slice(5) : '已取消'}</Text>
                        {entry.current?.detail && <Text style={styles.small}>{entry.current.detail}</Text>}
                        {entry.movedFrom && <Text style={styles.small}>从 {entry.movedFrom.slice(5)} 调入</Text>}
                        {latest && <Text style={styles.small}>原课 {workoutLabel(entry.original)} · {latest.reason}</Text>}
                        {entry.current && <Pressable accessibilityRole="button" accessibilityLabel={'调整 ' + workoutLabel(entry.current)} onPress={() => open({ type: 'workout', date: day, entry })}>
                          <Text style={styles.link}>调整</Text>
                        </Pressable>}
                      </View>;
                    })}
                  </View>
                  <View style={styles.cell}>
                    {activities.length > 0 ? activities.map(activityItem) : <Text style={styles.small}>
                      {state.skipped.includes(day) ? '已标记跳过' : day > date ? '待执行' : plan.some((entry) => entry.current && entry.current.type !== '休息') ? '待同步' : '无活动'}
                    </Text>}
                    {activities.length === 0 && day <= date && plan.some((entry) => entry.current && entry.current.type !== '休息') &&
                      <Pressable accessibilityRole="button" onPress={() => update((current) => ({
                        ...current, skipped: current.skipped.includes(day) ? current.skipped.filter((item) => item !== day) : [...current.skipped, day],
                      }), state.skipped.includes(day) ? '已恢复为待同步。' : '已标记跳过。')}>
                        <Text style={styles.link}>{state.skipped.includes(day) ? '撤销跳过' : '标记跳过'}</Text>
                      </Pressable>}
                    {day <= date && activities.some((item) => item.role === '待归类' && item.roleSource !== 'manual') &&
                      <Pressable accessibilityRole="button" accessibilityLabel={'自动归类 ' + dateLabel(day)}
                        onPress={() => update((current) => autoClassifyDay(current, day).state, '已检查自动归类，待确认的活动可手动调整。')}>
                        <Text style={styles.link}>自动归类</Text>
                      </Pressable>}
                    {day <= date && <Pressable accessibilityRole="button" accessibilityLabel={'补记活动 ' + dateLabel(day)}
                      onPress={() => open({ type: 'log', date: day })}><Text style={styles.link}>＋ 补记活动</Text></Pressable>}
                  </View>
                  <View style={styles.cell}>
                    {review && <Text numberOfLines={3} style={styles.small}>{review.review.summary}</Text>}
                    {stale && <Text style={styles.small}>待重新评估</Text>}
                    {activities.length ? <Pressable accessibilityRole="button"
                      accessibilityLabel={(review ? '查看训练评估 ' : eligible ? '评估训练 ' : '查看训练数据 ') + dateLabel(day)}
                      onPress={() => open({ type: 'review', date: day })}>
                      <Text style={styles.link}>{review ? '查看评估' : eligible ? '评估训练' : '查看数据'}</Text>
                    </Pressable> : <Text style={styles.small}>暂无活动</Text>}
                  </View>
                </View>
              </View>
            );
          })}
        </Card>
      </View>
    );
  }

  function profileContent() {
    return (
      <View style={styles.column}>
        <View style={styles.pageHeading}><Text accessibilityRole="header" style={styles.heading}>我的</Text></View>
        <Card>
          <View style={styles.tip}><Icon name="watch-variant" size={23} /><View style={styles.tipText}>
            <Text style={styles.cardTitle}>佳明中国区</Text><Text style={styles.body}>{garmin
              ? '已连接。回到 App 时自动检查更新。'
              : '连接后同步睡眠、夜间 HRV、静息心率和训练记录。'}</Text>
          </View></View>
          {garmin && <Text style={styles.small}>最近同步 · {garmin.date} {garminTime}</Text>}
          <View style={styles.actions}>
            <Action label={garmin ? '管理佳明连接' : '连接佳明'} disabled={syncing} onPress={() => open({ type: 'garmin' })} />
            {garmin && <Action label={syncing ? '同步中…' : '立即同步佳明'} icon="sync" secondary disabled={syncing} onPress={startGarminSync} />}
          </View>
        </Card>
        <Card>
          <View style={styles.tip}><Icon name="creation-outline" size={23} /><View style={styles.tipText}>
            <Text style={styles.cardTitle}>AI 接口</Text><Text style={styles.body}>配置模型和 API 密钥，用于课表、训练和心情回应。</Text>
          </View></View>
          <View style={styles.actions}><Action label="设置 AI 接口" onPress={() => open({ type: 'aiSettings' })} /></View>
        </Card>
        {!garmin && <Card>
          <View style={styles.tip}><Icon name="watch-variant" size={23} /><View style={styles.tipText}>
            <Text style={styles.cardTitle}>佳明同步演示</Text><Text style={styles.body}>这里用模拟跑步记录体验同步、去重和归类。</Text>
          </View></View>
          <Text style={styles.small}>最近演示同步 · {syncText}</Text>
          <View style={styles.actions}><Action label="同步演示跑步" icon="sync" onPress={syncDemo} />
            <Action label={state.demoMetrics ? '模拟数据缺失' : '恢复演示指标'} secondary onPress={() => update((current) => ({
              ...current, demoMetrics: !current.demoMetrics,
            }), state.demoMetrics ? '已切换到缺失指标场景。' : '已恢复演示指标。')} />
          </View>
        </Card>}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.shell}>
      <StatusBar style="dark" />
      <View style={styles.top}>
        <View style={styles.topInner}>
          <View style={styles.brand}><View style={styles.mark}><Icon name="run-fast" color="white" size={22} /></View><Text style={styles.brandText}>跑步教练</Text></View>
          {wide && <Navigation current={tab} onSelect={selectTab} />}
        </View>
      </View>
      <ScrollView key={tab} style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.content}>
          {storageError && <Text accessibilityRole="alert" style={styles.notice}>本地存储不可用，本次修改可能无法保留。</Text>}
          {notice !== '' && !sheet && <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text>}
          {ready ? tab === '今天' ? todayContent() : tab === '课表' ? planContent() : profileContent() : <Text style={styles.body}>正在加载课表…</Text>}
        </View>
      </ScrollView>
      {!wide && <View style={styles.bottom}><Navigation current={tab} onSelect={selectTab} mobile /></View>}
      {sheet?.type === 'aiSettings' && <AiSettings onClose={closeSheet} />}
      {sheet?.type === 'coach' && <CoachDialog day={coaching} context={coachContext} onSave={saveCoaching} onClose={closeSheet} />}
      {sheet?.type === 'garmin' && <GarminSetup date={date} latest={garmin} onSync={saveGarmin} onDisconnect={disconnectGarmin} onClose={closeSheet} />}
      {sheet?.type === 'planImport' && <PlanImport startDate={weekStart(state.cycleStart)}
        existingPlan={state.plan.filter((entry) => entry.current)} hasDemo={state.plan.some(isDefaultDemoPlan)}
        onClose={closeSheet} onImport={saveImportedPlan} />}
      {sheet?.type === 'review' && <TrainingReviewDialog input={trainingReviewInput(sheet.date, state.plan, reviewActivities)}
        activities={reviewActivities} onFeedback={(activity) => open({ type: 'activityFeedback', activity, returnToReview: sheet.date })}
        onClassify={(activity) => open({ type: 'classify', activity, returnToReview: sheet.date })}
        saved={state.reviews?.[sheet.date]} onSave={(review) => saveReview(sheet.date, review)} onClose={closeSheet}
        onLoadDetails={reviewActivities.some((item) => item.id.startsWith('garmin-cn-')) ? () => syncReviewDetails(sheet.date) : undefined} />}
      {sheet?.type === 'activityFeedback' && <ActivityFeedbackDialog activity={sheet.activity}
        onClose={() => finishFeedback(sheet)} onSave={(feedback) => finishFeedback(sheet, feedback, true)} />}
      {sheet?.type === 'schedule' && <ScheduleEditor initialDay={sheet.date} book={book} onUpdate={saveSchedule} onClose={closeSheet} />}
      {sheet && sheet.type !== 'aiSettings' && sheet.type !== 'planImport' && sheet.type !== 'review' && sheet.type !== 'schedule' && sheet.type !== 'garmin' && sheet.type !== 'coach' && sheet.type !== 'activityFeedback' &&
        <Editor sheet={sheet} state={state} date={date} notice={notice} onSave={update}
          onClose={() => { if (sheet.type === 'classify' && sheet.returnToReview) open({ type: 'review', date: sheet.returnToReview }); else closeSheet(); }} />}
    </SafeAreaView>
  );
}

function Navigation({ current, onSelect, mobile = false }: { current: Tab; onSelect: (tab: Tab) => void; mobile?: boolean }) {
  return (
    <View accessibilityRole="tablist" style={[styles.nav, mobile && styles.mobileNav]}>
      {tabs.map((tab) => <Pressable key={tab} accessibilityRole="tab" accessibilityLabel={tab} accessibilityState={{ selected: current === tab }}
        onPress={() => onSelect(tab)} style={[styles.navItem, mobile && styles.navMobileItem, current === tab && styles.navActive]}>
        <Icon name={tabIcons[tab]} size={19} color={current === tab ? green : muted} />
        <Text style={[styles.navLabel, current === tab && styles.activeText]}>{tab}</Text>
      </Pressable>)}
    </View>
  );
}

function Editor({ sheet, state, date, notice, onSave, onClose }: {
  sheet: EditorSheet; state: CoachState; date: string; notice: string;
  onSave: (transform: (current: CoachState) => CoachState, message: string) => void; onClose: () => void;
}) {
  const entry = sheet.type === 'workout' ? sheet.entry : undefined;
  const [form, setForm] = useState<CheckIn>(state.checkIns[date] ?? defaultCheckIn);
  const [expandedSymptoms, setExpandedSymptoms] = useState(form.symptoms.some((symptom) => moreSymptoms.some((item) => item === symptom)));
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyError, setReplyError] = useState('');
  const [minutes, setMinutes] = useState(String(entry?.current?.minutes ?? (sheet.type === 'checkin' ? form.minutes : 40)));
  const [type, setType] = useState<WorkoutType>(entry?.current?.type ?? '轻松跑');
  const [detail, setDetail] = useState(entry?.current?.detail ?? '');
  const [activityName, setActivityName] = useState('');
  const [distance, setDistance] = useState('');
  const [heartRate, setHeartRate] = useState('');
  const [action, setAction] = useState<ChangeAction>('换课');
  const [reason, setReason] = useState<ChangeReason>('日程冲突');
  const [target, setTarget] = useState(sheet.type === 'workout' ? addDays(sheet.date, 1) : state.cycleStart);
  const [weeks, setWeeks] = useState(String(state.weeks));
  const [activityRole, setActivityRole] = useState<Role>(sheet.type === 'classify' ? sheet.activity.role : '待归类');
  const [parentId, setParentId] = useState(sheet.type === 'classify' ? sheet.activity.parentId ?? '' : '');
  const [error, setError] = useState('');
  const title = sheet.type === 'checkin' ? '晨间打卡' : sheet.type === 'cycle' ? '训练周期' : sheet.type === 'classify' ? '确认活动归属' :
    sheet.type === 'log' ? '补记活动' : entry ? '调整训练' : '添加训练';

  function changeSymptom(item: Symptom) {
    const selected = item === '无不适' ? [] : form.symptoms.includes(item)
      ? form.symptoms.filter((value) => value !== item && value !== '无不适')
      : [...form.symptoms.filter((value) => value !== '无不适'), item];
    setForm({ ...form, symptoms: selected.length ? selected : ['无不适'], customSymptom: item === '无不适' ? '' : form.customSymptom });
  }

  async function generateReply() {
    const mood = form.mood.trim();
    const note = (form.note ?? '').trim();
    setReplyBusy(true);
    setReplyError('');
    try {
      const text = await requestMoodReply(mood, note);
      setForm((current) => ({ ...current, moodReply: { text, mood, note } }));
    } catch (error) { setReplyError(errorMessage(error)); }
    finally { setReplyBusy(false); }
  }

  function submit() {
    setError('');
    const amount = Number(minutes);
    if (sheet.type === 'checkin') {
      if (!minutes.trim() || !Number.isInteger(amount) || amount < 0 || amount > 1440) return setError('请输入 0 至 1440 的整数分钟。');
      onSave((current) => ({ ...current, checkIns: { ...current.checkIns, [date]: { ...form, minutes: amount, timeEstimated: false } } }), '打卡已保存，今天的建议已更新。');
    } else if (sheet.type === 'cycle') {
      const count = Number(weeks);
      if (!dateIsValid(target) || !Number.isInteger(count) || count < 1 || count > 52) return setError('请输入有效日期及 1 至 52 周。');
      onSave((current) => ({ ...current, cycleStart: target, weeks: count }), '周期已更新，原有训练记录已保留。');
    } else if (sheet.type === 'classify') {
      const activityId = sheet.activity.id;
      onSave((current) => classifyActivity(current, activityId, activityRole, parentId), '活动归属已保存。');
    } else if (sheet.type === 'log') {
      const logDay = sheet.date;
      const km = Number(distance);
      const averageHr = heartRate.trim() ? Number(heartRate) : undefined;
      if (!activityName.trim() || !Number.isInteger(amount) || amount <= 0 || amount > 1440 || !Number.isFinite(km) || km < 0) {
        return setError('请填写活动名称、有效时长和非负里程。');
      }
      if (averageHr !== undefined && (!Number.isInteger(averageHr) || averageHr <= 0 || averageHr > 300)) {
        return setError('请填写有效的平均心率（次/分）。');
      }
      const activity: Activity = {
        id: 'manual-' + Date.now(), date: sheet.date, time: '手动补记', title: activityName.trim(),
        minutes: amount, km, averageHr, role: '待归类', core: detail.trim() || undefined,
      };
      onSave((current) => autoClassifyDay({
        ...current, activities: [...current.activities, activity], skipped: current.skipped.filter((day) => day !== logDay),
      }, logDay).state, '活动已补记，并按心率/配速自动归类。');
    } else {
      const day = sheet.date;
      const replace = !entry || !['取消', '改期'].includes(action);
      const targetType = action === '缩短' && entry?.current ? entry.current.type : type;
      if (replace && targetType !== '休息' && (!Number.isInteger(amount) || amount < 0 || amount > 1440 || (!amount && !detail.trim()))) {
        return setError('请填写训练时长或具体训练内容。');
      }
      if (entry?.current && action === '缩短' && (!amount || amount >= entry.current.minutes)) return setError('请输入比原课更短的训练时长。');
      const workout = { type: targetType, minutes: targetType === '休息' ? 0 : amount, detail: detail.trim() || undefined };
      onSave((current) => {
        if (entry) return autoClassifyDates(changePlan(current, entry.id, action, reason, replace ? workout : undefined,
          action === '改期' ? target : undefined), action === '改期' ? [day, target] : [day]).state;
        if (!cycleContains(current, day)) throw new Error('日期不在当前周期内，请先调整周期。');
        return autoClassifyDay({ ...current, plan: [...current.plan, makeEntry(day, workout)] }, day).state;
      }, entry ? '调整已保存。' : '训练已加入课表。');
    }
  }

  const needsParent = activityRole === '热身' || activityRole === '冷身';
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <View style={styles.rowBetween}>
            <Text accessibilityRole="header" style={styles.modalHeading}>{title}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="关闭" onPress={onClose} hitSlop={10}><Icon name="close" size={24} /></Pressable>
          </View>
          <ScrollView style={styles.editorScroll} contentContainerStyle={styles.editorFields} keyboardShouldPersistTaps="handled">
            {sheet.type === 'checkin' && <>
              <Text style={styles.label}>起床体感</Text>
              <Options values={sensations} selected={[form.sensation]} onPress={(item) => setForm({ ...form, sensation: item })} />
              <Text style={styles.label}>有没有不适</Text>
              <Options< Symptom > values={expandedSymptoms ? [...commonSymptoms, ...moreSymptoms] : commonSymptoms}
                selected={form.customSymptom?.trim() ? form.symptoms.filter((item) => item !== '无不适') : form.symptoms}
                onPress={changeSymptom} />
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: expandedSymptoms }} onPress={() => setExpandedSymptoms(!expandedSymptoms)}>
                <Text style={styles.link}>{expandedSymptoms ? '收起其他选项' : '更多不适选项'}</Text>
              </Pressable>
              <Input label="其他不适（选填）" value={form.customSymptom ?? ''} maxLength={120}
                onChangeText={(customSymptom) => setForm({ ...form, customSymptom })} placeholder="例如右小腿跑起来痛" />
              <Input label="今天能训练多久（分钟）" value={minutes} onChangeText={setMinutes} numeric />
              <Input label="工作安排（选填）" value={form.schedule} onChangeText={(schedule) => setForm({ ...form, schedule })} placeholder="例如加班、出差" />
              <Input label="心情（选填）" value={form.mood} onChangeText={(mood) => setForm({ ...form, mood })} placeholder="例如有点烦躁" maxLength={80} />
              <Input label="备注（选填）" value={form.note ?? ''} onChangeText={(note) => setForm({ ...form, note })}
                placeholder="今天有什么想记下来？" maxLength={600} multiline />
              <Action label={replyBusy ? '正在生成回应…' : '生成心情回应'} onPress={generateReply} secondary
                disabled={replyBusy || (!form.mood.trim() && !form.note?.trim())} />
              <Text style={styles.small}>点生成会把这两项发送给已配置的 AI 服务。</Text>
              {form.moodReply && form.moodReply.mood === form.mood.trim() && form.moodReply.note === (form.note ?? '').trim() &&
                <Text style={styles.notice}>{form.moodReply.text}</Text>}
              {replyError !== '' && <Text accessibilityRole="alert" style={styles.notice}>{replyError}</Text>}
            </>}
            {sheet.type === 'cycle' && <>
              <Text style={styles.body}>设置想查看的训练周期，已安排的课和历史记录会保留。</Text>
              <Input label="开始日期" placeholder="YYYY-MM-DD" value={target} onChangeText={setTarget} />
              <Input label="周期周数" value={weeks} onChangeText={setWeeks} numeric />
            </>}
            {sheet.type === 'workout' && <>
              <Text style={styles.body}>{dateLabel(sheet.date)}{entry?.current ? ' · 当前 ' + workoutLabel(entry.current) : ''}</Text>
              {entry && <>
                <Text style={styles.label}>调整动作</Text>
                <Options values={changeActions} selected={[action]} onPress={(item) => {
                  setAction(item);
                  if (item === '降强度') setType('轻松跑');
                  if (item === '降强度' || item === '缩短') setDetail('');
                }} />
                <Text style={styles.label}>调整原因</Text>
                <Options values={changeReasons} selected={[reason]} onPress={setReason} />
              </>}
              {(!entry || action === '换课' || action === '降强度') && <>
                <Text style={styles.label}>训练类型</Text>
                <Options<WorkoutType> values={action === '降强度' && entry ? ['轻松跑', '休息'] : workoutTypes} selected={[type]} onPress={setType} />
              </>}
              {(!entry || !['取消', '改期'].includes(action)) && (type !== '休息' || action === '缩短') && <>
                <Input label="训练分钟数" value={minutes} onChangeText={setMinutes} numeric />
                <Input label="训练内容（选填）" value={detail} onChangeText={setDetail} placeholder="例如 6 × 800 米" />
              </>}
              {entry && action === '改期' && <Input label="新日期" placeholder="YYYY-MM-DD" value={target} onChangeText={setTarget} />}
            </>}
            {sheet.type === 'log' && <>
              <Text style={styles.body}>{dateLabel(sheet.date)}</Text>
              <Input label="活动名称" value={activityName} onChangeText={setActivityName} placeholder="例如 轻松跑" />
              <Input label="训练分钟数" value={minutes} onChangeText={setMinutes} numeric />
              <Input label="里程（公里，选填）" value={distance} onChangeText={setDistance} placeholder="例如 7.2" />
              <Input label="平均心率（次/分，选填）" value={heartRate} onChangeText={setHeartRate} numeric />
              <Input label="核心训练段（选填）" value={detail} onChangeText={setDetail} placeholder="例如 5 × 800 米" />
            </>}
            {sheet.type === 'classify' && <>
              <Text style={styles.body}>{sheet.activity.title} · {sheet.activity.minutes} 分钟 · {sheet.activity.km.toFixed(1)} 公里</Text>
              <Options values={roles} selected={[activityRole]} onPress={setActivityRole} />
              {needsParent && <><Text style={styles.label}>属于哪节训练</Text>
                {visibleActivities(state).filter((item) => item.date === sheet.activity.date && item.id !== sheet.activity.id && ['主课', '次课'].includes(item.role))
                  .map((item) => <Pressable accessibilityRole="button" accessibilityState={{ selected: parentId === item.id }} key={item.id}
                    style={[styles.option, parentId === item.id && styles.activeOption]} onPress={() => setParentId(item.id)}>
                    <Text style={styles.optionText}>{item.role} · {item.title}</Text>
                  </Pressable>)}
                {!visibleActivities(state).some((item) => item.date === sheet.activity.date && item.id !== sheet.activity.id && ['主课', '次课'].includes(item.role)) &&
                  <Text style={styles.small}>请先把其中一条活动标记为主课或次课。</Text>}
              </>}
            </>}
            {(error || notice) !== '' && <Text accessibilityRole="alert" style={styles.notice}>{error || notice}</Text>}
          </ScrollView>
          <Action label={sheet.type === 'checkin' ? '保存并更新建议' : '确认保存'} disabled={replyBusy} onPress={submit} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: paper },
  top: { backgroundColor: '#fff', borderBottomWidth: 1, borderColor: border },
  topInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', maxWidth: 1120, alignSelf: 'center', paddingHorizontal: 20, paddingVertical: 11, gap: 10 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  mark: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: green, borderRadius: 10 },
  brandText: { fontSize: 17, fontWeight: '800', color: ink },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  content: { width: '100%', maxWidth: 1120, alignSelf: 'center', paddingHorizontal: 18, paddingTop: 18, paddingBottom: 22, gap: 12 },
  pageHeading: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 },
  date: { color: green, fontSize: 13, fontWeight: '700', marginBottom: 3 },
  heading: { color: ink, fontSize: 35, fontWeight: '800', letterSpacing: -1.1 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: mint, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 7 },
  pillText: { fontSize: 12, fontWeight: '700', color: green },
  pageGrid: { gap: 10 },
  pageGridWide: { flexDirection: 'row', alignItems: 'flex-start' },
  column: { gap: 10, minWidth: 0 },
  mainColumn: { flex: 1.15 },
  sideColumn: { flex: 1 },
  hero: { backgroundColor: '#183b2d', borderRadius: 20, padding: 19, gap: 8 },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroLabel: { color: '#bfe9c6', fontSize: 13, fontWeight: '700' },
  heroTitle: { color: '#fff', fontWeight: '800', fontSize: 27, lineHeight: 34 },
  heroReason: { color: '#e0eee3', fontSize: 15, lineHeight: 23 },
  heroDivider: { height: 1, backgroundColor: '#48725d', marginVertical: 3 },
  heroPlan: { color: '#e0eee3', fontSize: 13, fontWeight: '600', lineHeight: 20 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  action: { minHeight: 43, borderRadius: 10, backgroundColor: green, minWidth: 72, paddingHorizontal: 13, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  actionSecondary: { borderColor: '#cadace', borderWidth: 1, backgroundColor: '#fff' },
  actionLabel: { color: '#fff', fontSize: 14, fontWeight: '700' },
  secondaryLabel: { color: green },
  dim: { opacity: 0.48 },
  card: { padding: 14, borderRadius: 17, borderWidth: 1, borderColor: border, backgroundColor: '#fff', gap: 9 },
  cardTitle: { color: ink, fontSize: 16, fontWeight: '800' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  metricGrid: { flexDirection: 'row', gap: 6 },
  metric: { flex: 1, paddingVertical: 10, paddingHorizontal: 7, gap: 4, backgroundColor: '#eff5ef', borderRadius: 10 },
  metricValue: { color: ink, fontWeight: '800', fontSize: 15 },
  small: { color: muted, fontSize: 12, lineHeight: 18 },
  body: { color: muted, fontSize: 14, lineHeight: 21 },
  label: { color: ink, fontSize: 14, fontWeight: '700' },
  textButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 4 },
  link: { color: green, fontWeight: '700', fontSize: 13, paddingVertical: 3 },
  tip: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  tipText: { flex: 1, gap: 3 },
  rule: { height: 1, backgroundColor: border },
  nav: { flexDirection: 'row', gap: 5 },
  mobileNav: { justifyContent: 'space-between', paddingHorizontal: 15 },
  navItem: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 9, paddingHorizontal: 15, borderRadius: 10, minHeight: 44 },
  navMobileItem: { flex: 1 },
  navActive: { backgroundColor: mint },
  navLabel: { color: muted, fontSize: 14, fontWeight: '700' },
  bottom: { backgroundColor: '#fff', borderTopWidth: 1, borderColor: border, paddingVertical: 6 },
  weekCenter: { alignItems: 'center' },
  splitRow: { flexDirection: 'row', gap: 8 },
  tableHeader: { paddingVertical: 9, borderTopWidth: 1, borderColor: border },
  planLabel: { flex: 1, color: muted, fontSize: 13, fontWeight: '700' },
  cell: { flex: 1, minWidth: 0, gap: 6 },
  day: { borderTopWidth: 1, borderColor: border, paddingTop: 10, gap: 8 },
  currentDay: { borderColor: '#82a88f' },
  planItem: { gap: 3, paddingBottom: 6 },
  activity: { padding: 7, gap: 2, backgroundColor: '#f0f5f0', borderRadius: 8 },
  activityName: { color: ink, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  role: { color: green, fontSize: 12, fontWeight: '700' },
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0d271f80', padding: 14 },
  modal: { width: '100%', maxWidth: 520, maxHeight: '90%', borderRadius: 17, backgroundColor: '#fff', padding: 16, gap: 11 },
  modalHeading: { color: ink, fontWeight: '800', fontSize: 22 },
  editorScroll: { flexShrink: 1 },
  editorFields: { gap: 9, paddingBottom: 3 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  option: { borderColor: border, borderWidth: 1, backgroundColor: '#fff', borderRadius: 9, paddingHorizontal: 10, paddingVertical: 9 },
  activeOption: { backgroundColor: mint, borderColor: '#8cb49a' },
  optionText: { color: ink, fontSize: 14 },
  activeText: { color: green, fontWeight: '800' },
  field: { gap: 4 },
  input: { borderColor: border, borderWidth: 1, borderRadius: 8, minHeight: 41, paddingHorizontal: 9, paddingVertical: 7, color: ink, fontSize: 16 },
  multiline: { minHeight: 74, textAlignVertical: 'top' },
  notice: { backgroundColor: mint, color: ink, borderRadius: 8, padding: 10, fontSize: 13, lineHeight: 19 },
});
