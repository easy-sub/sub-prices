export type ProviderKey = 'openai' | 'claude' | 'grok'
export type BillingInterval = 'month' | 'year'

export type TaxMode = 'inclusive' | 'exclusive'

export interface Promotion {
  amount: number
  durationPeriods: number
  expiresAt: string
}

export interface IntervalPrice {
  amount: number
  tax?: TaxMode
  taxPercent?: number
  promotion?: Promotion
  psp_override?: {
    amount: number
    tax?: TaxMode
  }
}

export interface PlanPricing {
  month?: IntervalPrice
  year?: IntervalPrice
}

export interface CurrencyConfig {
  symbol_code: string
  symbol: string
  tax_percent?: number
  minor_unit_exponent?: number
  [key: string]: unknown
}

export interface PricingConfig {
  country_code: string
  currency_config: CurrencyConfig
}

export interface PlanDefinition {
  key: string
  label: string
}

export interface PriceRow {
  rank: number
  countryCode: string
  countryName: string
  flag: string
  currencyCode: string
  currencySymbol: string
  originalAmount: number | null
  regularAmount: number | null
  promotion?: Promotion
  convertedAmount: number | null
  taxPercent: number | null
  taxIncluded: boolean
}
