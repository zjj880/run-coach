import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeStates, isPrivateHost, makePairCode } from '../src/sync.ts'
import { initialState } from '../src/training.ts'

const today = '2026-11-27'
const activity = (patch) => ({
  id: 'garmin-1', date: '2026-11-26', time: '07:00', title: '轻松跑', minutes: 50, km: 9,
  averageHr: 140, role: '主课', ...patch,
})

test('activities are unioned and the richer copy wins', () => {
  const local = { ...initialState(today), activities: [activity({ role: '待归类' }), activity({ id: 'garmin-2', date: '2026-11-27' })] }
  const remote = { ...initialState(today), activities: [
    activity({ detail: { maxHr: 180, calories: 600 }, averageHr: undefined }),
    activity({ id: 'garmin-3', date: '2026-11-20' }),
  ] }
  const { state, summary } = mergeStates(local, remote)
  assert.equal(state.activities.length, 3)
  const merged = state.activities.find((item) => item.id === 'garmin-1')
  assert.equal(merged.detail.maxHr, 180)
  assert.equal(merged.averageHr, 140)
  assert.equal(merged.role, '主课')
  assert.equal(summary.activities.added, 1)
})

test('plans keep the entry with more change history and merge cycles', () => {
  const base = { id: 'p1', date: '2026-11-26', original: { type: '轻松跑', minutes: 40 }, current: { type: '轻松跑', minutes: 40 }, changes: [] }
  const changed = { ...base, current: { type: '节奏跑', minutes: 30 }, changes: [{ action: '缩短', reason: '疲劳', previous: { type: '轻松跑', minutes: 40 } }] }
  const local = { ...initialState('2026-11-01'), activities: [], plan: [base] }
  const remote = { ...initialState(today), activities: [activity({ date: '2026-09-15' })], plan: [changed] }
  const { state } = mergeStates(local, remote)
  assert.equal(state.plan[0].changes.length, 1)
  assert.equal(state.plan[0].current.type, '节奏跑')
  // 周期要覆盖两边最早和最晚的日期
  assert.equal(state.cycleStart, '2026-09-14')
  assert.equal(state.weeks * 7 >= (Date.parse('2026-11-27') - Date.parse('2026-09-14')) / 86400000, true)
})

test('check-ins, reviews, notes, intake, water and periods merge without loss', () => {
  const local = {
    ...initialState(today),
    checkIns: { '2026-11-27': { sensation: '良好', symptoms: ['无不适'], minutes: 45, schedule: '', mood: '' } },
    reviews: { '2026-11-26': { review: { summary: '旧' }, signature: 'a', reviewedAt: '2026-11-26T10:00:00Z' } },
    notes: [{ id: 'n1', date: '2026-11-26', kind: '力量', text: '核心 2 组' }],
    intake: [{ id: 'i1', date: today, kcal: 400 }],
    water: [{ id: 'w1', date: today, ml: 300 }],
    periods: [{ id: 'pe1', name: '基础期', from: '2026-09-01', to: '2026-10-05' }],
  }
  const remote = {
    ...initialState(today),
    checkIns: { '2026-11-27': { sensation: '良好', symptoms: ['无不适'], minutes: 45, schedule: '', mood: '专注', note: '状态好' } },
    reviews: { '2026-11-26': { review: { summary: '新' }, signature: 'b', reviewedAt: '2026-11-27T08:00:00Z' } },
    notes: [{ id: 'n2', date: '2026-11-27', kind: '跑技', text: 'A-march 2 组' }],
    intake: [{ id: 'i2', date: today, kcal: 200 }],
    water: [{ id: 'w2', date: today, ml: 500 }],
    periods: [{ id: 'pe2', name: '专项期', from: '2026-10-06', to: '2026-11-15' }],
  }
  const { state } = mergeStates(local, remote)
  assert.equal(state.checkIns['2026-11-27'].mood, '专注')
  assert.equal(state.reviews['2026-11-26'].review.summary, '新')
  assert.equal(state.notes.length, 2)
  assert.equal(state.intake.length, 2)
  assert.equal(state.water.length, 2)
  assert.equal(state.periods.length, 2)
})

test('settings prefer the newer garmin snapshot and disable demo metrics', () => {
  const local = {
    ...initialState(today),
    demoMetrics: true,
    garmin: { date: '2026-11-26', syncedAt: '2026-11-26T10:00:00Z', health: { sleepMinutes: 400, hrv: 50, restingHr: 50 }, unavailable: [] },
  }
  const remote = {
    ...initialState(today),
    demoMetrics: true,
    garmin: { date: '2026-11-27', syncedAt: '2026-11-27T09:00:00Z', health: { sleepMinutes: 450, hrv: 55, restingHr: 48 }, unavailable: [] },
  }
  const { state } = mergeStates(local, remote)
  assert.equal(state.garmin.date, '2026-11-27')
  assert.equal(state.demoMetrics, true)
  const withReal = mergeStates(local, { ...remote, demoMetrics: false })
  assert.equal(withReal.state.demoMetrics, false)
})

test('pairing helpers produce six digit codes and detect private hosts', () => {
  const code = makePairCode()
  assert.match(code, /^\d{6}$/)
  assert.equal(isPrivateHost('192.168.1.20'), true)
  assert.equal(isPrivateHost('10.181.114.174'), true)
  assert.equal(isPrivateHost('172.20.1.5'), true)
  assert.equal(isPrivateHost('8.8.8.8'), false)
  assert.equal(isPrivateHost('127.0.0.1'), true)
})
