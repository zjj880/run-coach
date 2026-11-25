import assert from 'node:assert/strict'
import test from 'node:test'
import { syncGarminHistory } from '../src/garmin.ts'
import { createAiServer } from '../server/ai.mjs'

const key = 'GCDC_' + 'H'.repeat(30)
const token = 'synthetic-history-token'

function row(id, day, km, seconds, hr) {
  return {
    activityId: id,
    activityName: '跑步 ' + id,
    activityType: { typeKey: 'running' },
    startTimeLocal: day + ' 07:00:00',
    duration: seconds,
    distance: km * 1000,
    averageHR: hr,
  }
}

function historyFetcher(pages) {
  const calls = []
  const fetcher = async (address) => {
    const url = new URL(address)
    calls.push(address)
    if (url.pathname.endsWith('/personal-api-key/token')) return new Response(token)
    assert.equal(url.pathname, '/activitylist-service/activities/search/activities')
    const start = Number(url.searchParams.get('start'))
    const limit = Number(url.searchParams.get('limit'))
    assert.equal(limit, 100)
    return Response.json(pages[start / limit] ?? [])
  }
  return { fetcher, calls }
}

test('history sync pages through a date range, de-duplicates and sorts activities', async () => {
  const page1 = Array.from({ length: 100 }, (_, index) =>
    row(1000 + index, '2026-09-' + String((index % 28) + 1).padStart(2, '0'), 5, 1800, 140))
  const page2 = [row(2000, '2026-08-30', 10, 3000, 150), row(1000, '2026-09-01', 5, 1800, 140)]
  const { fetcher } = historyFetcher([page1, page2])
  const history = await syncGarminHistory(key, '2026-08-01', '2026-10-31', fetcher)
  assert.equal(history.pages, 2)
  assert.equal(history.truncated, false)
  assert.equal(history.from, '2026-08-01')
  assert.equal(history.to, '2026-10-31')
  // 100 条 + 1 条新增，跨页重复的 1000 只保留一次
  assert.equal(history.activities.length, 101)
  assert.equal(history.activities[0].date, '2026-08-30')
  assert.equal(history.activities.at(-1).date <= '2026-09-28', true)
  const ids = new Set(history.activities.map((activity) => activity.id))
  assert.equal(ids.size, history.activities.length)
  assert.equal(history.activities[0].id, 'garmin-cn-2000')
})

test('history sync validates the requested date range', async () => {
  const { fetcher } = historyFetcher([[]])
  await assert.rejects(() => syncGarminHistory(key, '2026-02-30', '2026-03-01', fetcher), /有效的同步日期/)
  await assert.rejects(() => syncGarminHistory(key, '2026-03-05', '2026-03-01', fetcher), /不能晚于/)
  await assert.rejects(() => syncGarminHistory(key, '2024-01-01', '2026-01-01', fetcher), /366/)
})

test('desktop proxy exposes history sync and rejects bad input', async (t) => {
  const { fetcher } = historyFetcher([[row(3000, '2026-10-01', 8, 2400, 145)]])
  const server = createAiServer({ garminFetchImpl: fetcher, initialGarminKey: key })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const root = 'http://127.0.0.1:' + server.address().port
  const post = (path, body) => fetch(root + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const ok = await post('/garmin/history', { from: '2026-09-01', to: '2026-10-31' })
  assert.equal(ok.status, 200)
  const payload = await ok.json()
  assert.equal(payload.activities.length, 1)
  assert.equal(payload.activities[0].id, 'garmin-cn-3000')
  assert.equal((await post('/garmin/history', { from: '2026-13-01', to: '2026-10-31' })).status, 400)
  const disconnected = createAiServer({ garminFetchImpl: fetcher })
  await new Promise((resolve) => disconnected.listen(0, '127.0.0.1', resolve))
  t.after(() => disconnected.close())
  const other = 'http://127.0.0.1:' + disconnected.address().port
  assert.equal((await fetch(other + '/garmin/history', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: '2026-09-01', to: '2026-10-31' }),
  })).status, 409)
})
