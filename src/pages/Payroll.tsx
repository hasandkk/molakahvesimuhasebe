import { Fragment, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { errorMessage } from '../lib/errors'
import { useQuery } from '../lib/useQuery'
import { fetchAllEmployees } from '../lib/refData'
import { addDays, formatDayMonth, formatLong, formatShort, startOfWeek, today } from '../lib/date'
import { money, parseNumber } from '../lib/format'
import type {
  Employee,
  EmployeeBonus,
  PayrollRow,
  PayrollSettings,
  WageMode,
} from '../lib/types'
import {
  Button,
  Card,
  CollapsibleCard,
  Empty,
  ErrorBox,
  Field,
  Input,
  Select,
  Spinner,
  Stat,
  Tabs,
} from '../components/ui'
import { PrintDoc, PrintEmpty, PrintFacts, PrintSection } from '../components/print'

type Data = {
  employees: Employee[]
  payroll: PayrollRow[]
  bonuses: EmployeeBonus[]
  settings: PayrollSettings | null
}

async function load(from: string, to: string): Promise<Data> {
  const [employees, payroll, bonuses, settings] = await Promise.all([
    fetchAllEmployees(),
    supabase.rpc('payroll', { p_from: from, p_to: to }),
    supabase.from('employee_bonuses').select('*').gte('work_date', from).lte('work_date', to),
    supabase.from('payroll_settings').select('*').limit(1),
  ])
  if (payroll.error) throw payroll.error
  if (bonuses.error) throw bonuses.error
  if (settings.error) throw settings.error
  return {
    employees,
    payroll: (payroll.data ?? []) as PayrollRow[],
    bonuses: (bonuses.data ?? []) as EmployeeBonus[],
    settings: (settings.data?.[0] as PayrollSettings | undefined) ?? null,
  }
}

type DayLine = {
  date: string
  dayIndex: number | null
  wage: number
  bonus: number
  isTraining: boolean
}

export default function Payroll() {
  const [mode, setMode] = useState<'haftalik' | 'aralik'>('haftalik')

  // Ödeme günü pazartesi; kapsanan dönem bir önceki pazartesi–pazar.
  // Varsayılan bugünden sonraki ilk pazartesi (bugün pazartesiyse bugün) —
  // hafta ortasında bakınca "bu hafta ne birikti" görünsün diye.
  const nextPayDay = () => {
    const monday = startOfWeek(today())
    return monday === today() ? monday : addDays(monday, 7)
  }
  const [payDay, setPayDay] = useState(nextPayDay)
  const [customFrom, setCustomFrom] = useState(addDays(today(), -30))
  const [customTo, setCustomTo] = useState(today())
  const [expanded, setExpanded] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const period =
    mode === 'haftalik'
      ? { from: addDays(payDay, -7), to: addDays(payDay, -1) }
      : { from: customFrom, to: customTo }

  const { data, loading, error, reload } = useQuery(
    () => load(period.from, period.to),
    [period.from, period.to],
  )

  const s = data?.settings ?? null

  /**
   * kademeli: ilk tier1_days gün tier1 ücreti → devamı tam ücret
   * tam:      ilk günden itibaren tam ücret
   * odemesiz: hiç yevmiye yok
   */
  const rateFor = (dayIndex: number, employeeWage: number | null, wageMode: WageMode) => {
    if (!s) return 0
    if (wageMode === 'odemesiz') return 0
    const fullWage = employeeWage !== null ? Number(employeeWage) : Number(s.tier2_wage)
    if (wageMode === 'tam') return fullWage
    if (dayIndex <= s.tier1_days) return Number(s.tier1_wage)
    return fullWage
  }

  const rows = useMemo(() => {
    if (!data) return []
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
      Number(
        data.bonuses.find((b) => b.employee_id === employeeId && b.work_date === date)?.amount ?? 0,
      )

    for (const p of data.payroll) {
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
    for (const b of data.bonuses) {
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
  }, [data, s])

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
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-stone-900">Maaş</h1>
          <p className="truncate text-sm text-stone-500">
            {mode === 'haftalik' ? `${formatLong(payDay)} ödemesi` : `${donemMetni} dönemi`}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => window.print()}>
          PDF / Yazdır
        </Button>
      </div>

      <Tabs
        active={mode}
        onChange={setMode}
        tabs={[
          { id: 'haftalik' as const, label: 'Haftalık ödeme' },
          { id: 'aralik' as const, label: 'Seçili aralık' },
        ]}
      />

      {mode === 'haftalik' ? (
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
          {payDay !== nextPayDay() && (
            <Button
              variant="secondary"
              size="sm"
              className="mt-2 w-full"
              onClick={() => setPayDay(nextPayDay())}
            >
              Yaklaşan ödemeye dön
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Başlangıç">
            <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
          </Field>
          <Field label="Bitiş">
            <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </Field>
        </div>
      )}

      {error && <ErrorBox message={error} />}
      {data && !s && (
        <ErrorBox message="Ücret kademeleri bulunamadı, bu yüzden tüm tutarlar sıfır görünüyor. 0001_init.sql betiğini çalıştır." />
      )}

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Yevmiye" value={money(grand.wage)} />
        <Stat label="Prim" value={money(grand.bonus)} tone={grand.bonus < 0 ? 'bad' : 'default'} />
        <Stat label="Ödenecek" value={money(grand.total)} tone="warn" />
      </div>

      {loading && !data && <Spinner />}

      <Card
        title="Çalışan başına ödeme"
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
                      <span className="text-[11px] text-brand-700">
                        {isOpen ? 'gizle ▴' : 'gün gün ▾'}
                      </span>
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

      <BonusCard
        key={`${period.from}-${period.to}`}
        employees={data?.employees ?? []}
        bonuses={data?.bonuses ?? []}
        from={period.from}
        to={period.to}
        onChanged={reload}
      />

      <SettingsCard settings={s} onSaved={reload} />

      <p className="text-xs text-stone-500">
        Haftalık ödemede pazartesi günü <strong>bir önceki pazartesi–pazar</strong> dönemi ödenir.
        Aynı gün iki vardiya çalışılsa da bir gün sayılır. Kademe sayacı kişinin işe başladığı ilk
        günden işler, seçtiğin dönemden değil.
      </p>

      <PrintDoc
        title={mode === 'haftalik' ? `Ödeme listesi — ${formatLong(payDay)}` : 'Ödeme listesi'}
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
    </>
  )
}

/* -------------------------------------------------------- Ücret kademeleri */

function SettingsCard({
  settings,
  onSaved,
}: {
  settings: PayrollSettings | null
  onSaved: () => void
}) {
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const value = (key: keyof PayrollSettings) => draft[key] ?? (settings ? String(settings[key]) : '')

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
    if (error) setError(errorMessage(error))
    else {
      setDraft({})
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onSaved()
    }
    setBusy(false)
  }

  if (!settings) {
    return (
      <Card title="Ücret kademeleri">
        <Empty>Ayarlar bulunamadı — 0001_init.sql'i tekrar çalıştır.</Empty>
      </Card>
    )
  }

  return (
    <CollapsibleCard
      title="Ücret kademeleri"
      openLabel="değiştir"
      summary={
        <>
          İlk <strong>{settings.tier1_days} gün</strong> günlük{' '}
          <strong>{money(settings.tier1_wage)}</strong> · devamı günlük{' '}
          <strong>{money(settings.tier2_wage)}</strong>
        </>
      }
    >
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
    </CollapsibleCard>
  )
}

/* ------------------------------------------------------------------ Prim */

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
    if (error) setError(errorMessage(error))
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
    if (error) setError(errorMessage(error))
    else onChanged()
    setBusy(false)
  }

  const nameOf = (id: string) => employees.find((e) => e.id === id)?.full_name ?? '—'
  const list = [...bonuses].sort((a, b) => b.work_date.localeCompare(a.work_date))

  return (
    <CollapsibleCard
      title="Prim"
      openLabel="prim ekle"
      summary={
        list.length === 0 ? (
          <span className="text-stone-500">Bu dönemde prim yok.</span>
        ) : (
          <ul className="divide-y divide-stone-100 text-sm">
            {list.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 py-1.5">
                <span className="min-w-0 truncate">
                  {formatShort(b.work_date)} · {nameOf(b.employee_id)}
                  {b.note ? <span className="text-stone-500"> · {b.note}</span> : null}
                </span>
                <span
                  className={`shrink-0 tabular-nums font-semibold ${
                    Number(b.amount) < 0 ? 'text-red-700' : 'text-emerald-700'
                  }`}
                >
                  {Number(b.amount) > 0 ? '+' : '−'}
                  {money(Math.abs(Number(b.amount)))}
                </span>
              </li>
            ))}
          </ul>
        )
      }
    >
      {error && (
        <div className="mb-3">
          <ErrorBox message={error} />
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Tarih">
          <Input
            type="date"
            value={date}
            min={from}
            max={to}
            onChange={(e) => setDate(e.target.value)}
          />
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
          <Input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
          />
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
    </CollapsibleCard>
  )
}
