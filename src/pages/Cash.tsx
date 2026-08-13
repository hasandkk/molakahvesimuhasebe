import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useQuery } from '../lib/useQuery'
import { fetchActiveStands } from '../lib/refData'
import { formatLong, formatShort, today } from '../lib/date'
import { money, parseNumber } from '../lib/format'
import { MOVEMENT_LABELS, type CashCount, type CashMovement, type CashMovementType, type DailyRevenue, type Stand } from '../lib/types'
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

type Tab = 'ciro' | 'hareket' | 'sayim'

type Summary = {
  cash_income: number
  pos_income: number
  withdrawals: number
  expenses: number
  to_bank: number
  deposits: number
  cash_balance: number
}

type Data = {
  stands: Stand[]
  revenues: DailyRevenue[]
  movements: CashMovement[]
  counts: CashCount[]
  summary: Summary | null
  expectedAtDate: number
}

async function load(date: string): Promise<Data> {
  const [stands, revenues, movements, counts, summary, expected] = await Promise.all([
    fetchActiveStands(),
    supabase.from('daily_revenues').select('*').eq('business_date', date),
    supabase.from('cash_movements').select('*').order('movement_date', { ascending: false }).order('created_at', { ascending: false }).limit(50),
    supabase.from('cash_counts').select('*').order('count_date', { ascending: false }).limit(20),
    supabase.rpc('cash_summary'),
    supabase.rpc('cash_balance_until', { p_date: date }),
  ])
  const err = revenues.error ?? movements.error ?? counts.error ?? summary.error ?? expected.error
  if (err) throw err

  const summaryRow = Array.isArray(summary.data) ? (summary.data[0] as Summary | undefined) : null

  return {
    stands,
    revenues: (revenues.data ?? []) as DailyRevenue[],
    movements: (movements.data ?? []) as CashMovement[],
    counts: (counts.data ?? []) as CashCount[],
    summary: summaryRow ?? null,
    expectedAtDate: Number(expected.data ?? 0),
  }
}

export default function Cash() {
  const [tab, setTab] = useState<Tab>('ciro')
  const [date, setDate] = useState(today())
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const { data, loading, error, reload } = useQuery(() => load(date), [date])

  // Ciro girişi formu (stand_id -> {nakit, pos})
  const [draft, setDraft] = useState<Record<string, { cash: string; pos: string }>>({})

  useEffect(() => {
    if (!data) return
    const next: Record<string, { cash: string; pos: string }> = {}
    for (const stand of data.stands) {
      const row = data.revenues.find((r) => r.stand_id === stand.id)
      next[stand.id] = {
        cash: row ? String(row.cash_amount) : '',
        pos: row ? String(row.pos_amount) : '',
      }
    }
    setDraft(next)
  }, [data])

  const dayTotals = useMemo(() => {
    const cash = (data?.revenues ?? []).reduce((s, r) => s + Number(r.cash_amount), 0)
    const pos = (data?.revenues ?? []).reduce((s, r) => s + Number(r.pos_amount), 0)
    return { cash, pos, total: cash + pos }
  }, [data])

  async function saveRevenues() {
    if (!data) return
    setBusy(true)
    setActionError(null)
    const rows = data.stands.map((stand) => ({
      business_date: date,
      stand_id: stand.id,
      cash_amount: parseNumber(draft[stand.id]?.cash ?? ''),
      pos_amount: parseNumber(draft[stand.id]?.pos ?? ''),
    }))
    const { error } = await supabase
      .from('daily_revenues')
      .upsert(rows, { onConflict: 'business_date,stand_id' })
    if (error) setActionError(error.message)
    else {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      await reload()
    }
    setBusy(false)
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-stone-900">Kasa</h1>
          <p className="text-sm text-stone-500">{formatLong(date)}</p>
        </div>
        <div className="w-full sm:w-72">
          <DateNav value={date} onChange={setDate} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Bugün nakit" value={money(dayTotals.cash)} />
        <Stat label="Bugün POS" value={money(dayTotals.pos)} />
        <Stat label="Bugün toplam" value={money(dayTotals.total)} />
        <Stat
          label="Kasadaki nakit"
          value={money(data?.summary?.cash_balance)}
          tone={(data?.summary?.cash_balance ?? 0) < 0 ? 'bad' : 'good'}
          sub="tüm zamanlar"
        />
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'ciro', label: 'Günlük ciro' },
          { id: 'hareket', label: 'Para hareketleri' },
          { id: 'sayim', label: 'Kasa sayımı' },
        ]}
      />

      {error && <ErrorBox message={error} />}
      {actionError && <ErrorBox message={actionError} />}
      {loading && !data && <Spinner />}

      {data && tab === 'ciro' && (
        <Card
          title="Stand bazlı gün sonu cirosu"
          action={
            <Button
              size="sm"
              onClick={() => void saveRevenues()}
              disabled={busy}
              className="max-md:hidden"
            >
              {saved ? '✓ Kaydedildi' : 'Kaydet'}
            </Button>
          }
        >
          {data.stands.length === 0 ? (
            <Empty>Önce “Tanımlar” ekranından stand ekle.</Empty>
          ) : (
            <div className="space-y-3">
              {data.stands.map((stand) => (
                <div key={stand.id} className="rounded-xl border border-stone-200 p-3">
                  <div className="mb-2 text-sm font-medium text-stone-800">{stand.name}</div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Nakit (₺)">
                      <Input
                        inputMode="decimal"
                        placeholder="0"
                        value={draft[stand.id]?.cash ?? ''}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, [stand.id]: { ...d[stand.id], cash: e.target.value } }))
                        }
                      />
                    </Field>
                    <Field label="POS (₺)">
                      <Input
                        inputMode="decimal"
                        placeholder="0"
                        value={draft[stand.id]?.pos ?? ''}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, [stand.id]: { ...d[stand.id], pos: e.target.value } }))
                        }
                      />
                    </Field>
                  </div>
                  <div className="mt-2 text-right text-xs text-stone-500">
                    Toplam:{' '}
                    {money(parseNumber(draft[stand.id]?.cash ?? '') + parseNumber(draft[stand.id]?.pos ?? ''))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {data && tab === 'ciro' && data.stands.length > 0 && (
        <StickyBar>
          <Button className="w-full" onClick={() => void saveRevenues()} disabled={busy}>
            {saved ? '✓ Kaydedildi' : `Ciroyu kaydet · ${money(dayTotals.total)}`}
          </Button>
        </StickyBar>
      )}

      {data && tab === 'hareket' && (
        <MovementsTab data={data} date={date} onChanged={reload} />
      )}

      {data && tab === 'sayim' && (
        <CountsTab data={data} date={date} onChanged={reload} />
      )}
    </>
  )
}

