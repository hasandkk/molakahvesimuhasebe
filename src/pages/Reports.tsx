import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useQuery } from '../lib/useQuery'
import { fetchActiveEmployees, fetchAllStands } from '../lib/refData'
import { formatLong, formatShort, startOfMonth, today } from '../lib/date'
import { money, qty } from '../lib/format'
import {
  MOVEMENT_LABELS,
  type CashMovement,
  type Employee,
  type Stand,
  type StockMovementRow,
} from '../lib/types'
import { Card, Empty, ErrorBox, Field, Input, Select, Spinner, Stat, Tabs } from '../components/ui'

type Tab = 'ozet' | 'vardiya' | 'stok'

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
}

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '')

async function load(from: string, to: string): Promise<Data> {
  const [stands, employees, revenues, movements, shifts, stock] = await Promise.all([
    fetchAllStands(),
    fetchActiveEmployees(),
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
  ])

  const err = revenues.error ?? movements.error ?? shifts.error ?? stock.error
  if (err) throw err

  return {
    stands,
    employees,
    revenues: (revenues.data ?? []) as RevenueRow[],
    movements: (movements.data ?? []) as CashMovement[],
    shifts: (shifts.data ?? []) as unknown as ShiftRow[],
    stock: (stock.data ?? []) as StockMovementRow[],
  }
}

export default function Reports() {
  const [tab, setTab] = useState<Tab>('ozet')
  const [from, setFrom] = useState(startOfMonth(today()))
  const [to, setTo] = useState(today())
  const { data, loading, error } = useQuery(() => load(from, to), [from, to])

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
        ]}
      />

      {error && <ErrorBox message={error} />}
      {loading && !data && <Spinner />}

      {data && tab === 'ozet' && <SummaryTab data={data} />}
      {data && tab === 'vardiya' && <ShiftHistoryTab data={data} />}
      {data && tab === 'stok' && <StockHistoryTab data={data} />}
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
    const map = new Map<string, { shifts: number; trainings: number }>()
    for (const s of data.shifts) {
      const name = s.employees?.full_name ?? '—'
      const row = map.get(name) ?? { shifts: 0, trainings: 0 }
      if (s.kind === 'egitim') row.trainings += 1
      else row.shifts += 1
      map.set(name, row)
    }
    return [...map.entries()].sort((a, b) => b[1].shifts - a[1].shifts)
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

      <Card title="Çalışan başına vardiya sayısı">
        {byEmployee.length === 0 ? (
          <Empty>Bu aralıkta vardiya kaydı yok.</Empty>
        ) : (
          <ul className="divide-y divide-stone-100 text-sm">
            {byEmployee.map(([name, row]) => (
              <li key={name} className="flex justify-between gap-3 py-2">
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
