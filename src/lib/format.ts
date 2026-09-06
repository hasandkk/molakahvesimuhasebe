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

/**
 * Türkçe yazılmış sayıyı okur.
 *
 * Önceki sürüm sadece virgülü noktaya çeviriyordu; bu yüzden Türkçe binlik
 * ayıracı olan nokta ondalık sanılıyordu:
 *   "1.500"     -> 1,5     (1500 yazılmak istenmişti)
 *   "1.500,50"  -> NaN -> 0  ("Tutar 0 olamaz" hatası veriyordu)
 *
 * Kurallar:
 *   • Hem nokta hem virgül varsa, SONDAKİ ondalık ayıracıdır; diğeri binlik.
 *   • Sadece virgül varsa ondalık ayıracıdır.        "1500,50" -> 1500.5
 *   • Sadece nokta varsa: "1.500" / "1.500.000" gibi tam binlik kalıbına
 *     uyuyorsa binlik ayıracıdır, uymuyorsa ondalık.
 *       "1.500"   -> 1500      "1.5"  -> 1.5
 *       "1.500.000" -> 1500000 "12.5" -> 12.5
 *
 * Geçersiz girdide NaN döner — çağıran taraf ayırt edebilsin diye.
 * Boş girdi 0'dır.
 */
function toNumber(input: string): number {
  // Boşluk, ₺ ve benzeri her şeyi at; rakam, ayıraç ve eksi kalsın.
  const cleaned = input.replace(/[^\d.,-]/g, '')
  // Girdi boşsa 0; doluyken temizlenince hiç rakam kalmadıysa geçersiz.
  if (cleaned === '') return input.trim() === '' ? 0 : NaN

  const negative = cleaned.startsWith('-')
  const body = cleaned.replace(/-/g, '')
  if (body === '') return NaN

  const lastDot = body.lastIndexOf('.')
  const lastComma = body.lastIndexOf(',')

  let normalized: string
  if (lastDot >= 0 && lastComma >= 0) {
    // İkisi de var: sondaki ondalık, diğeri binlik.
    const decimalAt = Math.max(lastDot, lastComma)
    const thousandsChar = decimalAt === lastDot ? ',' : '.'
    normalized =
      body.slice(0, decimalAt).split(thousandsChar).join('') + '.' + body.slice(decimalAt + 1)
  } else if (lastComma >= 0) {
    normalized = body.split(',').join('.')
  } else if (lastDot >= 0) {
    // Tam binlik kalıbı mı? "1.500", "12.500", "1.500.000"
    normalized = /^\d{1,3}(\.\d{3})+$/.test(body) ? body.split('.').join('') : body
  } else {
    normalized = body
  }

  const value = Number(normalized)
  if (!Number.isFinite(value)) return NaN
  return negative ? -value : value
}

/** Boş ve geçersiz girdide 0 döner. Miktar alanları için. */
export function parseNumber(input: string): number {
  const value = toNumber(input)
  return Number.isFinite(value) ? value : 0
}

/**
 * Para alanları için: boş ya da anlaşılmayan girdide `null` döner.
 * Böylece form "0 yazdın" ile "yazdığını anlayamadım" arasında ayrım
 * yapıp doğru hatayı gösterebiliyor.
 */
export function parseAmount(input: string): number | null {
  if (input.trim() === '') return null
  const value = toNumber(input)
  return Number.isFinite(value) ? value : null
}
