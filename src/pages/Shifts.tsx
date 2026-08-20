import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useQuery } from '../lib/useQuery'
import { fetchActiveEmployees, fetchActiveStands } from '../lib/refData'
import {
  addDays,
  formatDayMonth,
  formatLong,
  formatWeekday,
  startOfWeek,
  today,
  tomorrow,
  weekDays,
} from '../lib/date'
import { errorMessage } from '../lib/errors'
import { overlaps, rangeOf, type Range } from '../lib/shifts'
import {
  buildShiftMessage,
  groupByStand,
  groupLabel,
  hhmm,
  type ShiftGroup as Group,
} from '../lib/shiftMessage'
import {
  SHIFT_PRESETS,
  type Employee,
  type ShiftAssignment,
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

type View = 'gun' | 'hafta'
type Data = { stands: Stand[]; employees: Employee[]; assignments: ShiftAssignment[] }
type PresetId = (typeof SHIFT_PRESETS)[number]['id'] | 'ozel' | 'egitim'
type Times = { start: string; end: string }

/** Haftanın tamamı tek seferde çekilir; gün değiştirmek ağ beklemez. */
async function load(weekStart: string): Promise<Data> {
  const [stands, employees, assignments] = await Promise.all([
    fetchActiveStands(),
    fetchActiveEmployees(),
    supabase
      .from('shift_assignments')
      .select('*')
      .gte('work_date', weekStart)
      .lte('work_date', addDays(weekStart, 6)),
  ])
  if (assignments.error) throw assignments.error
  return { stands, employees, assignments: (assignments.data ?? []) as ShiftAssignment[] }
}

function TabLabel({ title, sub }: { title: string; sub?: string }) {
  return (
    <span className="flex flex-col leading-tight">
      <span>{title}</span>
      {sub && <span className="text-[10px] font-normal opacity-70">{sub}</span>}
    </span>
  )
}

export default function Shifts() {
  const [view, setView] = useState<View>('gun')
  const [date, setDate] = useState(tomorrow())
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const weekStart = startOfWeek(date)
  const { data, loading, error, reload } = useQuery(() => load(weekStart), [weekStart])

  const [preset, setPreset] = useState<PresetId>('sabah')
  const [customStart, setCustomStart] = useState('08:00')
  const [customEnd, setCustomEnd] = useState('15:30')
  const [editing, setEditing] = useState<string | null>(null)

  const [timeEdits, setTimeEdits] = useState<Record<string, Times>>({})
  useEffect(() => {
    setTimeEdits({})
    setEditing(null)
  }, [weekStart])

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

  const standById = useMemo(() => {
    const map = new Map<string, Stand>()
    for (const s of data?.stands ?? []) map.set(s.id, s)
    return map
  }, [data])

  const nameOf = useMemo(
    () => (a: ShiftAssignment) => employeeById.get(a.employee_id)?.full_name ?? '—',
    [employeeById],
  )

  const dayAssignments = useMemo(
    () => (data?.assignments ?? []).filter((a) => a.work_date === date),
    [data, date],
  )

  const buildGroups = useMemo(
    () => (list: ShiftAssignment[]) => groupByStand(list, nameOf, timesOf),
    [nameOf, timesOf],
  )

  const groupsByStand = useMemo(() => buildGroups(dayAssignments), [buildGroups, dayAssignments])

  /* --------------------------------------------------------- Çakışmalar */

  const newRange = useMemo(
    () => (newEntry.start && newEntry.end ? rangeOf(newEntry.start, newEntry.end) : null),
    [newEntry],
  )

  /** Bu kişinin o gün, saati çakışan başka bir vardiyası var mı? */
  const conflictFor = useMemo(
    () =>
      (employeeId: string, range: Range | null): ShiftAssignment | null => {
        if (!range) return null
        for (const a of dayAssignments) {
          if (a.employee_id !== employeeId || a.kind !== 'vardiya') continue
          const t = timesOf(a)
          const other = rangeOf(t.start, t.end)
          if (other && overlaps(range, other)) return a
        }
        return null
      },
    [dayAssignments, timesOf],
  )

  /** Kayıtlı planda kalmış çakışmalar (ör. "dünkünü kopyala" ile gelmiş olabilir). */
  const existingConflicts = useMemo(() => {
    const byEmployee = new Map<string, ShiftAssignment[]>()
    for (const a of dayAssignments) {
      if (a.kind !== 'vardiya') continue
      byEmployee.set(a.employee_id, [...(byEmployee.get(a.employee_id) ?? []), a])
    }
    const out: string[] = []
    for (const list of byEmployee.values()) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const ta = timesOf(list[i])
          const tb = timesOf(list[j])
          const ra = rangeOf(ta.start, ta.end)
          const rb = rangeOf(tb.start, tb.end)
          if (ra && rb && overlaps(ra, rb)) {
            out.push(
              `${nameOf(list[i])} — ${standById.get(list[i].stand_id)?.name ?? '?'} ${ta.start}–${ta.end}` +
                ` ile ${standById.get(list[j].stand_id)?.name ?? '?'} ${tb.start}–${tb.end} çakışıyor`,
            )
          }
        }
      }
    }
    return out
  }, [dayAssignments, timesOf, nameOf, standById])

  /** Eğitim için: aynı gün zaten eğitime yazılmış olanlar. */
  const trainedToday = useMemo(() => {
    const set = new Set<string>()
    for (const a of dayAssignments) if (a.kind === 'egitim') set.add(a.employee_id)
    return set
  }, [dayAssignments])

  /* ------------------------------------------------------------- Mesaj */

  const shareTextFor = useMemo(
    () => (standId: string | null) => {
      if (!data) return ''
      const stands = standId ? data.stands.filter((s) => s.id === standId) : data.stands
      return buildShiftMessage(date, stands, groupsByStand, nameOf)
    },
    [data, date, groupsByStand, nameOf],
  )

  const shareText = useMemo(() => shareTextFor(null), [shareTextFor])

  /* ------------------------------------------------------------ İşlemler */

  async function run(fn: () => Promise<{ error: unknown }>) {
    setBusy(true)
    setActionError(null)
    const { error } = await fn()
    if (error) setActionError(errorMessage(error))
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
    if (error) setActionError(errorMessage(error))
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
      setActionError(errorMessage(readError))
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

    if (insertError) setActionError(errorMessage(insertError))
    else {
      setTimeEdits({})
      await reload()
    }
    setBusy(false)
  }

  const [copiedStand, setCopiedStand] = useState<string | null>(null)

  async function copyText(standId: string | null) {
    try {
      await navigator.clipboard.writeText(shareTextFor(standId))
      if (standId) {
        setCopiedStand(standId)
        setTimeout(() => setCopiedStand(null), 2000)
      } else {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    } catch {
      setActionError('Panoya kopyalanamadı, metni elle seçip kopyalayabilirsin.')
    }
  }

  /* --------------------------------------------------------------- Render */

  return (
    <>
      <div>
        <h1 className="text-lg font-semibold text-stone-900">Vardiya Planı</h1>
        <p className="text-sm text-stone-500">
          {view === 'gun' ? formatLong(date) : `${formatDayMonth(weekStart)} – ${formatDayMonth(addDays(weekStart, 6))}`}
        </p>
      </div>

      <Tabs
        active={view}
        onChange={setView}
        tabs={[
          { id: 'gun' as View, label: 'Gün' },
          { id: 'hafta' as View, label: 'Hafta' },
        ]}
      />

      {view === 'gun' ? (
        <DateNav value={date} onChange={setDate} />
      ) : (
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="icon" onClick={() => setDate(addDays(date, -7))} aria-label="Önceki hafta">
            ‹
          </Button>
          <div className="flex-1 rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-center text-sm tabular-nums text-stone-800">
            {formatDayMonth(weekStart)} – {formatDayMonth(addDays(weekStart, 6))}
          </div>
          <Button variant="secondary" size="icon" onClick={() => setDate(addDays(date, 7))} aria-label="Sonraki hafta">
            ›
          </Button>
        </div>
      )}

      {/* Hafta modunda "dünkünü kopyala" anlamsız; soluk düğme bırakmak yerine gizli */}
      <div className={view === 'gun' ? 'grid grid-cols-2 gap-2' : ''}>
        <Button
          variant="secondary"
          size="sm"
          className={view === 'hafta' ? 'w-full' : ''}
          onClick={() => setDate(view === 'gun' ? tomorrow() : today())}
        >
          {view === 'gun' ? 'Yarına git' : 'Bu haftaya dön'}
        </Button>
        {view === 'gun' && (
          <Button variant="secondary" size="sm" onClick={() => void copyPreviousDay()} disabled={busy}>
            Dünkünü kopyala
          </Button>
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

      {data && data.stands.length > 0 && view === 'hafta' && (
        <WeekView
          data={data}
          weekStart={weekStart}
          buildGroups={buildGroups}
          nameOf={nameOf}
          onPickDay={(d) => {
            setDate(d)
            setView('gun')
          }}
        />
      )}

      {data && data.stands.length > 0 && view === 'gun' && (
        <>
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

          {existingConflicts.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
              <p className="font-semibold">Saat çakışması var</p>
              <ul className="mt-1 space-y-0.5 text-xs">
                {existingConflicts.map((c) => (
                  <li key={c}>• {c}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            {data.stands.map((stand) => {
              const groups = groupsByStand.get(stand.id) ?? []
              const shiftCount = groups
                .filter((g) => g.kind === 'vardiya')
                .reduce((s, g) => s + g.items.length, 0)
              const trainingCount = groups
                .filter((g) => g.kind === 'egitim')
                .reduce((s, g) => s + g.items.length, 0)

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
                    disabled={busy}
                    onChange={(e) => void addAssignment(stand.id, e.target.value)}
                  >
                    <option value="">
                      {newEntry.kind === 'egitim'
                        ? '+ Eğitime gelen ekle…'
                        : `+ Ekle · ${newEntry.start}–${newEntry.end}`}
                    </option>
                    {data.employees.map((e) => {
                      // Çakışan kişiler listede kalır ama seçilemez; sebebi yazar.
                      if (newEntry.kind === 'egitim') {
                        const busyTrainee = trainedToday.has(e.id)
                        return (
                          <option key={e.id} value={e.id} disabled={busyTrainee}>
                            {e.full_name}
                            {busyTrainee ? ' — bugün zaten eğitimde' : ''}
                          </option>
                        )
                      }
                      const clash = conflictFor(e.id, newRange)
                      const t = clash ? timesOf(clash) : null
                      return (
                        <option key={e.id} value={e.id} disabled={!!clash}>
                          {e.full_name}
                          {clash
                            ? ` — ${standById.get(clash.stand_id)?.name ?? '?'} ${t!.start}–${t!.end} ile çakışıyor`
                            : ''}
                        </option>
                      )
                    })}
                  </Select>

                  {groups.length > 0 && (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-2 w-full"
                      onClick={() => void copyText(stand.id)}
                    >
                      {copiedStand === stand.id
                        ? '✓ Kopyalandı'
                        : `${stand.name} grubuna atılacak mesajı kopyala`}
                    </Button>
                  )}
                </Card>
              )
            })}
          </div>

          <Card
            title="Tüm standların mesajı"
            action={
              <Button size="sm" onClick={() => void copyText(null)} className="max-md:hidden">
                {copied ? '✓ Kopyalandı' : 'Kopyala'}
              </Button>
            }
          >
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl bg-stone-50 p-3 font-sans text-sm leading-relaxed text-stone-800">
              {shareText}
            </pre>
          </Card>

          <StickyBar>
            <Button className="w-full" onClick={() => void copyText(null)}>
              {copied ? '✓ Mesaj kopyalandı' : 'Tüm standların mesajını kopyala'}
            </Button>
          </StickyBar>
        </>
      )}
    </>
  )
}

/* ------------------------------------------------------------ Hafta görünümü */

function WeekView({
  data,
  weekStart,
  buildGroups,
  nameOf,
  onPickDay,
}: {
  data: Data
  weekStart: string
  buildGroups: (list: ShiftAssignment[]) => Map<string, Group[]>
  nameOf: (a: ShiftAssignment) => string
  onPickDay: (date: string) => void
}) {
  const days = useMemo(() => weekDays(weekStart), [weekStart])

  const byDay = useMemo(() => {
    const map = new Map<string, Map<string, Group[]>>()
    for (const d of days) {
      map.set(
        d,
        buildGroups(data.assignments.filter((a) => a.work_date === d)),
      )
    }
    return map
  }, [days, data.assignments, buildGroups])

  /** Hafta boyunca kimin kaç vardiyası var — dengeyi görmek için. */
  const perEmployee = useMemo(() => {
    const map = new Map<string, { shifts: number; trainings: number }>()
    for (const a of data.assignments) {
      const name = nameOf(a)
      const row = map.get(name) ?? { shifts: 0, trainings: 0 }
      if (a.kind === 'egitim') row.trainings += 1
      else row.shifts += 1
      map.set(name, row)
    }
    return [...map.entries()].sort((a, b) => b[1].shifts - a[1].shifts)
  }, [data.assignments, nameOf])

  const cell = (groups: Group[] | undefined) => {
    if (!groups || groups.length === 0) {
      return <span className="text-xs font-medium text-red-700">atama yok</span>
    }
    return (
      <div className="space-y-0.5">
        {groups.map((g) => (
          <div key={g.id} className="text-xs leading-snug">
            <span className={`tabular-nums ${g.kind === 'egitim' ? 'text-amber-700' : 'text-stone-500'}`}>
              {g.kind === 'egitim' ? 'Eğitim' : `${g.start}–${g.end}`}
            </span>{' '}
            <span className="text-stone-800">{g.items.map(nameOf).join(', ')}</span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <>
      {/* Mobil: gün gün kartlar */}
      <div className="space-y-3 md:hidden">
        {days.map((d) => {
          const stands = byDay.get(d)
          const isToday = d === today()
          return (
            <Card
              key={d}
              title={
                <span className={isToday ? 'text-brand-800' : ''}>
                  {formatWeekday(d)} · {formatDayMonth(d)}
                  {isToday && <span className="ml-1 text-[10px] font-normal text-brand-600">bugün</span>}
                </span>
              }
              action={
                <button onClick={() => onPickDay(d)} className="text-xs font-medium text-brand-700">
                  düzenle →
                </button>
              }
            >
              <div className="space-y-2">
                {data.stands.map((s) => (
                  <div key={s.id} className="flex gap-2">
                    <span className="w-24 shrink-0 truncate text-xs font-semibold text-stone-600">
                      {s.name}
                    </span>
                    <div className="min-w-0 flex-1">{cell(stands?.get(s.id))}</div>
                  </div>
                ))}
              </div>
            </Card>
          )
        })}
      </div>

      {/* Masaüstü: gün × stand tablosu */}
      <Card className="hidden md:block">
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="text-left text-xs text-stone-500">
              <th className="w-28 pb-2 font-medium">Gün</th>
              {data.stands.map((s) => (
                <th key={s.id} className="pb-2 font-medium">
                  {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 align-top">
            {days.map((d) => (
              <tr key={d} className={d === today() ? 'bg-brand-50/60' : ''}>
                <td className="py-2 pr-2">
                  <button onClick={() => onPickDay(d)} className="text-left hover:underline">
                    <span className="block text-xs font-semibold text-stone-700">{formatWeekday(d)}</span>
                    <span className="block text-xs text-stone-500">{formatDayMonth(d)}</span>
                  </button>
                </td>
                {data.stands.map((s) => (
                  <td key={s.id} className="py-2 pr-2">
                    {cell(byDay.get(d)?.get(s.id))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Bu hafta kim kaç vardiya">
        {perEmployee.length === 0 ? (
          <Empty>Bu hafta atama yok.</Empty>
        ) : (
          <ul className="divide-y divide-stone-100 text-sm">
            {perEmployee.map(([name, row]) => (
              <li key={name} className="flex justify-between gap-3 py-1.5">
                <span className="min-w-0 truncate">{name}</span>
                <span className="shrink-0 tabular-nums text-stone-600">
                  {row.shifts} vardiya
                  {row.trainings > 0 && <span className="ml-1 text-amber-700">· {row.trainings} eğitim</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}
