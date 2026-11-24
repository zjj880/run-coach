import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCalendar } from '../src/calendarImport.ts';
import { emptySchedule, openRanges, parseClock, scheduleForDay } from '../src/schedule.ts';
import { defaultCheckIn, emptyHealth, getAdvice, initialState } from '../src/training.ts';

test('overlapping calendar blocks leave one usable gap and invalidate old training slots', () => {
  const date = '2026-11-24';
  const clock = (value) => new Date(date + 'T' + value + ':00').getTime();
  const book = {
    ...emptySchedule,
    window: { start: 480, end: 660 },
    calendar: { source: 'test.ics', from: date, until: '2026-11-25', blocks: [
      { startAt: clock('08:00'), endAt: clock('09:00'), title: '会议' },
    ] },
    manual: { [date]: [{ start: 515, end: 550, title: '出行' }] },
    selected: { [date]: { start: 535, end: 560 } },
  };
  const day = scheduleForDay(book, date);
  assert.deepEqual(day.available, [{ start: 550, end: 660 }]);
  assert.equal(day.selected, undefined);
  assert.equal(day.hasConflict, true);
  assert.equal(parseClock('24:00'), 1440);
  assert.equal(parseClock('24:30'), null);
  assert.deepEqual(openRanges({ start: 360, end: 1320 }, [{ start: 0, end: 1440 }]), []);
});

test('ICS expands recurring busy events while excluding free or removed occurrences', () => {
  const text = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'BEGIN:VEVENT', 'UID:meeting', 'DTSTART;TZID=Asia/Shanghai:20261124T090000', 'DTEND;TZID=Asia/Shanghai:20261124T100000',
    'RRULE:FREQ=DAILY;COUNT=3', 'EXDATE;TZID=Asia/Shanghai:20261125T090000', 'SUMMARY:Daily meeting', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:free', 'DTSTART:20261124T110000', 'DTEND:20261124T120000', 'TRANSP:TRANSPARENT', 'SUMMARY:Free marker', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const result = parseCalendar(text, '2026-11-24', '2026-11-28');
  assert.equal(result.length, 2);
  assert.equal(new Date(result[0].startAt).toISOString(), '2026-11-24T01:00:00.000Z');
  assert.equal(new Date(result[1].startAt).toISOString(), '2026-11-26T01:00:00.000Z');
});

test('selected time limits advice and user-entered symptoms affect the result', () => {
  const date = '2026-11-24';
  const state = initialState(date);
  assert.equal(getAdvice(state, date, emptyHealth, 20).label, '时间冲突');
  state.checkIns[date] = { ...defaultCheckIn, customSymptom: '右脚底跑起来痛' };
  assert.equal(getAdvice(state, date, emptyHealth, 20).changeReason, '身体不适');
});
