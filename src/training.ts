import type { SavedReview } from './evaluation';
import type { ScheduleBook } from './schedule';
import type { ActivityDetail, GarminSnapshot, GarminSync } from './garmin';
import type { CoachDay } from './coach';
import type { FitActivity } from './fit';

export const workoutTypes = ['轻松跑', '节奏跑', '间歇跑', '长跑', '力量训练', '休息'] as const;
export type WorkoutType = (typeof workoutTypes)[number];
export type Workout = { type: WorkoutType; minutes: number; detail?: string };
export type ChangeAction = '缩短' | '降强度' | '换课' | '取消' | '改期';
export type ChangeReason = '身体不适' | '疲劳' | '日程冲突' | '其他';
export type Change = { action: ChangeAction; reason: ChangeReason; targetDate?: string; previous: Workout };
export type PlanEntry = { id: string; date: string; original: Workout; current: Workout | null; changes: Change[]; movedFrom?: string };
export type ImportRow = { date: string; type: WorkoutType | ''; minutes: number | null; detail: string; source: string };

export const roles = ['待归类', '主课', '次课', '热身', '冷身'] as const;
export type Role = (typeof roles)[number];
export type ActivityFeedback = {
  effort: number | null;
  sensor: '未注明' | '腕式' | '胸带';
  heartRateTrust: '未评估' | '可信' | '存疑';
  cold: boolean;
  note: string;
};
export type Activity = { id: string; date: string; time: string; title: string; sport?: string; minutes: number; km: number; averageHr?: number; core?: string; role: Role; parentId?: string; roleSource?: 'auto' | 'manual'; roleReason?: string; detail?: ActivityDetail; fit?: FitActivity; feedback?: ActivityFeedback };

export const sensations = ['良好', '一般', '偏累'] as const;
export type Sensation = (typeof sensations)[number];
export const commonSymptoms = ['无不适', '腿痛', '脚痛', '嗓子痛', '咳嗽或鼻塞', '发热'] as const;
export const moreSymptoms = ['膝痛', '脚踝痛', '肌肉酸痛', '头痛', '胃肠不适', '跑动时疼痛', '症状加重', '胸痛或呼吸困难'] as const;
export const symptoms = [...commonSymptoms, ...moreSymptoms] as const;
export type Symptom = (typeof symptoms)[number];
export type CheckIn = {
  sensation: Sensation; symptoms: Symptom[]; minutes: number; schedule: string; mood: string; timeEstimated?: boolean;
  customSymptom?: string;
  note?: string;
  moodReply?: { text: string; mood: string; note: string };
};
export type Health = {
  sleepMinutes: number | null; hrv: number | null; restingHr: number | null;
  reference?: { sleepLow: number | null; hrvLow: number | null; restingHrHigh: number | null };
};
export type TrainingPeriod = { id: string; name: string; from: string; to: string };

export const periodPresets = ['基础期', '专项期', '调整期', '比赛期', '恢复期'] as const;

export type CoachState = {
  cycleStart: string;
  weeks: number;
  plan: PlanEntry[];
  activities: Activity[];
  checkIns: Record<string, CheckIn>;
  skipped: string[];
  lastSync?: string;
  demoMetrics: boolean;
  /** 是否允许同步明细时用取整后的活动起点查询环境温湿度；缺省为开启。 */
  weatherEnabled?: boolean;
  reviews?: Record<string, SavedReview>;
  availability?: ScheduleBook;
  garmin?: GarminSnapshot;
  coaching?: Record<string, CoachDay>;
  /** 用户自定义的训练周期（基础期/专项期/调整期等），按日期区间划分。 */
  periods?: TrainingPeriod[];
};

export function periodForDate(state: CoachState, date: string): TrainingPeriod | undefined {
  return state.periods?.find((period) => date >= period.from && date <= period.to);
}

export function periodTotals(state: CoachState) {
  return (state.periods ?? []).map((period) => {
    const activities = visibleActivities(state).filter((item) => item.date >= period.from && item.date <= period.to);
    const days = new Set(activities.map((item) => item.date)).size;
    return {
      period,
      activities: activities.length,
      days,
      km: Math.round(activities.reduce((sum, item) => sum + item.km, 0) * 10) / 10,
      minutes: Math.round(activities.reduce((sum, item) => sum + item.minutes, 0)),
    };
  });
}

