import ICAL from 'ical.js';
import type { CalendarBlock } from './schedule';

function eventTime(value: InstanceType<typeof ICAL.Time>, zoneId?: string): number {
  if (value.isDate || value.zone.tzid !== 'floating' || !zoneId) return value.toJSDate().getTime();
  const parts = (input: Intl.DateTimeFormatPart[]) => Object.fromEntries(input.map((part) => [part.type, Number(part.value)]));
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: zoneId, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const target = Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute, value.second);
  let guess = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const view = parts(formatter.formatToParts(guess));
    const offset = target - Date.UTC(view.year, view.month - 1, view.day, view.hour, view.minute, view.second);
    if (!offset) return guess;
    guess += offset;
  }
  throw new Error('日历包含无法转换的时区时间，请重新导出后再试。');
}

export function parseCalendar(text: string, from: string, until: string): CalendarBlock[] {
  const parsed = new ICAL.Component(ICAL.parse(text.trim()));
  if (parsed.name !== 'vcalendar') throw new Error('请选择有效的 .ics 日历文件。');
  const earliest = new Date(from + 'T00:00:00').getTime();
  const latest = new Date(until + 'T00:00:00').getTime();
  const blocks = new Map<string, CalendarBlock>();
  const zones = parsed.getAllSubcomponents('vtimezone').map((item) => new ICAL.Timezone({ component: item }));
  const previous = zones.map((zone) => ICAL.TimezoneService.get(zone.tzid));
  for (const zone of zones) ICAL.TimezoneService.register(zone);
  try {
    const add = (item: InstanceType<typeof ICAL.Event>, starts = item.startDate, ends = item.endDate) => {
      if (item.component.getFirstPropertyValue('status') === 'CANCELLED' || item.component.getFirstPropertyValue('transp') === 'TRANSPARENT') return;
      if (!starts || !ends) return;
      const zone = (name: string) => String(item.component.getFirstProperty(name)?.getParameter('tzid') || '') || undefined;
      const startAt = eventTime(starts, zone('dtstart'));
      const endAt = eventTime(ends, zone('dtend') ?? zone('dtstart'));
      if (Number.isFinite(startAt) && Number.isFinite(endAt) && endAt > startAt && startAt < latest && endAt > earliest) {
        blocks.set(item.uid + ':' + startAt + ':' + endAt, { startAt, endAt, title: item.summary || '忙碌' });
      }
    };
    let occurrences = 0;
    for (const component of parsed.getAllSubcomponents('vevent')) {
      const event = new ICAL.Event(component);
      if (!event.startDate || !event.isRecurring()) {
        if (event.startDate) add(event);
        continue;
      }
      const iterator = event.iterator();
      const zone = String(component.getFirstProperty('dtstart')?.getParameter('tzid') || '') || undefined;
      for (let occurrence = iterator.next(); occurrence && eventTime(occurrence, zone) < latest; occurrence = iterator.next()) {
        if (++occurrences > 50_000) throw new Error('日历重复事件过多，请导出较短的日期范围。');
        const item = event.getOccurrenceDetails(occurrence);
        add(item.item, item.startDate, item.endDate);
      }
    }
  } finally {
    zones.forEach((zone, index) => {
      const original = previous[index];
      if (original) ICAL.TimezoneService.register(original);
      else ICAL.TimezoneService.remove(zone.tzid);
    });
  }
  return [...blocks.values()];
}
