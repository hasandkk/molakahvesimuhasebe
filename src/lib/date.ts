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
