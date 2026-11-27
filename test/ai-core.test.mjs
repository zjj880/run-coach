import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AiError, buildCoachMessages, buildImportMessages, buildMoodMessages, buildReviewChatMessages, buildReviewMessages,
  complete, decodeCoach, decodeReview, decodeRows, parseEndpoint, publicConfig, toConfig,
} from '../src/aiCore.ts'
import { createAiClient } from '../src/aiClient.ts'

const today = '2026-11-27'
const plan = [{ date: today, current: { type: '轻松跑', minutes: 40, detail: null }, original: { type: '轻松跑', minutes: 40 }, changes: [] }]
const activities = [{ item: 1, title: '轻松跑', role: '主课', minutes: 40, km: 7, averagePaceSecPerKm: 343, averageHr: 138 }]

test('endpoint parsing appends chat/completions and rejects insecure URLs', () => {
  assert.equal(parseEndpoint('https://api.example.com/v1'), 'https://api.example.com/v1/chat/completions')
  assert.equal(parseEndpoint('https://api.example.com/v1/chat/completions/'), 'https://api.example.com/v1/chat/completions')
  assert.throws(() => parseEndpoint('http://api.example.com/v1'), /HTTPS/)
  assert.throws(() => parseEndpoint('https://api.example.com/v1?key=1'), /HTTPS/)
})

test('config keeps the previous key when the endpoint is unchanged', () => {
  const previous = { endpoint: 'https://api.example.com/v1/chat/completions', model: 'm', apiKey: 'k' }
  const next = toConfig({ baseUrl: 'https://api.example.com/v1', model: 'm2', apiKey: '' }, previous)
  assert.equal(next.apiKey, 'k')
  assert.equal(next.model, 'm2')
  assert.throws(() => toConfig({ baseUrl: 'https://other.example.com/v1', model: 'm', apiKey: '' }, previous), /密钥/)
  assert.deepEqual(publicConfig(previous), { configured: true, endpoint: previous.endpoint, model: 'm' })
  assert.deepEqual(publicConfig(null), { configured: false })
})

test('import/inspect inputs are validated before hitting the model', () => {
  assert.throws(() => buildImportMessages({}), /粘贴文字/)
  assert.throws(() => buildImportMessages({ start: '2026-11-25', text: 'x' }), /周一/)
  assert.throws(() => buildImportMessages({ text: 'x'.repeat(30_001) }), /3 万字/)
  assert.ok(buildImportMessages({ start: '2026-11-23', text: '第 1 周' }).length === 2)
  assert.throws(() => buildReviewMessages({ date: today, plan, activities: [] }), /活动记录/)
  assert.throws(() => buildMoodMessages({ mood: '', note: '' }), /心情或备注/)
  assert.throws(() => buildMoodMessages({ mood: 'x'.repeat(81) }), /80 字/)
})

test('model JSON is decoded, trimmed and rejected when malformed', () => {
  const rows = decodeRows('```json\n{"rows":[{"date":"2026-11-24","type":"间歇跑","minutes":45,"detail":"6x800","source":"第1周"}]}\n```')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].type, '间歇跑')
  assert.equal(rows[0].minutes, 45)
  assert.deepEqual(decodeRows('{"rows":[]}\n'), [])
  assert.deepEqual(decodeRows('{"rows":[]}\n'), [])
  assert.deepEqual(decodeRows('{"rows":[]}\n'), [])

  const review = decodeReview(JSON.stringify({ summary: 's', execution: 'e', intensity: 'i', next: 'n', limitations: 'l' }))
  assert.equal(review.summary, 's')
  assert.throws(() => decodeReview('{"summary":"s"}'), AiError)

  const coach = decodeCoach(JSON.stringify({ reply: '先休息', proposal: null }))
  assert.equal(coach.proposal, null)
  const proposed = decodeCoach(JSON.stringify({ reply: '方案如下', proposal: { title: 't', training: 'a', recovery: 'b', nutrition: 'c' } }))
  assert.equal(proposed.proposal.title, 't')
})

test('requests map HTTP failures and timeouts into readable errors', async () => {
  const config = { endpoint: 'https://api.example.com/v1/chat/completions', model: 'm', apiKey: 'k' }
  const ok = async () => Response.json({ choices: [{ message: { content: 'OK' } }] })
  assert.equal(await complete(ok, config, [{ role: 'user', content: 'hi' }]), 'OK')

  const unauthorized = async () => new Response('nope', { status: 401 })
  await assert.rejects(() => complete(unauthorized, config, []), /HTTP 401.*密钥/)

  const rateLimited = async () => new Response('slow down', { status: 429 })
  await assert.rejects(() => complete(rateLimited, config, []), /额度/)

  const timeout = async () => { const error = new Error('aborted'); error.name = 'AbortError'; throw error }
  await assert.rejects(() => complete(timeout, config, []), /超时/)
})

test('only OpenCode endpoints receive the session routing header', async () => {
  const seen = []
  const fake = async (url, options) => { seen.push({ url, headers: options.headers }); return Response.json({ choices: [{ message: { content: 'OK' } }] }) }
  await complete(fake, { endpoint: 'https://opencode.ai/inference/go/v1/chat/completions', model: 'm', apiKey: 'k' }, [], 'session-1')
  await complete(fake, { endpoint: 'https://api.example.com/v1/chat/completions', model: 'm', apiKey: 'k' }, [], 'session-1')
  assert.equal(seen[0].headers['x-opencode-session'], 'session-1')
  assert.equal(seen[1].headers['x-opencode-session'], undefined)
})

test('mobile AI client stores config locally and runs the same capabilities', async () => {
  let stored = null
  const store = { load: async () => stored, save: async (config) => { stored = config } }
  const replies = [
    { choices: [{ message: { content: 'OK' } }] },
    { choices: [{ message: { content: JSON.stringify({ rows: [{ date: today, type: '轻松跑', minutes: 40, detail: '', source: '' }] }) } }] },
    { choices: [{ message: { content: JSON.stringify({ summary: 'a', execution: 'b', intensity: 'c', next: 'd', limitations: 'e' }) } }] },
    { choices: [{ message: { content: '更放松一点，今天先慢跑。' } }] },
  ]
  const calls = []
  const client = createAiClient({
    store,
    fetchImpl: async (url, options) => { calls.push(url); return Response.json(replies[Math.min(calls.length - 1, replies.length - 1)]) },
    sessionId: 'test-session',
  })

  assert.deepEqual(await client.request('/ai/settings'), { configured: false })
  const configured = await client.request('/ai/settings', 'POST', { baseUrl: 'https://api.example.com/v1', model: 'm', apiKey: 'secret' })
  assert.equal(configured.configured, true)
  assert.equal(stored.apiKey, 'secret')

  const recognized = await client.request('/ai/recognize', 'POST', { start: '2026-11-23', text: '第 1 周' })
  assert.equal(recognized.rows[0].type, '轻松跑')

  const review = await client.request('/ai/review', 'POST', { date: today, plan, activities, total: { minutes: 40, km: 7 } })
  assert.equal(review.review.summary, 'a')

  const mood = await client.request('/ai/mood', 'POST', { mood: '有点累', note: '' })
  assert.match(mood.reply, /放松/)

  await client.request('/ai/settings', 'DELETE')
  assert.equal(stored, null)
  await assert.rejects(() => client.request('/ai/review', 'POST', { date: today, plan, activities }), /测试并保存配置/)
  await assert.rejects(() => client.request('/unknown', 'GET'), /找不到这个接口/)
})
