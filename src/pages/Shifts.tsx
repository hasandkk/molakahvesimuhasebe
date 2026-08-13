import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useQuery } from '../lib/useQuery'
import { fetchActiveEmployees, fetchActiveStands } from '../lib/refData'
import { addDays, formatLong, tomorrow } from '../lib/date'
import {
  SHIFT_PRESETS,
  type Employee,
  type ShiftAssignment,
  type ShiftKind,
  type Stand,
} from '../lib/types'
import {
  Button,
  Card,
  DateNav,
  Empty,
  ErrorBox,
  Select,
  Spinner,
  StickyBar,
  Tabs,
  TimeInput,
} from '../components/ui'

type Data = { stands: Stand[]; employees: Employee[]; assignments: ShiftAssignment[] }
type PresetId = (typeof SHIFT_PRESETS)[number]['id'] | 'ozel' | 'egitim'
type Times = { start: string; end: string }

/** Aynı stand içinde aynı tür ve saatte olanlar tek grupta toplanır. */
type Group = { id: string; kind: ShiftKind; start: string; end: string; items: ShiftAssignment[] }

/** Postgres "08:00:00" -> "08:00"; eğitim kayıtlarında saat boş olabilir. */
const hhmm = (time: string | null) => (time ? time.slice(0, 5) : '')

function groupLabel(g: Group) {
  const range = g.start && g.end ? `${g.start}–${g.end}` : null
  if (g.kind === 'egitim') return range ? `Eğitim · ${range}` : 'Eğitim'
  return range ?? 'Saat girilmemiş'
}

async function load(date: string): Promise<Data> {
  const [stands, employees, assignments] = await Promise.all([
    fetchActiveStands(),
    fetchActiveEmployees(),
    supabase.from('shift_assignments').select('*').eq('work_date', date),
  ])
  if (assignments.error) throw assignments.error
  return { stands, employees, assignments: (assignments.data ?? []) as ShiftAssignment[] }
}

/** Sekme etiketi: üstte ad, altta saat aralığı — dar ekranda taşmaz. */
function TabLabel({ title, sub }: { title: string; sub?: string }) {
  return (
    <span className="flex flex-col leading-tight">
      <span>{title}</span>
      {sub && <span className="text-[10px] font-normal opacity-70">{sub}</span>}
    </span>
  )
}