/** 让训练周期覆盖给定日期范围（历史活动导入后，课表才能翻到那些周）。 */
export function ensureCycleCovers(state: CoachState, dates: string[]): CoachState {
  const valid = dates.filter(dateIsValid);
  if (!valid.length) return state;
  const first = valid.reduce((low, date) => (date < low ? date : low), valid[0]);
  const last = valid.reduce((high, date) => (date > high ? date : high), valid[0]);
  const cycleEnd = addDays(state.cycleStart, state.weeks * 7 - 1);
  const start = first < state.cycleStart ? weekStart(first) : state.cycleStart;
  const end = last > cycleEnd ? last : cycleEnd;
  const weeks = Math.max(1, Math.min(104, Math.ceil(((Date.parse(end) - Date.parse(start)) / 86_400_000 + 1) / 7)));
  if (start === state.cycleStart && weeks === state.weeks) return state;
  return { ...state, cycleStart: start, weeks };
}

export const defaultCheckIn: CheckIn = { sensation: '一般', symptoms: ['无不适'], minutes: 45, schedule: '', mood: '' };
export const demoHealth: Health = { sleepMinutes: 370, hrv: 42, restingHr: 57, reference: { sleepLow: 390, hrvLow: 46, restingHrHigh: 55 } };
export const emptyHealth: Health = { sleepMinutes: null, hrv: null, restingHr: null };

export function visibleActivities(state: CoachState) {
  return state.activities.filter((item) => state.garmin ? !item.id.startsWith('demo-') : !item.id.startsWith('garmin-cn-'));
}

export function applyGarminSync(state: CoachState, sync: GarminSync): CoachState {
  const { activities, ...garmin } = sync;
  const stored = new Map(state.activities.map((item) => [item.id, item]));
  for (const incoming of activities) {
    const old = stored.get(incoming.id);
    stored.set(incoming.id, old ? { ...incoming, role: old.role, parentId: old.parentId, roleSource: old.roleSource,
      roleReason: old.roleReason, core: old.core ?? incoming.core,
      detail: old.detail ?? incoming.detail, fit: old.fit, feedback: old.feedback } : incoming);
  }
  const trainedDates = new Set(activities.map((item) => item.date));
  return { ...state, garmin, activities: [...stored.values()], skipped: state.skipped.filter((date) => !trainedDates.has(date)) };
}

export function mergeActivities(state: CoachState, incoming: Activity[]): CoachState {
  const stored = new Map(state.activities.map((item) => [item.id, item]));
  for (const next of incoming) {
    const old = stored.get(next.id);
    stored.set(next.id, old ? { ...next, role: old.role, parentId: old.parentId, roleSource: old.roleSource,
      roleReason: old.roleReason, core: old.core ?? next.core, detail: old.detail ?? next.detail, fit: old.fit, feedback: old.feedback } : next);
  }
  const importedDates = new Set(incoming.map((item) => item.date));
  return { ...state, activities: [...stored.values()], skipped: state.skipped.filter((date) => !importedDates.has(date)) };
}