function MovementsTab({ data, date, onChanged }: { data: Data; date: string; onChanged: () => void }) {
  const [type, setType] = useState<CashMovementType>('cekim')
  const [amount, setAmount] = useState('')
  const [person, setPerson] = useState('')
  const [standId, setStandId] = useState('')
  const [category, setCategory] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function add() {
    const value = parseNumber(amount)
    if (value <= 0) {
      setError('Tutar 0’dan büyük olmalı.')
      return
    }
    setBusy(true)
    setError(null)
    const { error } = await supabase.from('cash_movements').insert({
      movement_date: date,
      stand_id: standId || null,
      type,
      amount: value,
      person_name: person.trim() || null,
      category: category.trim() || null,
      note: note.trim() || null,
    })
    if (error) setError(error.message)
    else {
      setAmount('')
      setPerson('')
      setCategory('')
      setNote('')
      onChanged()
    }
    setBusy(false)
  }

  async function remove(id: string) {
    setBusy(true)
    const { error } = await supabase.from('cash_movements').delete().eq('id', id)
    if (error) setError(error.message)
    else onChanged()
    setBusy(false)
  }

  const standName = (id: string | null) =>
    id ? (data.stands.find((s) => s.id === id)?.name ?? '—') : 'Merkez kasa'

  return (
    <>
      <Card title="Yeni hareket">
        {error && <div className="mb-3"><ErrorBox message={error} /></div>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tür">
            <Select value={type} onChange={(e) => setType(e.target.value as CashMovementType)}>
              {(Object.keys(MOVEMENT_LABELS) as CashMovementType[]).map((key) => (
                <option key={key} value={key}>
                  {MOVEMENT_LABELS[key]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tutar (₺)">
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
          </Field>
          <Field label="Kim aldı / kim yaptı" hint="Örn: Hasan, Ortağım">
            <Input value={person} onChange={(e) => setPerson(e.target.value)} placeholder="İsim" />
          </Field>
          <Field label="Kasa">
            <Select value={standId} onChange={(e) => setStandId(e.target.value)}>
              <option value="">Merkez kasa</option>
              {data.stands.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Kategori" hint="Örn: kira, bardak, yakıt">
            <Input value={category} onChange={(e) => setCategory(e.target.value)} />
          </Field>
          <Field label="Açıklama">
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <Button className="mt-3 w-full sm:w-auto" onClick={() => void add()} disabled={busy}>
          Ekle
        </Button>
      </Card>

      <Card title="Son hareketler">
        {data.movements.length === 0 ? (
          <Empty>Kayıtlı hareket yok.</Empty>
        ) : (
          <ul className="divide-y divide-stone-200">
            {data.movements.map((m) => (
              <li key={m.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <div className="font-medium text-stone-800">
                    {MOVEMENT_LABELS[m.type]}
                    {m.person_name ? ` — ${m.person_name}` : ''}
                  </div>
                  <div className="truncate text-xs text-stone-500">
                    {formatShort(m.movement_date)} · {standName(m.stand_id)}
                    {m.category ? ` · ${m.category}` : ''}
                    {m.note ? ` · ${m.note}` : ''}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`tabular-nums font-semibold ${
                      m.type === 'giris' ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    {m.type === 'giris' ? '+' : '−'}
                    {money(m.amount)}
                  </span>
                  <Button variant="ghost" size="icon" onClick={() => void remove(m.id)} disabled={busy}>
                    ✕
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {data.summary && (
        <Card title="Genel toplamlar">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <Line label="Nakit ciro" value={money(data.summary.cash_income)} />
            <Line label="POS ciro" value={money(data.summary.pos_income)} />
            <Line label="Çekilen para" value={money(data.summary.withdrawals)} negative />
            <Line label="Giderler" value={money(data.summary.expenses)} negative />
            <Line label="Bankaya yatan" value={money(data.summary.to_bank)} negative />
            <Line label="Kasaya giriş" value={money(data.summary.deposits)} />
          </dl>
        </Card>
      )}
    </>
  )
}

function Line({ label, value, negative }: { label: string; value: string; negative?: boolean }) {
  return (
    <div className="rounded-xl bg-stone-50 px-3 py-2">
      <dt className="text-xs text-stone-500">{label}</dt>
      <dd className={`tabular-nums font-semibold ${negative ? 'text-red-700' : 'text-stone-800'}`}>{value}</dd>
    </div>
  )
}

function CountsTab({ data, date, onChanged }: { data: Data; date: string; onChanged: () => void }) {
  const [counted, setCounted] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const expected = data.expectedAtDate
  const diff = counted.trim() === '' ? null : parseNumber(counted) - expected

  async function save() {
    if (counted.trim() === '') {
      setError('Sayılan tutarı gir.')
      return
    }
    setBusy(true)
    setError(null)
    const { error } = await supabase.from('cash_counts').insert({
      count_date: date,
      stand_id: null,
      counted_amount: parseNumber(counted),
      expected_amount: expected,
      note: note.trim() || null,
    })
    if (error) setError(error.message)
    else {
      setCounted('')
      setNote('')
      onChanged()
    }
    setBusy(false)
  }

  return (
    <>
      <Card title="Kasa sayımı">
        {error && <div className="mb-3"><ErrorBox message={error} /></div>}
        <p className="mb-3 text-sm text-stone-600">
          {formatShort(date)} tarihine kadar kasada olması gereken nakit:{' '}
          <strong className="tabular-nums">{money(expected)}</strong>
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Sayılan nakit (₺)">
            <Input inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} placeholder="0" />
          </Field>
          <Field label="Not">
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        {diff !== null && (
          <p className={`mt-3 text-sm font-semibold ${diff < 0 ? 'text-red-700' : diff > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
            {diff < 0 ? `Açık: ${money(Math.abs(diff))}` : diff > 0 ? `Fazla: ${money(diff)}` : 'Kasa tam tutuyor'}
          </p>
        )}
        <Button className="mt-3 w-full sm:w-auto" onClick={() => void save()} disabled={busy}>
          Sayımı kaydet
        </Button>
      </Card>

      <Card title="Geçmiş sayımlar">
        {data.counts.length === 0 ? (
          <Empty>Henüz kasa sayımı yapılmamış.</Empty>
        ) : (
          <ul className="divide-y divide-stone-200">
            {data.counts.map((c) => {
              const d = Number(c.counted_amount) - Number(c.expected_amount ?? 0)
              return (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div>
                    <div className="font-medium text-stone-800">{formatShort(c.count_date)}</div>
                    <div className="text-xs text-stone-500">
                      Sayılan {money(c.counted_amount)} · Beklenen {money(c.expected_amount)}
                      {c.note ? ` · ${c.note}` : ''}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 tabular-nums font-semibold ${
                      d < 0 ? 'text-red-700' : d > 0 ? 'text-amber-700' : 'text-emerald-700'
                    }`}
                  >
                    {d === 0 ? 'tam' : `${d > 0 ? '+' : '−'}${money(Math.abs(d))}`}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </>
  )
}
