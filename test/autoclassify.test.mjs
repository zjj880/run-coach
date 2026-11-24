import assert from 'node:assert/strict';
import { test } from 'node:test';
import { autoClassifyDates, autoClassifyDay, pendingDates, paceSecPerKm, suggestRoles } from '../src/autoclassify.ts';
import { classifyActivity, emptyHealth, importDemo, initialState, visibleActivities } from '../src/training.ts';

const date = '2026-11-24';

const activitiesOf = (state) => visibleActivities(state).filter((activity) => activity.date === date);
const rolesOf = (state) => activitiesOf(state).map(({ title, role, parentId }) => [title, role, parentId ?? null]);

test('single activity day becomes the main session so it can be evaluated', () => {
  const state = initialState(date);
  const single = { id: 'garmin-cn-900', date, time: '07:10', title: '跑步', minutes: 53.4, km: 10.11, averageHr: 135, role: '待归类' };
  // 佳明活动只在连接佳明后可见，这里模拟已连接
  const withActivity = {
    ...state,
    garmin: { date, syncedAt: new Date().toISOString(), health: emptyHealth, unavailable: [] },
    activities: [...state.activities, single],
  };
  const result = autoClassifyDay(withActivity, date);
  assert.equal(result.applied.length, 1);
  assert.equal(result.applied[0].role, '主课');
  const saved = activitiesOf(result.state).find((activity) => activity.id === single.id);
  assert.equal(saved.role, '主课');
});

test('main, warmup, cooldown and secondary sessions are split by pace, heart rate and adjacency', () => {
  const state = importDemo(initialState(date), date);
  const result = autoClassifyDay(state, date);
  assert.deepEqual(rolesOf(result.state), [
    ['晨跑记录 1', '热身', 'demo-sync-2026-11-24-main'],
    ['间歇跑', '主课', null],
    ['晨跑记录 2', '冷身', 'demo-sync-2026-11-24-main'],
    ['晚间轻松跑', '次课', null],
  ]);
  // 已有归属不应被二次改写
  assert.equal(autoClassifyDay(result.state, date).applied.length, 0);
  assert.equal(pendingDates(result.state).length, 0);
});

test('manual classification wins over suggestions', () => {
  const state = importDemo(initialState(date), date);
  const [, main] = activitiesOf(state);
  const manual = classifyActivity(state, main.id, '次课');
  const result = autoClassifyDay(manual, date);
  assert.equal(activitiesOf(result.state).find((activity) => activity.id === main.id).role, '次课');
  assert.equal(activitiesOf(result.state).find((activity) => activity.role === '主课').role, '主课');
});

test('suggestions explain their reason and fall back to pace when heart rate is missing', () => {
  const state = initialState(date);
  const noHr = [
    { id: 'a', date, time: '07:00', title: '热身跑', minutes: 10, km: 1.5, role: '待归类' },
    { id: 'b', date, time: '07:12', title: '间歇', minutes: 30, km: 8, role: '待归类' },
    { id: 'c', date, time: '07:45', title: '慢跑收尾', minutes: 8, km: 1.1, role: '待归类' },
  ];
  const suggestions = suggestRoles(noHr, state.plan.filter((entry) => entry.date === date));
  const byId = Object.fromEntries(suggestions.map((item) => [item.id, item]));
  assert.equal(byId.b.role, '主课');
  assert.equal(byId.a.role, '热身');
  assert.equal(byId.a.parentId, 'b');
  assert.equal(byId.c.role, '冷身');
  assert.match(byId.b.reason, /配速/);
  assert.equal(paceSecPerKm({ id: 'p', date, time: '07:00', title: '跑', minutes: 30, km: 5, role: '待归类' }), 360);
});

test('late activities do not displace a manual main, and suspect wrist readings do not prevent a pace-based warmup', () => {
  const state = initialState(date);
  const records = [
    { id: 'original', date, time: '08:00', title: '轻松跑', minutes: 40, km: 7.8, averageHr: 135, role: '主课' },
    { id: 'warm', date, time: '07:50', title: '早上跑', minutes: 10, km: 1.3, averageHr: 182, role: '待归类',
      feedback: { effort: 3, sensor: '腕式', heartRateTrust: '存疑', cold: true, note: '' } },
    { id: 'burst', date, time: '18:00', title: '跑步', minutes: 13, km: 4, averageHr: 178, role: '待归类' },
  ];
  const result = autoClassifyDay({ ...state, activities: records }, date).state;
  assert.deepEqual(result.activities.map(({ role, parentId, roleSource }) => [role, parentId, roleSource]),
    [['主课', undefined, undefined], ['热身', 'original', 'auto'], ['次课', undefined, 'auto']]);
});

test('batch classification handles several dates and ignores empty days', () => {
  const first = importDemo(initialState(date), date);
  const next = importDemo(first, '2026-11-25');
  const result = autoClassifyDates(next, [date, '2026-11-25', '2026-11-30']);
  assert.equal(pendingDates(result.state).length, 0);
  assert.equal(activitiesOf(result.state).filter((activity) => activity.role === '主课').length, 1);
});