export function localDate(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

export function addDays(date: string, days: number) {
  const value = new Date(date + 'T00:00:00Z');
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function dateIsValid(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const value = new Date(date + 'T00:00:00Z');
  return !Number.isNaN(value.getTime()) && value.toISOString().slice(0, 10) === date;
}

export function weekStart(date: string) {
  const day = new Date(date + 'T00:00:00Z').getUTCDay();
  return addDays(date, -((day + 6) % 7));
}

export function dateLabel(date: string) {
  const value = new Date(date + 'T00:00:00Z');
  return `${value.getUTCMonth() + 1}月${value.getUTCDate()}日 周${'日一二三四五六'[value.getUTCDay()]}`;
}

export function workoutLabel(workout: Workout) {
  return workout.type === '休息' || workout.minutes <= 0 ? workout.type : `${workout.type} ${workout.minutes} 分钟`;
}

export function makeEntry(date: string, workout: Workout, id = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`): PlanEntry {
  return { id, date, original: { ...workout }, current: workout, changes: [] };
}

export function initialState(today: string): CoachState {
  const cycleStart = weekStart(today);
  const plan: PlanEntry[] = [];
  for (let week = 0; week < 8; week += 1) {
    const monday = addDays(cycleStart, week * 7);
    const entries: [number, Workout][] = [
      [0, { type: '轻松跑', minutes: 40 }],
      [2, { type: '间歇跑', minutes: 48, detail: '6 × 800 米' }],
      [4, { type: '轻松跑', minutes: 35 }],
      [6, { type: '长跑', minutes: 80 }],
    ];
    for (const [offset, workout] of entries) {
      const date = addDays(monday, offset);
      if (date !== today) plan.push(makeEntry(date, workout, `demo-plan-${date}`));
    }
  }
  plan.push(makeEntry(today, { type: '节奏跑', minutes: 45, detail: '10 分钟热身 · 25 分钟节奏 · 10 分钟冷身' }, `demo-plan-${today}`));
  return {
    cycleStart, weeks: 8, plan,
    activities: [
      { id: 'demo-history-1', date: addDays(today, -2), time: '07:20', title: '操场间歇', minutes: 48, km: 8.1, averageHr: 164, core: '5 × 800 米', role: '主课' },
      { id: 'demo-history-2', date: addDays(today, -4), time: '18:40', title: '轻松跑', minutes: 35, km: 5.9, averageHr: 139, role: '主课' },
    ],
    checkIns: {}, skipped: [], demoMetrics: true,
  };
}

export function cycleContains(state: CoachState, date: string) {
  return date >= state.cycleStart && date < addDays(state.cycleStart, state.weeks * 7);
}

export const isDefaultDemoPlan = (entry: PlanEntry) => entry.id.startsWith('demo-plan-') && !entry.changes.length;

export function importPlan(state: CoachState, rows: ImportRow[], replaceDemo = false): { state: CoachState; added: number; duplicates: number } {
  const plan = replaceDemo ? state.plan.filter((entry) => !isDefaultDemoPlan(entry)) : [...state.plan];
  let added = 0;
  let duplicates = 0;
  for (const [index, row] of rows.entries()) {
    if (!dateIsValid(row.date) || !row.type || !workoutTypes.includes(row.type)) {
      throw new Error('请补齐第 ' + (index + 1) + ' 条的日期和训练类型。');
    }
    const detail = row.detail.trim() || undefined;
    const minutes = row.type === '休息' ? 0 : row.minutes ?? 0;
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440 || (row.type !== '休息' && !minutes && !detail)) {
      throw new Error('请补齐第 ' + (index + 1) + ' 条的时长或具体训练内容。');
    }
    const same = (workout: Workout) =>
      workout.type === row.type && workout.minutes === minutes && (workout.detail?.trim() || undefined) === detail;
    if (plan.some((entry) => entry.date === row.date && (same(entry.original) || (entry.current && same(entry.current))))) {
      duplicates += 1;
      continue;
    }
    plan.push(makeEntry(row.date, { type: row.type, minutes, detail }));
    added += 1;
  }
  if (!added) return { state, added, duplicates };
  const dates = rows.map((row) => row.date).sort();
  const start = dates[0] < state.cycleStart ? weekStart(dates[0]) : state.cycleStart;
  const last = addDays(state.cycleStart, state.weeks * 7 - 1);
  const end = dates[dates.length - 1] > last ? dates[dates.length - 1] : last;
  const weeks = Math.ceil(((Date.parse(end) - Date.parse(start)) / 86_400_000 + 1) / 7);
  if (weeks > 52) throw new Error('这些日期跨度超过 52 周，请检查识别日期或分周期导入。');
  return { state: { ...state, plan, cycleStart: start, weeks }, added, duplicates };
}

export function isKeyWorkout(workout: Workout) {
  return workout.type === '节奏跑' || workout.type === '间歇跑' || workout.type === '长跑';
}

export function changePlan(state: CoachState, entryId: string, action: ChangeAction, reason: ChangeReason, replacement?: Workout, targetDate?: string): CoachState {
  const entry = state.plan.find((item) => item.id === entryId);
  if (!entry?.current) throw new Error('这节课已经调整，请重新选择。');
  let moved: PlanEntry | undefined;
  if (action === '改期') {
    if (!targetDate || !dateIsValid(targetDate) || !cycleContains(state, targetDate) || targetDate <= entry.date) {
      throw new Error('请选择周期内晚于原训练日的日期。');
    }
    if (isKeyWorkout(entry.current) && state.plan.some((other) =>
      other.id !== entry.id && other.current && isKeyWorkout(other.current) &&
      other.date >= addDays(targetDate, -1) && other.date <= addDays(targetDate, 1)
    )) {
      throw new Error('新日期与长跑或强度课相邻，请选其他日期。');
    }
    moved = { ...makeEntry(targetDate, entry.current), movedFrom: entry.date };
  } else if (action !== '取消' && !replacement) {
    throw new Error('请填写调整后的训练。');
  }
  const current = action === '改期' || action === '取消' ? null : replacement!;
  const change: Change = { action, reason, targetDate, previous: entry.current };
  return {
    ...state,
    plan: state.plan.map((item) => item.id === entryId ? { ...item, current, changes: [...item.changes, change] } : item).concat(moved ? [moved] : []),
  };
}

export function importDemo(state: CoachState, date: string): CoachState {
  const examples: Omit<Activity, 'date' | 'role'>[] = [
    { id: 'warmup', time: '07:05', title: '晨跑记录 1', minutes: 12, km: 1.9, averageHr: 133 },
    { id: 'main', time: '07:17', title: '间歇跑', minutes: 30, km: 5.4, averageHr: 167, core: '5 × 800 米' },
    { id: 'cooldown', time: '07:47', title: '晨跑记录 2', minutes: 8, km: 1.2, averageHr: 138 },
    { id: 'evening', time: '18:45', title: '晚间轻松跑', minutes: 20, km: 3.1, averageHr: 143 },
  ];
  const existing = new Set(state.activities.map((activity) => activity.id));
  const incoming = examples.map((example): Activity => ({
    ...example, id: `demo-sync-${date}-${example.id}`, date, role: '待归类',
  }));
  return {
    ...state,
    activities: [...state.activities, ...incoming.filter((activity) => !existing.has(activity.id))],
    skipped: state.skipped.filter((day) => day !== date),
    lastSync: new Date().toISOString(),
  };
}

export function classifyActivity(state: CoachState, id: string, role: Role, parentId?: string): CoachState {
  const visible = visibleActivities(state);
  const activity = visible.find((item) => item.id === id);
  if (!activity) throw new Error('这条活动已不存在。');
  const needsParent = role === '热身' || role === '冷身';
  const parent = visible.find((item) => item.id === parentId && item.date === activity.date);
  if (needsParent && (!parent || parent.id === id || !['主课', '次课'].includes(parent.role))) {
    throw new Error('请先标记主课或次课，再选归属。');
  }
  return {
    ...state,
    activities: state.activities.map((item): Activity => {
      if (item.id === id) return { ...item, role, parentId: needsParent ? parentId : undefined, roleSource: 'manual', roleReason: undefined };
      if (role === '主课' && item.date === activity.date && item.role === '主课' && visible.includes(item)) {
        return { ...item, role: '次课', roleSource: 'manual', roleReason: undefined };
      }
      if (item.parentId === id && !['主课', '次课'].includes(role)) return { ...item, role: '待归类', parentId: undefined, roleSource: undefined, roleReason: undefined };
      return item;
    }),
  };
}

export type Advice = {
  label: string;
  title: string;
  reason: string;
  recovery: string;
  nutrition: string;
  action?: '降强度' | '缩短' | '取消';
  replacement?: Workout;
  changeReason?: ChangeReason;
};

export function getAdvice(state: CoachState, date: string, health: Health, selectedMinutes?: number): Advice {
  const today = state.plan.filter((entry) => entry.date === date && entry.current);
  const workout = today[0]?.current;
  const checkIn = state.checkIns[date];
  const activities = visibleActivities(state);
  const actual = activities.filter((activity) => activity.date === date);
  const recentEffort = activities.some((activity) => activity.date >= addDays(date, -2) && activity.date < date &&
    activity.role !== '热身' && activity.role !== '冷身' && /间歇|节奏/.test(activity.title));
  const rest = '按平时时间作息，给今晚留出睡眠时间。';
  const meal = '正常吃三餐，按口渴和活动情况补水。';
  const hasTraining = Boolean(workout && workout.type !== '休息');
  if (checkIn?.symptoms.includes('胸痛或呼吸困难')) {
    return { label: '暂停运动', title: '停止运动，及时就医', reason: '你反馈了胸痛或呼吸困难。', recovery: '暂停当天训练，尽快寻求医疗帮助。', nutrition: '按医务人员建议安排饮食和补水。' };
  }
  if (checkIn?.symptoms.includes('发热') || checkIn?.symptoms.includes('症状加重')) {
    return { label: '休息优先', title: '今天休息，暂停训练', reason: '你反馈了发热或症状加重。', recovery: '休息并观察症状变化，恢复训练前重新评估。', nutrition: '按耐受情况进食和补水。', action: hasTraining ? '取消' : undefined, changeReason: '身体不适' };
  }
  const reported: string[] = checkIn?.symptoms.filter((value) => value !== '无不适') ?? [];
  if (checkIn?.customSymptom?.trim()) reported.push('其他不适');
  if (reported.length) {
    return { label: '调整训练', title: '暂停训练，先看症状变化', reason: '本次打卡记录了' + reported.join('、') + '。', recovery: '休息后重新评估体感。', nutrition: '按耐受情况进食和补水。', action: hasTraining ? '取消' : undefined, changeReason: '身体不适' };
  }
  if (actual.length > 0) {
    if (hasTraining && !actual.some((activity) => activity.role === '主课')) {
      return { label: '活动待确认', title: '先确认今天的主课', reason: '已记录活动，请确认是否完成原定主课。', recovery: rest, nutrition: meal };
    }
    const total = actual.reduce((sum, item) => sum + item.minutes, 0);
    return { label: '训练已记录', title: '今天进入训练后恢复', reason: `已同步 ${actual.length} 条活动，共 ${total} 分钟。`, recovery: rest, nutrition: '训练后补水，下一餐安排主食和蛋白质来源。' };
  }
  if (!workout || workout.type === '休息' || state.skipped.includes(date)) {
    return { label: '恢复日', title: '今天按休息日安排', reason: '今天没有待执行的训练课。', recovery: rest, nutrition: meal };
  }
  const reference = health.reference;
  const flags = [
    health.sleepMinutes !== null && reference?.sleepLow != null && health.sleepMinutes < reference.sleepLow,
    health.hrv !== null && reference?.hrvLow != null && health.hrv < reference.hrvLow,
    health.restingHr !== null && reference?.restingHrHigh != null && health.restingHr > reference.restingHrHigh,
  ];
  const deviations = flags.filter(Boolean).length;
  const missing = [health.sleepMinutes, health.hrv, health.restingHr].some((value) => value === null);
  const referenceName = state.garmin ? '个人参考范围' : '演示基线';
  const manualMinutes = checkIn && !checkIn.timeEstimated ? checkIn.minutes : undefined;
  const available = selectedMinutes === undefined ? manualMinutes ?? (workout.minutes || undefined) :
    Math.min(selectedMinutes, manualMinutes ?? selectedMinutes);
  if (available === 0) {
    return { label: '时间冲突', title: '今天没有训练时间', reason: '按当前日程，可以跳过这节课，或在课表里选择改期。', recovery: rest, nutrition: meal, action: '取消', changeReason: '日程冲突' };
  }
  if (isKeyWorkout(workout) && checkIn?.sensation === '偏累' && (recentEffort || deviations >= 2)) {
    const replacement: Workout = { type: '轻松跑', minutes: Math.min(25, available ?? 25, workout.minutes || 25) };
    return { label: '建议降强度', title: `改成 ${replacement.minutes} 分钟轻松跑`, reason: recentEffort ? '近两天有强度训练，加上今天自评偏累。' : '多项恢复指标偏离' + referenceName + '，加上今天自评偏累。', recovery: rest, nutrition: '训练后补水，按平时安排正餐。', action: '降强度', replacement, changeReason: '疲劳' };
  }
  if (available !== undefined && available < workout.minutes) {
    const replacement = { ...workout, minutes: available, detail: undefined };
    const shorteningNeedsReview = isKeyWorkout(workout);
    return { label: '时间冲突', title: shorteningNeedsReview ? '缩短或改期，先检查课表' : `${workout.type}缩短至 ${available} 分钟`, reason: `今天可用 ${available} 分钟，原课需要 ${workout.minutes} 分钟。`, recovery: rest, nutrition: meal, action: shorteningNeedsReview ? undefined : '缩短', replacement: shorteningNeedsReview ? undefined : replacement, changeReason: '日程冲突' };
  }
  if (!checkIn && isKeyWorkout(workout) && deviations >= 2) {
    return { label: '晨间评估', title: '先确认体感，再决定强度', reason: '多项恢复指标偏离' + referenceName + '，完成晨间打卡后更新建议。', recovery: rest, nutrition: meal };
  }
  return {
    label: missing ? '部分数据缺失' : checkIn ? '今日建议' : '晨间评估',
    title: `按课表安排${workout.type}`,
    reason: missing ? '恢复指标有缺失，请结合晨间体感确认。' : !checkIn ? '提交体感和可用时间后更新建议。' : '你的晨间反馈和可用时间支持当前安排。',
    recovery: rest,
    nutrition: workout.type === '长跑' ? '出发前准备饮水和熟悉的途中补给。' : meal,
  };
}
