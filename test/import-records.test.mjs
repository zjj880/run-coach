import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeImportedActivities, parseRecordsCsv, planTypeFromText } from '../src/importRecords.ts'
import { initialState } from '../src/training.ts'

const csv = '\uFEFF日期,公里,分钟,平均心率,标题,训练内容\n' +
  '2026-09-01,10.5,54,144,分段跑步,"19:29 跑步1.66km,5:54/km, HR112"\n' +
  '2026/9/2,12.07,65.8,148,跑步,轻松跑\n' +
  '2026-09-03,0,0,,无数据,\n' +
  '2026-02-30,5,30,140,非法日期,\n' +
  '2026-09-04,10.11,53.4,,跑步,"半马配速, 分段"\n'

test('CSV import parses headers, dates, numbers and quoted cells', () => {
  const parsed = parseRecordsCsv(csv)
  assert.equal(parsed.activities.length, 3)
  assert.equal(parsed.skipped, 1)
  assert.equal(parsed.errors.length, 1)
  const [first, second, fourth] = parsed.activities
  assert.deepEqual({ date: first.date, km: first.km, minutes: first.minutes, hr: first.averageHr },
    { date: '2026-09-01', km: 10.5, minutes: 54, hr: 144 })
  assert.equal(second.date, '2026-09-02')
  assert.equal(second.minutes, 65.8)
  assert.equal(fourth.date, '2026-09-04')
  assert.equal(fourth.averageHr, undefined)
  assert.match(fourth.core, /半马配速/)
  assert.equal(first.role, '待归类')
})

test('CSV import reports a missing date column instead of guessing', () => {
  const parsed = parseRecordsCsv('公里,分钟\n10,50\n')
  assert.equal(parsed.activities.length, 0)
  assert.match(parsed.errors[0], /日期/)
})

test('importing skips activities that already exist on the same day and distance', () => {
  const state = {
    ...initialState('2026-11-24'),
    activities: [{ id: 'garmin-cn-1', date: '2026-09-01', time: '07:00', title: '跑步', minutes: 54, km: 10.5, role: '主课' }],
  }
  const parsed = parseRecordsCsv(csv)
  const merged = mergeImportedActivities(state, parsed.activities)
  assert.equal(merged.duplicates, 1)
  assert.equal(merged.added.length, 2)
  assert.equal(merged.state.activities.length, 3)
  // 已有活动不被覆盖
  assert.equal(merged.state.activities[0].id, 'garmin-cn-1')
})

test('plan text maps to the closest workout type', () => {
  assert.equal(planTypeFromText('有氧功率混合间歇：3×1200米'), '间歇跑')
  assert.equal(planTypeFromText('阈值维持：2×2公里'), '节奏跑')
  assert.equal(planTypeFromText('长跑总量18公里'), '长跑')
  assert.equal(planTypeFromText('力量A维持熟悉动作'), '力量训练')
  assert.equal(planTypeFromText('轻松跑，约5:20–6:00/km'), '轻松跑')
  assert.equal(planTypeFromText('今天完全休息'), '轻松跑')
})

test('quoted cells with embedded newlines stay in one record', () => {
  const text = '日期,公里,分钟,平均心率,标题,训练内容\n2026-09-01,10.5,54,144,跑步,"19:29 跑步1.66km\n20:56 跑步8.84km"\n2026-09-02,12,66,140,跑步,轻松跑\n'
  const parsed = parseRecordsCsv(text)
  assert.equal(parsed.activities.length, 2)
  assert.equal(parsed.errors.length, 0)
  assert.match(parsed.activities[0].core, /19:29/)
  assert.match(parsed.activities[0].core, /20:56/)
  assert.equal(parsed.activities[1].date, '2026-09-02')
})