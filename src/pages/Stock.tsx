import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useQuery } from '../lib/useQuery'
import { fetchActiveStands } from '../lib/refData'
import { formatLong, formatShort, today } from '../lib/date'
import { parseNumber, qty } from '../lib/format'
import type { Stand, StockReportRow, StockTransfer } from '../lib/types'
import {
  Button,
  Card,
  DateNav,
  Empty,
  ErrorBox,
  Field,
  Input,
  Select,
  Spinner,
  Stat,
  StickyBar,
  Tabs,
} from '../components/ui'

type Tab = 'satis' | 'sayim' | 'transfer'

type Data = {
  stands: Stand[]
  standId: string
  date: string
  rows: StockReportRow[]
  transfers: (StockTransfer & { stock_transfer_items: { quantity: number; variant_id: string }[] })[]
}

async function fetchStandData(standId: string, date: string) {
  const [report, transfers] = await Promise.all([
    supabase.rpc('stand_stock_report', { p_stand_id: standId, p_date: date }),
    supabase
      .from('stock_transfers')
      .select('*, stock_transfer_items(quantity, variant_id)')
      .eq('stand_id', standId)
      .order('transfer_date', { ascending: false })
      .limit(15),
  ])
  if (report.error) throw report.error
  if (transfers.error) throw transfers.error
  return {
    rows: (report.data ?? []) as StockReportRow[],
    transfers: (transfers.data ?? []) as Data['transfers'],
  }
}

async function load(standId: string, date: string): Promise<Data> {
  if (standId) {
    const [stands, rest] = await Promise.all([fetchActiveStands(), fetchStandData(standId, date)])
    return { stands, standId, date, ...rest }
  }
  const stands = await fetchActiveStands()
  const first = stands[0]?.id
  if (!first) return { stands, standId: '', date, rows: [], transfers: [] }
  return { stands, standId: first, date, ...(await fetchStandData(first, date)) }
}

export default function Stock() {
  const [tab, setTab] = useState<Tab>('satis')
  const [date, setDate] = useState(today())
  const [standId, setStandId] = useState('')
  const { data, loading, error, reload } = useQuery(() => load(standId, date), [standId, date])

  const selectedStandId = standId || data?.stands[0]?.id || ''
  const formKey = data ? `${data.standId}|${data.date}` : 'bos'

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-stone-900">Stok</h1>
          <p className="text-sm text-stone-500">{formatLong(date)}</p>
        </div>
        <div className="w-full sm:w-72">
          <DateNav value={date} onChange={setDate} />
        </div>
      </div>

      <Field label="Stand">
        <Select value={selectedStandId} onChange={(e) => setStandId(e.target.value)}>
          {(data?.stands ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </Field>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'satis', label: 'Günlük satış' },
          { id: 'sayim', label: 'Sayım' },
          { id: 'transfer', label: 'Transfer' },
        ]}
      />

      {error && <ErrorBox message={error} />}
      {loading && !data && <Spinner />}

      {data && data.stands.length === 0 && (
        <Card>
          <Empty>Önce “Tanımlar” ekranından stand ekle.</Empty>
        </Card>
      )}

      {/* Sekmeler bağlı kalır, etkin olmayan gizlenir: yazılan sayılar kaybolmasın */}
      {data && data.stands.length > 0 && (
        <>
          <div className={tab === 'satis' ? 'space-y-4' : 'hidden'}>
            <SalesTab key={formKey} rows={data.rows} standId={data.standId} date={data.date} onSaved={reload} />
          </div>
          <div className={tab === 'sayim' ? 'space-y-4' : 'hidden'}>
            <CountTab key={`${formKey}-c`} rows={data.rows} standId={data.standId} date={data.date} onSaved={reload} />
          </div>
          <div className={tab === 'transfer' ? 'space-y-4' : 'hidden'}>
            <TransferTab key={`${formKey}-t`} data={data} standId={data.standId} date={data.date} onSaved={reload} />
          </div>
        </>
      )}
    </>
  )
}

function groupRows(rows: StockReportRow[]) {
  const groups: { productId: string; productName: string; rows: StockReportRow[] }[] = []
  for (const row of rows) {
    let group = groups.find((g) => g.productId === row.product_id)
    if (!group) {
      group = { productId: row.product_id, productName: row.product_name, rows: [] }
      groups.push(group)
    }
    group.rows.push(row)
  }
  return groups
}

/* --------------------------------------------------------- Günlük satış */

