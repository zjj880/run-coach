import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changePlan, classifyActivity, defaultCheckIn, demoHealth, emptyHealth, getAdvice, importDemo, initialState } from '../src/training.ts';

const today = '2026-11-24';
const makeState = () => initialState(today);
const sync = () => importDemo(makeState(), today);

test('changing a workout retains its original type and adjustment reason', () => {
  const state = makeState();
  const entry = state.plan.find((item) => item.date === today);
  const replacement = { type: '轻松跑', minutes: 25 };
  const next = changePlan(state, entry.id, '降强度', '疲劳', replacement);
  const updated = next.plan.find((item) => item.id === entry.id);
  assert.deepEqual(updated.current, replacement);
  assert.equal(updated.original.type, '节奏跑');
  assert.equal(updated.changes[0].reason, '疲劳');
});

test('rescheduling checks key workouts near the target date and preserves the source row', () => {
  const state = makeState();
  const entry = state.plan.find((item) => item.date === today);
  assert.throws(() => changePlan(state, entry.id, '改期', '日程冲突', undefined, '2026-11-26'), /相邻/);
  const next = changePlan(state, entry.id, '改期', '日程冲突', undefined, '2026-11-27');
  assert.equal(next.plan.find((item) => item.id === entry.id).current, null);
  assert.equal(next.plan.find((item) => item.movedFrom === today).date, '2026-11-27');
});

test('sync is idempotent and keeps confirmed main, secondary and warmup roles', () => {
  const state = sync();
  const activities = state.activities.filter((item) => item.date === today);
  const [warmup, activity, cooldown, secondary] = activities;
  assert.throws(() => classifyActivity(state, warmup.id, '热身', activity.id), /请先标记/);
  let next = classifyActivity(state, activity.id, '主课');
  next = classifyActivity(next, secondary.id, '次课');
  next = classifyActivity(next, warmup.id, '热身', activity.id);
  next = classifyActivity(next, cooldown.id, '冷身', activity.id);
  next = importDemo(next, today);
  const saved = next.activities.filter((item) => item.date === today);
  assert.deepEqual(saved.map((item) => item.role), ['热身', '主课', '冷身', '次课']);
  assert.equal(saved.reduce((sum, item) => sum + item.minutes, 0), 70);
  assert.equal(getAdvice(next, today, demoHealth).label, '训练已记录');
});

test('unclassified synced training does not complete the main session', () => {
  const state = sync();
  assert.equal(getAdvice(state, today, demoHealth).label, '活动待确认');
});

test('symptoms override activity and missing-health states', () => {
  const state = sync();
  state.checkIns[today] = { ...defaultCheckIn, symptoms: ['嗓子痛', '发热'] };
  const advice = getAdvice(state, today, emptyHealth);
  assert.equal(advice.changeReason, '身体不适');
  assert.match(advice.title, /暂停训练/);
});

test('missing data allows a suggestion based on the active workout and feedback', () => {
  const state = makeState();
  state.checkIns[today] = { ...defaultCheckIn, sensation: '偏累', minutes: 20 };
  const advice = getAdvice(state, today, emptyHealth);
  assert.deepEqual(advice.replacement, { type: '轻松跑', minutes: 20 });
});
