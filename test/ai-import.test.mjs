import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAiServer } from '../server/ai.mjs';
import { initialState, importPlan, changePlan, isDefaultDemoPlan } from '../src/training.ts';
import { trainingReviewInput } from '../src/evaluation.ts';

const date = '2026-11-24';
const distanceWorkout = { date, type: '间歇跑', minutes: null, detail: '6 × 800 米，热身 12 分钟', source: '6 × 800 米' };

test('import preview can preserve distance-only sessions, existing changes and deduplication', () => {
  let state = initialState(date);
  const current = state.plan.find((row) => row.date === date);
  state = changePlan(state, current.id, '降强度', '疲劳', { type: '轻松跑', minutes: 25 });
  const imported = importPlan(state, [distanceWorkout], true);
  assert.equal(imported.added, 1);
  assert.equal(imported.state.plan.some(isDefaultDemoPlan), false);
  assert.equal(imported.state.plan.find((row) => row.id === current.id).changes[0].reason, '疲劳');
  const workout = imported.state.plan.find((row) => row.current?.type === '间歇跑');
  assert.equal(workout.current.minutes, 0);
  assert.equal(workout.current.detail, distanceWorkout.detail);
  assert.equal(importPlan(imported.state, [distanceWorkout]).duplicates, 1);
  assert.throws(() => importPlan(state, [distanceWorkout, { ...distanceWorkout, date: '' }]), /第 2 条/);
  assert.equal(state.plan.filter((row) => row.date === date).length, 1);
});

test('local AI settings and import use a compatible response without exposing the key', async (t) => {
  const calls = [];
  const trainingReview = { summary: '主课已完成', execution: '按计划执行', intensity: '使用记录里的平均心率', next: '关注下一课体感', limitations: '缺少心率区间' };
  const server = createAiServer({ fetchImpl: async (url, options) => {
    calls.push({ url, headers: options.headers, body: JSON.parse(options.body) });
    const output = calls.length === 1 ? 'OK' : calls.length === 3 ? JSON.stringify(trainingReview) :
      calls.length === 4 ? '今天这件事确实让人心累，可以先给自己留一点安静的时间。' :
      JSON.stringify({ rows: [distanceWorkout, { date: '2026-02-30', type: 'unknown', minutes: -1 }] });
    return Response.json({ choices: [{ message: { content: output } }] });
  } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = (route, value, origin = 'http://localhost:8090') => fetch(base + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(value),
  });

  assert.equal((await post('/ai/recognize', { text: '课表' })).status, 409);
  const input = { baseUrl: 'https://test-provider.invalid/v1', model: 'test-model', apiKey: 'mock-key-only' };
  assert.equal((await post('/ai/settings', input, 'https://untrusted.invalid')).status, 403);
  const configured = await (await post('/ai/settings', input)).json();
  assert.deepEqual(configured, { configured: true, model: 'test-model', endpoint: input.baseUrl + '/chat/completions' });
  assert.equal(calls[0].headers.Authorization, 'Bearer mock-key-only');
  assert.equal((await post('/ai/recognize', { start: '2026-11-24', text: '第 1 周' })).status, 400);
  assert.equal((await post('/ai/recognize', { image: 'https://external.invalid/image.jpg' })).status, 400);

  const data = await (await post('/ai/recognize', { start: '2026-11-23', image: 'data:image/png;base64,AA==' })).json();
  assert.deepEqual(data.rows[0], distanceWorkout);
  assert.deepEqual(data.rows[1], { date: '', type: '', minutes: null, detail: '', source: '' });
  assert.equal(calls[1].body.messages[1].content[1].type, 'image_url');
  const inputReview = trainingReviewInput(date, initialState(date).plan, [
    { id: 'test', title: '间歇跑', date, role: '主课', minutes: 30, km: 6, averageHr: 160 },
  ]);
  assert.equal((await post('/ai/review', { ...inputReview, activities: [] })).status, 400);
  assert.equal((await post('/ai/review', { ...inputReview, activities: [...inputReview.activities, { role: '待归类' }] })).status, 409);
  const reviewed = await (await post('/ai/review', { ...inputReview, checkIn: '私密打卡信息' })).json();
  assert.deepEqual(reviewed, { review: trainingReview });
  assert.deepEqual(JSON.parse(calls[2].body.messages[1].content), inputReview);
  assert.equal((await post('/ai/mood', { mood: ' ' })).status, 400);
  const mood = { mood: '有些累', note: '工作很多' };
  const response = await post('/ai/mood', { ...mood, schedule: '不应发出的日程' });
  assert.match((await response.json()).reply, /安静/);
  assert.deepEqual(JSON.parse(calls[3].body.messages[1].content), mood);
  assert.equal((await fetch(base + '/ai/settings', { method: 'DELETE' })).status, 200);
  assert.deepEqual(await (await fetch(base + '/ai/settings')).json(), { configured: false });
});

test('coach keeps the prior turn and separates a follow-up question from a proposal', async (t) => {
  const replies = [
    { reply: '走路时脚也疼吗？', proposal: null },
    { reply: '那就先把今天的训练留空。', proposal: {
      title: '今天暂停跑步', training: '先暂停跑步。', recovery: '晚些再更新感受。', nutrition: '照常用餐。',
    } },
  ];
  const inputs = [];
  const server = createAiServer({ initialAiConfig: { endpoint: 'https://test-provider.invalid/chat/completions', model: 'test', apiKey: 'fake' },
    fetchImpl: async (_url, options) => {
      inputs.push(JSON.parse(JSON.parse(options.body).messages[1].content));
      return Response.json({ choices: [{ message: { content: JSON.stringify(replies[inputs.length - 1]) } }] });
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const url = 'http://127.0.0.1:' + server.address().port + '/ai/coach';
  const context = { date, checkIn: { symptoms: ['脚痛'] }, availableMinutes: 20 };
  const send = async (messages) => (await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context, messages }),
  })).json();
  const first = { role: 'user', text: '今天的课怎么调整？' };
  assert.deepEqual(await send([first]), replies[0]);
  const continued = [first, { role: 'assistant', text: replies[0].reply }, { role: 'user', text: '走路时也疼' }];
  assert.deepEqual(await send(continued), replies[1]);
  assert.deepEqual(inputs[1], { context, conversation: continued });
});
