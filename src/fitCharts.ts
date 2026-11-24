import type { HeartSample } from './fit';

export function chartTime(seconds: number) {
  const rounded = Math.round(seconds);
  return Math.floor(rounded / 60) + ':' + String(rounded % 60).padStart(2, '0');
}

export function chartBounds(values: number[], step: number, padding: number) {
  if (!values.length) return null;
  const minimum = values.reduce((low, value) => Math.min(low, value), Infinity);
  const maximum = values.reduce((high, value) => Math.max(high, value), -Infinity);
  return {
    minimum, maximum,
    lower: Math.max(0, Math.floor((minimum - padding) / step) * step),
    upper: Math.ceil((maximum + padding) / step) * step,
  };
}

export function heartSampleAt(samples: HeartSample[], second: number) {
  const next = samples.findIndex((sample) => sample[0] >= second);
  const after = samples[next];
  const before = samples[next < 0 ? samples.length - 1 : next - 1];
  if (after?.[0] === second) return after;
  if (!before || !after || before[2] !== after[2]) return undefined;
  return second - before[0] <= after[0] - second ? before : after;
}
