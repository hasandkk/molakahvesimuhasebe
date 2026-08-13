import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useQuery } from '../lib/useQuery'
import { fetchActiveStands } from '../lib/refData'
import { formatLong, formatShort, today } from '../lib/date'
import { money, parseNumber, qty } from '../lib/format'
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

type Tab = 'sayim' | 'transfer'

type Data = {
  stands: Stand[]
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
  // Stand seçiliyse üç isteği de aynı anda başlatabiliriz. Seçili değilse
  // hangi standın raporu çekilecek stand listesinden belli olur; o liste
  // önbellekten geldiği için ilk açılıştan sonra bekletmez.
  if (standId) {
    const [stands, rest] = await Promise.all([fetchActiveStands(), fetchStandData(standId, date)])
    return { stands, ...rest }
  }

  const stands = await fetchActiveStands()
  const first = stands[0]?.id
  if (!first) return { stands, rows: [], transfers: [] }
  return { stands, ...(await fetchStandData(first, date)) }
}

export default function Stock() {
  const [tab, setTab] = useState<Tab>('sayim')
  const [date, setDate] = useState(today())
  const [standId, setStandId] = useState('')
  const { data, loading, error, reload } = useQuery(() => load(standId, date), [standId, date])

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

  const soldOf = (row: StockReportRow) => {
    const raw = values[row.variant_id] ?? ''
    return raw === '' ? null : Number(row.expected_qty) - parseNumber(raw)
  }

  const netTransferOf = (row: StockReportRow) => Number(row.transfer_in) - Number(row.transfer_out)

  const filledCount = rows.filter((r) => (values[r.variant_id] ?? '') !== '').length

  const estimated = useMemo(() => {
    let total = 0
    for (const row of rows) {
      const sold = soldOf(row)
      if (sold === null) continue
      total += sold * Number(row.price ?? 0)
    }
    return total
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          sub={prevDate ? 'beklenen stok buna göre' : 'ilk sayım'}
        />
        <Stat label="Tahmini satış" value={money(estimated)} sub="fark × fiyat" />
      </div>

      <Card
        title={alreadyCounted ? 'Sayım (kayıtlı)' : 'Akşam sayımı'}
        action={
          <Button size="sm" onClick={() => void save()} disabled={busy} className="hidden md:inline-flex">
            {saved ? '✓ Kaydedildi' : 'Sayımı kaydet'}
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

              {/* Mobil: her gramaj için kart — yatay kaydırma yok */}
              <div className="space-y-2 md:hidden">
                {group.rows.map((row) => {
                  const sold = soldOf(row)
                  const net = netTransferOf(row)
                  return (
                    <div key={row.variant_id} className="rounded-xl border border-stone-200 p-3">
                      <div className="flex items-baseline justify-between">
                        <span className="text-sm font-medium text-stone-800">{row.size_label}</span>
                        <span className="text-xs text-stone-400">{row.unit}</span>
                      </div>
                      <div className="mt-2 flex items-end gap-3">
                        <dl className="flex-1 space-y-0.5 text-xs text-stone-500">
                          <div className="flex justify-between gap-2">
                            <dt>Önceki</dt>
                            <dd className="tabular-nums">{qty(row.prev_qty)}</dd>
                          </div>
                          {net !== 0 && (
                            <div className="flex justify-between gap-2">
                              <dt>Gelen</dt>
                              <dd className="tabular-nums">
                                {net > 0 ? '+' : ''}
                                {qty(net)}
                              </dd>
                            </div>
                          )}
                          <div className="flex justify-between gap-2 font-medium text-stone-800">
                            <dt>Beklenen</dt>
                            <dd className="tabular-nums">{qty(row.expected_qty)}</dd>
                          </div>
                        </dl>
                        <div className="w-28 shrink-0">
                          <span className="mb-1 block text-right text-[11px] font-medium text-stone-600">
                            Sayılan
                          </span>
                          <Input
                            inputMode="decimal"
                            className="py-2 text-right text-lg font-semibold"
                            placeholder="0"
                            value={values[row.variant_id] ?? ''}
                            onChange={(e) =>
                              setValues((v) => ({ ...v, [row.variant_id]: e.target.value }))
                            }
                          />
                          <span
                            className={`mt-1 block text-right text-[11px] ${
                              sold !== null && sold < 0 ? 'text-red-700' : 'text-stone-500'
                            }`}
                          >
                            {sold === null ? 'girilmedi' : `eksilen ${qty(sold)}`}
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Masaüstü: tablo */}
              <div className="hidden md:block">
                <table className="w-full text-sm">
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
                      const sold = soldOf(row)
                      const net = netTransferOf(row)
                      return (
                        <tr key={row.variant_id}>
                          <td className="py-1.5">
                            {row.size_label}
                            <span className="ml-1 text-xs text-stone-400">{row.unit}</span>
                          </td>
                          <td className="py-1.5 text-right tabular-nums text-stone-500">{qty(row.prev_qty)}</td>
                          <td className="py-1.5 text-right tabular-nums text-stone-500">
                            {net === 0 ? '—' : qty(net)}
                          </td>
                          <td className="py-1.5 text-right tabular-nums font-medium">{qty(row.expected_qty)}</td>
                          <td className="w-24 py-1 pl-2">
                            <Input
                              inputMode="decimal"
                              className="px-2 py-1.5 text-right"
                              placeholder="0"
                              value={values[row.variant_id] ?? ''}
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

      <StickyBar>
        <Button className="w-full" onClick={() => void save()} disabled={busy}>
          {saved ? '✓ Kaydedildi' : `Sayımı kaydet (${filledCount}/${rows.length})`}
        </Button>
      </StickyBar>
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
          <Button size="sm" onClick={() => void save()} disabled={busy} className="hidden md:inline-flex">
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
