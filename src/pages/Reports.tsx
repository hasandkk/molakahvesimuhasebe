import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useQuery } from '../lib/useQuery'
import { fetchAllEmployees, fetchAllStands } from '../lib/refData'
import { formatLong, formatShort, startOfMonth, today } from '../lib/date'
import { money, parseNumber, qty } from '../lib/format'
import {
  MOVEMENT_LABELS,
  type CashMovement,
  type Employee,
  type EmployeeBonus,
  type PayrollRow,
  type PayrollSettings,
  type Stand,
  type StockMovementRow,
} from '../lib/types'
import { Button, Card, Empty, ErrorBox, Field, Input, Select, Spinner, Stat, Tabs } from '../components/ui'

type Tab = 'ozet' | 'vardiya' | 'stok' | 'maas'

type RevenueRow = { business_date: string; stand_id: string; cash_amount: number; pos_amount: number }

type ShiftRow = {
  work_date: string
  kind: 'vardiya' | 'egitim'
  start_time: string | null
  end_time: string | null
  stand_id: string
  employee_id: string
  stands: { name: string } | null
  employees: { full_name: string } | null
}

type Data = {
  stands: Stand[]
  employees: Employee[]
  revenues: RevenueRow[]
  movements: CashMovement[]
  shifts: ShiftRow[]
  stock: StockMovementRow[]
  payroll: PayrollRow[]
  settings: PayrollSettings | null
  bonuses: EmployeeBonus[]
}

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '')

async function load(from: string, to: string): Promise<Data> {
  const [stands, employees, revenues, movements, shifts, stock, payroll, settings, bonuses] =
    await Promise.all([
    fetchAllStands(),
    fetchAllEmployees(),
    supabase
      .from('daily_revenues')
      .select('business_date, stand_id, cash_amount, pos_amount')
      .gte('business_date', from)
      .lte('business_date', to),
    supabase.from('cash_movements').select('*').gte('movement_date', from).lte('movement_date', to),
    supabase
      .from('shift_assignments')
      .select('work_date, kind, start_time, end_time, stand_id, employee_id, stands(name), employees(full_name)')
      .gte('work_date', from)
      .lte('work_date', to),
    supabase.rpc('stock_daily_movement', { p_from: from, p_to: to, p_stand_id: null }),
    supabase.rpc('payroll', { p_from: from, p_to: to }),
    supabase.from('payroll_settings').select('*').limit(1),
    supabase.from('employee_bonuses').select('*').gte('work_date', from).lte('work_date', to),
  ])

  const err =
    revenues.error ?? movements.error ?? shifts.error ?? stock.error ??
    payroll.error ?? settings.error ?? bonuses.error
  if (err) throw err

  return {
    stands,
    employees,
    revenues: (revenues.data ?? []) as RevenueRow[],
    movements: (movements.data ?? []) as CashMovement[],
    shifts: (shifts.data ?? []) as unknown as ShiftRow[],
    stock: (stock.data ?? []) as StockMovementRow[],
    payroll: (payroll.data ?? []) as PayrollRow[],
    settings: ((settings.data ?? [])[0] as PayrollSettings | undefined) ?? null,
    bonuses: (bonuses.data ?? []) as EmployeeBonus[],
  }
}

export default function Reports() {
  const [tab, setTab] = useState<Tab>('ozet')
  const [from, setFrom] = useState(startOfMonth(today()))
  const [to, setTo] = useState(today())
  const { data, loading, error, reload } = useQuery(() => load(from, to), [from, to])

  return (
    <>
      <h1 className="text-lg font-semibold text-stone-900">Raporlar</h1>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Başlangıç">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Bitiş">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'ozet', label: 'Özet' },
          { id: 'vardiya', label: 'Vardiya geçmişi' },
          { id: 'stok', label: 'Stok geçmişi' },
          { id: 'maas', label: 'Maaş' },
        ]}
      />

      {error && <ErrorBox message={error} />}
      {loading && !data && <Spinner />}

      {data && tab === 'ozet' && <SummaryTab data={data} />}
      {data && tab === 'vardiya' && <ShiftHistoryTab data={data} />}
      {data && tab === 'stok' && <StockHistoryTab data={data} />}
      {data && tab === 'maas' && <PayrollTab data={data} from={from} to={to} onChanged={reload} />}
    </>
  )
}

