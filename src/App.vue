<script setup lang="ts">
import { AlertCircle, ArrowDown, ArrowUp, Github, Moon, RefreshCw, SlidersHorizontal, Sun, TrendingDown, X } from 'lucide-vue-next'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { convertToDisplayCurrency, loadExchangeRates, type ExchangeRates } from './services/exchange'
import { clearPricingCache, loadPricing } from './services/pricing'
import { getPromotion, getProvider, providers } from './services/providers'
import type { BillingInterval, PriceRow, PricingConfig, ProviderKey } from './types/pricing'
import { countryFlag, formatMoney, getCountryName } from './utils/format'

const displayCurrencies = [
  { code: 'USD', flag: '🇺🇸' },
  { code: 'CNY', flag: '🇨🇳' },
  { code: 'HKD', flag: '🇭🇰' },
  { code: 'JPY', flag: '🇯🇵' },
  { code: 'EUR', flag: '🇪🇺' },
  { code: 'GBP', flag: '🇬🇧' },
  { code: 'TRY', flag: '🇹🇷' },
  { code: 'INR', flag: '🇮🇳' },
  { code: 'BRL', flag: '🇧🇷' }
]

const providerKey = ref<ProviderKey>((import.meta.env.VITE_DEFAULT_PROVIDER as ProviderKey) || 'openai')
const activePlan = ref('plus')
const billingInterval = ref<BillingInterval>('month')
const displayCurrency = ref(import.meta.env.VITE_DEFAULT_DISPLAY_CURRENCY || 'USD')
const sortDirection = ref<'ascending' | 'descending'>('ascending')
const configs = ref<Map<string, PricingConfig>>(new Map())
const totalCountries = ref(0)
const failedCountries = ref<string[]>([])
const exchangeRates = ref<ExchangeRates | null>(null)
const isLoading = ref(true)
const loadError = ref(false)
const exchangeLoading = ref(false)
const isDark = ref(false)
const claudeProxyUrl = ref('')
const showClaudeProxyModal = ref(false)
const usePromotionalPrice = ref(true)
const now = ref(Date.now())
let promotionTimer: ReturnType<typeof setInterval> | undefined
let pricingRequestId = 0

const provider = computed(() => getProvider(providerKey.value))
const rows = computed<PriceRow[]>(() => {
  const mapped = Array.from(configs.value.entries()).map(([countryCode, config]) => {
    const currencyCode = config.currency_config.symbol_code
    const regularAmount = provider.value.getPrice(config, activePlan.value, billingInterval.value)
    const promotion = providerKey.value === 'grok' ? getPromotion(config, activePlan.value, billingInterval.value, now.value) : undefined
    const originalAmount = usePromotionalPrice.value && promotion ? promotion.amount : regularAmount
    const convertedAmount =
      originalAmount === null ? null : convertToDisplayCurrency(originalAmount, currencyCode, exchangeRates.value)
    const taxPercent = provider.value.getTaxPercent(config, activePlan.value, billingInterval.value)
    const taxIncluded = provider.value.isTaxIncluded(config, activePlan.value, billingInterval.value)

    return {
      rank: 0,
      countryCode,
      countryName: getCountryName(countryCode),
      flag: countryFlag(countryCode),
      currencyCode,
      currencySymbol: config.currency_config.symbol,
      originalAmount,
      regularAmount,
      promotion,
      convertedAmount,
      taxPercent,
      taxIncluded
    }
  })

  const sorted = mapped.sort((left, right) => {
    const leftAmount = left.convertedAmount ?? Number.POSITIVE_INFINITY
    const rightAmount = right.convertedAmount ?? Number.POSITIVE_INFINITY
    return leftAmount - rightAmount
  })

  if (sortDirection.value === 'descending') {
    sorted.reverse()
  }

  return sorted.map((row, index) => ({ ...row, rank: index + 1 }))
})

const missingRateCount = computed(() => rows.value.filter((row) => row.originalAmount !== null && row.convertedAmount === null).length)
const rankingReady = computed(() => !isLoading.value && failedCountries.value.length === 0 && missingRateCount.value === 0)
const lowestRow = computed(() => {
  if (!rankingReady.value) {
    return undefined
  }
  return [...rows.value]
    .filter((row) => row.convertedAmount !== null)
    .sort((left, right) => Number(left.convertedAmount) - Number(right.convertedAmount))[0]
})