function SalesTab({
  rows,
  standId,
  date,
  onSaved,
}: {
  rows: StockReportRow[]
  standId: string
  date: string
  onSaved: () => void
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.variant_id, Number(r.sold_today) > 0 ? String(r.sold_today) : ''])),
  )
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const groups = useMemo(() => groupRows(rows), [rows])
  const alreadySaved = rows.some((r) => Number(r.sold_today) > 0)

  const soldOf = (row: StockReportRow) => parseNumber(values[row.variant_id] ?? '')
  const remainingOf = (row: StockReportRow) => Number(row.on_hand_before) - soldOf(row)

  const soldLines = rows.filter((r) => soldOf(r) > 0).length

  async function save() {
    setBusy(true)
    setError(null)

    const payload: Record<string, unknown> = { sale_date: date, stand_id: standId }
    if (note.trim()) payload.note = note.trim()

    const { data: sale, error: saleError } = await supabase
      .from('stock_sales')
      .upsert(payload, { onConflict: 'sale_date,stand_id' })
      .select('id')
      .single()

    if (saleError || !sale) {
      setError(saleError?.message ?? 'Satış kaydedilemedi.')
      setBusy(false)
      return
    }

    // Boş bırakılan gramaj "o gün satılmadı" demektir; 0 yazmak doğrudur.
    const items = rows.map((row) => ({
      sale_id: sale.id as string,
      variant_id: row.variant_id,
      quantity: soldOf(row),
    }))

    const { error: itemsError } = await supabase
      .from('stock_sale_items')
      .upsert(items, { onConflict: 'sale_id,variant_id' })

    if (itemsError) setError(itemsError.message)
    else {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onSaved()
    }
    setBusy(false)
  }

  if (rows.length === 0) {
    return (
      <Card>
        <Empty>Ürün tanımlı değil. “Tanımlar &gt; Ürünler” ekranından kahve çeşidi ekle.</Empty>
      </Card>
    )
  }

  return (
    <>
      <Card
        title={alreadySaved ? 'Günlük satış (kayıtlı)' : 'Günlük satış'}
        action={
          <Button size="sm" onClick={() => void save()} disabled={busy} className="max-md:hidden">
            {saved ? '✓ Kaydedildi' : 'Kaydet'}
          </Button>
        }
      >
        {error && (
          <div className="mb-3">
            <ErrorBox message={error} />
          </div>
        )}

        <div className="space-y-5">
          {groups.map((group) => (
            <div key={group.productId}>
              <h3 className="mb-2 text-sm font-semibold text-stone-800">{group.productName}</h3>
              <div className="space-y-2">
                {group.rows.map((row) => {
                  const remaining = remainingOf(row)
                  return (
                    <div
                      key={row.variant_id}
                      className="flex items-center gap-3 rounded-xl border border-stone-200 p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-stone-800">
                          {row.size_label}
                          <span className="ml-1 text-xs font-normal text-stone-400">{row.unit}</span>
                        </div>
                        <div className="text-xs text-stone-500">
                          Elde <span className="tabular-nums">{qty(row.on_hand_before)}</span> ·
                          kalan{' '}
                          <span className={`tabular-nums ${remaining < 0 ? 'text-red-700' : ''}`}>
                            {qty(remaining)}
                          </span>
                        </div>
                      </div>
                      <div className="w-28 shrink-0">
                        <span className="mb-1 block text-right text-[11px] font-medium text-stone-600">
                          Satılan
                        </span>
                        <Input
                          inputMode="decimal"
                          className="py-2 text-right text-lg font-semibold"
                          placeholder="0"
                          value={values[row.variant_id] ?? ''}
                          onChange={(e) => setValues((v) => ({ ...v, [row.variant_id]: e.target.value }))}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        <Field label="Not" className="mt-4">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="İsteğe bağlı" />
        </Field>

        <p className="mt-3 text-xs text-stone-500">
          Buraya o gün <strong>satılan adedi</strong> yaz; stok kendiliğinden düşer. Toplam stoğu
          saymak zorunda değilsin — sayımı ara sıra “Sayım” sekmesinden kontrol amaçlı yaparsın.
          Ciro hesabı burada yapılmaz; günlük ciroyu “Kasa” ekranından girersin.
        </p>
      </Card>

      <StickyBar>
        <Button className="w-full" onClick={() => void save()} disabled={busy}>
          {saved ? '✓ Kaydedildi' : `Satışı kaydet (${soldLines}/${rows.length} gramaj)`}
        </Button>
      </StickyBar>
    </>
  )
}

/* ---------------------------------------------------------------- Sayım */

function CountTab({
  rows,
  standId,
  date,
  onSaved,
}: {
  rows: StockReportRow[]
  standId: string
  date: string
  onSaved: () => void
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.variant_id, r.counted_qty === null ? '' : String(r.counted_qty)])),
  )
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const groups = useMemo(() => groupRows(rows), [rows])
  const prevDate = rows.find((r) => r.prev_date)?.prev_date ?? null

  /** Taban yoksa (ilk sayım, öncesinde hareket de yok) fark hesaplanamaz. */
  const hasBaseline = (row: StockReportRow) =>
    row.prev_date !== null || Number(row.transfer_in) !== 0 || Number(row.transfer_out) !== 0

  const varianceOf = (row: StockReportRow) => {
    if (!hasBaseline(row)) return null
    const raw = values[row.variant_id] ?? ''
    return raw === '' ? null : parseNumber(raw) - Number(row.on_hand)
  }

  const filledRows = rows.filter((r) => (values[r.variant_id] ?? '') !== '')
  const isFirstCount = rows.length > 0 && !rows.some(hasBaseline)

  const varianceLines = rows.filter((r) => {
    const v = varianceOf(r)
    return v !== null && v !== 0
  }).length

  async function save() {
    if (filledRows.length === 0) {
      setError('En az bir gramaja miktar gir.')
      return
    }
    setBusy(true)
    setError(null)

    const payload: Record<string, unknown> = { count_date: date, stand_id: standId }
    if (note.trim()) payload.note = note.trim()

    const { data: countRow, error: countError } = await supabase
      .from('stock_counts')
      .upsert(payload, { onConflict: 'count_date,stand_id' })
      .select('id')
      .single()

    if (countError || !countRow) {
      setError(countError?.message ?? 'Sayım kaydedilemedi.')
      setBusy(false)
      return
    }

    const items = filledRows.map((row) => ({
      count_id: countRow.id as string,
      variant_id: row.variant_id,
      quantity: parseNumber(values[row.variant_id] ?? ''),
    }))

    const { error: itemsError } = await supabase
      .from('stock_count_items')
      .upsert(items, { onConflict: 'count_id,variant_id' })

    if (itemsError) setError(itemsError.message)
    else {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onSaved()
    }
    setBusy(false)
  }

  if (rows.length === 0) return null

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Stat
          label="Önceki sayım"
          value={prevDate ? formatShort(prevDate) : 'Yok'}
          sub={prevDate ? 'teorik stok buna göre' : 'ilk sayım'}
        />
        <Stat
          label="Fark bulunan"
          value={`${varianceLines} gramaj`}
          tone={varianceLines > 0 ? 'warn' : 'good'}
          sub={varianceLines > 0 ? 'aşağıda işaretli' : 'hepsi tutuyor'}
        />
      </div>

      {isFirstCount && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm text-sky-900">
          Bu stand için daha önce sayım yok. Girdiğin rakamlar <strong>başlangıç stoğu</strong> olarak
          kaydedilir; fire/kayıp hesabı bir sonraki sayımdan itibaren çalışır.
        </div>
      )}

      <Card
        title="Fiziki sayım"
        action={
          <Button size="sm" onClick={() => void save()} disabled={busy} className="max-md:hidden">
            {saved ? '✓ Kaydedildi' : 'Kaydet'}
          </Button>
        }
      >
        {error && (
          <div className="mb-3">
            <ErrorBox message={error} />
          </div>
        )}

        <div className="space-y-5">
          {groups.map((group) => (
            <div key={group.productId}>
              <h3 className="mb-2 text-sm font-semibold text-stone-800">{group.productName}</h3>
              <div className="space-y-2">
                {group.rows.map((row) => {
                  const variance = varianceOf(row)
                  const baseline = hasBaseline(row)
                  return (
                    <div
                      key={row.variant_id}
                      className="flex items-center gap-3 rounded-xl border border-stone-200 p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-stone-800">
                          {row.size_label}
                          <span className="ml-1 text-xs font-normal text-stone-400">{row.unit}</span>
                        </div>
                        <div className="text-xs text-stone-500">
                          {baseline ? (
                            <>
                              Olması gereken{' '}
                              <span className="font-medium tabular-nums text-stone-800">
                                {qty(row.on_hand)}
                              </span>
                            </>
                          ) : (
                            'ilk sayım'
                          )}
                        </div>
                      </div>
                      <div className="w-28 shrink-0">
                        <span className="mb-1 block text-right text-[11px] font-medium text-stone-600">
                          Sayılan
                        </span>
                        <Input
                          inputMode="decimal"
                          className="py-2 text-right text-lg font-semibold"
                          placeholder="—"
                          value={values[row.variant_id] ?? ''}
                          onChange={(e) => setValues((v) => ({ ...v, [row.variant_id]: e.target.value }))}
                        />
                        <span
                          className={`mt-1 block text-right text-[11px] ${
                            variance !== null && variance < 0
                              ? 'text-red-700'
                              : variance !== null && variance > 0
                                ? 'text-amber-700'
                                : 'text-stone-500'
                          }`}
                        >
                          {variance === null
                            ? ' '
                            : variance === 0
                              ? 'tutuyor'
                              : `${variance > 0 ? '+' : '−'}${qty(Math.abs(variance))}`}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        <Field label="Not" className="mt-4">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="İsteğe bağlı" />
        </Field>

        <p className="mt-3 text-xs text-stone-500">
          Boş bıraktığın gramajlar <strong>değiştirilmez</strong>. Fark = sayılan − olması gereken;
          eksi çıkarsa fire, kayıp ya da girilmemiş bir satış vardır.
        </p>
      </Card>

      <StickyBar>
        <Button className="w-full" onClick={() => void save()} disabled={busy}>
          {saved ? '✓ Kaydedildi' : `Sayımı kaydet (${filledRows.length}/${rows.length})`}
        </Button>
      </StickyBar>
    </>
  )
}

/* ------------------------------------------------------------- Transfer */

function TransferTab({
  data,
  standId,
  date,
  onSaved,
}: {
  data: Data
  standId: string
  date: string
  onSaved: () => void
}) {
  const [direction, setDirection] = useState<'in' | 'out'>('in')
  const [values, setValues] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const groups = useMemo(() => groupRows(data.rows), [data.rows])
  const variantLabel = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of data.rows) map.set(row.variant_id, `${row.product_name} ${row.size_label}`)
    return map
  }, [data.rows])

  const filled = Object.entries(values).filter(([, v]) => parseNumber(v) > 0)

  async function save() {
    if (filled.length === 0) {
      setError('En az bir ürüne miktar gir.')
      return
    }
    setBusy(true)
    setError(null)

    const { data: transfer, error: transferError } = await supabase
      .from('stock_transfers')
      .insert({ transfer_date: date, stand_id: standId, direction, note: note.trim() || null })
      .select('id')
      .single()

    if (transferError || !transfer) {
      setError(transferError?.message ?? 'Transfer kaydedilemedi.')
      setBusy(false)
      return
    }

    const { error: itemsError } = await supabase.from('stock_transfer_items').insert(
      filled.map(([variantId, value]) => ({
        transfer_id: transfer.id as string,
        variant_id: variantId,
        quantity: parseNumber(value),
      })),
    )

    if (itemsError) setError(itemsError.message)
    else {
      setValues({})
      setNote('')
      onSaved()
    }
    setBusy(false)
  }

  async function remove(id: string) {
    setBusy(true)
    const { error } = await supabase.from('stock_transfers').delete().eq('id', id)
    if (error) setError(error.message)
    else onSaved()
    setBusy(false)
  }

  return (
    <>
      <Card
        title="Yeni transfer"
        action={
          <Button size="sm" onClick={() => void save()} disabled={busy} className="max-md:hidden">
            Kaydet
          </Button>
        }
      >
        {error && (
          <div className="mb-3">
            <ErrorBox message={error} />
          </div>
        )}

        <Field label="Yön">
          <Select value={direction} onChange={(e) => setDirection(e.target.value as 'in' | 'out')}>
            <option value="in">Depodan standa (giriş)</option>
            <option value="out">Standdan geri (çıkış / iade)</option>
          </Select>
        </Field>

        <div className="mt-4 space-y-4">
          {groups.map((group) => (
            <div key={group.productId}>
              <h3 className="mb-2 text-sm font-semibold text-stone-800">{group.productName}</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {group.rows.map((row) => (
                  <label key={row.variant_id} className="block">
                    <span className="mb-1 block text-xs text-stone-500">
                      {row.size_label} <span className="text-stone-400">({row.unit})</span>
                    </span>
                    <Input
                      inputMode="decimal"
                      className="px-2 py-2 text-right"
                      placeholder="0"
                      value={values[row.variant_id] ?? ''}
                      onChange={(e) => setValues((v) => ({ ...v, [row.variant_id]: e.target.value }))}
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        <Field label="Not" className="mt-4">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="İsteğe bağlı" />
        </Field>
      </Card>

      <StickyBar>
        <Button className="w-full" onClick={() => void save()} disabled={busy}>
          Transferi kaydet{filled.length > 0 ? ` (${filled.length} kalem)` : ''}
        </Button>
      </StickyBar>

      <Card title="Son transferler">
        {data.transfers.length === 0 ? (
          <Empty>Bu stand için transfer kaydı yok.</Empty>
        ) : (
          <ul className="divide-y divide-stone-200">
            {data.transfers.map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <div className="font-medium text-stone-800">
                    {formatShort(t.transfer_date)} · {t.direction === 'in' ? 'Giriş' : 'Çıkış'}
                  </div>
                  <div className="text-xs text-stone-500">
                    {t.stock_transfer_items
                      .map((i) => `${variantLabel.get(i.variant_id) ?? '—'}: ${qty(i.quantity)}`)
                      .join(' · ') || 'Kalem yok'}
                    {t.note ? ` · ${t.note}` : ''}
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => void remove(t.id)} disabled={busy}>
                  ✕
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}
