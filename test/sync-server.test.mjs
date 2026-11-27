import assert from 'node:assert/strict'
import test from 'node:test'
import { createAiServer } from '../server/ai.mjs'
import { createSyncLanServer, createSyncStore } from '../server/sync.mjs'
import { initialState } from '../src/training.ts'

const today = '2026-11-27'
const desktopState = {
  ...initialState(today),
  activities: [{ id: 'a-desktop', date: '2026-11-26', time: '07:00', title: '轻松跑', minutes: 50, km: 9, role: '主课' }],
}
const phoneState = {
  ...initialState(today),
  activities: [{ id: 'a-phone', date: '2026-11-27', time: '06:40', title: '节奏跑', minutes: 40, km: 8, role: '主课' }],
  notes: [{ id: 'n-phone', date: today, kind: '力量', text: '核心 2 组' }],
  intake: [{ id: 'i-phone', date: today, kcal: 500 }],
}

async function start() {
  const store = createSyncStore()
  const lan = createSyncLanServer(store, { port: 0 })
  const lanPort = await lan.listen()
  const ai = createAiServer({ desktopToken: 'desk-token', syncStore: store, syncPort: lanPort })
  await new Promise((ready, failed) => { ai.once('error', failed); ai.listen(0, '127.0.0.1', ready) })
  return { store, lanServer: lan.server, lanPort, aiServer: ai, aiPort: ai.address().port }
}

const stop = ({ lanServer, aiServer }) => new Promise((done) => {
  lanServer.close(() => aiServer.close(() => done()))
})

test('desktop hosts a pair code, phone joins over LAN, desktop fetches the merged state', async () => {
  const app = await start()
  try {
    const hostRes = await fetch(`http://127.0.0.1:${app.aiPort}/sync/host`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-run-coach-desktop': 'desk-token' },
      body: JSON.stringify({ state: desktopState }),
    })
    const host = await hostRes.json()
    assert.equal(hostRes.status, 200)
    assert.match(String(host.code), /^\d{6}$/)
    assert.equal(host.port, app.lanPort)

    const ping = await fetch(`http://127.0.0.1:${app.lanPort}/sync/ping`)
    assert.equal(ping.status, 200)

    const joinRes = await fetch(`http://127.0.0.1:${app.lanPort}/sync/join`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: host.code, state: phoneState }),
    })
    const joined = await joinRes.json()
    assert.equal(joinRes.status, 200)
    assert.equal(joined.state.activities.length, 2)
    assert.equal(joined.state.notes.length, 1)
    assert.equal(joined.state.intake.length, 1)

    const fetchRes = await fetch(`http://127.0.0.1:${app.aiPort}/sync/fetch`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-run-coach-desktop': 'desk-token' }, body: '{}',
    })
    const pulled = await fetchRes.json()
    assert.equal(fetchRes.status, 200)
    assert.equal(pulled.state.activities.length, 2)
    assert.ok(pulled.summary.activities.added >= 1)

    // 一次性：再次拉取会提示需要重新配对
    const again = await fetch(`http://127.0.0.1:${app.aiPort}/sync/fetch`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-run-coach-desktop': 'desk-token' }, body: '{}',
    })
    assert.equal(again.status, 410)
  } finally {
    await stop(app)
  }
})

test('wrong pair code is rejected and cancel clears the pairing', async () => {
  const app = await start()
  try {
    const host = await (await fetch(`http://127.0.0.1:${app.aiPort}/sync/host`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: desktopState }),
    })).json()

    const bad = await fetch(`http://127.0.0.1:${app.lanPort}/sync/join`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '000000', state: phoneState }),
    })
    assert.equal(bad.status, 403)
    assert.match((await bad.json()).error, /配对码/)

    const cancel = await fetch(`http://127.0.0.1:${app.aiPort}/sync/cancel`, { method: 'POST', body: '{}' })
    assert.equal(cancel.status, 200)
    const status = await (await fetch(`http://127.0.0.1:${app.aiPort}/sync/status`)).json()
    assert.equal(status.pairing, null)

    const after = await fetch(`http://127.0.0.1:${app.lanPort}/sync/join`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: host.code, state: phoneState }),
    })
    assert.equal(after.status, 410)
  } finally {
    await stop(app)
  }
})