const referenceRow = computed(() => rows.value.find((row) => row.countryCode === 'US'))
const savingsPercent = computed(() => {
  const lowest = lowestRow.value?.convertedAmount
  const reference = referenceRow.value?.convertedAmount

  if (!lowest || !reference || lowest >= reference) {
    return 0
  }

  return Math.round(((reference - lowest) / reference) * 100)
})

const distributionRows = computed(() => {
  return [...rows.value]
    .map((row) => ({
      ...row,
      displayAmount: row.convertedAmount
    }))
    .filter((row) => row.displayAmount !== null)
    .sort((left, right) => Number(left.displayAmount) - Number(right.displayAmount))
    .slice(0, 30)
})

const distributionMin = computed(() => Number(distributionRows.value[0]?.displayAmount ?? 0))
const distributionMax = computed(() => {
  const last = distributionRows.value[distributionRows.value.length - 1]
  return Number(last?.displayAmount ?? distributionMin.value)
})

const planLabel = computed(() => provider.value.plans.find((plan) => plan.key === activePlan.value)?.label ?? activePlan.value)
const selectedCurrencyFlag = computed(() => {
  return displayCurrencies.find((currency) => currency.code === displayCurrency.value)?.flag ?? '¤'
})

onMounted(async () => {
  promotionTimer = setInterval(() => { now.value = Date.now() }, 30_000)
  claudeProxyUrl.value = window.localStorage.getItem('sub-prices:claude-proxy') ?? ''
  const storedTheme = window.localStorage.getItem('sub-prices:theme')
  isDark.value = storedTheme === 'dark'
  applyTheme()
  await Promise.all([reloadPricing(false), reloadExchangeRates()])
})

onUnmounted(() => clearInterval(promotionTimer))

watch(providerKey, async () => {
  activePlan.value = provider.value.plans.find((plan) => plan.key === (providerKey.value === 'grok' ? 'premium' : 'pro'))?.key ?? provider.value.plans[0]?.key ?? ''
  await reloadPricing(false)
})

watch(displayCurrency, reloadExchangeRates)

function applyTheme() {
  document.documentElement.classList.toggle('dark', isDark.value)
  window.localStorage.setItem('sub-prices:theme', isDark.value ? 'dark' : 'light')
}

function toggleTheme() {
  isDark.value = !isDark.value
  applyTheme()
}

async function reloadPricing(forceRefresh: boolean) {
  const requestId = ++pricingRequestId
  const currentProvider = providerKey.value
  isLoading.value = true
  loadError.value = false
  configs.value = new Map()
  totalCountries.value = 0
  failedCountries.value = []
  if (forceRefresh) {
    clearPricingCache(currentProvider)
  }

  try {
    const result = await loadPricing(currentProvider, forceRefresh, {
      proxyUrl: currentProvider === 'claude' ? claudeProxyUrl.value : '',
      onProgress(progress) {
        if (requestId !== pricingRequestId) return
        configs.value = progress.configs
        totalCountries.value = progress.totalCountries
        failedCountries.value = progress.failedCountries
      }
    })
    if (requestId !== pricingRequestId) return
    configs.value = result.configs
    totalCountries.value = result.totalCountries
    failedCountries.value = result.failedCountries
  } catch {
    if (requestId !== pricingRequestId) return
    configs.value = new Map()
    totalCountries.value = 0
    failedCountries.value = []
    loadError.value = true
  }
  isLoading.value = false
}

async function reloadExchangeRates() {
  const currency = displayCurrency.value
  exchangeLoading.value = true
  exchangeRates.value = null
  const rates = await loadExchangeRates(currency)
  if (displayCurrency.value === currency) {
    exchangeRates.value = rates
    exchangeLoading.value = false
  }
}

function formatOriginal(row: PriceRow) {
  if (row.originalAmount === null) {
    return '暂无'
  }

  return `${row.currencySymbol}${row.originalAmount.toFixed(row.currencyCode === 'JPY' ? 0 : 2)} ${row.currencyCode}`
}

function formatConverted(row: PriceRow) {
  if (row.originalAmount === null) {
    return '暂无'
  }
  if (row.convertedAmount === null) {
    return '暂无汇率'
  }
  return formatMoney(row.convertedAmount, displayCurrency.value)
}

function promotionDuration(periods: number) {
  if (billingInterval.value === 'year') return periods === 1 ? '首年优惠' : `前 ${periods} 年优惠`
  return periods === 1 ? '首月优惠' : `前 ${periods} 个月优惠`
}

