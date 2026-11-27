import { weekStart, type Activity, type CoachState, type PlanEntry } from './training.ts';
import type { CoachDay } from './coach';

/** 局域网同步：手机与电脑各自保存整个 CoachState，通过配对码交换后按规则合并。 */

export type SyncEnvelope = { version: 1; exportedAt: string; state: CoachState };
export type SyncSummary = {
  activities: { added: number; updated: number };
  plan: { added: number; updated: number };
  checkIns: number;
  notes: number;
  reviews: number;
  intake: number;
  water: number;
  total: number;
};

const nonEmpty = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).some(nonEmpty);
  return true;
};

/** 谁的信息更全就留谁；一样全时保留本地，保证合并结果可复现。 */
const richer = <T>(local: T | undefined, remote: T | undefined): T | undefined => {
  if (local === undefined) return remote;
  if (remote === undefined) return local;
  const localScore = Object.values(local as Record<string, unknown>).filter(nonEmpty).length;
  const remoteScore = Object.values(remote as Record<string, unknown>).filter(nonEmpty).length;
  return remoteScore > localScore ? remote : local;
};

const unionById = <T extends { id: string }>(local: T[], remote: T[]): { list: T[]; added: number; updated: number } => {
  const map = new Map(local.map((item) => [item.id, item]));
  let added = 0;
  let updated = 0;
  for (const item of remote) {
    const existing = map.get(item.id);
    if (!existing) { map.set(item.id, item); added += 1; continue; }
    const merged = richer(existing, item);
    if (merged && merged !== existing) { map.set(item.id, merged); updated += 1; }
  }
  return { list: [...map.values()], added, updated };
};

const newerTime = (local?: string, remote?: string): string | undefined => {
  if (!local) return remote;
  if (!remote) return local;
  return remote > local ? remote : local;
};

const mergeActivities = (local: Activity[], remote: Activity[]) => {
  const map = new Map(local.map((item) => [item.id, item]));
  let added = 0;
  let updated = 0;
  for (const item of remote) {
    const existing = map.get(item.id);
    if (!existing) { map.set(item.id, item); added += 1; continue; }
    const merged: Activity = {
      ...existing,
      ...item,
      // 关键字段取更完整的一侧，避免一边只有摘要时覆盖掉另一边的明细
      title: existing.title || item.title,
      core: existing.core ?? item.core,
      averageHr: existing.averageHr ?? item.averageHr,
      sport: existing.sport ?? item.sport,
      detail: existing.detail && item.detail
        ? { ...item.detail, ...existing.detail }
        : existing.detail ?? item.detail,
      fit: existing.fit ?? item.fit,
      feedback: richer(existing.feedback, item.feedback),
      role: existing.role !== '待归类' ? existing.role : item.role,
      roleSource: existing.roleSource ?? item.roleSource,
      roleReason: existing.roleReason ?? item.roleReason,
    };
    map.set(item.id, merged);
    updated += 1;
  }
  return { list: [...map.values()], added, updated };
};

const mergePlan = (local: PlanEntry[], remote: PlanEntry[]) => {
  const map = new Map(local.map((item) => [item.id, item]));
  let added = 0;
  let updated = 0;
  for (const item of remote) {
    const existing = map.get(item.id);
    if (!existing) { map.set(item.id, item); added += 1; continue; }
    // 调整记录更多的一侧更新（改课会产生 changes），相同时保留本地
    if (item.changes.length > existing.changes.length) { map.set(item.id, item); updated += 1; }
  }
  return { list: [...map.values()], added, updated };
};

export function mergeStates(local: CoachState, remote: CoachState): { state: CoachState; summary: SyncSummary } {
  const activities = mergeActivities(local.activities, remote.activities);
  const plan = mergePlan(local.plan, remote.plan);

  const checkIns = { ...remote.checkIns };
  for (const [date, entry] of Object.entries(local.checkIns)) {
    checkIns[date] = richer(entry, checkIns[date]) ?? entry;
  }

  const reviews = { ...remote.reviews };
  for (const [date, entry] of Object.entries(local.reviews ?? {})) {
    const other = reviews[date];
    reviews[date] = !other || entry.reviewedAt >= other.reviewedAt ? entry : other;
  }

  const coaching: Record<string, CoachDay> = { ...(remote.coaching ?? {}) };
  for (const [date, entry] of Object.entries(local.coaching ?? {})) {
    const other = coaching[date];
    coaching[date] = !other || entry.messages.length >= other.messages.length ? entry : other;
  }

  const notes = unionById(local.notes ?? [], remote.notes ?? []);
  const periods = unionById(local.periods ?? [], remote.periods ?? []);
  const intake = unionById(local.intake ?? [], remote.intake ?? []);
  const water = unionById(local.water ?? [], remote.water ?? []);

  const dates = [...activities.list.map((item) => item.date), ...plan.list.map((item) => item.date)];
  const earliest = dates.length ? weekStart(dates.reduce((a, b) => (a < b ? a : b))) : local.cycleStart;
  const latest = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : local.cycleStart;
  const spanDays = Math.ceil((Date.parse(latest + 'T00:00:00Z') - Date.parse(earliest + 'T00:00:00Z')) / 86_400_000) + 1;
  const weeks = Math.max(local.weeks, remote.weeks, Math.ceil(Math.max(spanDays, 0) / 7));

  const garmin = (() => {
    if (!local.garmin) return remote.garmin;
    if (!remote.garmin) return local.garmin;
    return remote.garmin.syncedAt > local.garmin.syncedAt ? remote.garmin : local.garmin;
  })();

  const state: CoachState = {
    ...local,
    cycleStart: earliest,
    weeks,
    plan: plan.list,
    activities: activities.list,
    checkIns,
    skipped: [...new Set([...local.skipped, ...remote.skipped])],
    lastSync: newerTime(local.lastSync, remote.lastSync),
    demoMetrics: local.demoMetrics && remote.demoMetrics,
    weatherEnabled: local.weatherEnabled ?? remote.weatherEnabled,
    reviews,
    availability: local.availability && remote.availability
      ? {
        window: local.availability.window,
        manual: { ...remote.availability.manual, ...local.availability.manual },
        selected: { ...remote.availability.selected, ...local.availability.selected },
        calendar: richer(local.availability.calendar, remote.availability.calendar),
      }
      : local.availability ?? remote.availability,
    garmin,
    coaching,
    periods: periods.list,
    notes: notes.list,
    profile: local.profile ?? remote.profile,
    intake: intake.list,
    water: water.list,
  };

  const total = activities.added + activities.updated + plan.added + plan.updated + notes.added + periods.added
    + intake.added + water.added + Object.keys(reviews).length;
  return {
    state,
    summary: {
      activities, plan,
      checkIns: Object.keys(checkIns).length,
      notes: notes.added,
      reviews: Object.keys(reviews).length,
      intake: intake.added,
      water: water.added,
      total,
    },
  };
}

/** 配对码：6 位数字，便于在手机上输入。 */
export const makePairCode = (): string => String(Math.floor(100000 + Math.random() * 900000));

export function pairingUrl(host: string, port: number): string {
  return 'http://' + host + ':' + port + '/sync';
}

export function isPrivateHost(host: string): boolean {
  return /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
}
