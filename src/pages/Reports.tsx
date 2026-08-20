import { Fragment, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useQuery } from '../lib/useQuery'
import { fetchAllEmployees, fetchAllStands } from '../lib/refData'
import { addDays, formatDayMonth, formatLong, formatShort, startOfMonth, startOfWeek, today } from '../lib/date'
import { money, parseNumber, qty } from '../lib/format'
import {
  type Employee,
  type EmployeeBonus,
  type PayrollRow,
  type PayrollSettings,
  type Stand,
  type WageMode,
  type StockSaleRow,
  type StockVarianceRow,
} from '../lib/types'
import { Button, Card, Empty, ErrorBox, Field, Input, Select, Spinner, Stat, Tabs } from '../components/ui'
import { PrintDoc, PrintEmpty, PrintFacts, PrintSection } from '../components/print'

type Tab = 'ozet' | 'vardiya' | 'stok' | 'maas'

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
  shifts: ShiftRow[]
  sales: StockSaleRow[]
  variances: StockVarianceRow[]
  settings: PayrollSettings | null
}

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '')

async function load(from: string, to: string): Promise<Data> {
  const [stands, employees, shifts, sales, variances, settings] = await Promise.all([
    fetchAllStands(),
    fetchAllEmployees(),
    supabase
      .from('shift_assignments')
      .select('work_date, kind, start_time, end_time, stand_id, employee_id, stands(name), employees(full_name)')
      .gte('work_date', from)
      .lte('work_date', to),
    supabase.rpc('stock_daily_sales', { p_from: from, p_to: to, p_stand_id: null }),
    supabase.rpc('stock_count_variance', { p_from: from, p_to: to, p_stand_id: null }),
    supabase.from('payroll_settings').select('*').limit(1),
  ])

  const err = shifts.error ?? sales.error ?? variances.error ?? settings.error
  if (err) throw err

  return {
    stands,
    employees,
    shifts: (shifts.data ?? []) as unknown as ShiftRow[],
    sales: (sales.data ?? []) as StockSaleRow[],
    variances: (variances.data ?? []) as StockVarianceRow[],
    settings: ((settings.data ?? [])[0] as PayrollSettings | undefined) ?? null,
  }
}

export default function Reports() {
  const [tab, setTab] = useState<Tab>('ozet')
  const [from, setFrom] = useState(startOfMonth(today()))
  const [to, setTo] = useState(today())
  const { data, loading, error } = useQuery(() => load(from, to), [from, to])

  const period = `${formatShort(from)} – ${formatShort(to)}`

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-stone-900">Raporlar</h1>
        <Button variant="secondary" size="sm" onClick={() => window.print()}>
          PDF / Yazdır
        </Button>
      </div>

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
          { id: 'stok', label: 'Satış geçmişi' },
          { id: 'maas', label: 'Maaş' },
        ]}
      />

      {error && <ErrorBox message={error} />}
      {loading && !data && <Spinner />}

      {data && tab === 'ozet' && <SummaryTab data={data} period={period} />}
      {data && tab === 'vardiya' && <ShiftHistoryTab data={data} period={period} />}
      {data && tab === 'stok' && <StockHistoryTab data={data} period={period} />}
      {data && tab === 'maas' && <PayrollTab data={data} from={from} to={to} />}

      <p className="text-xs text-stone-500">
        <strong>PDF / Yazdır</strong> açık sekmedeki raporu A4 düzeninde çıkarır. Telefonda çıkan
        yazdırma ekranında yazıcı yerine <strong>“PDF olarak kaydet”</strong> seçilirse dosya olarak
        iner.
      </p>
    </>
  )
}

/* ------------------------------------------------------------------ Özet */

