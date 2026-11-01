import protocol from './grok-protocol.json' with { type: 'json' }

// 协议子集来自 autoSub 的 commerce_descriptor.go；只查询目录，不创建购物车。
const skuPlans = {
  sku_ToYBWq565pLU: 'plus',
  sku_iFHd43ge7daR: 'premium',
  sku_WWvZ1VL9fabh: 'super',
  sku_kO0knmcEPYnA: 'ultra'
}

export const grokCountries = [
  'AE', 'AR', 'AT', 'AU', 'BE', 'BR', 'CA', 'CH', 'CL', 'CO', 'CZ', 'DE', 'DK', 'ES',
  'FI', 'FR', 'GB', 'HU', 'ID', 'IE', 'IL', 'IN', 'IT', 'JP', 'KR', 'MX', 'MY', 'NL',
  'NO', 'NZ', 'PH', 'PL', 'PT', 'RO', 'SA', 'SE', 'SG', 'TH', 'TR', 'TW', 'US', 'VN', 'ZA'
]

export function grokPricingRequest(country) {
  const payload = Buffer.concat([
    encodeField(1, protocol.productTypeXpass),
    ...Object.keys(skuPlans).map((sku) => encodeField(2, sku)),
    encodeField(3, country),
    encodeField(4, 1)
  ])
  const frame = Buffer.alloc(5)
  frame.writeUInt32BE(payload.length, 1)
  return Buffer.concat([frame, payload])
}

export function decodeGrokPricing(body, headers = {}) {
  let payload
  let status = headers['grpc-status']
  let trailerSeen = false
  for (let offset = 0; offset < body.length;) {
    if (offset + 5 > body.length) throw new Error('Incomplete Grok frame')
    const flag = body[offset]
    const size = body.readUInt32BE(offset + 1)
    offset += 5
    if (offset + size > body.length || trailerSeen) throw new Error('Invalid Grok frame')
    const chunk = body.subarray(offset, offset + size)
    offset += size
    if (flag === 128) {
      trailerSeen = true
      const trailerStatus = chunk.toString().match(/(?:^|\r\n)grpc-status:\s*(\d+)/i)?.[1]
      if (trailerStatus === undefined) throw new Error('Missing Grok trailer status')
      if (status !== undefined && status !== trailerStatus) throw new Error('Conflicting Grok status')
      status = trailerStatus
    } else if (flag === 0 && !payload) {
      payload = chunk
    } else {
      throw new Error('Unsupported Grok frame')
    }
  }
  if (status !== '0' || !payload) throw new Error('Grok pricing request failed')
  const response = decodeMessage(payload, 'MultiGetSkuPricingsResponse')
  if (response.error) throw new Error('Grok pricing business error')
  return response
}

