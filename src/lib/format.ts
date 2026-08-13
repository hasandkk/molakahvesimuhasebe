const moneyFmt = new Intl.NumberFormat('tr-TR', {
  style: 'currency',
  currency: 'TRY',
  maximumFractionDigits: 2,
})

const numFmt = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 3 })

export function money(value: number | null | undefined): string {
  return moneyFmt.format(Number(value ?? 0))
}

export function qty(value: number | null | undefined): string {
  return numFmt.format(Number(value ?? 0))
}

/** "12,5" ve "12.5" girişlerinin ikisini de kabul eder. */
export function parseNumber(input: string): number {
  const normalized = input.replace(/\s/g, '').replace(',', '.')
  if (normalized === '') return 0
  const value = Number(normalized)
  return Number.isFinite(value) ? value : 0
}
