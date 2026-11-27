import assert from 'node:assert/strict'
import test from 'node:test'
import { allowedExternalUrls, aiProviders, garminKeyPage, matchProvider, providerById } from '../src/providers.ts'
import { parseEndpoint } from '../src/aiCore.ts'

test('every provider preset is usable as-is', () => {
  assert.equal(aiProviders.length, 4)
  for (const provider of aiProviders) {
    assert.ok(provider.label)
    if (provider.id === 'custom') {
      assert.equal(provider.endpoint, '')
      continue
    }
    // 预设地址必须能通过 App 的 HTTPS 校验并补全为 chat/completions
    assert.match(parseEndpoint(provider.endpoint), /^https:\/\/.+\/chat\/completions$/)
    assert.ok(provider.model.length > 0)
    assert.match(provider.keyPage ?? '', /^https:\/\//)
  }
})

test('DeepSeek preset points at the official endpoint and cheap default model', () => {
  const deepseek = providerById('deepseek')
  assert.equal(deepseek.endpoint, 'https://api.deepseek.com/v1')
  assert.equal(deepseek.model, 'deepseek-chat')
  assert.equal(deepseek.keyPage, 'https://platform.deepseek.com/api_keys')
  assert.match(deepseek.note ?? '', /deepseek-reasoner/)
})

test('saved endpoints map back to the right provider chip', () => {
  assert.equal(matchProvider('https://api.deepseek.com/v1/chat/completions').id, 'deepseek')
  assert.equal(matchProvider('https://api.openai.com/v1/chat/completions').id, 'openai')
  assert.equal(matchProvider('https://openrouter.ai/api/v1/chat/completions').id, 'openrouter')
  assert.equal(matchProvider('https://my-gateway.example.com/v1/chat/completions'), undefined)
  assert.equal(matchProvider(''), undefined)
})

test('desktop external allowlist covers every key page', () => {
  assert.equal(allowedExternalUrls.includes(garminKeyPage), true)
  for (const provider of aiProviders) {
    if (!provider.keyPage) continue
    assert.equal(allowedExternalUrls.includes(provider.keyPage), true)
  }
  assert.equal(allowedExternalUrls.length, 4)
})
