import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useQuery } from '../lib/useQuery'
import { addDays, formatLong, tomorrow } from '../lib/date'
import { SHIFT_PRESETS, type Employee, type ShiftAssignment, type Stand } from '../lib/types'
import { Button, Card, DateNav, Empty, ErrorBox, Select, Spinner, Tabs } from '../components/ui'

type Data = { stands: Stand[]; employees: Employee[]; assignments: ShiftAssignment[] }
type PresetId = (typeof SHIFT_PRESETS)[number]['id'] | 'ozel'

/** Postgres "08:00:00" -> "08:00" */
const hhmm = (time: string) => time.slice(0, 5)

async function load(date: string): Promise<Data> {
  const [stands, employees, assignments] = await Promise.all([
    supabase.from('stands').select('*').eq('is_active', true).order('sort_order').order('name'),
    supabase.from('employees').select('*').eq('is_active', true).order('full_name'),
    supabase.from('shift_assignments').select('*').eq('work_date', date),
  ])
  const err = stands.error ?? employees.error ?? assignments.error
  if (err) throw err
  return {
    stands: (stands.data ?? []) as Stand[],
    employees: (employees.data ?? []) as Employee[],
    assignments: (assignments.data ?? []) as ShiftAssignment[],
  }
}

export default function Shifts() {
  const [date, setDate] = useState(tomorrow())
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const { data, loading, error, reload } = useQuery(() => load(date), [date])

  // Eklenecek vardiyanın saatleri
  const [preset, setPreset] = useState<PresetId>('sabah')
  const [customStart, setCustomStart] = useState('08:00')
  const [customEnd, setCustomEnd] = useState('15:30')

  // Satır bazında düzenlenen saatler; sunucuya yazılırken ekran titremesin diye
  // yerel olarak da tutuluyor.
  const [timeEdits, setTimeEdits] = useState<Record<string, { start: string; end: string }>>({})
  useEffect(() => setTimeEdits({}), [date])

  const newShift = useMemo(() => {
    if (preset === 'ozel') return { start: customStart, end: customEnd }
    const found = SHIFT_PRESETS.find((p) => p.id === preset)!
    return { start: found.start, end: found.end }
  }, [preset, customStart, customEnd])

  const timesOf = useMemo(() => {
    return (a: ShiftAssignment) =>
      timeEdits[a.id] ?? { start: hhmm(a.start_time), end: hhmm(a.end_time) }
  }, [timeEdits])

  const employeeById = useMemo(() => {
    const map = new Map<string, Employee>()
    for (const e of data?.employees ?? []) map.set(e.id, e)
    return map
  }, [data])

  const byStand = useMemo(() => {
    const map = new Map<string, ShiftAssignment[]>()
    for (const a of data?.assignments ?? []) {
      const list = map.get(a.stand_id) ?? []
      list.push(a)
      map.set(a.stand_id, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        const byTime = timesOf(a).start.localeCompare(timesOf(b).start)
        if (byTime !== 0) return byTime
        return (employeeById.get(a.employee_id)?.full_name ?? '').localeCompare(
          employeeById.get(b.employee_id)?.full_name ?? '',
          'tr',
        )
      })
    }
    return map
  }, [data, employeeById, timesOf])

  /** Aynı vardiya saatinde başka bir standa yazılmış olanlar tekrar önerilmez. */
  const takenInNewShift = useMemo(() => {
    const set = new Set<string>()
    for (const a of data?.assignments ?? []) {
      if (timesOf(a).start === newShift.start) set.add(a.employee_id)
    }
    return set
  }, [data, newShift, timesOf])

  const shareText = useMemo(() => {
    if (!data) return ''
    const lines = [`📅 ${formatLong(date)} — Vardiya Planı`, '']
    for (const stand of data.stands) {
      const list = byStand.get(stand.id) ?? []
      lines.push(`☕ ${stand.name}`)
      if (list.length === 0) {
        lines.push('• (kimse atanmadı)')
      } else {
        for (const a of list) {
          const t = timesOf(a)
          const name = employeeById.get(a.employee_id)?.full_name ?? '—'
          lines.push(`• ${t.start}-${t.end}  ${name}`)
        }
      }
      lines.push('')
    }
    return lines.join('\n').trim()
  }, [data, date, byStand, employeeById, timesOf])

  async function run(fn: () => Promise<{ error: unknown }>) {
    setBusy(true)
    setActionError(null)
    const { error } = await fn()
    if (error) setActionError(error instanceof Error ? error.message : String(error))
    else await reload()
    setBusy(false)
  }

  async function addAssignment(standId: string, employeeId: string) {
    if (!employeeId) return
    await run(async () =>
      supabase.from('shift_assignments').insert({
        work_date: date,
        stand_id: standId,
        employee_id: employeeId,
        start_time: newShift.start,
        end_time: newShift.end,
      }),
    )
  }

  async function removeAssignment(id: string) {
    await run(async () => supabase.from('shift_assignments').delete().eq('id', id))
  }

  async function changeTime(a: ShiftAssignment, field: 'start' | 'end', value: string) {
    if (!value) return
    const next = { ...timesOf(a), [field]: value }
    setTimeEdits((prev) => ({ ...prev, [a.id]: next }))
    setActionError(null)
    const { error } = await supabase
      .from('shift_assignments')
      .update(field === 'start' ? { start_time: value } : { end_time: value })
      .eq('id', a.id)
    if (error) setActionError(error.message)
  }

  async function copyPreviousDay() {
    setBusy(true)
    setActionError(null)
    const prev = addDays(date, -1)
    const { data: prevRows, error: readError } = await supabase
      .from('shift_assignments')
      .select('stand_id, employee_id, role, start_time, end_time')
      .eq('work_date', prev)

    if (readError) {
      setActionError(readError.message)
      setBusy(false)
      return
    }
    if (!prevRows || prevRows.length === 0) {
      setActionError(`${formatLong(prev)} için kayıtlı vardiya yok.`)
      setBusy(false)
      return
    }

    const { error: insertError } = await supabase
      .from('shift_assignments')
      .upsert(
        prevRows.map((r) => ({ ...r, work_date: date })),
        { onConflict: 'work_date,stand_id,employee_id,start_time', ignoreDuplicates: true },
      )

    if (insertError) setActionError(insertError.message)
    else {
      setTimeEdits({})
      await reload()
    }
    setBusy(false)
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(shareText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setActionError('Panoya kopyalanamadı, metni elle seçip kopyalayabilirsin.')
    }
  }

  const timeInputClass =
    'rounded-lg border border-stone-300 bg-white px-2 py-1 text-xs tabular-nums text-stone-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20'

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-stone-900">Vardiya Planı</h1>
          <p className="text-sm text-stone-500">{formatLong(date)}</p>
        </div>
        <div className="w-full sm:w-72">
          <DateNav value={date} onChange={setDate} />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => setDate(tomorrow())}>
          Yarın
        </Button>
        <Button variant="secondary" size="sm" onClick={() => void copyPreviousDay()} disabled={busy}>
          Bir önceki günü kopyala
        </Button>
      </div>

      <Card title="Eklenecek vardiya">
        <Tabs
          active={preset}
          onChange={setPreset}
          tabs={[
            { id: 'sabah' as PresetId, label: 'Sabah 08:00–15:30' },
            { id: 'aksam' as PresetId, label: 'Akşam 15:30–23:00' },
            { id: 'ozel' as PresetId, label: 'Özel saat' },
          ]}
        />
        {preset === 'ozel' && (
          <div className="mt-3 flex items-center gap-2">
            <input
              type="time"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className={timeInputClass}
            />
            <span className="text-stone-400">–</span>
            <input
              type="time"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className={timeInputClass}
            />
          </div>
        )}
        <p className="mt-2 text-xs text-stone-500">
          Aşağıda eklediğin kişiler bu saatlerle kaydedilir. Ekledikten sonra her satırın saatini
          tek tek değiştirebilirsin.
        </p>
      </Card>

      {error && <ErrorBox message={error} />}
      {actionError && <ErrorBox message={actionError} />}
      {loading && !data && <Spinner />}

      {data && data.stands.length === 0 && (
        <Card>
          <Empty>Henüz stand tanımlanmamış. “Tanımlar” ekranından stand ekle.</Empty>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {data?.stands.map((stand) => {
          const list = byStand.get(stand.id) ?? []
          const available = data.employees.filter((e) => !takenInNewShift.has(e.id))
          return (
            <Card
              key={stand.id}
              title={stand.name}
              action={<span className="text-xs text-stone-500">{list.length} kişi</span>}
            >
              <ul className="space-y-2">
                {list.length === 0 && <Empty>Kimse atanmadı</Empty>}
                {list.map((a) => {
                  const t = timesOf(a)
                  return (
                    <li key={a.id} className="rounded-xl bg-stone-50 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-stone-800">
                          {employeeById.get(a.employee_id)?.full_name ?? '—'}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void removeAssignment(a.id)}
                          disabled={busy}
                          aria-label="Çıkar"
                        >
                          ✕
                        </Button>
                      </div>
                      <div className="mt-1 flex items-center gap-1.5">
                        <input
                          type="time"
                          value={t.start}
                          onChange={(e) => void changeTime(a, 'start', e.target.value)}
                          className={timeInputClass}
                          aria-label="Başlangıç saati"
                        />
                        <span className="text-stone-400">–</span>
                        <input
                          type="time"
                          value={t.end}
                          onChange={(e) => void changeTime(a, 'end', e.target.value)}
                          className={timeInputClass}
                          aria-label="Bitiş saati"
                        />
                      </div>
                    </li>
                  )
                })}
              </ul>

              <Select
                className="mt-3"
                value=""
                disabled={busy || available.length === 0}
                onChange={(e) => void addAssignment(stand.id, e.target.value)}
              >
                <option value="">
                  {available.length === 0
                    ? 'Bu vardiyada boşta çalışan kalmadı'
                    : `+ Çalışan ekle (${newShift.start}–${newShift.end})…`}
                </option>
                {available.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.full_name}
                  </option>
                ))}
              </Select>
            </Card>
          )
        })}
      </div>

      {data && data.stands.length > 0 && (
        <Card
          title="Gruba atılacak mesaj"
          action={
            <Button size="sm" onClick={() => void copyText()}>
              {copied ? '✓ Kopyalandı' : 'Metni kopyala'}
            </Button>
          }
        >
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl bg-stone-50 p-3 font-sans text-sm text-stone-800">
            {shareText}
          </pre>
        </Card>
      )}
    </>
  )
}
