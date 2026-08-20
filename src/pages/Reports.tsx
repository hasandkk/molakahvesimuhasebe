import { Fragment, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useQuery } from '../lib/useQuery'
import { fetchAllEmployees, fetchAllStands } from '../lib/refData'
import { formatLong, formatShort, startOfMonth, today } from '../lib/date'
import { qty } from '../lib/format'
import {
  type Employee,
  type Stand,
  type StockSaleRow,
  type StockVarianceRow,
} from '../lib/types'
import { Button, Card, Empty, ErrorBox, Field, Input, Select, Spinner, Stat, Tabs } from '../components/ui'
import { PrintDoc, PrintEmpty, PrintFacts, PrintSection } from '../components/print'

type Tab = 'ozet' | 'vardiya' | 'stok'

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
}

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '')

async function load(from: string, to: string): Promise<Data> {
  const [stands, employees, shifts, sales, variances] = await Promise.all([
    fetchAllStands(),
    fetchAllEmployees(),
    supabase
      .from('shift_assignments')
      .select('work_date, kind, start_time, end_time, stand_id, employee_id, stands(name), employees(full_name)')
      .gte('work_date', from)
      .lte('work_date', to),
    supabase.rpc('stock_daily_sales', { p_from: from, p_to: to, p_stand_id: null }),
    supabase.rpc('stock_count_variance', { p_from: from, p_to: to, p_stand_id: null }),
  ])

  const err = shifts.error ?? sales.error ?? variances.error
  if (err) throw err

  return {
    stands,
    employees,
    shifts: (shifts.data ?? []) as unknown as ShiftRow[],
    sales: (sales.data ?? []) as StockSaleRow[],
    variances: (variances.data ?? []) as StockVarianceRow[],
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
        ]}
      />

      {error && <ErrorBox message={error} />}
      {loading && !data && <Spinner />}

      {data && tab === 'ozet' && <SummaryTab data={data} period={period} />}
      {data && tab === 'vardiya' && <ShiftHistoryTab data={data} period={period} />}
      {data && tab === 'stok' && <StockHistoryTab data={data} period={period} />}

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

  /**
   * Filtrede pasife alınanlar görünmez; ama seçili aralıkta kaydı olan biri
   * pasifleştirilmişse listede kalır, yoksa geçmişine ulaşılamazdı.
   */
  const withRecords = useMemo(
    () => new Set(data.shifts.map((s) => s.employee_id)),
    [data.shifts],
  )
  const filterOptions = data.employees.filter((e) => e.is_active || withRecords.has(e.id))

  return (
    <>
      <Field label="Çalışan" hint="Boş bırakırsan bütün günler stand stand listelenir.">
        <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
          <option value="">Tüm çalışanlar</option>
          {filterOptions.map((e) => (
            <option key={e.id} value={e.id}>
              {e.full_name}
              {e.is_active ? '' : ' (pasif)'}
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
