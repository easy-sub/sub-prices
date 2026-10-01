export function countryFlag(countryCode: string) {
  if (countryCode.length !== 2 || !/^[A-Z]{2}$/.test(countryCode)) {
    return ''
  }

  const base = 127397
  return String.fromCodePoint(countryCode.charCodeAt(0) + base, countryCode.charCodeAt(1) + base)
}

export function formatMoney(amount: number, currencyCode: string, locale = 'zh-CN') {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currencyCode,
      maximumFractionDigits: currencyCode === 'JPY' ? 0 : 2
    }).format(amount)
  } catch {
    return `${currencyCode} ${amount.toFixed(2)}`
  }
}

export function getCountryName(countryCode: string, locale = 'zh-CN') {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(countryCode) ?? countryCode
  } catch {
    return countryCode
  }
}
