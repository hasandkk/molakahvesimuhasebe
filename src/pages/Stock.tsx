import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useQuery } from '../lib/useQuery'
import { formatLong, formatShort, today } from '../lib/date'
import { money, parseNumber, qty } from '../lib/format'
import type { Stand, StockReportRow, StockTransfer } from '../lib/types'
import { Button, Card, DateNav, Empty, ErrorBox, Field, Input, Select, Spinner, Stat, Tabs } from '../components/ui'

type Tab = 'sayim' | 'transfer'

type Data = {
  stands: Stand[]
  rows: StockReportRow[]
  transfers: (StockTransfer & { stock_transfer_items: { quantity: number; variant_id: string }[] })[]
}

async function load(standId: string, date: string): Promise<Data> {
  const standsRes = await supabase
    .from('stands')
    .select('*')
    .eq('is_active', true)
    .order('sort_order')
    .order('name')
  if (standsRes.error) throw standsRes.error
  const stands = (standsRes.data ?? []) as Stand[]

  const activeStand = standId || stands[0]?.id
  if (!activeStand) return { stands, rows: [], transfers: [] }

  const [report, transfers] = await Promise.all([
    supabase.rpc('stand_stock_report', { p_stand_id: activeStand, p_date: date }),
    supabase
      .from('stock_transfers')
      .select('*, stock_transfer_items(quantity, variant_id)')
      .eq('stand_id', activeStand)
      .order('transfer_date', { ascending: false })
      .limit(15),
  ])
  if (report.error) throw report.error
  if (transfers.error) throw transfers.error

  return {
    stands,
    rows: (report.data ?? []) as StockReportRow[],
    transfers: (transfers.data ?? []) as Data['transfers'],
  }
}

export default function Stock() {
  const [tab, setTab] = useState<Tab>('sayim')
  const [date, setDate] = useState(today())
  const [standId, setStandId] = useState('')
  const { data, loading, error, reload } = useQuery(() => load(standId, date), [standId, date])

  // İlk yüklemede varsayılan standı seç
  useEffect(() => {
    if (!standId && data?.stands.length) setStandId(data.stands[0].id)
  }, [data, standId])

  const activeStandId = standId || data?.stands[0]?.id || ''

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
        <Select value={activeStandId} onChange={(e) => setStandId(e.target.value)}>
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
          { id: 'sayim', label: 'Akşam sayımı' },
          { id: 'transfer', label: 'Mal transferi' },
        ]}
      />

      {error && <ErrorBox message={error} />}
      {loading && !data && <Spinner />}

      {data && data.stands.length === 0 && (
        <Card>
          <Empty>Önce “Tanımlar” ekranından stand ekle.</Empty>
        </Card>
      )}

      {data && data.stands.length > 0 && tab === 'sayim' && (
        <CountTab key={`${activeStandId}-${date}`} rows={data.rows} standId={activeStandId} date={date} onSaved={reload} />
      )}

      {data && data.stands.length > 0 && tab === 'transfer' && (
        <TransferTab
          key={`${activeStandId}-${date}-t`}
          data={data}
          standId={activeStandId}
          date={date}
          onSaved={reload}
        />
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
  const alreadyCounted = rows.some((r) => r.counted_qty !== null)

  const estimated = useMemo(() => {
    let total = 0
    for (const row of rows) {
      const counted = values[row.variant_id]
      if (counted === undefined || counted === '') continue
      const sold = Number(row.expected_qty) - parseNumber(counted)
      total += sold * Number(row.price ?? 0)
    }
    return total
  }, [rows, values])

  async function save() {
    setBusy(true)
    setError(null)

    const { data: countRow, error: countError } = await supabase
      .from('stock_counts')
      .upsert({ count_date: date, stand_id: standId, note: note.trim() || null }, { onConflict: 'count_date,stand_id' })
      .select('id')
      .single()

    if (countError || !countRow) {
      setError(countError?.message ?? 'Sayım kaydedilemedi.')
      setBusy(false)
      return
    }

    const items = rows.map((row) => ({
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

  if (rows.length === 0) {
    return (
      <Card>
        <Empty>Ürün tanımlı değil. “Tanımlar &gt; Ürünler” ekranından kahve çeşidi ekle.</Empty>
      </Card>
    )
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Stat
          label="Önceki sayım"
          value={prevDate ? formatShort(prevDate) : 'Yok'}
          sub={prevDate ? 'beklenen stok bu tarihe göre' : 'ilk sayım'}
        />
        <Stat label="Tahmini satış tutarı" value={money(estimated)} sub="fark × fiyat" />
      </div>

      <Card
        title={alreadyCounted ? 'Sayım (kayıtlı — güncelleyebilirsin)' : 'Akşam sayımı'}
        action={
          <Button size="sm" onClick={() => void save()} disabled={busy}>
            {saved ? '✓ Kaydedildi' : 'Sayımı kaydet'}
          </Button>
        }
      >
        {error && <div className="mb-3"><ErrorBox message={error} /></div>}

        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group.productId}>
              <h3 className="mb-2 text-sm font-semibold text-stone-800">{group.productName}</h3>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-stone-500">
                      <th className="pb-1 font-medium">Gramaj</th>
                      <th className="pb-1 text-right font-medium">Önceki</th>
                      <th className="pb-1 text-right font-medium">Gelen</th>
                      <th className="pb-1 text-right font-medium">Beklenen</th>
                      <th className="pb-1 text-right font-medium">Sayılan</th>
                      <th className="pb-1 text-right font-medium">Eksilen</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {group.rows.map((row) => {
                      const raw = values[row.variant_id] ?? ''
                      const sold = raw === '' ? null : Number(row.expected_qty) - parseNumber(raw)
                      return (
                        <tr key={row.variant_id}>
                          <td className="py-1.5">
                            {row.size_label}
                            <span className="ml-1 text-xs text-stone-400">{row.unit}</span>
                          </td>
                          <td className="py-1.5 text-right tabular-nums text-stone-500">{qty(row.prev_qty)}</td>
                          <td className="py-1.5 text-right tabular-nums text-stone-500">
                            {Number(row.transfer_in) - Number(row.transfer_out) === 0
                              ? '—'
                              : qty(Number(row.transfer_in) - Number(row.transfer_out))}
                          </td>
                          <td className="py-1.5 text-right tabular-nums font-medium">{qty(row.expected_qty)}</td>
                          <td className="w-24 py-1 pl-2">
                            <Input
                              inputMode="decimal"
                              className="px-2 py-1.5 text-right"
                              placeholder="0"
                              value={raw}
                              onChange={(e) =>
                                setValues((v) => ({ ...v, [row.variant_id]: e.target.value }))
                              }
                            />
                          </td>
                          <td
                            className={`py-1.5 text-right tabular-nums ${
                              sold !== null && sold < 0 ? 'text-red-700' : 'text-stone-700'
                            }`}
                          >
                            {sold === null ? '—' : qty(sold)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>

        <Field label="Not" className="mt-4">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="İsteğe bağlı" />
        </Field>

        <p className="mt-3 text-xs text-stone-500">
          “Eksilen” = beklenen − sayılan. Normalde satılan miktardır; eksi çıkarsa girilmemiş bir transfer
          veya sayım hatası vardır.
        </p>
      </Card>
    </>
  )
}

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
          <Button size="sm" onClick={() => void save()} disabled={busy}>
            Kaydet
          </Button>
        }
      >
        {error && <div className="mb-3"><ErrorBox message={error} /></div>}

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
                      className="px-2 py-1.5 text-right"
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
                <Button variant="ghost" size="sm" onClick={() => void remove(t.id)} disabled={busy}>
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
