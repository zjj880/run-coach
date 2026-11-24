import { visibleActivities, type Activity, type CoachState, type PlanEntry, type Role } from './training.ts';

type RoleSuggestion = { id: string; role: Role; parentId?: string; reason: string };

export function paceSecPerKm(activity: Activity) {
  const seconds = activity.fit?.timerSeconds ?? activity.minutes * 60;
  return activity.km > 0 && seconds > 0 ? Math.round(seconds / activity.km) : undefined;
}

const startMinute = (activity: Activity) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(activity.time);
  return match ? Number(match[1]) * 60 + Number(match[2]) : undefined;
};
const timeOrder = (left: Activity, right: Activity) => (left.time + '|' + left.id).localeCompare(right.time + '|' + right.id);
const running = (activity: Activity) => activity.sport
  ? /running|treadmill|trail_run|ultra_run/.test(activity.sport)
  : /跑|间歇|节奏/.test(activity.title) || (activity.km > 0 && !/骑行|步行|走路|徒步|游泳|划船|力量/.test(activity.title));
const reliableHr = (activity: Activity) => {
  const feedback = activity.feedback;
  if (feedback?.heartRateTrust === '存疑' || (feedback?.cold && feedback.sensor === '腕式' && feedback.heartRateTrust !== '可信')) return undefined;
  return activity.fit?.averageHr ?? activity.averageHr;
};
const closeness = (value: number, target: number, tolerance: number) => Math.max(0, 1 - Math.abs(value - target) / tolerance);

