import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPricingProxy } from './pricing-proxy.mjs'

const calls = []
const proxy = createPricingProxy({
  fetchUpstream: async (target, headers, proxyUrl) => {
    calls.push({ target: target.href, headers, proxyUrl })
    return { statusCode: 200, contentType: 'application/json', body: Buffer.from('{}') }
  }
})

function invoke(url, method = 'GET') {
  return new Promise((resolve) => {
    const headers = {}
    const response = {
      statusCode: 200,
      setHeader(name, value) { headers[name] = value },
      end(body) { resolve({ status: this.statusCode, headers, body }) }
    }
    proxy({ url, method }, response, () => resolve({ status: 404 }))
  })
}

test('maps OpenAI country and config routes', async () => {
  calls.length = 0
  assert.equal((await invoke('/api/providers/openai/countries')).status, 200)
  assert.equal((await invoke('/api/providers/openai/configs/us')).status, 200)
  assert.equal(calls[0].target, 'https://chatgpt.com/backend-api/checkout_pricing_config/countries')
  assert.equal(calls[1].target, 'https://chatgpt.com/backend-api/checkout_pricing_config/configs/US')
  assert.deepEqual(calls.map((call) => call.proxyUrl), ['', ''])
})

test('keeps Claude proxy choice on each request', async () => {
  calls.length = 0
  const first = `/api/providers/claude/configs/us?proxy=${encodeURIComponent('https://first.example:8443')}`
  const second = `/api/providers/claude/configs/ca?proxy=${encodeURIComponent('http://second.example:8080')}`
  const responses = await Promise.all([invoke(first), invoke(second), invoke('/api/providers/claude/configs/gb')])
  assert.deepEqual(responses.map((response) => response.status), [200, 200, 200])
  assert.deepEqual(calls.map((call) => call.proxyUrl), [
    'https://first.example:8443', 'http://second.example:8080', ''
  ])
  assert.deepEqual(calls.map((call) => call.target), [
    'https://claude.ai/api/billing/subscription_pricing?country=US',
    'https://claude.ai/api/billing/subscription_pricing?country=CA',
    'https://claude.ai/api/billing/subscription_pricing?country=GB'
  ])
})

test('rejects invalid country, proxy, and method', async () => {
  assert.equal((await invoke('/api/providers/openai/configs/USA')).status, 400)
  assert.equal((await invoke('/api/providers/claude/configs/us?proxy=file:///tmp/test')).status, 400)
  assert.equal((await invoke('/api/providers/claude/configs/us', 'POST')).status, 405)
  assert.equal((await invoke('/api/providers/other')).status, 404)
})
