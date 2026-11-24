import { Decoder, Stream } from '@garmin/fitsdk';
import { unzipSync } from 'fflate';

export const maxFitDownloadBytes = 12 * 1024 * 1024;

export type FitLap = {
  number: number; meters?: number; timerSeconds?: number; paceSecPerKm?: number;
  averageHr?: number; maxHr?: number; averagePowerW?: number; ascentM?: number;
};
export type HeartSample = [second: number, bpm: number, segment: number];
export type FitActivity = {
  laps: FitLap[];
  elapsedSeconds: number;
  timerSeconds?: number;
  heartRate: HeartSample[];
  heartRateSampleCount: number;
  heartRateTrend: { fromSeconds: number; toSeconds: number; average: number; min: number; max: number; count: number }[];
  averageHr?: number;
  maxHr?: number;
  averagePowerW?: number;
  ascentM?: number;
};

const positive = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
const heart = (value: unknown) => typeof value === 'number' && value >= 20 && value <= 255 ? value : undefined;
const time = (value: unknown) => value instanceof Date && Number.isFinite(value.getTime()) ? value.getTime() : undefined;

function fitBytes(bytes: Uint8Array) {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return bytes;
  let selected = false;
  const files = unzipSync(bytes, { filter: (file) => {
    if (selected || !file.name.toLowerCase().endsWith('.fit') || file.originalSize <= 0 || file.originalSize > 24 * 1024 * 1024) {
      return false;
    }
    selected = true;
    return true;
  } });
  const activity = Object.values(files)[0];
  if (!activity) throw new Error('活动压缩包中没有可读取的 FIT。');
  return activity;
}

function chartSamples(points: HeartSample[], duration: number) {
  if (points.length <= 180) return points;
  const width = Math.max(1, Math.ceil((duration + 1) / 80));
  const buckets = new Map<number, { low: HeartSample; high: HeartSample }>();
  for (const point of points) {
    const index = Math.floor(point[0] / width);
    const bucket = buckets.get(index);
    if (!bucket) buckets.set(index, { low: point, high: point });
    else {
      if (point[1] < bucket.low[1]) bucket.low = point;
      if (point[1] >= bucket.high[1]) bucket.high = point;
    }
  }
  const last = points[points.length - 1];
  const sampled = [points[0], ...Array.from(buckets.values()).flatMap(({ low, high }) => [low, high]), last];
  return [...new Set(sampled)].sort((left, right) => left[0] - right[0]);
}

export function parseFitActivity(bytes: Uint8Array): FitActivity {
  if (!bytes.length || bytes.length > maxFitDownloadBytes) throw new Error('FIT 文件大小超出支持范围。');
  const decoder = new Decoder(Stream.fromByteArray(fitBytes(bytes)));
  if (!decoder.checkIntegrity()) throw new Error('FIT 文件校验失败。');
  const { messages, errors } = decoder.read();
  if (errors.length) throw new Error('FIT 文件包含无法读取的记录。');
  const sessions = messages.sessionMesgs ?? [];
  const records = (messages.recordMesgs ?? []).flatMap((record) => {
    const stamp = time(record.timestamp);
    return stamp === undefined ? [] : [{ stamp, bpm: heart(record.heartRate) }];
  }).sort((left, right) => left.stamp - right.stamp);
  const first = Math.min(time(sessions[0]?.startTime) ?? Infinity, records[0]?.stamp ?? Infinity);
  const last = Math.max(time(sessions[sessions.length - 1]?.timestamp) ?? 0, records[records.length - 1]?.stamp ?? 0);
  const elapsedSeconds = Number.isFinite(first) ? Math.max(0, Math.round((last - first) / 1000)) : 0;
  const timerSeconds = sessions.length ? sessions.reduce((sum, session) => sum + (positive(session.totalTimerTime) ?? 0), 0) : 0;
  const laps = (messages.lapMesgs ?? []).map((lap, index): FitLap => {
    const meters = positive(lap.totalDistance);
    const timer = positive(lap.totalTimerTime);
    return { number: index + 1, meters, timerSeconds: timer,
      paceSecPerKm: meters && timer ? Math.round(timer * 1000 / meters) : undefined,
      averageHr: heart(lap.avgHeartRate), maxHr: heart(lap.maxHeartRate),
      averagePowerW: positive(lap.avgPower), ascentM: positive(lap.totalAscent),
    };
  });
  if (!sessions.length && !records.length && !laps.length) throw new Error('FIT 文件中没有活动数据。');
  let segment = 0;
  let previous: number | undefined;
  const points: HeartSample[] = [];
  for (const record of records) {
    if (record.bpm === undefined) continue;
    const second = Math.round((record.stamp - first) / 1000);
    if (previous !== undefined && second - previous > 30) segment += 1;
    if (second === previous) points.pop();
    points.push([second, record.bpm, segment]);
    previous = second;
  }
  const sections = Array.from({ length: 3 }, () => ({ min: Infinity, max: 0, sum: 0, count: 0 }));
  const third = Math.max(1, Math.ceil((elapsedSeconds + 1) / 3));
  for (const [second, bpm] of points) {
    const range = sections[Math.min(2, Math.floor(second / third))];
    range.min = Math.min(range.min, bpm);
    range.max = Math.max(range.max, bpm);
    range.sum += bpm;
    range.count += 1;
  }
  const summary = sessions.length === 1 ? sessions[0] : undefined;
  return { laps, elapsedSeconds, timerSeconds: timerSeconds || undefined, heartRate: chartSamples(points, elapsedSeconds),
    heartRateSampleCount: points.length, heartRateTrend: sections.flatMap(({ min, max, sum, count }, index) => count ? [{
      fromSeconds: index * third, toSeconds: Math.min(elapsedSeconds, (index + 1) * third - 1), min, max, average: Math.round(sum / count), count,
    }] : []),
    averageHr: heart(summary?.avgHeartRate), maxHr: heart(summary?.maxHeartRate),
    averagePowerW: positive(summary?.avgPower), ascentM: positive(summary?.totalAscent),
  };
}