export function normalizeGrokPricing(response, country, now = Date.now()) {
  const plans = {}
  let currency
  for (const sku of response.sku_pricings ?? []) {
    const key = skuPlans[sku.sku_id]
    const pricing = sku.pricing
    const details = pricing?.details
    const interval = details?.interval
    if (!key || sku.display_only || pricing.sku_id !== sku.sku_id ||
      pricing.status !== 'PRICING_STATUS_ACTIVE' || details.country !== country ||
      details.billing_platform !== 'BILLING_PLATFORM_STRIPE' || interval?.count !== 1) continue
    const period = interval.unit === 'UNIT_MONTH' ? 'month' : interval.unit === 'UNIT_YEAR' ? 'year' : null
    const amount = moneyAmount(details.amount)
    const code = details.amount?.currency_code
    if (!period || amount === null || !/^[A-Z]{3}$/.test(code ?? '')) continue
    if (currency && currency !== code) throw new Error('Mixed Grok currencies')
    currency = code
    // 页面年付价格统一按月展示；优惠期数仍按上游的计费周期保留。
    const divisor = period === 'year' ? 12 : 1
    const price = { amount: amount / divisor }
    if (details.tax_behavior === 'TAX_BEHAVIOR_INCLUSIVE') price.tax = 'inclusive'
    if (details.tax_behavior === 'TAX_BEHAVIOR_EXCLUSIVE') price.tax = 'exclusive'
    for (const benefit of sku.benefits ?? []) {
      const discount = benefit.value?.discount
      const promoAmount = moneyAmount(benefit.first_cycle_amount)
      const expiresAt = Number(benefit.redeem_by?.seconds) * 1000
      if (!benefit.benefit_id || !discount || !Number.isInteger(discount.times) || discount.times <= 0 ||
        !Number.isFinite(expiresAt) || expiresAt <= now || promoAmount === null ||
        promoAmount >= amount || benefit.first_cycle_amount.currency_code !== code) continue
      // 使用上游首期金额，保留各币种的优惠取整规则。
      const promotion = {
        amount: promoAmount / divisor,
        durationPeriods: discount.times,
        expiresAt: new Date(expiresAt).toISOString()
      }
      if (!price.promotion || promotion.amount < price.promotion.amount) price.promotion = promotion
    }
    plans[key] ??= {}
    plans[key][period] = price
  }
  if (!currency) throw new Error('No Grok prices for requested country')
  const symbol = new Intl.NumberFormat('en-US', {
    style: 'currency', currency, currencyDisplay: 'narrowSymbol'
  }).formatToParts(0).find((part) => part.type === 'currency')?.value ?? currency
  return { country_code: country, currency_config: { symbol_code: currency, symbol, ...plans } }
}

function moneyAmount(money) {
  const micros = money?.unit_micros
  return Number.isSafeInteger(micros) && micros > 0 ? micros / 1_000_000 : null
}

function encodeVarint(value) {
  const bytes = []
  do {
    bytes.push((value & 127) | (value > 127 ? 128 : 0))
    value = Math.floor(value / 128)
  } while (value)
  return Buffer.from(bytes)
}

function encodeField(number, value) {
  if (typeof value === 'number') return Buffer.concat([encodeVarint(number * 8), encodeVarint(value)])
  const bytes = Buffer.from(value)
  return Buffer.concat([encodeVarint(number * 8 + 2), encodeVarint(bytes.length), bytes])
}

function decodeMessage(bytes, name) {
  const schema = protocol.messages[name]
  const result = {}
  let offset = 0
  const readVarint = () => {
    let value = 0n
    for (let shift = 0n; shift < 70n && offset < bytes.length; shift += 7n) {
      const byte = bytes[offset++]
      value |= BigInt(byte & 127) << shift
      if (byte < 128) return Number(value)
    }
    throw new Error('Invalid Grok varint')
  }
  while (offset < bytes.length) {
    const tag = readVarint()
    const field = schema[Math.floor(tag / 8)]
    const wire = tag & 7
    let value
    if (wire === 0) value = readVarint()
    else if ([1, 2, 5].includes(wire)) {
      const size = wire === 2 ? readVarint() : wire === 1 ? 8 : 4
      if (!Number.isSafeInteger(size) || size < 0 || offset + size > bytes.length) throw new Error('Truncated Grok field')
      value = bytes.subarray(offset, offset + size)
      offset += size
    } else throw new Error('Unsupported Grok field')
    if (!field) continue
    const [key, type, repeated] = field
    const expectedWire = type === 'double' ? 1 : type === 'string' || protocol.messages[type] ? 2 : 0
    if (wire !== expectedWire) throw new Error('Invalid Grok field type')
    if (type === 'string') value = value.toString()
    else if (type === 'double') value = value.readDoubleLE()
    else if (type === 'bool') value = Boolean(value)
    else if (protocol.messages[type]) value = decodeMessage(value, type)
    else if (protocol.enums[type]) value = protocol.enums[type][value] ?? value
    if (repeated) (result[key] ??= []).push(value)
    else result[key] = value
  }
  return result
}