/* ------------------------------------------------------------------ Özet */

function SummaryTab({ data }: { data: Data }) {
  const totals = useMemo(() => {
    const cash = data.revenues.reduce((s, r) => s + Number(r.cash_amount), 0)
    const pos = data.revenues.reduce((s, r) => s + Number(r.pos_amount), 0)
    const out = data.movements
      .filter((m) => m.type !== 'giris')
      .reduce((s, m) => s + Number(m.amount), 0)
    return { cash, pos, total: cash + pos, out }
  }, [data])

  const byStand = useMemo(
    () =>
      data.stands
        .map((stand) => {
          const rows = data.revenues.filter((r) => r.stand_id === stand.id)
          const cash = rows.reduce((s, r) => s + Number(r.cash_amount), 0)
          const pos = rows.reduce((s, r) => s + Number(r.pos_amount), 0)
          return { stand, cash, pos, total: cash + pos, days: rows.length }
        })
        .filter((r) => r.days > 0 || r.stand.is_active)
        .sort((a, b) => b.total - a.total),
    [data],
  )

  const byPerson = useMemo(() => {
    const map = new Map<string, number>()
    for (const m of data.movements) {
      if (m.type !== 'cekim') continue
      const key = m.person_name?.trim() || 'Belirtilmemiş'
      map.set(key, (map.get(key) ?? 0) + Number(m.amount))
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [data])

  const byCategory = useMemo(() => {
    const map = new Map<string, number>()
    for (const m of data.movements) {
      if (m.type !== 'gider') continue
      const key = m.category?.trim() || 'Diğer'
      map.set(key, (map.get(key) ?? 0) + Number(m.amount))
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [data])

  const byEmployee = useMemo(() => {
    const map = new Map<string, { name: string; shifts: number; trainings: number }>()
    for (const s of data.shifts) {
      const row = map.get(s.employee_id) ?? {
        name: s.employees?.full_name ?? '—',
        shifts: 0,
        trainings: 0,
      }
      if (s.kind === 'egitim') row.trainings += 1
      else row.shifts += 1
      map.set(s.employee_id, row)
    }
    return [...map.values()].sort((a, b) => b.shifts - a.shifts)
  }, [data])

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Toplam ciro" value={money(totals.total)} />
        <Stat label="Nakit" value={money(totals.cash)} />
        <Stat label="POS" value={money(totals.pos)} />
        <Stat label="Kasadan çıkan" value={money(totals.out)} tone="bad" />
      </div>

      <Card title="Stand bazlı ciro">
        {byStand.length === 0 ? (
          <Empty>Bu aralıkta ciro kaydı yok.</Empty>
        ) : (
          <>
            <ul className="space-y-2 md:hidden">
              {byStand.map((row) => (
                <li key={row.stand.id} className="rounded-xl border border-stone-200 p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-medium text-stone-800">
                      {row.stand.name}
                    </span>
                    <span className="shrink-0 text-base font-semibold tabular-nums text-stone-900">
                      {money(row.total)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-stone-500">
                    <span>
                      Nakit <span className="tabular-nums">{money(row.cash)}</span>
                    </span>
                    <span>
                      POS <span className="tabular-nums">{money(row.pos)}</span>
                    </span>
                    <span>
                      <span className="tabular-nums">{row.days}</span> gün
                    </span>
                  </div>
                </li>
              ))}
            </ul>

            <table className="hidden w-full text-sm md:table">
              <thead>
                <tr className="text-left text-xs text-stone-500">
                  <th className="pb-2 font-medium">Stand</th>
                  <th className="pb-2 text-right font-medium">Gün</th>
                  <th className="pb-2 text-right font-medium">Nakit</th>
                  <th className="pb-2 text-right font-medium">POS</th>
                  <th className="pb-2 text-right font-medium">Toplam</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {byStand.map((row) => (
                  <tr key={row.stand.id}>
                    <td className="py-2">{row.stand.name}</td>
                    <td className="py-2 text-right tabular-nums text-stone-500">{row.days}</td>
                    <td className="py-2 text-right tabular-nums">{money(row.cash)}</td>
                    <td className="py-2 text-right tabular-nums">{money(row.pos)}</td>
                    <td className="py-2 text-right font-semibold tabular-nums">{money(row.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Kim ne kadar para çekti">
          {byPerson.length === 0 ? (
            <Empty>Çekim kaydı yok.</Empty>
          ) : (
            <ul className="divide-y divide-stone-100 text-sm">
              {byPerson.map(([name, amount]) => (
                <li key={name} className="flex justify-between py-2">
                  <span>{name}</span>
                  <span className="tabular-nums font-semibold text-red-700">{money(amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Gider kalemleri">
          {byCategory.length === 0 ? (
            <Empty>Gider kaydı yok.</Empty>
          ) : (
            <ul className="divide-y divide-stone-100 text-sm">
              {byCategory.map(([name, amount]) => (
                <li key={name} className="flex justify-between py-2">
                  <span>{name}</span>
                  <span className="tabular-nums font-semibold">{money(amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Çalışan başına vardiya">
        {byEmployee.length === 0 ? (
          <Empty>Bu aralıkta vardiya kaydı yok.</Empty>
        ) : (
          <>
            <ul className="divide-y divide-stone-100 text-sm">
              {byEmployee.map((row) => (
                <li key={row.name} className="flex justify-between gap-3 py-2">
                  <span className="min-w-0 truncate">{row.name}</span>
                  <span className="shrink-0 tabular-nums text-stone-600">
                    {row.shifts} vardiya
                    {row.trainings > 0 && (
                      <span className="ml-1 text-amber-700">· {row.trainings} eğitim</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-stone-500">
              Ödenecek tutar için “Maaş” sekmesine bak — kademeli ücret, yemek ve prim orada hesaplanır.
            </p>
          </>
        )}
      </Card>

      <Card title="Hareket dökümü">
        {data.movements.length === 0 ? (
          <Empty>Bu aralıkta hareket yok.</Empty>
        ) : (
          <ul className="divide-y divide-stone-100 text-sm">
            {data.movements.map((m) => (
              <li key={m.id} className="flex justify-between gap-3 py-2">
                <span className="min-w-0 truncate">
                  {formatShort(m.movement_date)} · {MOVEMENT_LABELS[m.type]}
                  {m.person_name ? ` · ${m.person_name}` : ''}
                  {m.category ? ` · ${m.category}` : ''}
                </span>
                <span
                  className={`shrink-0 tabular-nums font-semibold ${
                    m.type === 'giris' ? 'text-emerald-700' : 'text-red-700'
                  }`}
                >
                  {m.type === 'giris' ? '+' : '−'}
                  {money(m.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}

/* -------------------------------------------------------- Vardiya geçmişi */

function ShiftLine({ shift }: { shift: ShiftRow }) {
  const range = shift.start_time && shift.end_time ? `${hhmm(shift.start_time)}–${hhmm(shift.end_time)}` : null
  return (
    <div className="flex items-center gap-2 py-1 text-sm">
      <span
        className={`w-24 shrink-0 tabular-nums text-xs ${
          shift.kind === 'egitim' ? 'text-amber-700' : 'text-stone-500'
        }`}
      >
        {shift.kind === 'egitim' ? (range ?? 'Eğitim') : range}
      </span>
      <span className="min-w-0 truncate text-stone-800">{shift.employees?.full_name ?? '—'}</span>
      {shift.kind === 'egitim' && (
        <span className="shrink-0 rounded-md bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900">
          Eğitim
        </span>
      )}
    </div>
  )
}

function ShiftHistoryTab({ data }: { data: Data }) {
  const [employeeId, setEmployeeId] = useState('')

  const filtered = useMemo(
    () => (employeeId ? data.shifts.filter((s) => s.employee_id === employeeId) : data.shifts),
    [data.shifts, employeeId],
  )

  const sortShifts = (a: ShiftRow, b: ShiftRow) => {
    const byKind = (a.kind === 'egitim' ? 1 : 0) - (b.kind === 'egitim' ? 1 : 0)
    if (byKind !== 0) return byKind
    const byTime = hhmm(a.start_time).localeCompare(hhmm(b.start_time))
    if (byTime !== 0) return byTime
    return (a.employees?.full_name ?? '').localeCompare(b.employees?.full_name ?? '', 'tr')
  }

  /** Tarih (yeniden eskiye) → stand → kişiler */
  const byDate = useMemo(() => {
    const days = new Map<string, Map<string, ShiftRow[]>>()
    for (const s of filtered) {
      const stands = days.get(s.work_date) ?? new Map<string, ShiftRow[]>()
      const key = s.stands?.name ?? '—'
      stands.set(key, [...(stands.get(key) ?? []), s])
      days.set(s.work_date, stands)
    }
    return [...days.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, stands]) => ({
        date,
        stands: [...stands.entries()]
          .sort((a, b) => a[0].localeCompare(b[0], 'tr'))
          .map(([name, list]) => ({ name, list: [...list].sort(sortShifts) })),
      }))
  }, [filtered])

  /** Kişi seçiliyse düz liste daha okunur: hangi gün, nerede, hangi saatte */
  const flat = useMemo(
    () => [...filtered].sort((a, b) => b.work_date.localeCompare(a.work_date) || sortShifts(a, b)),
    [filtered],
  )

  const selected = data.employees.find((e) => e.id === employeeId)

  return (
    <>
      <Field label="Çalışan" hint="Boş bırakırsan bütün günler stand stand listelenir.">
        <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
          <option value="">Tüm çalışanlar</option>
          {data.employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.full_name}
            </option>
          ))}
        </Select>
      </Field>

      {filtered.length === 0 ? (
        <Card>
          <Empty>Bu aralıkta vardiya kaydı yok.</Empty>
        </Card>
      ) : employeeId ? (
        <Card
          title={selected?.full_name ?? 'Çalışan'}
          action={
            <span className="text-xs text-stone-500">
              {flat.filter((s) => s.kind === 'vardiya').length} vardiya
              {flat.some((s) => s.kind === 'egitim') &&
                ` · ${flat.filter((s) => s.kind === 'egitim').length} eğitim`}
            </span>
          }
        >
          <ul className="divide-y divide-stone-100">
            {flat.map((s, i) => (
              <li key={`${s.work_date}-${s.stand_id}-${s.employee_id}-${i}`} className="py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-stone-800">{s.stands?.name ?? '—'}</span>
                  <span className="shrink-0 text-xs text-stone-500">{formatShort(s.work_date)}</span>
                </div>
                <div
                  className={`text-xs tabular-nums ${
                    s.kind === 'egitim' ? 'text-amber-700' : 'text-stone-500'
                  }`}
                >
                  {s.kind === 'egitim'
                    ? s.start_time
                      ? `${hhmm(s.start_time)}–${hhmm(s.end_time)} · eğitim`
                      : 'eğitim'
                    : `${hhmm(s.start_time)}–${hhmm(s.end_time)}`}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        byDate.map((day) => (
          <Card key={day.date} title={formatLong(day.date)}>
            <div className="space-y-3">
              {day.stands.map((stand) => (
                <div key={stand.name}>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                    {stand.name}
                  </h3>
                  <div className="mt-1 divide-y divide-stone-100">
                    {stand.list.map((s, i) => (
                      <ShiftLine key={`${s.employee_id}-${i}`} shift={s} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ))
      )}
    </>
  )
}

/* ----------------------------------------------------------- Stok geçmişi */

function StockHistoryTab({ data }: { data: Data }) {
  const [standId, setStandId] = useState('')

  const rows = useMemo(
    () => (standId ? data.stock.filter((r) => r.stand_id === standId) : data.stock),
    [data.stock, standId],
  )

  const totalAmount = rows.reduce((s, r) => s + Number(r.sold_amount), 0)
  const hasPrice = rows.some((r) => Number(r.sold_amount) !== 0)

  /** Tarih (yeniden eskiye) → stand → gramajlar */
  const byDate = useMemo(() => {
    const days = new Map<string, Map<string, StockMovementRow[]>>()
    for (const r of rows) {
      const stands = days.get(r.count_date) ?? new Map<string, StockMovementRow[]>()
      stands.set(r.stand_name, [...(stands.get(r.stand_name) ?? []), r])
      days.set(r.count_date, stands)
    }
    return [...days.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, stands]) => ({
        date,
        stands: [...stands.entries()].sort((a, b) => a[0].localeCompare(b[0], 'tr')),
      }))
  }, [rows])

  return (
    <>
      <Field label="Stand">
        <Select value={standId} onChange={(e) => setStandId(e.target.value)}>
          <option value="">Tüm standlar</option>
          {data.stands.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </Field>

      {hasPrice && (
        <div className="grid grid-cols-1 gap-3">
          <Stat label="Aralıktaki toplam eksilen tutar" value={money(totalAmount)} sub="eksilen × fiyat" />
        </div>
      )}

      {byDate.length === 0 ? (
        <Card>
          <Empty>
            Bu aralıkta karşılaştırılabilir sayım yok. Eksilen miktar, iki sayım arasındaki farktan
            hesaplanır — en az iki günlük sayım gerekir.
          </Empty>
        </Card>
      ) : (
        byDate.map((day) => (
          <Card key={day.date} title={formatLong(day.date)}>
            <div className="space-y-4">
              {day.stands.map(([standName, list]) => {
                const dayTotal = list.reduce((s, r) => s + Number(r.sold_amount), 0)
                return (
                  <div key={standName}>
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                        {standName}
                      </h3>
                      {hasPrice && (
                        <span className="text-sm font-semibold tabular-nums text-stone-800">
                          {money(dayTotal)}
                        </span>
                      )}
                    </div>
                    <ul className="mt-1 divide-y divide-stone-100">
                      {list.map((r) => (
                        <li key={r.variant_id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                          <span className="min-w-0 truncate text-stone-700">
                            {r.size_label}
                            <span className="ml-1 text-xs text-stone-400">{r.unit}</span>
                          </span>
                          <span className="flex shrink-0 items-baseline gap-3">
                            <span className="text-xs text-stone-400">
                              {qty(r.expected_qty)} → {qty(r.counted_qty)}
                            </span>
                            <span
                              className={`w-16 text-right font-semibold tabular-nums ${
                                Number(r.sold_qty) < 0 ? 'text-red-700' : 'text-stone-900'
                              }`}
                            >
                              {qty(r.sold_qty)}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </div>
          </Card>
        ))
      )}

      <p className="text-xs text-stone-500">
        “Eksilen” = beklenen stok − sayılan stok, yani o gün standdan çıkan ürün. Eksi bir değer
        girilmemiş bir transferi veya sayım hatasını gösterir.
      </p>
    </>
  )
}

/* ----------------------------------------------------------------- Maaş */

function PayrollTab({
  data,
  from,
  to,
  onChanged,
}: {
  data: Data
  from: string
  to: string
  onChanged: () => void
}) {
  const [openSettings, setOpenSettings] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const s = data.settings

  /**
   * 1. gün ücretsiz → sonraki tier1_days gün tier1 → devamı tier2.
   * Çalışana özel ücret girilmişse son kademede o geçerli.
   */
  const rateFor = (dayIndex: number, employeeWage: number | null) => {
    if (!s) return { wage: 0, meal: 0 }
    if (dayIndex === 1) return { wage: Number(s.first_day_wage), meal: Number(s.first_day_meal) }
    if (dayIndex <= 1 + s.tier1_days) return { wage: Number(s.tier1_wage), meal: Number(s.meal_wage) }
    return {
      wage: employeeWage !== null ? Number(employeeWage) : Number(s.tier2_wage),
      meal: Number(s.meal_wage),
    }
  }

  type DayLine = {
    date: string
    dayIndex: number | null
    wage: number
    meal: number
    bonus: number
    isTraining: boolean
  }

  const rows = useMemo(() => {
    const map = new Map<
      string,
      { id: string; name: string; days: DayLine[]; wageTotal: number; mealTotal: number; bonusTotal: number }
    >()

    const bonusOf = (employeeId: string, date: string) =>
      Number(data.bonuses.find((b) => b.employee_id === employeeId && b.work_date === date)?.amount ?? 0)

    for (const p of data.payroll) {
      const employeeWage = data.employees.find((e) => e.id === p.employee_id)?.daily_wage ?? null
      const { wage, meal } = rateFor(p.day_index, employeeWage)
      const bonus = bonusOf(p.employee_id, p.work_date)

      const row =
        map.get(p.employee_id) ??
        { id: p.employee_id, name: p.full_name, days: [], wageTotal: 0, mealTotal: 0, bonusTotal: 0 }
      row.days.push({
        date: p.work_date,
        dayIndex: p.day_index,
        wage,
        meal,
        bonus,
        isTraining: p.is_training,
      })
      row.wageTotal += wage
      row.mealTotal += meal
      row.bonusTotal += bonus
      map.set(p.employee_id, row)
    }

    // Çalışma günüyle eşleşmeyen primler de hesaba katılmalı
    for (const b of data.bonuses) {
      const row = map.get(b.employee_id)
      const matched = row?.days.some((d) => d.date === b.work_date)
      if (matched) continue
      const name = data.employees.find((e) => e.id === b.employee_id)?.full_name ?? '—'
      const target =
        row ?? { id: b.employee_id, name, days: [], wageTotal: 0, mealTotal: 0, bonusTotal: 0 }
      target.days.push({
        date: b.work_date,
        dayIndex: null,
        wage: 0,
        meal: 0,
        bonus: Number(b.amount),
        isTraining: false,
      })
      target.bonusTotal += Number(b.amount)
      map.set(b.employee_id, target)
    }

    return [...map.values()]
      .map((r) => ({
        ...r,
        days: [...r.days].sort((a, b) => a.date.localeCompare(b.date)),
        total: r.wageTotal + r.mealTotal + r.bonusTotal,
      }))
      .sort((a, b) => b.total - a.total)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const grand = rows.reduce(
    (acc, r) => ({
      wage: acc.wage + r.wageTotal,
      meal: acc.meal + r.mealTotal,
      bonus: acc.bonus + r.bonusTotal,
      total: acc.total + r.total,
    }),
    { wage: 0, meal: 0, bonus: 0, total: 0 },
  )

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Yevmiye" value={money(grand.wage)} />
        <Stat label="Yemek" value={money(grand.meal)} />
        <Stat label="Prim" value={money(grand.bonus)} tone={grand.bonus < 0 ? 'bad' : 'default'} />
        <Stat label="Toplam ödenecek" value={money(grand.total)} tone="warn" />
      </div>

      <SettingsCard
        settings={s}
        open={openSettings}
        onToggle={() => setOpenSettings((v) => !v)}
        onSaved={onChanged}
      />

      <BonusCard data={data} from={from} to={to} onChanged={onChanged} />

      <Card title="Çalışan başına hesap">
        {rows.length === 0 ? (
          <Empty>Bu aralıkta çalışma kaydı yok.</Empty>
        ) : (
          <ul className="divide-y divide-stone-200">
            {rows.map((r) => {
              const isOpen = expanded === r.id
              const workedDays = r.days.filter((d) => d.dayIndex !== null).length
              return (
                <li key={r.id} className="py-2.5">
                  <button
                    onClick={() => setExpanded(isOpen ? null : r.id)}
                    className="flex w-full items-baseline justify-between gap-3 text-left"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-stone-800">{r.name}</span>
                      <span className="text-xs text-stone-500">
                        {workedDays} gün · yevmiye {money(r.wageTotal)} · yemek {money(r.mealTotal)}
                        {r.bonusTotal !== 0 && ` · prim ${money(r.bonusTotal)}`}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-semibold tabular-nums text-stone-900">
                        {money(r.total)}
                      </span>
                      <span className="text-[11px] text-brand-700">{isOpen ? 'gizle ▴' : 'gün gün ▾'}</span>
                    </span>
                  </button>

                  {isOpen && (
                    <ul className="mt-2 space-y-1 rounded-xl bg-stone-50 p-2">
                      {r.days.map((d) => (
                        <li key={d.date} className="flex items-center justify-between gap-2 text-xs">
                          <span className="tabular-nums text-stone-600">
                            {formatShort(d.date)}
                            {d.dayIndex !== null && (
                              <span className="ml-1 text-stone-400">{d.dayIndex}. gün</span>
                            )}
                            {d.isTraining && <span className="ml-1 text-amber-700">eğitim</span>}
                          </span>
                          <span className="shrink-0 tabular-nums text-stone-700">
                            {money(d.wage)}
                            {d.meal > 0 && <span className="text-stone-400"> +{money(d.meal)}</span>}
                            {d.bonus !== 0 && (
                              <span className={d.bonus < 0 ? 'text-red-700' : 'text-emerald-700'}>
                                {' '}
                                {d.bonus > 0 ? '+' : '−'}
                                {money(Math.abs(d.bonus))}
                              </span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <p className="text-xs text-stone-500">
        Aynı gün iki vardiya çalışılsa da bir gün sayılır. Kademe sayacı kişinin işe başladığı ilk
        günden işler, seçtiğin tarih aralığından değil.
      </p>
    </>
  )
}

function SettingsCard({
  settings,
  open,
  onToggle,
  onSaved,
}: {
  settings: PayrollSettings | null
  open: boolean
  onToggle: () => void
  onSaved: () => void
}) {
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const value = (key: keyof PayrollSettings) =>
    draft[key] ?? (settings ? String(settings[key]) : '')

  const fields: { key: keyof PayrollSettings; label: string; hint?: string }[] = [
    { key: 'first_day_wage', label: 'İlk gün ücreti (₺)' },
    { key: 'first_day_meal', label: 'İlk gün yemek (₺)' },
    { key: 'tier1_days', label: 'İlk günden sonra kaç gün', hint: 'bu kadar gün düşük ücret' },
    { key: 'tier1_wage', label: 'Bu günlerin ücreti (₺)' },
    { key: 'tier2_wage', label: 'Sonraki günlerin ücreti (₺)' },
    { key: 'meal_wage', label: 'Günlük yemek (₺)' },
  ]

  async function save() {
    setBusy(true)
    setError(null)
    const payload: Record<string, number> = {}
    for (const f of fields) payload[f.key] = parseNumber(value(f.key))
    const { error } = await supabase.from('payroll_settings').update(payload).eq('id', true)
    if (error) setError(error.message)
    else {
      setDraft({})
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onSaved()
    }
    setBusy(false)
  }

  return (
    <Card
      title="Ücret kademeleri"
      action={
        <button onClick={onToggle} className="text-xs font-medium text-brand-700">
          {open ? 'gizle ▴' : 'değiştir ▾'}
        </button>
      }
    >
      {!settings ? (
        <Empty>Ayarlar bulunamadı — 0001_init.sql'i tekrar çalıştır.</Empty>
      ) : !open ? (
        <p className="text-sm text-stone-600">
          İlk gün <strong>{money(settings.first_day_wage)}</strong> (yemek{' '}
          {money(settings.first_day_meal)}) · sonraki <strong>{settings.tier1_days} gün</strong>{' '}
          <strong>{money(settings.tier1_wage)}</strong> · devamı{' '}
          <strong>{money(settings.tier2_wage)}</strong> · günlük yemek{' '}
          <strong>{money(settings.meal_wage)}</strong>
        </p>
      ) : (
        <>
          {error && (
            <div className="mb-3">
              <ErrorBox message={error} />
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            {fields.map((f) => (
              <Field key={f.key} label={f.label} hint={f.hint}>
                <Input
                  inputMode="decimal"
                  value={value(f.key)}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                />
              </Field>
            ))}
          </div>
          <Button className="mt-3 w-full sm:w-auto" onClick={() => void save()} disabled={busy}>
            {saved ? '✓ Kaydedildi' : 'Kademeleri kaydet'}
          </Button>
          <p className="mt-2 text-xs text-stone-500">
            Çalışana özel ücret vermek istersen “Tanımlar → Çalışanlar” ekranındaki yevmiye alanını
            doldur; o kişi son kademede bu tutar yerine kendi ücretini alır.
          </p>
        </>
      )}
    </Card>
  )
}

function BonusCard({
  data,
  from,
  to,
  onChanged,
}: {
  data: Data
  from: string
  to: string
  onChanged: () => void
}) {
  const [date, setDate] = useState(to)
  const [employeeId, setEmployeeId] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function add() {
    const value = parseNumber(amount)
    if (!employeeId) {
      setError('Çalışan seç.')
      return
    }
    if (value === 0) {
      setError('Tutar 0 olamaz.')
      return
    }
    setBusy(true)
    setError(null)
    const { error } = await supabase
      .from('employee_bonuses')
      .upsert(
        { work_date: date, employee_id: employeeId, amount: value, note: note.trim() || null },
        { onConflict: 'work_date,employee_id' },
      )
    if (error) setError(error.message)
    else {
      setAmount('')
      setNote('')
      onChanged()
    }
    setBusy(false)
  }

  async function remove(id: string) {
    setBusy(true)
    const { error } = await supabase.from('employee_bonuses').delete().eq('id', id)
    if (error) setError(error.message)
    else onChanged()
    setBusy(false)
  }

  const nameOf = (id: string) => data.employees.find((e) => e.id === id)?.full_name ?? '—'
  const list = [...data.bonuses].sort((a, b) => b.work_date.localeCompare(a.work_date))

  return (
    <Card title="Prim">
      {error && (
        <div className="mb-3">
          <ErrorBox message={error} />
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Tarih">
          <Input type="date" value={date} min={from} max={to} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Çalışan">
          <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">Seç…</option>
            {data.employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tutar (₺)" hint="Eksi yazarsan kesinti olur">
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
        </Field>
        <Field label="Açıklama">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="İsteğe bağlı" />
        </Field>
      </div>
      <Button className="mt-3 w-full sm:w-auto" onClick={() => void add()} disabled={busy}>
        Prim ekle
      </Button>

      {list.length > 0 && (
        <ul className="mt-4 divide-y divide-stone-100 text-sm">
          {list.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 truncate">
                {formatShort(b.work_date)} · {nameOf(b.employee_id)}
                {b.note ? <span className="text-stone-500"> · {b.note}</span> : null}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span
                  className={`tabular-nums font-semibold ${
                    Number(b.amount) < 0 ? 'text-red-700' : 'text-emerald-700'
                  }`}
                >
                  {Number(b.amount) > 0 ? '+' : '−'}
                  {money(Math.abs(Number(b.amount)))}
                </span>
                <Button variant="ghost" size="icon" onClick={() => void remove(b.id)} disabled={busy}>
                  ✕
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
