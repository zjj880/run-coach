import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canReviewTraining, trainingComparison, trainingReviewInput } from '../src/evaluation.ts';
import { classifyActivity, getAdvice, emptyHealth, importDemo, initialState, defaultCheckIn, changePlan } from '../src/training.ts';

test('daily evaluation aggregates warmup and cooldown with their main session and keeps secondary mileage distinct', () => {
  const date = '2026-11-24';
  let state = importDemo(initialState(date), date);
  const [warmup, main, cooldown, secondary] = state.activities.filter((activity) => activity.date === date);
  assert.equal(canReviewTraining(trainingReviewInput(date, state.plan, state.activities)), true);
  state = classifyActivity(state, main.id, '主课');
  state = classifyActivity(state, warmup.id, '热身', main.id);
  state = classifyActivity(state, cooldown.id, '冷身', main.id);
  state = classifyActivity(state, secondary.id, '次课');
  const review = trainingReviewInput(date, state.plan, state.activities);
  assert.equal(canReviewTraining(review), true);
  assert.deepEqual(review.total, { minutes: 70, km: 11.6 });
  assert.deepEqual(review.mainWithWarmupAndCooldown, { minutes: 50, km: 8.5 });
  assert.equal(review.activities[1].averagePaceSecPerKm, 333);
  assert.equal(review.activities[0].parentItem, review.activities[1].item);
  assert.equal(review.activities[1].core, '5 × 800 米');
});

test('a 53.4-minute run compares with 40 minutes without counting other sessions as plan execution', () => {
  const input = {
    plan: [{ type: '轻松跑', minutes: 40, detail: null }],
    total: { minutes: 68.4, km: 11.6 },
    mainWithWarmupAndCooldown: { minutes: 53.4, km: 10.11 },
  };
  assert.deepEqual(trainingComparison(input), { planned: 40, compared: input.mainWithWarmupAndCooldown, deltaMinutes: 13.4 });
  assert.equal(trainingComparison({ ...input, mainWithWarmupAndCooldown: null }).deltaMinutes, null);
  assert.equal(trainingComparison({ ...input, plan: [...input.plan, { type: '力量训练', minutes: null, detail: '核心稳定' }] }).planned, null);
});

test('one-tap morning feeling does not impose a time constraint on a revised plan', () => {
  const date = '2026-11-24';
  const state = initialState(date);
  state.checkIns[date] = { ...defaultCheckIn, sensation: '良好', minutes: 45, timeEstimated: true };
  const entry = state.plan.find((item) => item.date === date);
  const revised = changePlan(state, entry.id, '换课', '其他', { type: '长跑', minutes: 80 });
  assert.match(getAdvice(revised, date, emptyHealth).title, /按课表安排长跑/);
});
