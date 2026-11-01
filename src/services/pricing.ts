import { claudeCountries } from '../data/countries'
import type { PricingConfig, ProviderKey } from '../types/pricing'

const cacheTtlMs = 10 * 60 * 1000
const cacheVersion = 3
const apiBase = import.meta.env.VITE_PRICE_API_BASE ?? '/api/providers'

interface CachedPricing {
  version?: number
  timestamp: number
  provider: ProviderKey
  configs: Record<string, PricingConfig>
}

export interface LoadPricingResult {
  configs: Map<string, PricingConfig>
  totalCountries: number
  failedCountries: string[]
}

interface LoadPricingOptions {
  proxyUrl?: string
  onProgress?: (result: LoadPricingResult) => void
}

export async function loadPricing(
  provider: ProviderKey,
  forceRefresh = false,
  options: LoadPricingOptions = {}
): Promise<LoadPricingResult> {
  const proxyUrl = provider === 'claude' ? options.proxyUrl?.trim() ?? '' : ''

  if (!forceRefresh) {
    const cached = readCache(provider, proxyUrl)
    if (cached) {
      return { configs: cached, totalCountries: cached.size, failedCountries: [] }
    }
  }

  const countries = await fetchCountries(provider)
  const { entries, failedCountries } = await fetchConfigs(provider, countries, proxyUrl, options.onProgress)
  const configs = new Map(entries)

  if (configs.size === 0) {
    throw new Error('No valid pricing configs returned')
  }

  if (failedCountries.length === 0) {
    writeCache(provider, configs, proxyUrl)
  }
  return { configs, totalCountries: countries.length, failedCountries }
}

export function clearPricingCache(provider: ProviderKey) {
  const prefix = cacheKeyPrefix(provider)
  for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
    const key = window.sessionStorage.key(index)
    if (key?.startsWith(prefix)) {
      window.sessionStorage.removeItem(key)
    }
  }
}

async function fetchCountries(provider: ProviderKey): Promise<string[]> {
  if (provider === 'claude') {
    return prioritizeCountries(claudeCountries, ['US', 'CA'])
  }

  const response = await fetch(`${apiBase}/${provider}/countries`, {
    headers: { accept: 'application/json' }
  })

  if (!response.ok) {
    throw new Error(`Countries HTTP ${response.status}`)
  }

  const data = (await response.json()) as { countries?: string[] }
  if (!Array.isArray(data.countries) || data.countries.length === 0) {
    throw new Error('Invalid countries payload')
  }

  return prioritizeCountries(data.countries, provider === 'grok' ? ['US', 'IN', 'TR'] : ['CL', 'US'])
}

async function fetchConfigs(
  provider: ProviderKey,
  countries: string[],
  proxyUrl: string,
  onProgress?: (result: LoadPricingResult) => void
) {
  const entries: Array<[string, PricingConfig]> = []
  const failedCountries = new Set<string>()

  const reportProgress = () => {
    onProgress?.({ configs: new Map(entries), totalCountries: countries.length, failedCountries: [...failedCountries] })
  }

  const fetchAll = async (pending: string[], concurrency: number) => {
    let nextIndex = 0
    await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, async () => {
      while (nextIndex < pending.length) {
        const countryCode = pending[nextIndex++]
        if (!countryCode) continue
        try {
          entries.push(await fetchConfig(provider, countryCode, proxyUrl))
          failedCountries.delete(countryCode)
        } catch {
          failedCountries.add(countryCode)
        }
        reportProgress()
      }
    }))
  }

  await fetchAll(countries, provider === 'openai' ? 20 : 5)
  for (let attempt = 0; attempt < 2 && failedCountries.size > 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
    await fetchAll([...failedCountries], provider === 'openai' ? 10 : 3)
  }

  return { entries, failedCountries: [...failedCountries] }
}

async function fetchConfig(provider: ProviderKey, countryCode: string, proxyUrl: string): Promise<[string, PricingConfig]> {
  const response = await fetch(providerConfigUrl(provider, countryCode, proxyUrl), {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(provider === 'claude' ? 12_000 : 8_000)
  })

  if (!response.ok) {
    throw new Error(`Config ${countryCode} HTTP ${response.status}`)
  }

  const config = (await response.json()) as PricingConfig
  const normalizedConfig = provider === 'claude' ? normalizeClaudeConfig(countryCode, config) : config
  if (!normalizedConfig.currency_config?.symbol_code) {
    throw new Error(`Invalid config ${countryCode}`)
  }

  return [countryCode, normalizedConfig]
}

function prioritizeCountries(countries: string[], priority: string[]) {
  const seen = new Set<string>()
  return [...priority, ...countries].filter((country) => {
    if (seen.has(country)) {
      return false
    }
    seen.add(country)
    return true
  })
}

