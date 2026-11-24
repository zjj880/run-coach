import type { Activity, Health } from './training';
import type { FitActivity } from './fit';

const host = 'https://personal.connectapi.garmin.cn';
const tokenPath = '/personalapitoken-service/personal-api/personal-api-key/token';
type GarminRow = Record<string, unknown>;

export type GarminSnapshot = {
  date: string;
  syncedAt: string;
  health: Health;
  unavailable: string[];
};
export type GarminSync = GarminSnapshot & { activities: Activity[] };
export type ActivityDetail = {
  maxHr?: number;
  runningCadenceSpm?: number;
  strideLengthCm?: number;
  elevationGainM?: number;
  averagePowerW?: number;
  movingSeconds?: number;
  aerobicTrainingEffect?: number;
  anaerobicTrainingEffect?: number;
  segmentTotals?: { type: string; count?: number; seconds?: number; meters?: number; averageHr?: number }[];
};

export function validateGarminKey(input: string) {
  const value = input.trim();
  if (!/^GCDC_[A-Za-z0-9./+_=-]{20,240}$/.test(value)) {
    throw new Error('请输入 Garmin Connect 中国区创建的个人 API 密钥。');
  }
  return value;
}

export function validateGarminDate(input: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) throw new Error('请输入有效的同步日期。');
  const date = new Date(input + 'T00:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input) {
    throw new Error('请输入有效的同步日期。');
  }
  return date;
}

const obj = (input: unknown): GarminRow => input && typeof input === 'object' && !Array.isArray(input) ? input as GarminRow : {};
const positive = (input: unknown): number | null => typeof input === 'number' && Number.isFinite(input) && input > 0 ? input : null;
const metric = (input: unknown) => positive(input) ?? undefined;
const forDate = (row: GarminRow, day: string) => !row.calendarDate || row.calendarDate === day ? row : {};
const sleepRecord = (value: unknown) => {
  const data = obj(value);
  return { ...data, ...obj(data.dailySleepDTO) };
};

function normalizeActivities(input: unknown): Activity[] {
  const root = obj(input);
  const list = Array.isArray(input) ? input : root.activityList ?? root.activities;
  if (!Array.isArray(list)) return [];
  const types: Record<string, string> = { running: '跑步', track_running: '操场跑', treadmill_running: '跑步机', strength_training: '力量训练', cycling: '骑行', lap_swimming: '游泳' };
  const result = new Map<string, Activity>();
  for (const item of list) {
    const row = obj(item);
    const id = String(row.activityId ?? '');
    const stamp = typeof row.startTimeLocal === 'string' ? row.startTimeLocal : '';
    const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(stamp);
    const seconds = positive(row.duration);
    if (!/^\d+$/.test(id) || !match || seconds === null) continue;
    const kind = obj(row.activityType).typeKey;
    const name = typeof row.activityName === 'string' ? row.activityName.trim() : '';
    result.set(id, {
      id: 'garmin-cn-' + id, date: match[1], time: match[2],
      title: name || (typeof kind === 'string' ? types[kind] : undefined) || '佳明活动',
      ...(typeof kind === 'string' ? { sport: kind } : {}),
      minutes: Math.round(seconds / 6) / 10, km: Math.round((positive(row.distance) ?? 0) / 10) / 100,
      averageHr: positive(row.averageHR) ?? undefined, role: '待归类',
    });
  }
  return [...result.values()].sort((left, right) => (left.date + left.time).localeCompare(right.date + right.time));
}

async function request(fetcher: typeof fetch, path: string, authorization: string, method = 'GET') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 14_000);
  try {
    const response = await fetcher(host + path, { method, headers: { Authorization: authorization, Accept: '*/*' }, signal: controller.signal, redirect: 'error' });
    return { status: response.status, body: response.ok && response.status !== 204 ? await response.text() : '' };
  } finally { clearTimeout(timer); }
}

