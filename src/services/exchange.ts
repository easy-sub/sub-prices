export interface ExchangeRates {
  date: string
  base: string
  rates: Record<string, number>
}

const primaryBaseUrl = 'https://api.fxratesapi.com/latest'
const fallbackBaseUrl = 'https://api.coinbase.com/v2/exchange-rates'

export async function loadExchangeRates(displayCurrency: string): Promise<ExchangeRates | null> {
  const base = displayCurrency.toLowerCase()

  try {
    return await fetchPrimaryRates(base)
  } catch {
    try {
      return await fetchFallbackRates(base)
    } catch {
      return null
    }
  }
}

export function convertToDisplayCurrency(amount: number, fromCurrency: string, rates: ExchangeRates | null) {
  if (!rates) {
    return null
  }
  if (fromCurrency.toLowerCase() === rates.base) {
    return amount
  }

  const sourcePerDisplayUnit = rates.rates[fromCurrency.toLowerCase()]
  if (!sourcePerDisplayUnit || sourcePerDisplayUnit <= 0) {
    return null
  }

  return amount / sourcePerDisplayUnit
}

async function fetchPrimaryRates(base: string): Promise<ExchangeRates> {
  const response = await fetch(`${primaryBaseUrl}?base=${base.toUpperCase()}`, {
    signal: AbortSignal.timeout(8_000)
  })
  if (!response.ok) {
    throw new Error(`Exchange HTTP ${response.status}`)
  }

  const payload = (await response.json()) as {
    success?: boolean
    base?: string
    date?: string
    rates?: Record<string, number>
  }
  if (payload.success !== true || payload.base?.toLowerCase() !== base || !payload.date || !payload.rates) {
    throw new Error('Invalid exchange payload')
  }

  return {
    date: payload.date,
    base,
    rates: normalizeRates(payload.rates)
  }
}

async function fetchFallbackRates(base: string): Promise<ExchangeRates> {
  const response = await fetch(`${fallbackBaseUrl}?currency=${base.toUpperCase()}`, {
    signal: AbortSignal.timeout(8_000)
  })
  if (!response.ok) {
    throw new Error(`Exchange HTTP ${response.status}`)
  }

  const payload = (await response.json()) as {
    data?: { currency?: string; rates?: Record<string, string> }
  }
  if (payload.data?.currency?.toLowerCase() !== base || !payload.data.rates) {
    throw new Error('Invalid exchange payload')
  }

  return {
    date: new Date().toISOString(),
    base,
    rates: normalizeRates(payload.data.rates)
  }
}

function normalizeRates(rates: Record<string, number | string>): Record<string, number> {
  const normalized: Record<string, number> = {}
  for (const [currency, rawRate] of Object.entries(rates)) {
    const rate = Number(rawRate)
    if (Number.isFinite(rate) && rate > 0) {
      normalized[currency.toLowerCase()] = rate
    }
  }
  if (Object.keys(normalized).length === 0) {
    throw new Error('Invalid exchange rates')
  }
  return normalized
}