function readCache(provider: ProviderKey, proxyUrl: string): Map<string, PricingConfig> | null {
  try {
    const raw = window.sessionStorage.getItem(cacheKey(provider, proxyUrl))
    if (!raw) {
      return null
    }

    const cached = JSON.parse(raw) as CachedPricing
    if (cached.version !== cacheVersion || cached.provider !== provider || Date.now() - cached.timestamp > cacheTtlMs) {
      return null
    }

    return new Map(Object.entries(cached.configs))
  } catch {
    return null
  }
}

function writeCache(provider: ProviderKey, configs: Map<string, PricingConfig>, proxyUrl: string) {
  const payload: CachedPricing = {
    version: cacheVersion,
    timestamp: Date.now(),
    provider,
    configs: Object.fromEntries(configs)
  }

  try {
    window.sessionStorage.setItem(cacheKey(provider, proxyUrl), JSON.stringify(payload))
  } catch {
    // Cache failures should not block the price table.
  }
}

function providerConfigUrl(provider: ProviderKey, countryCode: string, proxyUrl: string) {
  const query = provider === 'claude' && proxyUrl ? `?proxy=${encodeURIComponent(proxyUrl)}` : ''
  return `${apiBase}/${provider}/configs/${countryCode}${query}`
}

function cacheKeyPrefix(provider: ProviderKey) {
  return `sub-prices:${provider}:pricing`
}

function cacheKey(provider: ProviderKey, proxyUrl: string) {
  const suffix = provider === 'claude' && proxyUrl ? `:${encodeURIComponent(proxyUrl)}` : ''
  return `${cacheKeyPrefix(provider)}${suffix}`
}

interface ClaudePricingResponse {
  country?: string
  currency?: string
  plans?: Record<
    string,
    {
      amount_minor?: number
      currency?: string
      interval?: 'month' | 'year'
      tax_rate_pct?: number | null
    } | null
  >
  tax_display?: {
    show_included?: boolean
  }
}

function normalizeClaudeConfig(countryCode: string, response: PricingConfig | ClaudePricingResponse): PricingConfig {
  if ('currency_config' in response) {
    return response
  }

  const currency = response.currency ?? firstClaudePlanCurrency(response) ?? 'USD'
  const currencyConfig = {
    symbol_code: currency,
    symbol: currencySymbol(currency),
    tax_percent: firstClaudeTaxRate(response) ?? undefined,
    free: { month: { amount: 0, tax: 'exclusive' } },
    pro: {
      month: claudeIntervalPrice(response, 'pro_monthly'),
      year: claudeIntervalPrice(response, 'pro_annual', true)
    },
    max_5x: {
      month: claudeIntervalPrice(response, 'max_5x_monthly')
    },
    max_20x: {
      month: claudeIntervalPrice(response, 'max_20x_monthly')
    },
    team: {
      month: claudeIntervalPrice(response, 'team_monthly_per_seat'),
      year: claudeIntervalPrice(response, 'team_annual_per_seat', true)
    },
    team_nonprofit: {
      month: claudeIntervalPrice(response, 'team_nonprofit_monthly_per_seat')
    },
    team_premium: {
      month: claudeIntervalPrice(response, 'team_premium_monthly_per_seat'),
      year: claudeIntervalPrice(response, 'team_premium_annual_per_seat', true)
    },
    minor_unit_exponent: currencyMinorUnits(currency)
  }

  return {
    country_code: response.country ?? countryCode,
    currency_config: currencyConfig
  }
}

function claudeIntervalPrice(response: ClaudePricingResponse, planKey: string, annualTotal = false) {
  const plan = response.plans?.[planKey]
  if (!plan || typeof plan.amount_minor !== 'number') {
    return undefined
  }

  const currency: string = plan.currency ?? response.currency ?? 'USD'
  let amountMinor: number = plan.amount_minor
  if (annualTotal) {
    amountMinor = Math.round(amountMinor / 12)
  }

  const taxPercent = typeof plan.tax_rate_pct === 'number' && plan.tax_rate_pct > 0 ? plan.tax_rate_pct : null
  if (taxPercent) {
    amountMinor = Math.round(amountMinor * (1 + taxPercent / 100))
  }

  return {
    amount: amountMinor / Math.pow(10, currencyMinorUnits(currency)),
    tax: taxPercent ? 'inclusive' : 'exclusive',
    taxPercent: taxPercent ?? undefined
  }
}

function firstClaudePlanCurrency(response: ClaudePricingResponse) {
  return Object.values(response.plans ?? {}).find((plan) => plan?.currency)?.currency
}

function firstClaudeTaxRate(response: ClaudePricingResponse) {
  return Object.values(response.plans ?? {}).find((plan) => typeof plan?.tax_rate_pct === 'number' && plan.tax_rate_pct > 0)
    ?.tax_rate_pct
}

function currencyMinorUnits(currency: string): number {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
  } catch {
    return 2
  }
}

function currencySymbol(currency: string) {
  try {
    const parts = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol'
    }).formatToParts(0)

    return parts.find((part) => part.type === 'currency')?.value ?? currency
  } catch {
    return currency
  }
}
