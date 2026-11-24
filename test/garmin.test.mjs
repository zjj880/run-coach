import assert from 'node:assert/strict';
import test from 'node:test';
import { syncGarminDaily } from '../src/garmin.ts';
import { applyGarminSync, classifyActivity, importDemo, initialState, visibleActivities } from '../src/training.ts';
import { createAiServer } from '../server/ai.mjs';

const date = '2026-11-24';
const key = 'GCDC_' + 'x'.repeat(28);
const token = 'fake.token.for.testing.only';
const history = Array.from({ length: 8 }, () => ({ sleepTimeSeconds: 27_000 }));
const run = { activityId: 810, activityName: '操场间歇', startTimeLocal: date + ' 07:15:00', duration: 1800, distance: 5000, averageHR: 149 };
const warmup = { ...run, activityId: 809, activityName: '热身跑', startTimeLocal: date + ' 07:00:00' };

function garminFetch(list = [run, warmup, run], missingHeartRate = false) {
  return async (address, options) => {
    const url = new URL(address);
    assert.equal(url.origin, 'https://personal.connectapi.garmin.cn');
    if (url.pathname.endsWith('/personal-api-key/token')) {
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'ApiKey ' + key);
      return new Response(token);
    }
    assert.equal(options.headers.Authorization, 'Bearer ' + token);
    if (url.pathname.endsWith('/dailySleep')) return Response.json({ dailySleepDTO: { calendarDate: date, sleepTimeSeconds: 25_200 } });
    if (url.pathname.endsWith('/dailySleepSummariesByDate')) return Response.json(history);
    if (url.pathname.endsWith('/hrv/' + date)) return Response.json({ hrvSummary: { calendarDate: date, lastNightAvg: 53, baseline: { balancedLow: 45 } } });
    if (url.pathname.endsWith('/dailyHeartRate')) {
      return missingHeartRate ? new Response(null, { status: 503 }) : Response.json({ calendarDate: date, restingHeartRate: 50, lastSevenDaysAvgRestingHeartRate: 51 });
    }
    if (url.pathname === '/activity-service/activity/810') return Response.json({
      summaryDTO: { maxHR: 168, averageRunCadence: 176, strideLength: 111, avgPower: 285 },
      splitSummaries: [{ splitType: 'INTERVAL_ACTIVE', noOfSplits: 6, duration: 960, distance: 4800, averageHR: 160 }],
    });
    if (url.pathname === '/download-service/files/activity/810') return new Response(null, { status: 404 });
    assert.equal(url.pathname, '/activitylist-service/activities/search/activities');
    assert.equal(url.searchParams.get('startDate'), '2026-11-11');
    assert.equal(url.searchParams.get('endDate'), date);
    return Response.json(list);
  };
}

test('sync maps daily readings and new activities without overwriting confirmed roles', async () => {
  const data = await syncGarminDaily(key, date, garminFetch());
  assert.deepEqual(data.health, { sleepMinutes: 420, hrv: 53, restingHr: 50, reference: { sleepLow: 390, hrvLow: 45, restingHrHigh: 56 } });
  assert.deepEqual(data.unavailable, []);
  assert.deepEqual(data.activities[1], { id: 'garmin-cn-810', date, time: '07:15', title: '操场间歇', minutes: 30, km: 5, averageHr: 149, role: '待归类' });

  let state = applyGarminSync({ ...importDemo(initialState(date), date), skipped: [date] }, data);
  assert.deepEqual(state.skipped, []);
  assert.equal(visibleActivities(state).length, 2);
  state = classifyActivity(state, 'garmin-cn-810', '主课');
  state = classifyActivity(state, 'garmin-cn-809', '热身', 'garmin-cn-810');
  const next = await syncGarminDaily(key, date, garminFetch([warmup, run, { ...run, activityId: 811 }], true));
  state = applyGarminSync(state, next);
  assert.deepEqual(visibleActivities(state).map(({ role, parentId }) => [role, parentId]), [['热身', 'garmin-cn-810'], ['主课', undefined], ['待归类', undefined]]);
  assert.deepEqual(next.unavailable, ['静息心率']);
});

test('desktop proxy saves the key only on successful connect and returns no credentials', async (t) => {
  const server = createAiServer({ garminFetchImpl: garminFetch() });
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  t.after(() => server.close());
  const root = 'http://127.0.0.1:' + server.address().port;
  const post = (path, data) => fetch(root + '/garmin/' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, ...data }),
  });
  assert.equal((await post('sync')).status, 409);
  const connected = await post('connect', { key });
  assert.equal(connected.status, 200);
  const payload = await connected.text();
  assert.ok(!payload.includes(key) && !payload.includes(token));
  assert.equal(JSON.parse(payload).activities.length, 2);
  assert.equal((await post('sync')).status, 200);
  const detailed = await (await post('details', { ids: ['garmin-cn-810'] })).json();
  const { fitIssue, ...summary } = detailed.details[0].detail;
  assert.equal(fitIssue, '佳明 FIT 下载失败（HTTP 404）。');
  assert.deepEqual(summary, { maxHr: 168, runningCadenceSpm: 176, strideLengthCm: 111, averagePowerW: 285,
    segmentTotals: [{ type: 'INTERVAL_ACTIVE', count: 6, seconds: 960, meters: 4800, averageHr: 160 }] });
  await fetch(root + '/garmin/settings', { method: 'DELETE' });
  assert.equal((await post('sync')).status, 409);
});
