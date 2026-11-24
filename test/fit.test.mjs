import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Encoder, Profile } from '@garmin/fitsdk';
import { zipSync } from 'fflate';
import { parseFitActivity } from '../src/fit.ts';
import { syncGarminDetails } from '../src/garmin.ts';
import { applyGarminSync, emptyHealth, initialState } from '../src/training.ts';
import { trainingReviewInput } from '../src/evaluation.ts';

const date = '2026-11-24';
const timestamp = (seconds) => new Date(Date.UTC(2026, 10, 24, 1, 0, seconds));

function syntheticActivity() {
  const encoder = new Encoder();
  const { FILE_ID, RECORD, LAP, SESSION } = Profile.MesgNum;
  encoder.onMesg(FILE_ID, { type: 'activity', timeCreated: timestamp(0), manufacturer: 'development', product: 1 });
  for (const [seconds, bpm] of [[0, 112], [10, 127], [20, 132], [82, 163], [92, 158], [100, 150]]) {
    encoder.onMesg(RECORD, { timestamp: timestamp(seconds), heartRate: bpm, positionLat: 2345, positionLong: 4356 });
  }
  encoder.onMesg(LAP, { startTime: timestamp(0), timestamp: timestamp(50), totalDistance: 200, totalTimerTime: 50, avgHeartRate: 128, maxHeartRate: 132 });
  encoder.onMesg(LAP, { startTime: timestamp(50), timestamp: timestamp(100), totalDistance: 250, totalTimerTime: 48, avgHeartRate: 155, maxHeartRate: 163, avgPower: 265 });
  encoder.onMesg(SESSION, { sport: 'running', startTime: timestamp(0), timestamp: timestamp(100), totalTimerTime: 98, avgHeartRate: 140, maxHeartRate: 163 });
  return encoder.close();
}

test('raw FIT and zipped FIT retain recorded laps, timer pace, heart samples and chart gaps', () => {
  const bytes = syntheticActivity();
  const fit = parseFitActivity(bytes);
  assert.deepEqual(parseFitActivity(zipSync({ 'notes.txt': new Uint8Array([32]), 'activity.FIT': bytes })), fit);
  assert.deepEqual(fit.laps.map(({ meters, timerSeconds, paceSecPerKm, averageHr }) => [meters, timerSeconds, paceSecPerKm, averageHr]),
    [[200, 50, 250, 128], [250, 48, 192, 155]]);
  assert.equal(fit.heartRateSampleCount, 6);
  assert.deepEqual(fit.heartRate[3], [82, 163, 1]);
  assert.deepEqual(fit.heartRateTrend.map(({ min, max, count }) => [min, max, count]), [[112, 132, 3], [150, 163, 3]]);
  assert.equal(fit.elapsedSeconds, 100);
  assert.equal(fit.timerSeconds, 98);
  assert.ok(!JSON.stringify(fit).includes('positionLat'));
  const corrupted = bytes.slice();
  corrupted[15] ^= 1;
  assert.throws(() => parseFitActivity(corrupted), /FIT/);
});

test('Garmin downloads binary and review receives selected FIT data plus per-activity feedback after repeat sync', async () => {
  const key = 'GCDC_' + 'x'.repeat(30);
  const token = 'fake.token.for.testing.only';
  const id = 'garmin-cn-810';
  const [record] = await syncGarminDetails(key, [id], async (address, options) => {
    const url = new URL(address);
    assert.equal(url.host, 'personal.connectapi.garmin.cn');
    if (url.pathname.endsWith('/personal-api-key/token')) return new Response(token);
    assert.equal(options.headers.Authorization, 'Bearer ' + token);
    if (url.pathname === '/activity-service/activity/810') return Response.json({ summaryDTO: { maxHR: 163 } });
    assert.equal(url.pathname, '/download-service/files/activity/810');
    assert.match(options.headers.Accept, /application\/x-zip-compressed/);
    return new Response(zipSync({ 'activity.fit': syntheticActivity() }), { headers: { 'Content-Type': 'application/zip' } });
  });
  const incoming = { id, date, title: '操场跑', time: '08:00', km: 0.45, minutes: 1.63, averageHr: 140, role: '待归类' };
  const feedback = { effort: 7, sensor: '腕式', heartRateTrust: '存疑', cold: true, note: '开始几分钟读数可能偏高。' };
  const state = applyGarminSync({ ...initialState(date), activities: [{ ...incoming, ...record, role: '主课', feedback }] },
    { date, syncedAt: new Date().toISOString(), health: emptyHealth, unavailable: [], activities: [incoming] });
  assert.equal(state.activities[0].fit.heartRate.length, 6);
  const reviewed = trainingReviewInput(date, state.plan, state.activities).activities[0];
  assert.deepEqual(reviewed.feedback, feedback);
  assert.equal(reviewed.fit.lapCount, 2);
  assert.equal(reviewed.fit.laps[1].paceSecPerKm, 192);
  assert.equal('heartRate' in reviewed.fit, false);
});
