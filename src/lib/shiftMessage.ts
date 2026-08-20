import { formatLong } from './date'
import type { ShiftAssignment, ShiftKind, Stand } from './types'

/** Postgres "08:00:00" -> "08:00"; eğitim kayıtlarında saat boş olabilir. */
export const hhmm = (time: string | null) => (time ? time.slice(0, 5) : '')

/** Aynı stand içinde aynı tür ve saatte olanlar tek satırda toplanır. */
export type ShiftGroup = {
  id: string
  kind: ShiftKind
  start: string
  end: string
  items: ShiftAssignment[]
}

export function groupLabel(g: ShiftGroup) {
  const range = g.start && g.end ? `${g.start}–${g.end}` : null
  if (g.kind === 'egitim') return range ? `Eğitim · ${range}` : 'Eğitim'
  return range ?? 'Saat girilmemiş'
}

/**
 * Atamaları stand > (tür + saat) şeklinde gruplar.
 *
 * `timesOf` Vardiya ekranı için var: orada saatler kaydedilmeden önce
 * ekranda düzenlenebiliyor, gruplama kaydedilmiş değil düzenlenmiş saate
 * göre yapılmalı. Başka yerlerde verilmez, kayıtlı saat kullanılır.
 */
export function groupByStand(
  list: ShiftAssignment[],
  nameOf: (a: ShiftAssignment) => string,
  timesOf: (a: ShiftAssignment) => { start: string; end: string } = (a) => ({
    start: hhmm(a.start_time),
    end: hhmm(a.end_time),
  }),
): Map<string, ShiftGroup[]> {
  const map = new Map<string, ShiftGroup[]>()
  for (const a of list) {
    const t = timesOf(a)
    const key = `${a.kind}|${t.start}|${t.end}`
    const groups = map.get(a.stand_id) ?? []
    const found = groups.find((g) => g.id === key)
    if (found) found.items.push(a)
    else groups.push({ id: key, kind: a.kind, start: t.start, end: t.end, items: [a] })
    map.set(a.stand_id, groups)
  }
  for (const groups of map.values()) {
    groups.sort((a, b) => {
      const byKind = (a.kind === 'egitim' ? 1 : 0) - (b.kind === 'egitim' ? 1 : 0)
      return byKind !== 0 ? byKind : a.start.localeCompare(b.start)
    })
    for (const g of groups) g.items.sort((x, y) => nameOf(x).localeCompare(nameOf(y), 'tr'))
  }
  return map
}

/**
 * Sohbet grubuna atılacak metin. `stands` tek stand içeriyorsa o standın
 * kendi grubuna atılacak mesaj, hepsini içeriyorsa toplu mesaj çıkar.
 */
export function buildShiftMessage(
  date: string,
  stands: Stand[],
  groupsByStand: Map<string, ShiftGroup[]>,
  nameOf: (a: ShiftAssignment) => string,
): string {
  const lines = [`📅 ${formatLong(date)} — Vardiya Planı`, '']
  for (const stand of stands) {
    lines.push(`☕ ${stand.name}`)
    const groups = groupsByStand.get(stand.id) ?? []
    if (groups.length === 0) lines.push('(kimse atanmadı)')
    else for (const g of groups) lines.push(`${groupLabel(g)} · ${g.items.map(nameOf).join(', ')}`)
    lines.push('')
  }
  return lines.join('\n').trim()
}
