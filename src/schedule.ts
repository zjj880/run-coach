export type TimeRange = { start: number; end: number };
export type BusyRange = TimeRange & { title: string };
export type CalendarBlock = { startAt: number; endAt: number; title: string };
export type CalendarSnapshot = { source: string; from: string; until: string; blocks: CalendarBlock[] };
export type ScheduleBook = {
  window: TimeRange;
  manual: Record<string, BusyRange[]>;
  selected: Record<string, TimeRange>;
  calendar?: CalendarSnapshot;
};

export const emptySchedule: ScheduleBook = { window: { start: 360, end: 1320 }, manual: {}, selected: {} };

export function parseClock(value: string) {
  const parts = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!parts) return null;
  const [, hoursText, minutesText] = parts;
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  if ((hours === 24 && minutes === 0) || (hours < 24 && minutes < 60)) return hours * 60 + minutes;
  return null;
}

export function toClock(minutes: number) {
  return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
}

export function rangeLabel(range: TimeRange) {
  return toClock(range.start) + '–' + toClock(range.end);
}

function minuteOfDay(time: number) {
  const value = new Date(time);
  return value.getHours() * 60 + value.getMinutes();
}

export function busyOnDay(book: ScheduleBook, day: string) {
  const supplied = book.manual[day] ?? [];
  const source = book.calendar;
  if (!source || day < source.from || day >= source.until) return { supplied, imported: [], covered: false };
  const start = new Date(day + 'T00:00:00');
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const imported = source.blocks
    .filter((entry) => entry.startAt < end.getTime() && entry.endAt > start.getTime())
    .map((entry): BusyRange => ({
      start: entry.startAt <= start.getTime() ? 0 : minuteOfDay(entry.startAt),
      end: entry.endAt >= end.getTime() ? 1440 : minuteOfDay(entry.endAt),
      title: entry.title,
    }))
    .sort((left, right) => left.start - right.start);
  return { supplied, imported, covered: true };
}

export function openRanges(window: TimeRange, busy: TimeRange[]) {
  const result: TimeRange[] = [];
  let cursor = window.start;
  for (const block of [...busy].sort((left, right) => left.start - right.start)) {
    if (block.end <= cursor) continue;
    const stop = Math.min(block.start, window.end);
    if (stop > cursor) result.push({ start: cursor, end: stop });
    cursor = Math.max(cursor, block.end);
    if (cursor >= window.end) break;
  }
  if (cursor < window.end) result.push({ start: cursor, end: window.end });
  return result;
}

export function scheduleForDay(book: ScheduleBook, day: string) {
  const busy = busyOnDay(book, day);
  const available = openRanges(book.window, [...busy.imported, ...busy.supplied]);
  const saved = book.selected[day];
  const selected = saved && available.some((range) => saved.start >= range.start && saved.end <= range.end && saved.start < saved.end) ? saved : undefined;
  return { ...busy, available, selected, hasConflict: Boolean(saved && !selected) };
}