async function getGarminData(input: string, fetcher: typeof fetch) {
  const key = validateGarminKey(input);
  let tokenResponse;
  try {
    tokenResponse = await request(fetcher, tokenPath, 'ApiKey ' + key, 'POST');
  } catch {
    throw new Error('无法连接佳明中国区，请检查网络后重试。');
  }
  if (tokenResponse.status === 401 || tokenResponse.status === 403 || tokenResponse.status === 404) {
    throw new Error('佳明中国区未接受该密钥。请检查账号区服、密钥是否有效。');
  }
  if (tokenResponse.status !== 200) throw new Error('佳明令牌请求失败（HTTP ' + tokenResponse.status + '）。');
  const tokenBody = tokenResponse.body.trim();
  let token: unknown = tokenBody;
  try {
    const parsed: unknown = JSON.parse(tokenBody);
    token = typeof parsed === 'string' ? parsed : obj(parsed).access_token ?? obj(parsed).accessToken;
  } catch { /* The official endpoint may return the access token as plain text. */ }
  if (typeof token !== 'string' || !/^[A-Za-z0-9._~+/=-]{20,4096}$/.test(token)) throw new Error('佳明返回的令牌格式无法识别。');
  const get = async (path: string): Promise<unknown> => {
    const result = await request(fetcher, path, 'Bearer ' + token);
    if (result.status === 204) return null;
    if (result.status !== 200) throw new Error('HTTP ' + result.status);
    return result.body.trim() ? JSON.parse(result.body) : null;
  };
  return { get, token };
}

async function downloadFit(fetcher: typeof fetch, id: string, token: string, maxBytes: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetcher(host + '/download-service/files/activity/' + id, {
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/zip, application/octet-stream' },
      signal: controller.signal, redirect: 'error',
    });
    if (response.status !== 200 || Number(response.headers.get('content-length')) > maxBytes) {
      controller.abort();
      throw new Error('无法下载活动 FIT。');
    }
    const reader = response.body?.getReader?.();
    if (!reader) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > maxBytes) throw new Error('FIT 文件过大。');
      return bytes;
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maxBytes) {
          await reader.cancel();
          throw new Error('FIT 文件过大。');
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  } finally { clearTimeout(timeout); }
}

function normalizeDetail(input: unknown): ActivityDetail {
  const root = obj(input);
  const row = { ...root, ...obj(root.summaryDTO) };
  const segmentTotals = Array.isArray(root.splitSummaries) ? root.splitSummaries.slice(0, 20).flatMap((item: unknown) => {
    const split = obj(item);
    if (typeof split.splitType !== 'string') return [];
    const seconds = metric(split.duration);
    const meters = metric(split.distance);
    const averageHr = metric(split.averageHR);
    if (!seconds && !meters && !averageHr) return [];
    return [{ type: split.splitType.slice(0, 45), count: metric(split.noOfSplits), seconds, meters, averageHr }];
  }) : [];
  return {
    maxHr: metric(row.maxHR),
    runningCadenceSpm: metric(row.averageRunCadence ?? row.averageRunningCadenceInStepsPerMinute),
    strideLengthCm: metric(row.strideLength),
    elevationGainM: metric(row.elevationGain),
    averagePowerW: metric(row.avgPower ?? row.averagePower),
    movingSeconds: metric(row.movingDuration),
    aerobicTrainingEffect: metric(row.trainingEffect ?? row.aerobicTrainingEffect),
    anaerobicTrainingEffect: metric(row.anaerobicTrainingEffect),
    segmentTotals: segmentTotals.length ? segmentTotals : undefined,
  };
}

export type GarminActivityDetail = { id: string; detail?: ActivityDetail; fit?: FitActivity };