function SummaryTab({ data, period }: { data: Data; period: string }) {
  /** Stand başına: kaç vardiya, kaç eğitim, kaç ayrı gün açık kaldı */
  const byStand = useMemo(
    () =>
      data.stands
        .map((stand) => {
          const rows = data.shifts.filter((s) => s.stand_id === stand.id)
          return {
            stand,
            shifts: rows.filter((s) => s.kind !== 'egitim').length,
            trainings: rows.filter((s) => s.kind === 'egitim').length,
            days: new Set(rows.map((s) => s.work_date)).size,
          }
        })
        .filter((r) => r.days > 0 || r.stand.is_active)
        .sort((a, b) => b.shifts - a.shifts),
    [data],
  )

  const byEmployee = useMemo(() => {
    const map = new Map<string, { name: string; shifts: number; trainings: number; days: Set<string> }>()
    for (const s of data.shifts) {
      const row = map.get(s.employee_id) ?? {
        name: s.employees?.full_name ?? '—',
        shifts: 0,
        trainings: 0,
        days: new Set<string>(),
      }
      if (s.kind === 'egitim') row.trainings += 1
      else row.shifts += 1
      row.days.add(s.work_date)
      map.set(s.employee_id, row)
    }
    return [...map.values()].sort((a, b) => b.shifts - a.shifts)
  }, [data])

  const totals = useMemo(
    () => ({
      shifts: data.shifts.filter((s) => s.kind !== 'egitim').length,
      trainings: data.shifts.filter((s) => s.kind === 'egitim').length,
      days: new Set(data.shifts.map((s) => s.work_date)).size,
      soldQty: data.sales.reduce((sum, r) => sum + Number(r.quantity), 0),
    }),
    [data],
  )

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Vardiya" value={totals.shifts} />
        <Stat label="Eğitim" value={totals.trainings} />
        <Stat label="Çalışılan gün" value={totals.days} />
        <Stat label="Satılan" value={`${qty(totals.soldQty)} kalem`} />
      </div>

      <Card title="Stand başına vardiya">
        {byStand.length === 0 ? (
          <Empty>Bu aralıkta vardiya kaydı yok.</Empty>
        ) : (
          <ul className="divide-y divide-stone-100 text-sm">
            {byStand.map((row) => (
              <li key={row.stand.id} className="flex items-baseline justify-between gap-3 py-2">
                <span className="min-w-0 truncate text-stone-800">{row.stand.name}</span>
                <span className="shrink-0 tabular-nums text-stone-600">
                  {row.shifts} vardiya · {row.days} gün
                  {row.trainings > 0 && (
                    <span className="ml-1 text-amber-700">· {row.trainings} eğitim</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

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
                    {row.shifts} vardiya · {row.days.size} gün
                    {row.trainings > 0 && (
                      <span className="ml-1 text-amber-700">· {row.trainings} eğitim</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-stone-500">
              Ödenecek tutar için “Maaş” sekmesine bak — kademeli yevmiye ve prim orada hesaplanır.
            </p>
          </>
        )}
      </Card>

      <PrintDoc title="Özet raporu" period={period}>
        <PrintFacts
          items={[
            { label: 'Vardiya', value: String(totals.shifts) },
            { label: 'Eğitim', value: String(totals.trainings) },
            { label: 'Çalışılan gün', value: String(totals.days) },
            { label: 'Satılan', value: `${qty(totals.soldQty)} kalem` },
          ]}
        />

        <PrintSection title="Stand başına vardiya">
          {byStand.length === 0 ? (
            <PrintEmpty>Bu aralıkta vardiya kaydı yok.</PrintEmpty>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Stand</th>
                  <th className="num">Vardiya</th>
                  <th className="num">Eğitim</th>
                  <th className="num">Gün</th>
                </tr>
              </thead>
              <tbody>
                {byStand.map((row) => (
                  <tr key={row.stand.id}>
                    <td>{row.stand.name}</td>
                    <td className="num">{row.shifts}</td>
                    <td className="num muted">{row.trainings || '—'}</td>
                    <td className="num muted">{row.days}</td>
                  </tr>
                ))}
                <tr className="total-row">
                  <td>Toplam</td>
                  <td className="num">{totals.shifts}</td>
                  <td className="num">{totals.trainings}</td>
                  <td className="num">{totals.days}</td>
                </tr>
              </tbody>
            </table>
          )}
        </PrintSection>

        <PrintSection title="Çalışan başına vardiya">
          {byEmployee.length === 0 ? (
            <PrintEmpty>Bu aralıkta vardiya kaydı yok.</PrintEmpty>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Çalışan</th>
                  <th className="num">Vardiya</th>
                  <th className="num">Eğitim</th>
                  <th className="num">Gün</th>
                </tr>
              </thead>
              <tbody>
                {byEmployee.map((row) => (
                  <tr key={row.name}>
                    <td>{row.name}</td>
                    <td className="num">{row.shifts}</td>
                    <td className="num muted">{row.trainings || '—'}</td>
                    <td className="num muted">{row.days.size}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="note">
            Ödenecek tutar “Maaş” sekmesinde hesaplanır. Aynı gün iki vardiya çalışılsa da gün
            sayısı bir artar.
          </p>
        </PrintSection>
      </PrintDoc>
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

function ShiftHistoryTab({ data, period }: { data: Data; period: string }) {
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

      <PrintDoc
        title={selected ? `Vardiya geçmişi — ${selected.full_name}` : 'Vardiya geçmişi'}
        period={period}
      >
        <PrintFacts
          items={[
            { label: 'Vardiya', value: String(filtered.filter((s) => s.kind === 'vardiya').length) },
            { label: 'Eğitim', value: String(filtered.filter((s) => s.kind === 'egitim').length) },
            { label: 'Gün', value: String(new Set(filtered.map((s) => s.work_date)).size) },
          ]}
        />

        <PrintSection title={selected ? 'Çalışılan günler' : 'Gün gün vardiyalar'}>
          {filtered.length === 0 ? (
            <PrintEmpty>Bu aralıkta vardiya kaydı yok.</PrintEmpty>
          ) : selected ? (
            <table>
              <thead>
                <tr>
                  <th className="num">Tarih</th>
                  <th>Stand</th>
                  <th className="num">Saat</th>
                  <th>Tür</th>
                </tr>
              </thead>
              <tbody>
                {flat.map((s, i) => (
                  <tr key={`${s.work_date}-${s.stand_id}-${i}`}>
                    <td className="num">{formatShort(s.work_date)}</td>
                    <td>{s.stands?.name ?? '—'}</td>
                    <td className="num">
                      {s.start_time ? `${hhmm(s.start_time)}–${hhmm(s.end_time)}` : '—'}
                    </td>
                    <td className="muted">{s.kind === 'egitim' ? 'Eğitim' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Stand</th>
                  <th className="num">Saat</th>
                  <th>Çalışan</th>
                  <th>Tür</th>
                </tr>
              </thead>
              <tbody>
                {byDate.map((day) => (
                  <Fragment key={day.date}>
                    <tr className="group-row">
                      <td colSpan={4}>{formatLong(day.date)}</td>
                    </tr>
                    {day.stands.map((stand) =>
                      stand.list.map((s, i) => (
                        <tr key={`${day.date}-${stand.name}-${s.employee_id}-${i}`}>
                          <td>{i === 0 ? stand.name : ''}</td>
                          <td className="num">
                            {s.start_time ? `${hhmm(s.start_time)}–${hhmm(s.end_time)}` : '—'}
                          </td>
                          <td>{s.employees?.full_name ?? '—'}</td>
                          <td className="muted">{s.kind === 'egitim' ? 'Eğitim' : ''}</td>
                        </tr>
                      )),
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </PrintSection>
      </PrintDoc>
    </>
  )
}

/* --------------------------------------------------- Satış / stok geçmişi */

function StockHistoryTab({ data, period }: { data: Data; period: string }) {
  const [standId, setStandId] = useState('')

  const sales = useMemo(
    () => (standId ? data.sales.filter((r) => r.stand_id === standId) : data.sales),
    [data.sales, standId],
  )
  const variances = useMemo(
    () => (standId ? data.variances.filter((r) => r.stand_id === standId) : data.variances),
    [data.variances, standId],
  )

  const totalQty = sales.reduce((s, r) => s + Number(r.quantity), 0)
  const salesDays = new Set(sales.map((r) => r.sale_date)).size

  /** Tarih (yeniden eskiye) → stand → gramajlar */
  const byDate = useMemo(() => {
    const days = new Map<string, Map<string, StockSaleRow[]>>()
    for (const r of sales) {
      const stands = days.get(r.sale_date) ?? new Map<string, StockSaleRow[]>()
      stands.set(r.stand_name, [...(stands.get(r.stand_name) ?? []), r])
      days.set(r.sale_date, stands)
    }
    return [...days.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, stands]) => ({
        date,
        stands: [...stands.entries()].sort((a, b) => a[0].localeCompare(b[0], 'tr')),
      }))
  }, [sales])

  /**
   * Yazdırma için dönem toplamı: satır gramaj, sütun stand. Ekranda yok —
   * kâğıtta "bu ay hangi standda hangi gramajdan kaç adet gitti" tek bakışta
   * görünsün diye.
   */
  const pivot = useMemo(() => {
    const standNames = [...new Set(sales.map((r) => r.stand_name))].sort((a, b) =>
      a.localeCompare(b, 'tr'),
    )
    const sizes = new Map<string, { label: string; unit: string; sort: number }>()
    const cells = new Map<string, number>()
    for (const r of sales) {
      if (!sizes.has(r.variant_id)) {
        sizes.set(r.variant_id, { label: r.size_label, unit: r.unit, sort: sizes.size })
      }
      const key = `${r.variant_id}|${r.stand_name}`
      cells.set(key, (cells.get(key) ?? 0) + Number(r.quantity))
    }
    const rows = [...sizes.entries()].map(([variantId, size]) => {
      const perStand = standNames.map((name) => cells.get(`${variantId}|${name}`) ?? 0)
      return { variantId, ...size, perStand, total: perStand.reduce((s, v) => s + v, 0) }
    })
    return {
      standNames,
      rows,
      columnTotals: standNames.map((_, i) => rows.reduce((s, r) => s + r.perStand[i], 0)),
    }
  }, [sales])

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

      <div className="grid grid-cols-2 gap-3">
        <Stat label="Satılan" value={`${qty(totalQty)} kalem`} />
        <Stat label="Satış girilen gün" value={salesDays} />
      </div>

      {variances.length > 0 && (
        <Card
          title="Sayım farkları"
          action={<span className="text-xs text-stone-500">{variances.length} kalem</span>}
        >
          <ul className="divide-y divide-stone-100 text-sm">
            {variances.map((v) => (
              <li key={`${v.count_date}-${v.stand_id}-${v.variant_id}`} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 truncate">
                  {formatShort(v.count_date)} · {v.stand_name} · {v.size_label}
                  <span className="ml-1 text-xs text-stone-400">
                    {qty(v.on_hand)} → {qty(v.counted_qty)}
                  </span>
                </span>
                <span
                  className={`shrink-0 tabular-nums font-semibold ${
                    Number(v.variance) < 0 ? 'text-red-700' : 'text-amber-700'
                  }`}
                >
                  {Number(v.variance) > 0 ? '+' : '−'}
                  {qty(Math.abs(Number(v.variance)))}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-stone-500">
            Sayımda bulunan miktar ile olması gereken arasındaki fark. Eksi değer fire, kayıp ya da
            girilmemiş satış demektir.
          </p>
        </Card>
      )}

      {byDate.length === 0 ? (
        <Card>
          <Empty>Bu aralıkta satış kaydı yok. Stok ekranındaki “Günlük satış” sekmesinden girilir.</Empty>
        </Card>
      ) : (
        byDate.map((day) => (
          <Card key={day.date} title={formatLong(day.date)}>
            <div className="space-y-4">
              {day.stands.map(([standName, list]) => {
                return (
                  <div key={standName}>
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                        {standName}
                      </h3>
                      <span className="text-xs tabular-nums text-stone-500">
                        {qty(list.reduce((sum, r) => sum + Number(r.quantity), 0))} kalem
                      </span>
                    </div>
                    <ul className="mt-1 divide-y divide-stone-100">
                      {list.map((r) => (
                        <li key={r.variant_id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                          <span className="min-w-0 truncate text-stone-700">
                            {r.size_label}
                            <span className="ml-1 text-xs text-stone-400">{r.unit}</span>
                          </span>
                          <span className="w-16 shrink-0 text-right font-semibold tabular-nums text-stone-900">
                            {qty(r.quantity)}
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

      <PrintDoc
        title={
          standId
            ? `Satış geçmişi — ${data.stands.find((s) => s.id === standId)?.name ?? ''}`
            : 'Satış geçmişi'
        }
        period={period}
      >
        <PrintFacts
          items={[
            { label: 'Satılan', value: `${qty(totalQty)} kalem` },
            { label: 'Satış girilen gün', value: String(salesDays) },
            { label: 'Sayım farkı', value: `${variances.length} kalem` },
          ]}
        />

        <PrintSection title="Dönem toplamı">
          {pivot.rows.length === 0 ? (
            <PrintEmpty>Bu aralıkta satış kaydı yok.</PrintEmpty>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Gramaj</th>
                  {pivot.standNames.map((name) => (
                    <th key={name} className="num">
                      {name}
                    </th>
                  ))}
                  <th className="num">Toplam</th>
                </tr>
              </thead>
              <tbody>
                {pivot.rows.map((row) => (
                  <tr key={row.variantId}>
                    <td>
                      {row.label} <span className="muted">{row.unit}</span>
                    </td>
                    {row.perStand.map((value, i) => (
                      <td key={pivot.standNames[i]} className="num">
                        {value ? qty(value) : '—'}
                      </td>
                    ))}
                    <td className="num">{qty(row.total)}</td>
                  </tr>
                ))}
                <tr className="total-row">
                  <td>Toplam</td>
                  {pivot.columnTotals.map((value, i) => (
                    <td key={pivot.standNames[i]} className="num">
                      {qty(value)}
                    </td>
                  ))}
                  <td className="num">{qty(totalQty)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </PrintSection>

        {variances.length > 0 && (
          <PrintSection title="Sayım farkları">
            <table>
              <thead>
                <tr>
                  <th className="num">Tarih</th>
                  <th>Stand</th>
                  <th>Gramaj</th>
                  <th className="num">Olması gereken</th>
                  <th className="num">Sayılan</th>
                  <th className="num">Fark</th>
                </tr>
              </thead>
              <tbody>
                {variances.map((v) => (
                  <tr key={`${v.count_date}-${v.stand_id}-${v.variant_id}`}>
                    <td className="num">{formatShort(v.count_date)}</td>
                    <td>{v.stand_name}</td>
                    <td>{v.size_label}</td>
                    <td className="num muted">{qty(v.on_hand)}</td>
                    <td className="num muted">{qty(v.counted_qty)}</td>
                    <td className="num">
                      {Number(v.variance) > 0 ? '+' : '−'}
                      {qty(Math.abs(Number(v.variance)))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="note">
              Sayımda bulunan miktar ile olması gereken arasındaki fark. Eksi değer fire, kayıp ya da
              girilmemiş satış demektir.
            </p>
          </PrintSection>
        )}

        {byDate.length > 0 && (
          <PrintSection title="Gün gün satışlar">
            {/* Gramajlar sütun: kalem kalem alt alta yazmak 12 günde 6 sayfa
                tutuyordu, bu düzende her stand tek satır. */}
            <table>
              <thead>
                <tr>
                  <th>Stand</th>
                  {pivot.rows.map((c) => (
                    <th key={c.variantId} className="num">
                      {c.label}
                    </th>
                  ))}
                  <th className="num">Toplam</th>
                </tr>
              </thead>
              <tbody>
                {byDate.map((day) => (
                  <Fragment key={day.date}>
                    <tr className="group-row">
                      <td colSpan={pivot.rows.length + 2}>{formatLong(day.date)}</td>
                    </tr>
                    {day.stands.map(([standName, list]) => (
                      <tr key={`${day.date}-${standName}`}>
                        <td>{standName}</td>
                        {pivot.rows.map((c) => {
                          const found = list.find((r) => r.variant_id === c.variantId)
                          return (
                            <td key={c.variantId} className="num">
                              {found ? qty(found.quantity) : '—'}
                            </td>
                          )
                        })}
                        <td className="num">
                          {qty(list.reduce((sum, r) => sum + Number(r.quantity), 0))}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </PrintSection>
        )}
      </PrintDoc>
    </>
  )
}

/* ----------------------------------------------------------------- Maaş */

type PayrollData = {
  payroll: PayrollRow[]
  bonuses: EmployeeBonus[]
  settings: PayrollSettings | null
}

// Kademeler de burada okunuyor: "kaydet"ten sonra reload() ayarları da
// tazelesin diye. Üstteki load() ayrı bir kopya tutuyor ama bu sekmede
// her zaman buradaki taze hali kullanılır.
async function loadPayroll(from: string, to: string): Promise<PayrollData> {
  const [payroll, bonuses, settings] = await Promise.all([
    supabase.rpc('payroll', { p_from: from, p_to: to }),
    supabase.from('employee_bonuses').select('*').gte('work_date', from).lte('work_date', to),
    supabase.from('payroll_settings').select('*').limit(1),
  ])
  if (payroll.error) throw payroll.error
  if (bonuses.error) throw bonuses.error
  if (settings.error) throw settings.error
  return {
    payroll: (payroll.data ?? []) as PayrollRow[],
    bonuses: (bonuses.data ?? []) as EmployeeBonus[],
    settings: (settings.data?.[0] as PayrollSettings | undefined) ?? null,
  }
}

function PayrollTab({ data, from, to }: { data: Data; from: string; to: string }) {
  const [mode, setMode] = useState<'haftalik' | 'aralik'>('haftalik')
  // Ödeme günü pazartesi; kapsanan dönem bir önceki pazartesi–pazar.
  // Varsayılan: bugünden sonraki ilk pazartesi (bugün pazartesiyse bugün).
  // Hafta ortasında bakınca "bu hafta ne birikti" görünsün diye.
  const nextPayDay = () => {
    const monday = startOfWeek(today())
    return monday === today() ? monday : addDays(monday, 7)
  }
  const [payDay, setPayDay] = useState(nextPayDay)
  const [openSettings, setOpenSettings] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const period =
    mode === 'haftalik' ? { from: addDays(payDay, -7), to: addDays(payDay, -1) } : { from, to }

  const {
    data: pd,
    loading,
    error,
    reload,
  } = useQuery(() => loadPayroll(period.from, period.to), [period.from, period.to])

  // Kaydetten sonra taze hali gelsin diye önce sekmenin kendi verisi.
  const s = pd?.settings ?? data.settings

  /**
   * kademeli: ilk tier1_days gün tier1 ücreti → devamı tam ücret
   * tam:      ilk günden itibaren tam ücret
   */
  const rateFor = (dayIndex: number, employeeWage: number | null, wageMode: WageMode) => {
    if (!s) return 0
    if (wageMode === 'odemesiz') return 0
    const fullWage = employeeWage !== null ? Number(employeeWage) : Number(s.tier2_wage)
    if (wageMode === 'tam') return fullWage
    if (dayIndex <= s.tier1_days) return Number(s.tier1_wage)
    return fullWage
  }

  type DayLine = {
    date: string
    dayIndex: number | null
    wage: number
    bonus: number
    isTraining: boolean
  }

  const rows = useMemo(() => {
    if (!pd) return []
    const map = new Map<
      string,
      {
        id: string
        name: string
        wageMode: WageMode
        days: DayLine[]
        wageTotal: number
        bonusTotal: number
      }
    >()

    const bonusOf = (employeeId: string, date: string) =>
      Number(pd.bonuses.find((b) => b.employee_id === employeeId && b.work_date === date)?.amount ?? 0)

    for (const p of pd.payroll) {
      const emp = data.employees.find((e) => e.id === p.employee_id)
      const wageMode = (emp?.wage_mode ?? 'kademeli') as WageMode
      const wage = rateFor(p.day_index, emp?.daily_wage ?? null, wageMode)
      const bonus = bonusOf(p.employee_id, p.work_date)

      const row =
        map.get(p.employee_id) ??
        {
          id: p.employee_id,
          name: p.full_name,
          wageMode,
          days: [],
          wageTotal: 0,
          bonusTotal: 0,
        }
      row.days.push({
        date: p.work_date,
        dayIndex: p.day_index,
        wage,
        bonus,
        isTraining: p.is_training,
      })
      row.wageTotal += wage
      row.bonusTotal += bonus
      map.set(p.employee_id, row)
    }

    // Çalışma günüyle eşleşmeyen primler de hesaba katılmalı
    for (const b of pd.bonuses) {
      const row = map.get(b.employee_id)
      if (row?.days.some((d) => d.date === b.work_date)) continue
      const emp = data.employees.find((e) => e.id === b.employee_id)
      const target =
        row ??
        {
          id: b.employee_id,
          name: emp?.full_name ?? '—',
          wageMode: (emp?.wage_mode ?? 'kademeli') as WageMode,
          days: [],
          wageTotal: 0,
          bonusTotal: 0,
        }
      target.days.push({
        date: b.work_date,
        dayIndex: null,
        wage: 0,
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
        total: r.wageTotal + r.bonusTotal,
      }))
      .sort((a, b) => b.total - a.total)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pd, data.employees, s])

  const grand = rows.reduce(
    (acc, r) => ({
      wage: acc.wage + r.wageTotal,
      bonus: acc.bonus + r.bonusTotal,
      total: acc.total + r.total,
    }),
    { wage: 0, bonus: 0, total: 0 },
  )

  const donemMetni = `${formatDayMonth(period.from)} – ${formatDayMonth(period.to)}`

  const odemeMetni = useMemo(() => {
    const lines = [
      mode === 'haftalik'
        ? `💰 ${formatLong(payDay)} ödemesi — ${donemMetni} dönemi`
        : `💰 ${donemMetni} dönemi ödemesi`,
      '',
    ]
    for (const r of rows) {
      const gun = r.days.filter((d) => d.dayIndex !== null).length
      lines.push(`${r.name} — ${gun} gün · ${money(r.total)}`)
    }
    lines.push('', `Toplam: ${money(grand.total)}`)
    return lines.join('\n')
  }, [rows, grand.total, payDay, donemMetni, mode])

  async function copyText() {
    try {
      await navigator.clipboard.writeText(odemeMetni)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* pano yoksa sessiz geç */
    }
  }

  return (
    <>
      <Tabs
        active={mode}
        onChange={setMode}
        tabs={[
          { id: 'haftalik' as const, label: 'Haftalık ödeme' },
          { id: 'aralik' as const, label: 'Seçili aralık' },
        ]}
      />

      {mode === 'haftalik' && (
        <div className="rounded-2xl border border-stone-200 bg-white p-3 shadow-sm">
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="icon"
              onClick={() => setPayDay(addDays(payDay, -7))}
              aria-label="Önceki hafta"
            >
              ‹
            </Button>
            <div className="min-w-0 flex-1 text-center">
              <div className="text-sm font-semibold text-stone-900">{formatLong(payDay)}</div>
              <div className="text-xs text-stone-500">ödeme günü · {donemMetni} dönemi</div>
            </div>
            <Button
              variant="secondary"
              size="icon"
              onClick={() => setPayDay(addDays(payDay, 7))}
              aria-label="Sonraki hafta"
            >
              ›
            </Button>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="mt-2 w-full"
            onClick={() => setPayDay(nextPayDay())}
          >
            Yaklaşan ödeme
          </Button>
        </div>
      )}

      {!s && (
        <ErrorBox message="Ücret kademeleri bulunamadı, bu yüzden tüm tutarlar sıfır görünüyor. 0001_init.sql betiğini çalıştır." />
      )}

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Yevmiye" value={money(grand.wage)} />
        <Stat label="Prim" value={money(grand.bonus)} tone={grand.bonus < 0 ? 'bad' : 'default'} />
        <Stat label="Toplam ödenecek" value={money(grand.total)} tone="warn" />
      </div>

      {error && <ErrorBox message={error} />}
      {loading && !pd && <Spinner />}

      <SettingsCard
        settings={s}
        open={openSettings}
        onToggle={() => setOpenSettings((v) => !v)}
        onSaved={reload}
      />

      <BonusCard
        key={`${period.from}-${period.to}`}
        employees={data.employees}
        bonuses={pd?.bonuses ?? []}
        from={period.from}
        to={period.to}
        onChanged={reload}
      />

      <Card
        title="Çalışan başına hesap"
        action={
          rows.length > 0 && (
            <Button size="sm" variant="secondary" onClick={() => void copyText()}>
              {copied ? '✓ Kopyalandı' : 'Listeyi kopyala'}
            </Button>
          )
        }
      >
        {rows.length === 0 ? (
          <Empty>Bu dönemde çalışma kaydı yok.</Empty>
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
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-stone-800">{r.name}</span>
                        {r.wageMode === 'tam' && (
                          <span className="shrink-0 rounded-md bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800">
                            tam ücret
                          </span>
                        )}
                        {r.wageMode === 'odemesiz' && (
                          <span className="shrink-0 rounded-md bg-stone-200 px-1.5 py-0.5 text-[10px] font-semibold text-stone-600">
                            ödeme yok
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-stone-500">
                        {workedDays} gün · yevmiye {money(r.wageTotal)}
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

      <PrintDoc
        title={
          mode === 'haftalik' ? `Ödeme listesi — ${formatLong(payDay)}` : 'Ödeme listesi'
        }
        period={`${formatShort(period.from)} – ${formatShort(period.to)}`}
      >
        <PrintFacts
          items={[
            { label: 'Yevmiye', value: money(grand.wage) },
            { label: 'Prim', value: money(grand.bonus) },
            { label: 'Toplam ödenecek', value: money(grand.total) },
          ]}
        />

        <PrintSection title="Çalışan başına ödeme">
          {rows.length === 0 ? (
            <PrintEmpty>Bu dönemde çalışma kaydı yok.</PrintEmpty>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Çalışan</th>
                  <th className="num">Gün</th>
                  <th className="num">Yevmiye</th>
                  <th className="num">Prim</th>
                  <th className="num">Ödenecek</th>
                  <th className="sign-col">İmza</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="sign-row">
                    <td>
                      {r.name}
                      {r.wageMode !== 'kademeli' && (
                        <span className="muted">
                          {' '}
                          ({r.wageMode === 'tam' ? 'tam ücret' : 'ödeme yok'})
                        </span>
                      )}
                    </td>
                    <td className="num muted">{r.days.filter((d) => d.dayIndex !== null).length}</td>
                    <td className="num">{money(r.wageTotal)}</td>
                    <td className="num">{r.bonusTotal === 0 ? '—' : money(r.bonusTotal)}</td>
                    <td className="num">{money(r.total)}</td>
                    <td />
                  </tr>
                ))}
                <tr className="total-row">
                  <td>Toplam</td>
                  <td />
                  <td className="num">{money(grand.wage)}</td>
                  <td className="num">{money(grand.bonus)}</td>
                  <td className="num">{money(grand.total)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          )}
        </PrintSection>

        {rows.length > 0 && (
          <PrintSection title="Gün gün döküm">
            <table>
              <thead>
                <tr>
                  <th className="num">Tarih</th>
                  <th className="num">Kaçıncı gün</th>
                  <th className="num">Yevmiye</th>
                  <th className="num">Prim</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Fragment key={r.id}>
                    <tr className="group-row">
                      <td colSpan={4}>
                        {r.name} — {money(r.total)}
                      </td>
                    </tr>
                    {r.days.map((d) => (
                      <tr key={`${r.id}-${d.date}`}>
                        <td className="num">{formatShort(d.date)}</td>
                        <td className="num muted">
                          {d.dayIndex ?? '—'}
                          {d.isTraining && ' · eğitim'}
                        </td>
                        <td className="num">{money(d.wage)}</td>
                        <td className="num">{d.bonus === 0 ? '—' : money(d.bonus)}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </PrintSection>
        )}

        {s && (
          <p className="note">
            Kademeli ücret: ilk {s.tier1_days} gün günlük {money(s.tier1_wage)}, devamı günlük{' '}
            {money(s.tier2_wage)}. Kademe sayacı kişinin işe başladığı ilk günden işler, seçilen
            dönemden değil. Aynı gün iki vardiya çalışılsa da bir gün sayılır.
          </p>
        )}
      </PrintDoc>

      <p className="text-xs text-stone-500">
        Haftalık ödemede pazartesi günü <strong>bir önceki pazartesi–pazar</strong> dönemi ödenir.
        Aynı gün iki vardiya çalışılsa da bir gün sayılır. Kademe sayacı kişinin işe başladığı ilk
        günden işler, seçtiğin dönemden değil.
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
    { key: 'tier1_days', label: 'İlk kaç gün düşük ücret', hint: 'işe başladığı günden itibaren' },
    { key: 'tier1_wage', label: 'Bu günlerin ücreti (₺)' },
    { key: 'tier2_wage', label: 'Sonraki günlerin ücreti (₺)' },
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
          İlk <strong>{settings.tier1_days} gün</strong> günlük{' '}
          <strong>{money(settings.tier1_wage)}</strong> · devamı günlük{' '}
          <strong>{money(settings.tier2_wage)}</strong>
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
  employees,
  bonuses,
  from,
  to,
  onChanged,
}: {
  employees: Employee[]
  bonuses: EmployeeBonus[]
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

  const nameOf = (id: string) => employees.find((e) => e.id === id)?.full_name ?? '—'
  const list = [...bonuses].sort((a, b) => b.work_date.localeCompare(a.work_date))

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
            {employees.map((e) => (
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
