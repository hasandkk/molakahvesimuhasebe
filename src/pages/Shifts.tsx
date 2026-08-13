import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useQuery } from '../lib/useQuery'
import { addDays, formatLong, tomorrow } from '../lib/date'
import { SHIFT_PRESETS, type Employee, type ShiftAssignment, type Stand } from '../lib/types'
import { Button, Card, DateNav, Empty, ErrorBox, Select, Spinner, Tabs } from '../components/ui'

type Data = { stands: Stand[]; employees: Employee[]; assignments: ShiftAssignment[] }
type PresetId = (typeof SHIFT_PRESETS)[number]['id'] | 'ozel' | 'egitim'
type Times = { start: string; end: string }

/** Postgres "08:00:00" -> "08:00"; eğitim kayıtlarında saat boş olabilir. */
const hhmm = (time: string | null) => (time ? time.slice(0, 5) : '')

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

  // Eklenecek kaydın türü ve saatleri
  const [preset, setPreset] = useState<PresetId>('sabah')
  const [customStart, setCustomStart] = useState('08:00')
  const [customEnd, setCustomEnd] = useState('15:30')

  // Satır bazında düzenlenen saatler; sunucuya yazılırken ekran titremesin diye
  // yerel olarak da tutuluyor.
  const [timeEdits, setTimeEdits] = useState<Record<string, Times>>({})
  useEffect(() => setTimeEdits({}), [date])

  const newEntry = useMemo(() => {
    if (preset === 'egitim') return { kind: 'egitim' as const, start: null, end: null }
    if (preset === 'ozel') return { kind: 'vardiya' as const, start: customStart, end: customEnd }
    const found = SHIFT_PRESETS.find((p) => p.id === preset)!
    return { kind: 'vardiya' as const, start: found.start, end: found.end }
  }, [preset, customStart, customEnd])

  const timesOf = useMemo(() => {
    return (a: ShiftAssignment): Times =>
      timeEdits[a.id] ?? { start: hhmm(a.start_time), end: hhmm(a.end_time) }
  }, [timeEdits])

  const employeeById = useMemo(() => {
    const map = new Map<string, Employee>()
    for (const e of data?.employees ?? []) map.set(e.id, e)
    return map
  }, [data])

  const nameOf = useMemo(
    () => (a: ShiftAssignment) => employeeById.get(a.employee_id)?.full_name ?? '—',
    [employeeById],
  )

  const byStand = useMemo(() => {
    const map = new Map<string, ShiftAssignment[]>()
    for (const a of data?.assignments ?? []) {
      const list = map.get(a.stand_id) ?? []
      list.push(a)
      map.set(a.stand_id, list)
    }
    // Önce vardiyalar (saate göre), sonra eğitimler
    for (const list of map.values()) {
      list.sort((a, b) => {
        const byKind = (a.kind === 'egitim' ? 1 : 0) - (b.kind === 'egitim' ? 1 : 0)
        if (byKind !== 0) return byKind
        const byTime = timesOf(a).start.localeCompare(timesOf(b).start)
        if (byTime !== 0) return byTime
        return nameOf(a).localeCompare(nameOf(b), 'tr')
      })
    }
    return map
  }, [data, nameOf, timesOf])

  /** Aynı vardiyaya (ya da aynı güne, eğitim için) zaten yazılmış olanlar önerilmez. */
  const alreadyTaken = useMemo(() => {
    const set = new Set<string>()
    for (const a of data?.assignments ?? []) {
      if (newEntry.kind === 'egitim') {
        if (a.kind === 'egitim') set.add(a.employee_id)
      } else if (a.kind === 'vardiya' && timesOf(a).start === newEntry.start) {
        set.add(a.employee_id)
      }
    }
    return set
  }, [data, newEntry, timesOf])

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
          const range = t.start && t.end ? `${t.start}-${t.end}  ` : ''
          const suffix = a.kind === 'egitim' ? ' (eğitim)' : ''
          lines.push(`• ${range}${nameOf(a)}${suffix}`)
        }
      }
      lines.push('')
    }
    return lines.join('\n').trim()
  }, [data, date, byStand, nameOf, timesOf])

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
        kind: newEntry.kind,
        start_time: newEntry.start,
        end_time: newEntry.end,
      }),
    )
  }

  async function removeAssignment(id: string) {
    await run(async () => supabase.from('shift_assignments').delete().eq('id', id))
  }

  async function changeTime(a: ShiftAssignment, field: keyof Times, value: string) {
    // Vardiya kayıtlarında saat zorunlu; eğitimde boş bırakılabilir.
    if (!value && a.kind === 'vardiya') return

    setTimeEdits((prev) => ({ ...prev, [a.id]: { ...timesOf(a), [field]: value } }))
    setActionError(null)

    const column = field === 'start' ? 'start_time' : 'end_time'
    const { error } = await supabase
      .from('shift_assignments')
      .update({ [column]: value || null })
      .eq('id', a.id)
    if (error) setActionError(error.message)
  }

  async function copyPreviousDay() {
    setBusy(true)
    setActionError(null)
    const prev = addDays(date, -1)
    const { data: prevRows, error: readError } = await supabase
      .from('shift_assignments')
      .select('stand_id, employee_id, kind, role, start_time, end_time')
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
        { onConflict: 'work_date,stand_id,employee_id,kind,start_time', ignoreDuplicates: true },
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

      <Card title="Ne ekleniyor?">
        <Tabs
          active={preset}
          onChange={setPreset}
          tabs={[
            { id: 'sabah' as PresetId, label: 'Sabah 08:00–15:30' },
            { id: 'aksam' as PresetId, label: 'Akşam 15:30–23:00' },
            { id: 'ozel' as PresetId, label: 'Özel saat' },
            { id: 'egitim' as PresetId, label: 'Eğitim' },
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
          {preset === 'egitim'
            ? 'Eğitime gelen kişi vardiyadaki birinin yanına yazılır, saat girmek zorunlu değildir. İstersen satırdan saat de verebilirsin.'
            : 'Aşağıda eklediğin kişiler bu saatlerle kaydedilir. Ekledikten sonra her satırın saatini tek tek değiştirebilirsin.'}
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
          const shiftCount = list.filter((a) => a.kind === 'vardiya').length
          const trainingCount = list.length - shiftCount
          const available = data.employees.filter((e) => !alreadyTaken.has(e.id))
          return (
            <Card
              key={stand.id}
              title={stand.name}
              action={
                <span className="text-xs text-stone-500">
                  {shiftCount} kişi{trainingCount > 0 ? ` · ${trainingCount} eğitim` : ''}
                </span>
              }
            >
              <ul className="space-y-2">
                {list.length === 0 && <Empty>Kimse atanmadı</Empty>}
                {list.map((a) => {
                  const t = timesOf(a)
                  const isTraining = a.kind === 'egitim'
                  return (
                    <li
                      key={a.id}
                      className={`rounded-xl px-3 py-2 ${isTraining ? 'bg-amber-50' : 'bg-stone-50'}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2 text-sm text-stone-800">
                          <span className="truncate">{nameOf(a)}</span>
                          {isTraining && (
                            <span className="shrink-0 rounded-md bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900">
                              Eğitim
                            </span>
                          )}
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
                        {isTraining && !t.start && !t.end && (
                          <span className="text-xs text-stone-400">saat isteğe bağlı</span>
                        )}
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
                    ? 'Boşta kimse kalmadı'
                    : newEntry.kind === 'egitim'
                      ? '+ Eğitime gelen ekle…'
                      : `+ Çalışan ekle (${newEntry.start}–${newEntry.end})…`}
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
