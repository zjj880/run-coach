import { classifyActivity, visibleActivities, type Activity, type CoachState, type PlanEntry, type Role } from './training.ts';

/**
 * 自动归类：根据实际活动的时长、里程、配速、平均心率和先后顺序，
 * 把「待归类」的活动推断为 主课 / 次课 / 热身 / 冷身。
 * 只处理待归类项，用户手动确认过的归属不会被覆盖。
 */

export type RoleSuggestion = { id: string; role: Role; parentId?: string; reason: string };

const warmupMaxMinutes = 20;
const coldownMaxMinutes = 20;
const secondaryMinMinutes = 10;
const adjacencyMinutes = 30;

const minuteOfDay = (time: string) => {
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  return match ? Number(match[1]) * 60 + Number(match[2]) : undefined;
};

const round1 = (value: number) => Math.round(value * 10) / 10;

export function paceSecPerKm(activity: Activity): number | undefined {
  return activity.km > 0 && activity.minutes > 0 ? Math.round(activity.minutes * 60 / activity.km) : undefined;
}

export function paceLabel(activity: Activity): string | undefined {
  const pace = paceSecPerKm(activity);
  if (pace === undefined) return undefined;
  return Math.floor(pace / 60) + ':' + String(pace % 60).padStart(2, '0');
}

/** 强度分：有平均心率用心率；没有则用配速折算到与心率同一量级。 */
function intensity(activity: Activity): number {
  if (activity.averageHr !== undefined) return activity.averageHr;
  const pace = paceSecPerKm(activity);
  if (pace !== undefined) return Math.max(100, Math.min(200, Math.round(260 - pace / 2)));
  return 150;
}

function describe(activity: Activity) {
  const parts: string[] = [];
  if (activity.averageHr !== undefined) parts.push('平均心率 ' + activity.averageHr);
  const pace = paceLabel(activity);
  if (pace) parts.push('均配 ' + pace + '/公里');
  parts.push(round1(activity.minutes) + ' 分钟');
  if (activity.km > 0) parts.push(round1(activity.km) + ' 公里');
  return parts.join(' · ');
}

function byTime(left: Activity, right: Activity) {
  return (left.time + '|' + left.id).localeCompare(right.time + '|' + right.id);
}

/** 当天课表里是否有正向训练（非休息、有时长或内容）。 */
function planWorkouts(plans: PlanEntry[]) {
  return plans.filter((entry) => entry.current && entry.current.type !== '休息');
}

function pickMain(pending: Activity[], plans: PlanEntry[]): Activity {
  const workouts = planWorkouts(plans);
  if (pending.length === 1) return pending[0];
  const keyWorkout = workouts.some((entry) => entry.current && ['节奏跑', '间歇跑', '长跑'].includes(entry.current.type));
  return [...pending].sort((left, right) => {
    const score = intensity(right) - intensity(left);
    if (Math.abs(score) >= 3) return score;
    // 强度接近时，优先时长更接近计划时长的那条
    const planned = workouts[0]?.current?.minutes ?? 0;
    if (planned > 0) return Math.abs(left.minutes - planned) - Math.abs(right.minutes - planned);
    // 仍然接近时，强度课优先取更长的那条，否则取更早的那条
    if (keyWorkout) return right.minutes - left.minutes;
    return byTime(left, right);
  })[0];
}

export function suggestRoles(activities: Activity[], plans: PlanEntry[]): RoleSuggestion[] {
  const pending = activities.filter((activity) => activity.role === '待归类').sort(byTime);
  if (!pending.length) return [];
  const main = pickMain(pending, plans);
  const result: RoleSuggestion[] = [];
  const mainScore = intensity(main);

  result.push({
    id: main.id,
    role: '主课',
    reason: pending.length === 1 ? '当天唯一一条活动，按计划视为主课' : '强度最高（' + describe(main) + '）',
  });

  for (const activity of pending) {
    if (activity.id === main.id) continue;
    const before = byTime(activity, main) < 0;
    const activityStart = minuteOfDay(activity.time);
    const mainStart = minuteOfDay(main.time);
    const adjacent = activityStart !== undefined && mainStart !== undefined && (before
      ? mainStart - activityStart >= -5 && mainStart - activityStart <= adjacencyMinutes
      : activityStart - (mainStart + main.minutes) >= -5 && activityStart - (mainStart + main.minutes) <= adjacencyMinutes);
    const short = activity.minutes <= (before ? warmupMaxMinutes : coldownMaxMinutes);
    const lighter = intensity(activity) < mainScore - 8;
    if (before && adjacent && short && lighter) {
      result.push({ id: activity.id, role: '热身', parentId: main.id, reason: '紧接主课之前、' + describe(activity) + '，低于主课强度' });
    } else if (!before && adjacent && short && lighter) {
      result.push({ id: activity.id, role: '冷身', parentId: main.id, reason: '紧接主课之后、' + describe(activity) + '，低于主课强度' });
    } else if (activity.minutes >= secondaryMinMinutes) {
      result.push({ id: activity.id, role: '次课', reason: '非当日主课，' + describe(activity) });
    }
  }
  return result;
}

/** 对单日待归类活动应用自动归类；返回新状态与实际生效的建议。 */
export function autoClassifyDay(state: CoachState, date: string): { state: CoachState; applied: RoleSuggestion[] } {
  const activities = visibleActivities(state).filter((activity) => activity.date === date);
  const plans = state.plan.filter((entry) => entry.date === date);
  const suggestions = suggestRoles(activities, plans);
  if (!suggestions.length) return { state, applied: [] };

  let next = state;
  const applied: RoleSuggestion[] = [];
  // 先定主课/次课，再定热身/冷身（归属依赖主课已存在）
  for (const role of ['主课', '次课', '热身', '冷身'] as const) {
    for (const suggestion of suggestions.filter((item) => item.role === role)) {
      try {
        next = classifyActivity(next, suggestion.id, suggestion.role, suggestion.parentId);
        applied.push(suggestion);
      } catch {
        // 单条失败（例如归属方不存在）不影响其他活动
      }
    }
  }
  return { state: next, applied };
}

/** 对多个日期批量自动归类（同步后一次性处理最近若干天）。 */
export function autoClassifyDates(state: CoachState, dates: Iterable<string>): { state: CoachState; applied: RoleSuggestion[] } {
  let next = state;
  const applied: RoleSuggestion[] = [];
  for (const date of new Set(dates)) {
    const result = autoClassifyDay(next, date);
    next = result.state;
    applied.push(...result.applied);
  }
  return { state: next, applied };
}

export function pendingDates(state: CoachState) {
  return [...new Set(visibleActivities(state).filter((activity) => activity.role === '待归类').map((activity) => activity.date))].sort();
}
