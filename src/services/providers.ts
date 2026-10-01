import type { BillingInterval, CurrencyConfig, PlanDefinition, PlanPricing, PricingConfig, ProviderKey } from '../types/pricing'

export interface ProviderAdapter {
  key: ProviderKey
  label: string
  plans: PlanDefinition[]
  getPrice(config: PricingConfig, planKey: string, interval: BillingInterval): number | null
  getTaxPercent(config: PricingConfig, planKey: string, interval: BillingInterval): number | null
  isTaxIncluded(config: PricingConfig, planKey: string, interval: BillingInterval): boolean
}

const openAIProvider: ProviderAdapter = {
  key: 'openai',
  label: 'OpenAI',
  plans: [
    { key: 'free', label: '免费' },
    { key: 'go', label: 'Go' },
    { key: 'plus', label: 'Plus' },
    { key: 'prolite', label: 'Pro 100' },
    { key: 'pro', label: 'Pro 200' },
    { key: 'promax', label: 'Pro 500' },
    { key: 'business', label: '团队版' },
    { key: 'business_non_profit', label: '非盈利' }
  ],
  getPrice(config, planKey, interval) {
    return extractOpenAIPrice(config.currency_config, planKey, interval)
  },
  getTaxPercent() {
    return null
  },
  isTaxIncluded(config, planKey, interval) {
    const selected = getIntervalPrice(config.currency_config, planKey, interval)
    if (!selected) return false
    if (typeof selected.psp_override?.amount === 'number') {
      return selected.psp_override.amount > 0 && selected.psp_override.tax === 'inclusive'
    }
    return selected.amount > 0 && selected.tax === 'inclusive'
  }
}

const claudeProvider: ProviderAdapter = {
  key: 'claude',
  label: 'Claude',
  plans: [
    { key: 'free', label: '免费' },
    { key: 'pro', label: 'Pro' },
    { key: 'max_5x', label: 'Max 5x' },
    { key: 'max_20x', label: 'Max 20x' },
    { key: 'team', label: '团队版' },
    { key: 'team_nonprofit', label: '非盈利' },
    { key: 'team_premium', label: 'Team Premium' }
  ],
  getPrice(config, planKey, interval) {
    return extractClaudePrice(config.currency_config, planKey, interval)
  },
  getTaxPercent(config, planKey, interval) {
    return extractTaxPercent(config.currency_config, planKey, interval)
  },
  isTaxIncluded() {
    return false
  }
}

export const providers: ProviderAdapter[] = [
  openAIProvider,
  claudeProvider
]

export function getProvider(key: ProviderKey): ProviderAdapter {
  return providers.find((provider) => provider.key === key) ?? openAIProvider
}

function extractOpenAIPrice(config: CurrencyConfig, planKey: string, interval: BillingInterval): number | null {
  const selected = getIntervalPrice(config, planKey, interval)

  if (!selected || typeof selected.amount !== 'number') {
    return null
  }

  return typeof selected.psp_override?.amount === 'number' ? selected.psp_override.amount : selected.amount
}

function getIntervalPrice(config: CurrencyConfig, planKey: string, interval: BillingInterval) {
  const pricing = config[planKey] as PlanPricing | undefined
  return pricing?.[interval] ?? (interval === 'year' ? undefined : pricing?.month)
}

function extractClaudePrice(config: CurrencyConfig, planKey: string, interval: BillingInterval): number | null {
  const pricing = config[planKey] as PlanPricing | undefined
  const selected = pricing?.[interval] ?? (interval === 'year' ? undefined : pricing?.month)

  if (!selected || typeof selected.amount !== 'number') {
    return null
  }

  return selected.amount
}

function extractTaxPercent(config: CurrencyConfig, planKey: string, interval: BillingInterval): number | null {
  const pricing = config[planKey] as PlanPricing | undefined
  const selected = pricing?.[interval] ?? (interval === 'year' ? undefined : pricing?.month)
  return typeof selected?.taxPercent === 'number' && selected.taxPercent > 0 ? selected.taxPercent : null
}