function formatPromotionDeadline(expiresAt: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
  }).format(new Date(expiresAt))
}

async function applyClaudeProxy() {
  claudeProxyUrl.value = claudeProxyUrl.value.trim()
  window.localStorage.setItem('sub-prices:claude-proxy', claudeProxyUrl.value)
  await reloadPricing(true)
  showClaudeProxyModal.value = false
}

async function clearClaudeProxy() {
  claudeProxyUrl.value = ''
  window.localStorage.removeItem('sub-prices:claude-proxy')
  await reloadPricing(true)
  showClaudeProxyModal.value = false
}
</script>

<template>
  <div class="min-h-dvh bg-stone-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
    <header class="sticky top-0 z-20 border-b border-zinc-200 bg-stone-50/90 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/90">
      <div class="mx-auto flex min-h-14 max-w-7xl items-center justify-between gap-4 px-4 py-2 sm:px-6">
        <div class="flex min-w-0 items-baseline gap-3">
          <h1 class="truncate text-sm font-semibold tracking-normal text-zinc-900 dark:text-zinc-50">Sub Prices</h1>
          <p class="hidden truncate text-xs text-zinc-400 dark:text-zinc-500 sm:block">AI 订阅价格对比</p>
        </div>

        <div class="flex shrink-0 items-center gap-1.5">
          <button class="icon-button" :aria-label="isDark ? '切换到浅色模式' : '切换到深色模式'" @click="toggleTheme">
            <Sun v-if="isDark" :size="17" />
            <Moon v-else :size="17" />
          </button>

          <button class="icon-button" aria-label="刷新价格" :disabled="isLoading" @click="reloadPricing(true)">
            <RefreshCw :size="17" :class="{ 'animate-spin': isLoading }" />
          </button>

          <a
            class="icon-button"
            href="https://github.com/easy-sub/sub-prices"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub 项目仓库"
            title="GitHub 项目仓库"
          >
            <Github :size="17" />
          </a>
        </div>
      </div>
    </header>

    <main class="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6">
      <section class="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
        <div class="flex flex-col gap-3">
          <div class="flex min-w-0 items-center gap-2">
            <div class="segmented shrink-0" aria-label="价格服务">
              <button
                v-for="item in providers"
                :key="item.key"
                :class="{ active: providerKey === item.key }"
                @click="providerKey = item.key"
              >
                {{ item.label }}
              </button>
            </div>
            <span class="h-5 w-px shrink-0 bg-zinc-200 dark:bg-zinc-700" aria-hidden="true"></span>
            <div class="flex min-w-0 gap-1 overflow-x-auto pb-1">
              <button
                v-for="plan in provider.plans"
                :key="plan.key"
                class="h-8 shrink-0 rounded-lg px-3 text-sm font-medium transition"
                :class="
                  activePlan === plan.key
                    ? 'bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-950'
                    : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
                "
                @click="activePlan = plan.key"
              >
                {{ plan.label }}
              </button>
            </div>
          </div>

        </div>

        <div class="flex flex-wrap items-center gap-2">
          <label v-if="providerKey === 'grok'" class="inline-flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
            <input v-model="usePromotionalPrice" type="checkbox" class="accent-emerald-600" />
            按优惠价比较
          </label>
          <button
            v-if="providerKey === 'claude'"
            class="proxy-config-button"
            type="button"
            aria-label="Claude 代理设置"
            @click="showClaudeProxyModal = true"
          >
            <SlidersHorizontal :size="14" />
          </button>

          <span class="text-xs text-zinc-500 dark:text-zinc-400">账期:</span>
          <div class="segmented">
            <button :class="{ active: billingInterval === 'month' }" @click="billingInterval = 'month'">月付</button>
            <button :class="{ active: billingInterval === 'year' }" @click="billingInterval = 'year'">年付</button>
          </div>

          <label class="currency-select" aria-label="显示币种">
            <span class="currency-select-flag">{{ selectedCurrencyFlag }}</span>
            <select v-model="displayCurrency" class="select-control">
              <option v-for="currency in displayCurrencies" :key="currency.code" :value="currency.code">
                {{ currency.code }}
              </option>
            </select>
          </label>
        </div>
      </section>

      <p v-if="providerKey === 'grok'" class="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
        {{ billingInterval === 'year' ? '年付价格按月折算。' : '月付价格按每月展示。' }}
        {{ usePromotionalPrice ? '按有效优惠首期价格排名，无优惠时使用原价。' : '按正常续费价格排名。' }}
        各地区优惠期数可能不同；优惠资格及最终税费以结算页为准。
      </p>

      <section class="grid gap-4 lg:grid-cols-[1fr_18rem] lg:items-start">
        <div class="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div class="flex flex-col gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p class="text-sm font-medium">{{ provider.label }} {{ planLabel }}</p>
              <p class="text-xs text-zinc-500 dark:text-zinc-400">
                {{ loadError ? '数据加载失败' : `已加载 ${configs.size}/${totalCountries || '…'} 个国家/地区` }}
                <span v-if="isLoading"> · 正在加载价格</span>
                <span v-if="failedCountries.length"> · {{ failedCountries.length }} 个国家/地区加载失败，价格排名暂停</span>
                <span v-if="exchangeLoading"> · 汇率更新中</span>
                <span v-else-if="!exchangeRates"> · 汇率未加载，价格排名暂停</span>
                <span v-else-if="missingRateCount"> · {{ missingRateCount }} 个价格缺少汇率，价格排名暂停</span>
              </p>
            </div>

            <button class="sort-button" @click="sortDirection = sortDirection === 'ascending' ? 'descending' : 'ascending'">
              {{ displayCurrency }}
              <ArrowUp v-if="sortDirection === 'ascending'" :size="14" />
              <ArrowDown v-else :size="14" />
            </button>
          </div>

          <div v-if="isLoading && rows.length === 0" class="flex min-h-80 items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
            正在加载价格...
          </div>

          <div v-else-if="loadError" class="flex min-h-80 flex-col items-center justify-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
            <AlertCircle :size="28" />
            数据加载失败，请刷新重试
          </div>

          <div v-else-if="rows.length === 0" class="flex min-h-80 flex-col items-center justify-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
            <AlertCircle :size="28" />
            暂无可展示的价格数据
          </div>

          <div v-else class="overflow-x-auto">
            <table class="w-full min-w-[42rem] text-sm">
              <thead class="bg-zinc-100 text-xs uppercase text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
                <tr>
                  <th class="w-16 px-4 py-3 text-left font-medium">Rank</th>
                  <th class="px-4 py-3 text-left font-medium">国家/地区</th>
                  <th class="px-4 py-3 text-left font-medium">原币价格</th>
                  <th class="px-4 py-3 text-left font-medium">换算价格</th>
                  <th class="px-4 py-3 text-left font-medium">状态</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in rows"
                  :key="row.countryCode"
                  class="border-t border-zinc-100 transition hover:bg-stone-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50"
                >
                  <td class="px-4 py-3 font-mono text-xs text-zinc-500">{{ rankingReady && row.convertedAmount !== null ? row.rank : '-' }}</td>
                  <td class="px-4 py-3">
                    <span class="inline-flex items-center gap-2 font-medium">
                      <span class="w-5">{{ row.flag }}</span>
                      {{ row.countryName }}
                      <span class="text-xs text-zinc-400">{{ row.countryCode }}</span>
                    </span>
                  </td>
                  <td class="px-4 py-3 text-zinc-600 dark:text-zinc-300">
                    <span class="inline-flex flex-wrap items-center gap-1.5">
                      <span class="font-mono">{{ formatOriginal(row) }}</span>
                      <span v-if="row.taxIncluded" class="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-400/10 dark:text-amber-300">含税</span>
                      <span v-else-if="providerKey === 'grok' && row.originalAmount !== null" class="text-[11px] text-zinc-400">未含税</span>
                    </span>
                    <div v-if="row.promotion" class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      <span v-if="usePromotionalPrice" class="line-through">{{ formatMoney(row.regularAmount!, row.currencyCode) }}</span>
                      <span v-else>{{ promotionDuration(row.promotion.durationPeriods) }} {{ formatMoney(row.promotion.amount, row.currencyCode) }}</span>
                      <span v-if="usePromotionalPrice"> · {{ promotionDuration(row.promotion.durationPeriods) }}</span>
                    </div>
                  </td>
                  <td class="px-4 py-3 font-mono font-semibold">{{ formatConverted(row) }}</td>
                  <td class="px-4 py-3">
                    <div v-if="row.promotion" class="mb-1 text-xs leading-relaxed text-emerald-700 dark:text-emerald-300">
                      {{ promotionDuration(row.promotion.durationPeriods) }}，之后恢复原价<br />
                      {{ formatPromotionDeadline(row.promotion.expiresAt) }} 截止
                    </div>
                    <div class="flex flex-wrap items-center gap-1.5">
                      <span
                        v-if="lowestRow?.countryCode === row.countryCode"
                        class="rounded-md bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300"
                      >
                        最低
                      </span>
                      <span
                        v-if="row.taxPercent"
                        class="rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 dark:bg-blue-400/15 dark:text-blue-300"
                      >
                        含 {{ row.taxPercent }}% 税估算
                      </span>
                      <span v-if="lowestRow?.countryCode !== row.countryCode && !row.taxPercent" class="text-xs text-zinc-400">-</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <aside class="grid gap-4">
          <div class="summary-panel">
            <p class="panel-label">最低价格</p>
            <template v-if="lowestRow">
              <p class="font-mono text-2xl font-semibold">{{ formatConverted(lowestRow) }}</p>
              <p class="text-sm text-zinc-600 dark:text-zinc-400">
                {{ lowestRow.flag }} {{ lowestRow.countryName }}
              </p>
              <p v-if="lowestRow.taxPercent" class="mt-2 text-xs font-medium text-blue-600 dark:text-blue-300">
                已含 {{ lowestRow.taxPercent }}% 税估算
              </p>
              <p
                v-if="savingsPercent > 0"
                class="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-300"
              >
                <TrendingDown :size="14" />
                比美国{{ providerKey === 'grok' && usePromotionalPrice ? '同口径价格' : '原价' }}低 {{ savingsPercent }}%
              </p>
            </template>
            <p v-else class="text-sm text-zinc-500">{{ failedCountries.length ? '国家价格数据不完整' : '暂无可比价格' }}</p>
          </div>

          <div class="summary-panel">
            <p class="panel-label">价格分布</p>
            <div v-if="distributionRows.length > 0" class="flex flex-col gap-1.5">
              <div
                v-for="row in distributionRows"
                :key="`distribution-${row.countryCode}`"
                class="grid grid-cols-[1.75rem_1fr_4.5rem] items-center gap-2"
              >
                <span class="font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                  {{ row.flag || row.countryCode }}
                </span>
                <div class="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <div
                    class="h-full rounded-full transition-all duration-300"
                    :class="lowestRow?.countryCode === row.countryCode ? 'bg-emerald-500 dark:bg-emerald-400' : 'bg-zinc-300 dark:bg-zinc-600'"
                    :style="{
                      width: `${distributionMax > distributionMin ? ((Number(row.displayAmount) - distributionMin) / (distributionMax - distributionMin)) * 80 + 10 : 50}%`
                    }"
                  />
                </div>
                <span class="truncate text-right font-mono text-[11px] text-zinc-600 dark:text-zinc-400">
                  {{ formatMoney(Number(row.displayAmount), displayCurrency) }}
                </span>
              </div>
            </div>
            <p v-else class="text-sm text-zinc-500">暂无数据</p>
          </div>
        </aside>
      </section>
    </main>

    <div v-if="showClaudeProxyModal" class="modal-backdrop" @click.self="showClaudeProxyModal = false">
      <section class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="claude-proxy-title">
        <div class="flex items-center justify-between gap-4 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <h2 id="claude-proxy-title" class="text-sm font-semibold">Claude 代理设置</h2>
          <button class="icon-button" type="button" aria-label="关闭" @click="showClaudeProxyModal = false">
            <X :size="16" />
          </button>
        </div>

        <div class="flex flex-col gap-4 p-4">
          <label class="flex flex-col gap-2">
            <span class="text-xs font-medium text-zinc-500 dark:text-zinc-400">代理地址</span>
            <input
              v-model="claudeProxyUrl"
              class="proxy-input"
              placeholder="https://proxy.example.com:8443"
              spellcheck="false"
              @keyup.enter="applyClaudeProxy"
            />
          </label>

          <div class="flex justify-end gap-2">
            <button class="proxy-button ghost" type="button" :disabled="isLoading || !claudeProxyUrl" @click="clearClaudeProxy">
              清空
            </button>
            <button class="proxy-button" type="button" :disabled="isLoading" @click="applyClaudeProxy">
              应用
            </button>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
