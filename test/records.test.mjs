import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addDays, ensureCycleCovers, initialState, periodForDate, periodTotals, weekStart,
} from '../src/training.ts'

const today = '2026-11-24'

test('periodForDate matches inclusive date ranges', () => {
  const state = {
    ...initialState(today),
    periods: [
      { id: 'p1', name: '基础期', from: '2026-09-01', to: '2026-10-05' },
      { id: 'p2', name: '专项期', from: '2026-10-06', to: '2026-11-15' },
    ],
  }
  assert.equal(periodForDate(state, '2026-09-01').name, '基础期')
  assert.equal(periodForDate(state, '2026-10-05').name, '基础期')
  assert.equal(periodForDate(state, '2026-10-06').name, '专项期')
  assert.equal(periodForDate(state, '2026-08-31'), undefined)
  assert.equal(periodForDate(state, '2026-11-16'), undefined)
})

test('periodTotals counts days, activities and distance inside each period', () => {
  const state = {
    ...initialState(today),
    periods: [{ id: 'p1', name: '基础期', from: '2026-11-18', to: '2026-11-24' }],
    activities: [
      { id: 'a1', date: '2026-11-20', time: '07:00', title: '轻松跑', minutes: 30, km: 5, role: '主课' },
      { id: 'a2', date: '2026-11-20', time: '18:00', title: '放松跑', minutes: 20, km: 3.3, role: '次课' },
      { id: 'a3', date: '2026-11-22', time: '07:00', title: '长跑', minutes: 90, km: 18, role: '主课' },
      { id: 'a4', date: '2026-11-25', time: '07:00', title: '范围外', minutes: 30, km: 5, role: '主课' },
    ],
  }
  const [summary] = periodTotals(state)
  assert.equal(summary.days, 2)
  assert.equal(summary.activities, 3)
  assert.equal(summary.km, 26.3)
  assert.equal(summary.minutes, 140)
})

test('ensureCycleCovers expands backwards and forwards to include imported history', () => {
  const state = initialState(today)
  const expanded = ensureCycleCovers(state, ['2026-09-03', '2026-10-27'])
  assert.equal(expanded.cycleStart, weekStart('2026-09-03'))
  assert.equal(expanded.cycleStart, '2026-08-31')
  const end = addDays(expanded.cycleStart, expanded.weeks * 7 - 1)
  assert.equal(end >= '2026-11-24', true)
  assert.equal(expanded.weeks >= state.weeks, true)
  // 已在范围内的日期不再改变周期
  assert.deepEqual(ensureCycleCovers(expanded, ['2026-09-03']), expanded)
  // 上限保护
  const wide = ensureCycleCovers(state, ['2000-01-01', '2030-01-01'])
  assert.equal(wide.weeks <= 104, true)
})
