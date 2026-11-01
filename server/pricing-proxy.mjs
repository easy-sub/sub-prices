import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { decodeGrokPricing, grokCountries, grokPricingRequest, normalizeGrokPricing } from './grok-pricing.mjs'

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 20_000

export function createPricingProxy({
  openAIOrigin = 'https://chatgpt.com',
  claudeOrigin = 'https://claude.ai',
  grokOrigin = 'https://grok.com',
  fetchUpstream = requestUpstream
} = {}) {
  return (req, res, next) => {
    const localUrl = new URL(req.url ?? '/', 'http://localhost')
    if (!localUrl.pathname.startsWith('/api/providers/')) {
      next()
      return
    }

    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'Method not allowed' })
      return
    }

    if (localUrl.pathname === '/api/providers/grok/countries') {
      sendJson(res, 200, { countries: grokCountries })
      return
    }

    const route = resolveRoute(localUrl, openAIOrigin, claudeOrigin, grokOrigin)
    if (!route) {
      sendJson(res, 404, { error: 'Not found' })
      return
    }
    if (route.error) {
      sendJson(res, 400, { error: route.error })
      return
    }

    fetchUpstream(route.target, route.headers, route.proxyUrl, route.body)
      .then(({ statusCode, contentType, body, headers }) => {
        if (route.country) {
          if (statusCode !== 200 || !/^application\/grpc-web(?:\+proto)?(?:;|$)/i.test(contentType)) {
            throw new Error('Invalid Grok pricing response')
          }
          sendJson(res, 200, normalizeGrokPricing(decodeGrokPricing(body, headers), route.country))
          return
        }
        res.statusCode = statusCode
        res.setHeader('content-type', contentType)
        res.end(body)
      })
      .catch(() => sendJson(res, 502, { error: 'Pricing provider unavailable' }))
  }
}

function resolveRoute(localUrl, openAIOrigin, claudeOrigin, grokOrigin) {
  const { pathname, searchParams } = localUrl
  const grokMatch = pathname.match(/^\/api\/providers\/grok\/configs\/([^/]+)$/)
  if (grokMatch) {
    const country = normalizeCountry(grokMatch[1])
    if (!country) return { error: 'Invalid country code' }
    return {
      target: new URL('/commerce.prepurchase.v1.PrePurchaseService/MultiGetSkuPricings', grokOrigin),
      headers: {
        'content-type': 'application/grpc-web+proto',
        'x-grpc-web': '1',
        'x-user-agent': 'connect-es/2.1.1',
        'x-xai-app': 'grok',
        origin: 'https://grok.com',
        referer: 'https://grok.com/',
        'user-agent': USER_AGENT
      },
      proxyUrl: '',
      body: grokPricingRequest(country),
      country
    }
  }
  if (pathname === '/api/providers/openai/countries') {
    return {
      target: new URL('/backend-api/checkout_pricing_config/countries', openAIOrigin),
      headers: openAIHeaders(),
      proxyUrl: ''
    }
  }

  const openAIMatch = pathname.match(/^\/api\/providers\/openai\/configs\/([^/]+)$/)
  if (openAIMatch) {
    const country = normalizeCountry(openAIMatch[1])
    if (!country) return { error: 'Invalid country code' }
    return {
      target: new URL(`/backend-api/checkout_pricing_config/configs/${country}`, openAIOrigin),
      headers: openAIHeaders(),
      proxyUrl: ''
    }
  }

  const claudeMatch = pathname.match(/^\/api\/providers\/claude\/configs\/([^/]+)$/)
  if (claudeMatch) {
    const country = normalizeCountry(claudeMatch[1])
    if (!country) return { error: 'Invalid country code' }
    const proxyUrl = searchParams.get('proxy')?.trim() ?? ''
    if (proxyUrl && !validProxyUrl(proxyUrl)) return { error: 'Invalid proxy URL' }
    return {
      target: new URL(`/api/billing/subscription_pricing?country=${country}`, claudeOrigin),
      headers: {
        accept: 'application/json',
        origin: 'https://claude.com',
        referer: 'https://claude.com/pricing',
        'user-agent': USER_AGENT
      },
      proxyUrl
    }
  }

  return null
}

function normalizeCountry(value) {
  return /^[a-z]{2}$/i.test(value ?? '') ? value.toUpperCase() : ''
}

function validProxyUrl(value) {
  if (value.length > 2048) return false
  try {
    const parsed = new URL(value)
    return ['http:', 'https:'].includes(parsed.protocol) && Boolean(parsed.hostname)
  } catch {
    return false
  }
}

function openAIHeaders() {
  return {
    accept: 'application/json',
    referer: 'https://chatgpt.com/',
    'user-agent': USER_AGENT
  }
}

export function requestUpstream(target, headers, proxyUrl = '', body) {
  return new Promise((resolve, reject) => {
    const request = target.protocol === 'http:' ? httpRequest : httpsRequest
    const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined
    const upstreamRequest = request(target, { method: body ? 'POST' : 'GET', agent, timeout: REQUEST_TIMEOUT_MS, headers }, (response) => {
      const chunks = []
      let size = 0
      response.on('data', (chunk) => {
        size += chunk.length
        if (size > MAX_RESPONSE_BYTES) {
          upstreamRequest.destroy(new Error('Pricing response too large'))
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => {
        resolve({
          statusCode: response.statusCode ?? 502,
          contentType: response.headers['content-type'] ?? 'application/json; charset=utf-8',
          headers: { ...response.headers, ...response.trailers },
          body: Buffer.concat(chunks)
        })
      })
      response.on('error', reject)
    })

    upstreamRequest.on('timeout', () => upstreamRequest.destroy(new Error('Pricing request timed out')))
    upstreamRequest.on('error', reject)
    upstreamRequest.end(body)
  })
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}
