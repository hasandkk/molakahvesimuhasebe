const longFmt = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  weekday: 'long',
})

const shortFmt = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' })

/** Tarayıcının yerel saatine göre YYYY-MM-DD (UTC kaymasını önler). */
export function toISODate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function today(): string {
  return toISODate(new Date())
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d + days)
  return toISODate(date)
}

export function tomorrow(): string {
  return addDays(today(), 1)
}

export function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`
}

/** Haftanın başı — pazartesi. */
export function startOfWeek(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const day = date.getDay() // 0 = pazar
  const back = day === 0 ? 6 : day - 1
  return addDays(iso, -back)
}

/** Verilen tarihin haftasındaki 7 gün (pazartesiden pazara). */
export function weekDays(iso: string): string[] {
  const start = startOfWeek(iso)
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

function toDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** "14 Ağustos 2026 Cuma" */
export function formatLong(iso: string): string {
  const parts = longFmt.formatToParts(toDate(iso))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('day')} ${get('month')} ${get('year')} ${get('weekday')}`
}

/** "14.08.2026" */
export function formatShort(iso: string): string {
  return shortFmt.format(toDate(iso))
}

const weekdayFmt = new Intl.DateTimeFormat('tr-TR', { weekday: 'short' })
const dayMonthFmt = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' })

/** "Pzt" */
export function formatWeekday(iso: string): string {
  return weekdayFmt.format(toDate(iso))
}

/** "11 Ağu" */
export function formatDayMonth(iso: string): string {
  return dayMonthFmt.format(toDate(iso))
}

/** Ayın son günü. */
export function endOfMonth(iso: string): string {
  const [y, m] = iso.split('-').map(Number)
  // Bir sonraki ayın 0. günü = bu ayın son günü
  return toISODate(new Date(y, m, 0))
}

/** Ay ekle/çıkar; gün her zaman ayın 1'ine sabitlenir. */
export function addMonths(iso: string, months: number): string {
  const [y, m] = iso.split('-').map(Number)
  return toISODate(new Date(y, m - 1 + months, 1))
}

const monthFmt = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' })

/** "Eylül 2026" */
export function formatMonth(iso: string): string {
  return monthFmt.format(toDate(iso))
}
