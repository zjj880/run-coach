import assert from 'node:assert/strict'
import test from 'node:test'
import { bundleFilename, bundlePrefix, decodeBundle, encodeBundle, normalizeSyncAddress } from '../src/dataBundle.ts'
import { joinDesktop } from '../src/syncClient.ts'
import { initialState } from '../src/training.ts'

const today = '2026-11-27'
const state = {
  ...initialState(today),
  activities: [{ id: 'a1', date: today, time: '07:00', title: '轻松跑', minutes: 40, km: 7, role: '主课' }],
  notes: [{ id: 'n1', date: today, kind: '力量', text: '核心 2 组' }],
}

test('data bundle round-trips through gzip and base64', () => {
  const encoded = encodeBundle(state)
  assert.equal(encoded.startsWith(bundlePrefix), true)
  const decoded = decodeBundle(encoded)
  assert.equal(decoded.state.activities.length, 1)
  assert.equal(decoded.state.notes.length, 1)
  // 压缩后应明显小于原始 JSON
  assert.ok(encoded.length < JSON.stringify(state).length)
})

test('a plain JSON bundle is accepted, garbage is rejected', () => {
  const plain = JSON.stringify({ version: 1, state })
  assert.equal(decodeBundle(plain).state.activities.length, 1)
  assert.throws(() => decodeBundle('not a bundle'), /无法解析/)
  assert.throws(() => decodeBundle(JSON.stringify({ version: 1 })), /无法解析/)
})

test('bundle filename carries the date and extension', () => {
  const name = bundleFilename(new Date('2026-11-27T10:00:00Z'))
  assert.equal(name, 'jiaowopao-data-2026-11-27.jwx')
})

test('sync address input is normalised for typing convenience', () => {
  assert.equal(normalizeSyncAddress('10.181.114.174'), 'http://10.181.114.174:8093')
  assert.equal(normalizeSyncAddress('10.181.114.174:9000'), 'http://10.181.114.174:9000')
  assert.equal(normalizeSyncAddress('http://192.168.1.9:8093'), 'http://192.168.1.9:8093')
  assert.equal(normalizeSyncAddress('localhost'), 'http://localhost:8093')
  assert.throws(() => normalizeSyncAddress(''), /填写电脑上显示的地址/)
  assert.throws(() => normalizeSyncAddress('abc'), /局域网 IP/)
  assert.throws(() => normalizeSyncAddress('example.com'), /局域网 IP/)
})

test('joinDesktop posts the local state and returns the merged one', async () => {
  const calls = []
  const merged = { ...state, activities: [...state.activities, { id: 'a2', date: '2026-11-26', time: '07:00', title: '节奏跑', minutes: 30, km: 6, role: '主课' }] }
  const fetchImpl = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) })
    return Response.json({ state: merged, summary: { activities: { added: 1, updated: 0 }, plan: { added: 0, updated: 0 }, checkIns: 1, notes: 0, reviews: 0, intake: 0, water: 0, total: 1 } })
  }
  const result = await joinDesktop({ address: '10.0.0.5', code: '123456', state, fetchImpl })
  assert.equal(calls[0].url, 'http://10.0.0.5:8093/sync/join')
  assert.equal(calls[0].body.code, '123456')
  assert.equal(calls[0].body.state.activities.length, 1)
  assert.equal(result.state.activities.length, 2)
  assert.equal(result.summary.activities.added, 1)

  await assert.rejects(() => joinDesktop({ address: '10.0.0.5', code: '12', state, fetchImpl }), /6 位配对码/)
})

test('joinDesktop surfaces server errors and network failures', async () => {
  const rejecting = async () => { throw new Error('network down') }
  await assert.rejects(() => joinDesktop({ address: '10.0.0.5', code: '123456', state, fetchImpl: rejecting }), /连不上电脑/)

  const forbidden = async () => Response.json({ error: '配对码不正确，请核对电脑上显示的 6 位数字。' }, { status: 403 })
  await assert.rejects(() => joinDesktop({ address: '10.0.0.5', code: '123456', state, fetchImpl: forbidden }), /配对码不正确/)
})
