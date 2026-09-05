import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { errorMessage } from '../lib/errors'
import { useQuery } from '../lib/useQuery'
import {
  addMonths,
  endOfMonth,
  formatMonth,
  formatShort,
  startOfMonth,
  today,
} from '../lib/date'
import { money, parseNumber } from '../lib/format'
import { EXPENSE_SPENDERS, type Expense, type ExpenseSpender } from '../lib/types'
import {
  Button,
  Card,
  CollapsibleCard,
  Empty,
  ErrorBox,
  Field,
  Input,
  Spinner,
  Stat,
} from '../components/ui'
import { PrintDoc, PrintEmpty, PrintFacts, PrintSection } from '../components/print'

async function load(from: string, to: string): Promise<Expense[]> {
  const { data, error } = await supabase
    .from('expenses')
    .select('*')
    .gte('expense_date', from)
    .lte('expense_date', to)
    .order('expense_date', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as Expense[]
}

export default function Expenses() {
  // Ay sonunda bakılıyor; varsayılan içinde bulunulan ay.
  const [month, setMonth] = useState(() => startOfMonth(today()))
  const [copied, setCopied] = useState(false)

  const from = month
  const to = endOfMonth(month)

  const { data, loading, error, reload } = useQuery(() => load(from, to), [from, to])

  const rows = useMemo(() => data ?? [], [data])

  const total = rows.reduce((s, r) => s + Number(r.amount), 0)

  /**
   * Kişi başı toplam. Bilerek sadece tutar ve kayıt sayısı var — yüzde payı
   * ya da "kim daha çok harcadı" karşılaştırması yok; bunlar iki ortak
   * arasında yarış havası yaratıyordu.
   */
  const bySpender = useMemo(
    () =>
      EXPENSE_SPENDERS.map((name) => {
        const list = rows.filter((r) => r.spender === name)
        return {
          name,
          sum: list.reduce((s, r) => s + Number(r.amount), 0),
          count: list.length,
        }
      }),
    [rows],
  )

  const ozetMetni = useMemo(() => {
    const lines = [`💸 ${formatMonth(month)} harcamaları`, '']
    for (const s of bySpender) lines.push(`${s.name} — ${money(s.sum)} (${s.count} kayıt)`)
    lines.push('', `Toplam: ${money(total)}`)
    return lines.join('\n')
  }, [bySpender, total, month])

  async function copyText() {
    try {
      await navigator.clipboard.writeText(ozetMetni)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* pano yoksa sessiz geç */
    }
  }

  const thisMonth = startOfMonth(today())

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-stone-900">Harcamalar</h1>
          <p className="truncate text-sm text-stone-500">{formatMonth(month)}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          {rows.length > 0 && (
            <Button variant="secondary" size="sm" onClick={() => void copyText()}>
              {copied ? '✓ Kopyalandı' : 'Özeti kopyala'}
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => window.print()}>
            PDF / Yazdır
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-stone-200 bg-white p-3 shadow-sm">
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="icon"
            onClick={() => setMonth(addMonths(month, -1))}
            aria-label="Önceki ay"
          >
            ‹
          </Button>
          <div className="min-w-0 flex-1 text-center">
            <div className="text-sm font-semibold text-stone-900">{formatMonth(month)}</div>
            <div className="text-xs text-stone-500">
              {formatShort(from)} – {formatShort(to)}
            </div>
          </div>
          <Button
            variant="secondary"
            size="icon"
            onClick={() => setMonth(addMonths(month, 1))}
            aria-label="Sonraki ay"
          >
            ›
          </Button>
        </div>
        {month !== thisMonth && (
          <Button
            variant="secondary"
            size="sm"
            className="mt-2 w-full"
            onClick={() => setMonth(thisMonth)}
          >
            Bu aya dön
          </Button>
        )}
      </div>

      {error && <ErrorBox message={error} />}

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Toplam" value={money(total)} tone="warn" />
        {bySpender.map((s) => (
          <Stat key={s.name} label={s.name} value={money(s.sum)} sub={`${s.count} kayıt`} />
        ))}
      </div>

      {loading && !data && <Spinner />}

      <NewExpenseCard onAdded={reload} defaultDate={month === thisMonth ? today() : to} />

      <Card title="Harcama listesi">
        {rows.length === 0 ? (
          <Empty>Bu ayda harcama kaydı yok.</Empty>
        ) : (
          <ul className="divide-y divide-stone-100">
            {rows.map((r) => (
              <ExpenseRow key={r.id} expense={r} onChanged={reload} />
            ))}
          </ul>
        )}
      </Card>

      <PrintDoc title="Harcama raporu" period={formatMonth(month)}>
        <PrintFacts
          items={[
            { label: 'Toplam', value: money(total) },
            ...bySpender.map((s) => ({ label: s.name, value: money(s.sum) })),
          ]}
        />

        <PrintSection title="Kim ne kadar harcadı">
          <table>
            <thead>
              <tr>
                <th>Kişi</th>
                <th className="num">Kayıt</th>
                <th className="num">Tutar</th>
              </tr>
            </thead>
            <tbody>
              {bySpender.map((s) => (
                <tr key={s.name}>
                  <td>{s.name}</td>
                  <td className="num muted">{s.count}</td>
                  <td className="num">{money(s.sum)}</td>
                </tr>
              ))}
              <tr className="total-row">
                <td>Toplam</td>
                <td className="num">{rows.length}</td>
                <td className="num">{money(total)}</td>
              </tr>
            </tbody>
          </table>
        </PrintSection>

        <PrintSection title="Harcama listesi">
          {rows.length === 0 ? (
            <PrintEmpty>Bu ayda harcama kaydı yok.</PrintEmpty>
          ) : (
            <table>
              <thead>
                <tr>
                  <th className="num">Tarih</th>
                  <th>Kişi</th>
                  <th>Açıklama</th>
                  <th className="num">Tutar</th>
                </tr>
              </thead>
              <tbody>
                {[...rows]
                  .sort((a, b) => a.expense_date.localeCompare(b.expense_date))
                  .map((r) => (
                    <tr key={r.id}>
                      <td className="num">{formatShort(r.expense_date)}</td>
                      <td>{r.spender}</td>
                      <td className="muted">{r.note || ''}</td>
                      <td className="num">{money(r.amount)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </PrintSection>
      </PrintDoc>
    </>
  )
}

/* --------------------------------------------------------- Yeni harcama */

function NewExpenseCard({
  onAdded,
  defaultDate,
}: {
  onAdded: () => void
  defaultDate: string
}) {
  const [date, setDate] = useState(defaultDate)
  const [spender, setSpender] = useState<ExpenseSpender>(EXPENSE_SPENDERS[0])
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function add() {
    const value = parseNumber(amount)
    if (value <= 0) {
      setError('Tutar sıfırdan büyük olmalı.')
      return
    }
    setBusy(true)
    setError(null)
    const { error } = await supabase.from('expenses').insert({
      expense_date: date,
      spender,
      amount: value,
      note: note.trim() || null,
    })
    if (error) setError(errorMessage(error))
    else {
      setAmount('')
      setNote('')
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onAdded()
    }
    setBusy(false)
  }

  return (
    <CollapsibleCard title="Yeni harcama" openLabel="harcama ekle" defaultOpen>
      {error && (
        <div className="mb-3">
          <ErrorBox message={error} />
        </div>
      )}

      <Field label="Harcayan">
        {/* İki kişilik seçim için açılır liste yerine düğme: tek dokunuş */}
        <div className="grid grid-cols-2 gap-2">
          {EXPENSE_SPENDERS.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setSpender(name)}
              aria-pressed={spender === name}
              className={`min-h-11 rounded-xl border px-3 text-sm font-medium transition ${
                spender === name
                  ? 'border-brand-700 bg-brand-700 text-white'
                  : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-50'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      </Field>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Tutar (₺)">
          <Input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
          />
        </Field>
        <Field label="Tarih">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Açıklama" className="sm:col-span-2">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ne için harcandı?"
          />
        </Field>
      </div>

      <Button className="mt-3 w-full sm:w-auto" onClick={() => void add()} disabled={busy}>
        {saved ? '✓ Eklendi' : 'Harcamayı ekle'}
      </Button>
    </CollapsibleCard>
  )
}

/* ------------------------------------------------------------ Liste satırı */

function ExpenseRow({ expense, onChanged }: { expense: Expense; onChanged: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    setBusy(true)
    const { error } = await supabase.from('expenses').delete().eq('id', expense.id)
    if (error) setError(errorMessage(error))
    else onChanged()
    setBusy(false)
  }

  return (
    <li className="py-2.5">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="text-sm font-medium text-stone-800">{expense.spender}</span>
          <span className="block text-xs text-stone-500">
            {formatShort(expense.expense_date)}
            {expense.note ? ` · ${expense.note}` : ''}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="tabular-nums font-semibold text-stone-900">{money(expense.amount)}</span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setConfirming((v) => !v)}
            aria-label="Sil"
            disabled={busy}
          >
            ✕
          </Button>
        </span>
      </div>

      {error && (
        <div className="mt-2">
          <ErrorBox message={error} />
        </div>
      )}

      {confirming && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-xl bg-red-50 px-3 py-2">
          <span className="text-xs text-red-800">Bu harcama silinsin mi?</span>
          <span className="flex shrink-0 gap-2">
            <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>
              Vazgeç
            </Button>
            <Button size="sm" variant="danger" onClick={() => void remove()} disabled={busy}>
              Sil
            </Button>
          </span>
        </div>
      )}
    </li>
  )
}
