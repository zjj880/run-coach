import assert from 'node:assert/strict'
import test from 'node:test'
import {
  activityCalories, basalMetabolicRate, dailyCalories, neatFactor, profileIsComplete, waterGoalMl,
} from '../src/nutrition.ts'

const male = {
  sex: '男', age: 30, heightCm: 175, weightKg: 70, activityLevel: '轻度', goal: '维持',
}
const female = { ...male, sex: '女', weightKg: 60, heightCm: 165 }

const activity = (patch = {}) => ({
  id: 'a1', date: '2026-11-27', time: '07:00', title: '轻松跑', minutes: 60, km: 10,
  averageHr: undefined, role: '主课', ...patch,
})

test('BMR uses Mifflin-St Jeor and Katch-McArdle when body fat is known', () => {
  assert.equal(basalMetabolicRate(male).kcal, Math.round(10 * 70 + 6.25 * 175 - 5 * 30 + 5))
  assert.match(basalMetabolicRate(male).method, /Mifflin/)
  assert.equal(basalMetabolicRate(female).kcal, Math.round(10 * 60 + 6.25 * 165 - 5 * 30 - 161))
  const withFat = basalMetabolicRate({ ...male, bodyFatPct: 15 })
  assert.equal(withFat.kcal, Math.round(370 + 21.6 * 70 * 0.85))
  assert.match(withFat.method, /Katch/)
  // 体脂率异常时回落到 Mifflin
  assert.match(basalMetabolicRate({ ...male, bodyFatPct: 90 }).method, /Mifflin/)
})

test('activity levels map to NEAT factors below true TDEE', () => {
  assert.deepEqual(['久坐', '轻度', '中度', '高度'].map((level) => neatFactor(level)), [1.2, 1.3, 1.4, 1.5])
})

test('activity calories prefer device data, then heart-rate formula, then pace', () => {
  assert.deepEqual(activityCalories(activity({ detail: { calories: 512 } }), male), { kcal: 512, source: '设备记录' })
  const keytel = activityCalories(activity({ averageHr: 150, km: 0 }), male)
  assert.equal(keytel.source, '心率公式')
  assert.ok(keytel.kcal > 700 && keytel.kcal < 950, 'Keytel 估算应在合理区间，实际 ' + keytel.kcal)
  const pace = activityCalories(activity(), male)
  assert.equal(pace.source, '配速估算')
  assert.ok(pace.kcal > 600 && pace.kcal < 800, '配速估算应在合理区间，实际 ' + pace.kcal)
  assert.equal(activityCalories(activity({ minutes: 0, km: 0 }), male).kcal, 0)
})

test('daily budget adds exercise on top of NEAT and subtracts what was eaten', () => {
  const base = dailyCalories({ profile: male, activities: [], intake: [], water: [], date: '2026-11-27' })
  assert.equal(base.bmr, 1649)
  assert.equal(base.neat, Math.round(1649 * 1.3))
  assert.equal(base.exercise, 0)
  assert.equal(base.maintenance, base.neat)
  assert.equal(base.target, base.neat)
  assert.equal(base.remaining, base.neat)

  const trained = dailyCalories({
    profile: male,
    activities: [activity({ detail: { calories: 600 } })],
    intake: [{ id: 'i1', date: '2026-11-27', kcal: 500, label: '午饭' }],
    water: [{ id: 'w1', date: '2026-11-27', ml: 300 }],
    date: '2026-11-27',
  })
  assert.equal(trained.exercise, 600)
  assert.equal(trained.maintenance, trained.neat + 600)
  assert.equal(trained.eaten, 500)
  assert.equal(trained.remaining, trained.target - 500)
  assert.equal(trained.water, 300)
  assert.equal(trained.waterGoal, 2100)
})

test('cutting keeps a safe floor and manual targets win', () => {
  const cutting = dailyCalories({ profile: { ...male, goal: '减脂' }, activities: [], intake: [], water: [], date: '2026-11-27' })
  assert.equal(cutting.target, Math.max(cutting.maintenance - 550, Math.round(1649 * 1.2)))
  const manual = dailyCalories({ profile: { ...male, targetIntake: 1800 }, activities: [], intake: [], water: [], date: '2026-11-27' })
  assert.equal(manual.target, 1800)
  assert.equal(manual.manualTarget, true)
  const gaining = dailyCalories({ profile: { ...male, goal: '增肌' }, activities: [], intake: [], water: [], date: '2026-11-27' })
  assert.equal(gaining.target, gaining.maintenance + Math.round((0.25 * 7700) / 7))
})

test('missing profile yields no budget; water goal falls back to weight', () => {
  assert.equal(dailyCalories({ profile: undefined, activities: [], intake: [], water: [], date: '2026-11-27' }), undefined)
  assert.equal(profileIsComplete(undefined), false)
  assert.equal(profileIsComplete({ ...male, weightKg: 0 }), false)
  assert.equal(profileIsComplete(male), true)
  assert.equal(waterGoalMl(male), 2100)
  assert.equal(waterGoalMl(undefined), 2000)
  assert.equal(waterGoalMl({ ...male, waterGoalMl: 2600 }), 2600)
})
