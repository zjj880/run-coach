import assert from 'node:assert/strict';
import test from 'node:test';
import { chartBounds, chartTime, heartSampleAt } from '../src/fitCharts.ts';

test('FIT chart pace axis pads observed data and formats rounded minute boundaries', () => {
  assert.deepEqual(chartBounds([305, 320, 342], 15, 10), { minimum: 305, maximum: 342, lower: 285, upper: 360 });
  assert.deepEqual(chartBounds([140], 10, 5), { minimum: 140, maximum: 140, lower: 130, upper: 150 });
  assert.equal(chartBounds([], 10, 5), null);
  assert.equal(chartTime(59.6), '1:00');
});

test('heart rate selection snaps to recorded samples and leaves gaps blank', () => {
  const samples = [[6, 110, 0], [14, 119, 0], [60, 155, 1], [80, 158, 1]];
  assert.deepEqual(heartSampleAt(samples, 11), samples[1]);
  assert.deepEqual(heartSampleAt(samples, 60), samples[2]);
  assert.equal(heartSampleAt(samples, 35), undefined);
  assert.equal(heartSampleAt(samples, 0), undefined);
  assert.equal(heartSampleAt(samples, 120), undefined);
  assert.equal(heartSampleAt([], 0), undefined);
});