export default function Shifts() {
  const [date, setDate] = useState(tomorrow())
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const { data, loading, error, reload } = useQuery(() => load(date), [date])

  const [preset, setPreset] = useState<PresetId>('sabah')
  const [customStart, setCustomStart] = useState('08:00')
  const [customEnd, setCustomEnd] = useState('15:30')

  // Saat düzenleyicisi açık olan grup. Grubun ilk atamasının id'si ile izlenir:
  // saat değişince grup anahtarı değişse de düzenleyici açık kalsın diye.
  const [editing, setEditing] = useState<string | null>(null)

  // Sunucuya yazarken ekran titremesin diye saatler yerel olarak da tutuluyor.
  const [timeEdits, setTimeEdits] = useState<Record<string, Times>>({})
  useEffect(() => {
    setTimeEdits({})
    setEditing(null)
  }, [date])

  const newEntry = useMemo(() => {
    if (preset === 'egitim') return { kind: 'egitim' as const, start: null, end: null }
    if (preset === 'ozel') return { kind: 'vardiya' as const, start: customStart, end: customEnd }
    const found = SHIFT_PRESETS.find((p) => p.id === preset)!
    return { kind: 'vardiya' as const, start: found.start, end: found.end }
  }, [preset, customStart, customEnd])

  const timesOf = useMemo(
    () =>
      (a: ShiftAssignment): Times =>
        timeEdits[a.id] ?? { start: hhmm(a.start_time), end: hhmm(a.end_time) },
    [timeEdits],
  )

  const employeeById = useMemo(() => {
    const map = new Map<string, Employee>()
    for (const e of data?.employees ?? []) map.set(e.id, e)
    return map
  }, [data])

  const nameOf = useMemo(
    () => (a: ShiftAssignment) => employeeById.get(a.employee_id)?.full_name ?? '—',
    [employeeById],
  )

  /** stand → gruplar (önce saate göre vardiyalar, sonra eğitimler) */
  const groupsByStand = useMemo(() => {
    const map = new Map<string, Group[]>()
    for (const a of data?.assignments ?? []) {
      const t = timesOf(a)
      const key = `${a.kind}|${t.start}|${t.end}`
      const list = map.get(a.stand_id) ?? []
      const found = list.find((g) => g.id === key)
      if (found) found.items.push(a)
      else list.push({ id: key, kind: a.kind, start: t.start, end: t.end, items: [a] })
      map.set(a.stand_id, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        const byKind = (a.kind === 'egitim' ? 1 : 0) - (b.kind === 'egitim' ? 1 : 0)
        if (byKind !== 0) return byKind
        return a.start.localeCompare(b.start)
      })
      for (const g of list) g.items.sort((x, y) => nameOf(x).localeCompare(nameOf(y), 'tr'))
    }
    return map
  }, [data, nameOf, timesOf])

  /** Aynı vardiyaya (eğitimse aynı güne) zaten yazılmış olanlar önerilmez. */
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
      lines.push(`☕ ${stand.name}`)
      const groups = groupsByStand.get(stand.id) ?? []
      if (groups.length === 0) lines.push('(kimse atanmadı)')
      else for (const g of groups) lines.push(`${groupLabel(g)} · ${g.items.map(nameOf).join(', ')}`)
      lines.push('')
    }
    return lines.join('\n').trim()
  }, [data, date, groupsByStand, nameOf])

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

  /** Saat değişikliği gruptaki herkese birden uygulanır. */
  async function changeGroupTime(group: Group, field: keyof Times, value: string) {
    if (!value && group.kind === 'vardiya') return

    setTimeEdits((prev) => {
      const next = { ...prev }
      for (const a of group.items) {
        next[a.id] = { ...(next[a.id] ?? { start: group.start, end: group.end }), [field]: value }
      }
      return next
    })
    setActionError(null)

    const column = field === 'start' ? 'start_time' : 'end_time'
    const { error } = await supabase
      .from('shift_assignments')
      .update({ [column]: value || null })
      .in(
        'id',
        group.items.map((a) => a.id),
      )
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

    const { error: insertError } = await supabase.from('shift_assignments').upsert(
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

  return (
    <>
      <div>
        <h1 className="text-lg font-semibold text-stone-900">Vardiya Planı</h1>
        <p className="text-sm text-stone-500">{formatLong(date)}</p>
      </div>

      <DateNav value={date} onChange={setDate} />

      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" size="sm" onClick={() => setDate(tomorrow())}>
          Yarına git
        </Button>
        <Button variant="secondary" size="sm" onClick={() => void copyPreviousDay()} disabled={busy}>
          Dünkünü kopyala
        </Button>
      </div>

      {/* Eklenecek vardiya seçici — kart yerine sade blok, dikeyde yer kaplamasın */}
      <div>
        <span className="mb-1 block text-xs font-medium text-stone-600">Eklenecek vardiya</span>
        <Tabs
          active={preset}
          onChange={setPreset}
          tabs={[
            { id: 'sabah' as PresetId, label: <TabLabel title="Sabah" sub="08:00–15:30" /> },
            { id: 'aksam' as PresetId, label: <TabLabel title="Akşam" sub="15:30–23:00" /> },
            { id: 'ozel' as PresetId, label: <TabLabel title="Özel saat" /> },
            { id: 'egitim' as PresetId, label: <TabLabel title="Eğitim" /> },
          ]}
        />
        {preset === 'ozel' && (
          <div className="mt-2 flex items-center gap-2">
            <TimeInput value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
            <span className="text-stone-400">–</span>
            <TimeInput value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
          </div>
        )}
      </div>

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
          const groups = groupsByStand.get(stand.id) ?? []
          const shiftCount = groups
            .filter((g) => g.kind === 'vardiya')
            .reduce((s, g) => s + g.items.length, 0)
          const trainingCount = groups
            .filter((g) => g.kind === 'egitim')
            .reduce((s, g) => s + g.items.length, 0)
          const available = data.employees.filter((e) => !alreadyTaken.has(e.id))

          return (
            <Card
              key={stand.id}
              title={stand.name}
              action={
                <span className="text-xs text-stone-500">
                  {shiftCount} kişi
                  {trainingCount > 0 && <span className="text-amber-700"> · {trainingCount} eğitim</span>}
                </span>
              }
            >
              {groups.length === 0 && <Empty>Kimse atanmadı</Empty>}

              <div className="space-y-3">
                {groups.map((group) => {
                  const isOpen = editing === group.items[0].id
                  const isTraining = group.kind === 'egitim'
                  return (
                    <div
                      key={group.id}
                      className={`overflow-hidden rounded-xl border ${
                        isTraining ? 'border-amber-200' : 'border-stone-200'
                      }`}
                    >
                      {/* Başlığın tamamı dokunulabilir: saat düzenleyicisini açar */}
                      <button
                        onClick={() => setEditing(isOpen ? null : group.items[0].id)}
                        className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left ${
                          isTraining ? 'bg-amber-100/70' : 'bg-stone-100'
                        }`}
                      >
                        <span
                          className={`text-xs font-semibold tabular-nums ${
                            isTraining ? 'text-amber-900' : 'text-stone-700'
                          }`}
                        >
                          {groupLabel(group)}
                        </span>
                        <span className="shrink-0 text-[11px] font-medium text-brand-700">
                          {isOpen ? 'kapat ▴' : 'saati değiştir ▾'}
                        </span>
                      </button>

                      {isOpen && (
                        <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 bg-white px-3 py-2">
                          <TimeInput
                            value={group.start}
                            onChange={(e) => void changeGroupTime(group, 'start', e.target.value)}
                            aria-label="Başlangıç saati"
                          />
                          <span className="text-stone-400">–</span>
                          <TimeInput
                            value={group.end}
                            onChange={(e) => void changeGroupTime(group, 'end', e.target.value)}
                            aria-label="Bitiş saati"
                          />
                          {group.items.length > 1 && (
                            <span className="text-[11px] leading-tight text-stone-500">
                              {group.items.length} kişiye birden uygulanır
                            </span>
                          )}
                        </div>
                      )}

                      <ul className="divide-y divide-stone-100 bg-white">
                        {group.items.map((a) => (
                          <li key={a.id} className="flex items-center justify-between gap-2 py-1 pl-3 pr-1">
                            <span className="min-w-0 truncate text-sm text-stone-800">{nameOf(a)}</span>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => void removeAssignment(a.id)}
                              disabled={busy}
                              aria-label={`${nameOf(a)} çıkar`}
                            >
                              ✕
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                })}
              </div>

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
                      : `+ Ekle · ${newEntry.start}–${newEntry.end}`}
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
            <Button size="sm" onClick={() => void copyText()} className="hidden md:inline-flex">
              {copied ? '✓ Kopyalandı' : 'Kopyala'}
            </Button>
          }
        >
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl bg-stone-50 p-3 font-sans text-sm leading-relaxed text-stone-800">
            {shareText}
          </pre>
        </Card>
      )}

      {data && data.stands.length > 0 && (
        <StickyBar>
          <Button className="w-full" onClick={() => void copyText()}>
            {copied ? '✓ Mesaj kopyalandı' : 'Gruba atılacak mesajı kopyala'}
          </Button>
        </StickyBar>
      )}
    </>
  )
}