function explicitTargets(plan: string) {
  const paces = [...plan.matchAll(/(?<!\d)(\d{1,2})[:：'′](\d{2})(?:["″])?\s*(?:\/\s*(?:公里|千米|km)|每公里)/gi)];
  const pace = paces.length === 1 && Number(paces[0][2]) < 60 ? Number(paces[0][1]) * 60 + Number(paces[0][2]) : undefined;
  const hr = /(?:心率|HR)\s*[:：]?\s*(\d{2,3})(?:\s*[-–—~～至]\s*(\d{2,3}))?/i.exec(plan);
  const heart = hr && Number(hr[1]) >= 70 && Number(hr[2] ?? hr[1]) <= 220 ? (Number(hr[1]) + Number(hr[2] ?? hr[1])) / 2 : undefined;
  return { pace, heart };
}

function selectMain(candidates: Activity[], plans: PlanEntry[]) {
  const plan = plans.find((row) => row.current && row.current.type !== '休息')?.current;
  const keySession = plan?.type === '节奏跑' || plan?.type === '间歇跑';
  const target = explicitTargets(plan?.detail ?? '');
  const longest = Math.max(...candidates.map((entry) => entry.minutes));
  const paces = candidates.map(paceSecPerKm).filter((value): value is number => value !== undefined);
  const fastest = Math.min(...paces);
  const heartRates = candidates.map(reliableHr).filter((value): value is number => value !== undefined);
  const highest = Math.max(...heartRates);
  function score(activity: Activity) {
    const pace = paceSecPerKm(activity);
    const hr = reliableHr(activity);
    const timeScore = plan?.minutes ? closeness(activity.minutes, plan.minutes, plan.minutes) : activity.minutes / longest;
    const paceScore = pace !== undefined && (target.pace !== undefined || (keySession && paces.length > 1))
      ? closeness(pace, target.pace ?? fastest, 120) : 0.5;
    const hrScore = hr !== undefined && (target.heart !== undefined || (keySession && heartRates.length > 1))
      ? closeness(hr, target.heart ?? highest, 35) : 0.5;
    const named = plan?.type && activity.title.includes(plan.type) ? 0.12 : 0;
    return timeScore * 0.6 + paceScore * 0.24 + hrScore * 0.16 + named;
  }
  return [...candidates].sort((left, right) => score(right) - score(left) || right.minutes - left.minutes || timeOrder(left, right))[0];
}

function lighterThan(activity: Activity, main: Activity) {
  const pace = paceSecPerKm(activity);
  const mainPace = paceSecPerKm(main);
  const heart = reliableHr(activity);
  const mainHr = reliableHr(main);
  const paceDifference = pace !== undefined && mainPace !== undefined ? pace - mainPace : undefined;
  const hrDifference = heart !== undefined && mainHr !== undefined ? heart - mainHr : undefined;
  if ((paceDifference ?? 0) < -15 || (hrDifference ?? 0) > 8) return false;
  return (paceDifference ?? 0) >= 18 || (hrDifference ?? 0) <= -8;
}

export function suggestRoles(activities: Activity[], plans: PlanEntry[]): RoleSuggestion[] {
  const pending = activities.filter((activity) => activity.role === '待归类' && activity.roleSource !== 'manual');
  const planned = plans.some((row) => row.current && row.current.type !== '休息');
  const runPlanned = plans.some((row) => row.current && /跑/.test(row.current.type));
  const eligible = pending.filter((activity) => (runPlanned ? running(activity) : true) &&
    activity.minutes >= 8 && !/热身|冷身|warm.?up|cool.?down/i.test(activity.title));
  const fixedMain = activities.find((activity) => activity.role === '主课');
  const main = fixedMain ?? (eligible.length ? selectMain(eligible, plans) : undefined);
  const result: RoleSuggestion[] = [];
  if (!fixedMain && main) {
    result.push({ id: main.id, role: '主课', reason: eligible.length === 1
      ? '当天仅一条符合条件的活动，暂作主课比对。'
      : planned ? '结合计划时长、可用心率和配速选作主课。' : '按时长及可用数据选作主课。' });
  }
  for (const activity of pending) {
    if (activity.id === main?.id) continue;
    const start = startMinute(activity);
    const mainStart = main ? startMinute(main) : undefined;
    if (main && start !== undefined && mainStart !== undefined && running(activity) && running(main) &&
      activity.minutes <= Math.min(20, main.minutes * 0.75) && lighterThan(activity, main)) {
      const before = mainStart - (start + activity.minutes);
      const after = start - (mainStart + main.minutes);
      if (before >= -2 && before <= 15) {
        result.push({ id: activity.id, role: '热身', parentId: main.id, reason: '紧邻主课之前，时长较短、配速或可信心率更低。' });
        continue;
      }
      if (after >= -2 && after <= 15) {
        result.push({ id: activity.id, role: '冷身', parentId: main.id, reason: '紧邻主课之后，时长较短、配速或可信心率更低。' });
        continue;
      }
    }
    if (activity.minutes >= 10 && !/热身|冷身|warm.?up|cool.?down/i.test(activity.title)) {
      result.push({ id: activity.id, role: '次课', reason: '作为独立活动记录。' });
    }
  }
  return result;
}

export function autoClassifyDay(state: CoachState, date: string): { state: CoachState; applied: RoleSuggestion[] } {
  const activities = visibleActivities(state).filter((activity) => activity.date === date);
  const lockedParents = new Set(activities.filter((item) => item.roleSource !== 'auto' && item.parentId).map((item) => item.parentId));
  const reconsider = new Set(activities.filter((item) => item.roleSource === 'auto' && !lockedParents.has(item.id)).map((item) => item.id));
  const working = activities.map((item): Activity => reconsider.has(item.id)
    ? { ...item, role: '待归类', roleSource: undefined, roleReason: undefined, parentId: undefined } : item);
  const plan = state.plan.filter((entry) => entry.date === date);
  const suggestions = new Map(suggestRoles(working, plan).map((item) => [item.id, item]));
  const applied: RoleSuggestion[] = [];
  const next = state.activities.map((item): Activity => {
    const suggestion = suggestions.get(item.id);
    if (!suggestion) return reconsider.has(item.id)
      ? { ...item, role: '待归类', roleSource: undefined, roleReason: undefined, parentId: undefined } : item;
    if (item.role === suggestion.role && item.parentId === suggestion.parentId && item.roleReason === suggestion.reason) return item;
    applied.push(suggestion);
    return { ...item, role: suggestion.role, parentId: suggestion.parentId, roleSource: 'auto', roleReason: suggestion.reason };
  });
  return { state: next.some((item, index) => item !== state.activities[index]) ? { ...state, activities: next } : state, applied };
}

export function autoClassifyDates(state: CoachState, dates: Iterable<string>) {
  let next = state;
  for (const date of new Set(dates)) next = autoClassifyDay(next, date).state;
  return { state: next };
}

export function pendingDates(state: CoachState) {
  return [...new Set(visibleActivities(state).filter((activity) => activity.role === '待归类' && activity.roleSource !== 'manual').map((activity) => activity.date))].sort();
}
