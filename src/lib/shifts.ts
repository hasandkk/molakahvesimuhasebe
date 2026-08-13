/**
 * Vardiya saatleri için aralık hesabı.
 *
 * Aynı kişinin aynı gün iki ayrı standa yazılması normaldir (sabah birinde,
 * akşam diğerinde). Yasak olan, saatlerin ÇAKIŞMASI. Bitişik vardiyalar
 * (12:00'de biten ve 12:00'de başlayan) çakışma sayılmaz.
 */

const toMinutes = (time: string) => {
  const [h, m] = time.split(':').map(Number)
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN
}

export type Range = readonly [number, number]

/** "08:00","15:30" -> [480, 930]. Gece yarısını aşan vardiya desteklenir. */
export function rangeOf(start: string, end: string): Range | null {
  if (!start || !end) return null
  const s = toMinutes(start)
  let e = toMinutes(end)
  if (Number.isNaN(s) || Number.isNaN(e)) return null
  if (e <= s) e += 24 * 60 // 23:00–02:00 gibi
  return [s, e]
}

export function overlaps(a: Range, b: Range): boolean {
  return a[0] < b[1] && b[0] < a[1]
}