export async function syncGarminDetails(input: string, ids: string[], fetcher: typeof fetch = fetch): Promise<GarminActivityDetail[]> {
  if (!ids.length || ids.length > 12 || ids.some((id) => !/^garmin-cn-[1-9]\d{0,19}$/.test(id))) {
    throw new Error('请选择 1 至 12 条有效的佳明活动。');
  }
  const { get, token } = await getGarminData(input, fetcher);
  const details: GarminActivityDetail[] = [];
  let reachable = false;
  const { parseFitActivity, maxFitDownloadBytes } = await import('./fit.ts');
  for (let start = 0; start < ids.length; start += 3) {
    const batch = await Promise.all(ids.slice(start, start + 3).map(async (id): Promise<GarminActivityDetail> => {
      const activityId = id.slice('garmin-cn-'.length);
      const [summary, file] = await Promise.allSettled([
        get('/activity-service/activity/' + activityId).then(normalizeDetail),
        downloadFit(fetcher, activityId, token, maxFitDownloadBytes).then(parseFitActivity),
      ]);
      if (summary.status === 'fulfilled' || file.status === 'fulfilled') reachable = true;
      const detail = summary.status === 'fulfilled' && Object.values(summary.value).some((value) => value !== undefined) ? summary.value : undefined;
      return { id, detail, fit: file.status === 'fulfilled' ? file.value : undefined };
    }));
    details.push(...batch.filter(({ detail, fit }) => detail || fit));
  }
  if (!reachable) throw new Error('佳明暂时无法读取活动明细和 FIT，请重试。');
  return details;
}

export async function syncGarminDaily(input: string, day: string, fetcher: typeof fetch = fetch): Promise<GarminSync> {
  const date = validateGarminDate(day);
  const { get } = await getGarminData(input, fetcher);
  const before = new Date(date);
  before.setUTCDate(date.getUTCDate() - 28);
  const previous = new Date(date);
  previous.setUTCDate(date.getUTCDate() - 1);
  const activityStart = new Date(date);
  activityStart.setUTCDate(date.getUTCDate() - 13);
  const [sleep, hrv, heart, history, activities] = await Promise.allSettled([
    get('/sleep-service/sleep/dailySleep?date=' + day),
    get('/hrv-service/hrv/' + day),
    get('/wellness-service/wellness/dailyHeartRate?date=' + day),
    get('/sleep-service/sleep/dailySleepSummariesByDate?startDate=' + before.toISOString().slice(0, 10) + '&endDate=' + previous.toISOString().slice(0, 10)),
    get('/activitylist-service/activities/search/activities?start=0&limit=100&startDate=' + activityStart.toISOString().slice(0, 10) + '&endDate=' + day),
  ]);
  const sleepRow = forDate(sleepRecord(sleep.status === 'fulfilled' ? sleep.value : null), day);
  const hrvRoot = obj(hrv.status === 'fulfilled' ? hrv.value : null);
  const hrvRow = forDate({ ...hrvRoot, ...obj(hrvRoot.hrvSummary) }, day);
  const heartRow = forDate(obj(heart.status === 'fulfilled' ? heart.value : null), day);
  const sleepSeconds = positive(sleepRow.sleepTimeSeconds);
  const sleepMinutes = sleepSeconds === null ? null : Math.round(sleepSeconds / 60);
  const restingReference = positive(heartRow.lastSevenDaysAvgRestingHeartRate);
  const historicValues = history.status === 'fulfilled' && Array.isArray(history.value)
    ? history.value.map((value) => positive(sleepRecord(value).sleepTimeSeconds)).filter((value): value is number => value !== null).sort((a, b) => a - b)
    : [];
  const sleepReference = historicValues.length >= 7 ? Math.round(historicValues[Math.floor(historicValues.length / 2)] / 60) : null;
  const health: Health = {
    sleepMinutes, hrv: positive(hrvRow.lastNightAvg), restingHr: positive(heartRow.restingHeartRate),
    reference: {
      sleepLow: sleepReference === null ? null : Math.max(1, sleepReference - 60),
      hrvLow: positive(obj(hrvRow.baseline).balancedLow),
      restingHrHigh: restingReference === null ? null : restingReference + 5,
    },
  };
  if ([sleep, hrv, heart, activities].every((item) => item.status === 'rejected')) {
    throw new Error('佳明已通过认证，但当日数据和活动暂时无法读取，请稍后重试。');
  }
  const unavailable = [health.sleepMinutes === null ? '睡眠' : '', health.hrv === null ? '夜间 HRV' : '', health.restingHr === null ? '静息心率' : ''].filter(Boolean);
  if (activities.status === 'rejected') unavailable.push('训练活动');
  return { date: day, syncedAt: new Date().toISOString(), health, unavailable, activities: activities.status === 'fulfilled' ? normalizeActivities(activities.value) : [] };
}
