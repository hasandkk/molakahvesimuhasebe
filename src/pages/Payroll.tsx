import { Fragment, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { errorMessage } from '../lib/errors'
import { useQuery } from '../lib/useQuery'
import { fetchActiveEmployees, fetchAllEmployees } from '../lib/refData'
import { addDays, formatDayMonth, formatLong, formatShort, startOfWeek, today } from '../lib/date'
import { money, parseAmount, parseNumber } from '../lib/format'
import type {
  Employee,
  EmployeeAdvance,
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
  Spinner,
  Stat,
  Tabs,
} from '../components/ui'
import { PrintDoc, PrintEmpty, PrintFacts, PrintSection } from '../components/print'

type Data = {
  /** Hesaplama ve isim çözümü için — pasife alınmış biri geçmiş dönemde
   *  çalışmışsa ödeme listesinde görünmeye devam etmeli. */
  employees: Employee[]
  /** Prim açılır listesi için — ayrılmış birine prim yazılmaz. */
  activeEmployees: Employee[]
  payroll: PayrollRow[]
  bonuses: EmployeeBonus[]
  advances: EmployeeAdvance[]
  settings: PayrollSettings | null
}

async function load(from: string, to: string): Promise<Data> {
  const [employees, activeEmployees, payroll, bonuses, advances, settings] = await Promise.all([
    fetchAllEmployees(),
    fetchActiveEmployees(),
    supabase.rpc('payroll', { p_from: from, p_to: to }),
    supabase.from('employee_bonuses').select('*').gte('work_date', from).lte('work_date', to),
    supabase.from('employee_advances').select('*').gte('paid_date', from).lte('paid_date', to),
    supabase.from('payroll_settings').select('*').limit(1),
  ])
  if (payroll.error) throw payroll.error
  if (bonuses.error) throw bonuses.error
  if (advances.error) throw advances.error
  if (settings.error) throw settings.error
  return {
    employees,
    activeEmployees,
    payroll: (payroll.data ?? []) as PayrollRow[],
    bonuses: (bonuses.data ?? []) as EmployeeBonus[],
    advances: (advances.data ?? []) as EmployeeAdvance[],
    settings: (settings.data?.[0] as PayrollSettings | undefined) ?? null,
  }
}

type DayLine = {
  date: string
  dayIndex: number | null
  wage: number
  bonus: number
  advance: number
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
   * odemesiz: hiç yevmiye yok
   */
  const rateFor = (dayIndex: number, employeeWage: number | null, wageMode: WageMode) => {
    if (!s) return 0
    if (wageMode === 'odemesiz') return 0
    const fullWage = employeeWage !== null ? Number(employeeWage) : Number(s.tier2_wage)
    if (dayIndex <= s.tier1_days) return Number(s.tier1_wage)
    return fullWage
  }

  const rows = useMemo(() => {
    if (!data) return []

    type Row = {
      id: string
      name: string
      wageMode: WageMode
      days: DayLine[]
      wageTotal: number
      bonusTotal: number
      advanceTotal: number
    }
    const map = new Map<string, Row>()

    /**
     * Bir kişinin bir gününü tutan satırı bulur, yoksa açar.
     *
     * Gün satırları tek yerden yönetiliyor: aynı kişiye aynı gün birden
     * fazla prim ya da avans yazılabildiği için tutarların ÜST ÜSTE
     * TOPLANMASI gerekiyor. Önceki sürüm primi `find` ile arıyordu, yani
     * aynı günün ikinci primi hesaba hiç girmiyordu.
     */
    const lineFor = (employeeId: string, name: string, date: string) => {
      const emp = data.employees.find((e) => e.id === employeeId)
      let row = map.get(employeeId)
      if (!row) {
        row = {
          id: employeeId,
          name: emp?.full_name ?? name,
          wageMode: (emp?.wage_mode ?? 'kademeli') as WageMode,
          days: [],
          wageTotal: 0,
          bonusTotal: 0,
          advanceTotal: 0,
        }
        map.set(employeeId, row)
      }
      let line = row.days.find((d) => d.date === date)
      if (!line) {
        line = { date, dayIndex: null, wage: 0, bonus: 0, advance: 0, isTraining: false }
        row.days.push(line)
      }
      return { row, line }
    }

    for (const p of data.payroll) {
      const emp = data.employees.find((e) => e.id === p.employee_id)
      const wageMode = (emp?.wage_mode ?? 'kademeli') as WageMode
      const wage = rateFor(p.day_index, emp?.daily_wage ?? null, wageMode)
      const { row, line } = lineFor(p.employee_id, p.full_name, p.work_date)
      line.dayIndex = p.day_index
      line.isTraining = p.is_training
      line.wage += wage
      row.wageTotal += wage
    }

    for (const b of data.bonuses) {
      const { row, line } = lineFor(b.employee_id, '—', b.work_date)
      line.bonus += Number(b.amount)
      row.bonusTotal += Number(b.amount)
    }

    // Kişi o gün çalışmamış da olabilir (izinli günde uğrayıp para aldı);
    // öyle günler de satır açar ve hakedişten düşülür.
    for (const a of data.advances) {
      const { row, line } = lineFor(a.employee_id, '—', a.paid_date)
      line.advance += Number(a.amount)
      row.advanceTotal += Number(a.amount)
    }

    // Çalışma kaydı olmayan aktif çalışanlar da listede dursun: prim ya da
    // avansı doğrudan kendi satırından girebilmek için. Tutarları sıfır
    // olduğu için toplamları etkilemiyorlar.
    for (const e of data.activeEmployees) {
      if (map.has(e.id)) continue
      map.set(e.id, {
        id: e.id,
        name: e.full_name,
        wageMode: e.wage_mode,
        days: [],
        wageTotal: 0,
        bonusTotal: 0,
        advanceTotal: 0,
      })
    }

    return [...map.values()]
      .map((r) => ({
        ...r,
        days: [...r.days].sort((a, b) => a.date.localeCompare(b.date)),
        total: r.wageTotal + r.bonusTotal - r.advanceTotal,
      }))
      // Kaydı olanlar üstte, tutarı büyükten küçüğe; boşlar en altta isimle.
      .sort((a, b) => {
        const byHas = (b.days.length > 0 ? 1 : 0) - (a.days.length > 0 ? 1 : 0)
        if (byHas !== 0) return byHas
        if (a.days.length === 0) return a.name.localeCompare(b.name, 'tr')
        return b.total - a.total
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, s])

  const grand = rows.reduce(
    (acc, r) => ({
      wage: acc.wage + r.wageTotal,
      bonus: acc.bonus + r.bonusTotal,
      advance: acc.advance + r.advanceTotal,
      total: acc.total + r.total,
    }),
    { wage: 0, bonus: 0, advance: 0, total: 0 },
  )

  /** Ödeme listesine sadece o dönemde kaydı olanlar girer. */
  const payableRows = useMemo(() => rows.filter((r) => r.days.length > 0), [rows])

  const donemMetni = `${formatDayMonth(period.from)} – ${formatDayMonth(period.to)}`

  const odemeMetni = useMemo(() => {
    const lines = [
      mode === 'haftalik'
        ? `💰 ${formatLong(payDay)} ödemesi — ${donemMetni} dönemi`
        : `💰 ${donemMetni} dönemi ödemesi`,
      '',
    ]
    for (const r of payableRows) {
      const gun = r.days.filter((d) => d.dayIndex !== null).length
      const avans = r.advanceTotal > 0 ? ` (avans −${money(r.advanceTotal)})` : ''
      lines.push(`${r.name} — ${gun} gün${avans} · ${money(r.total)}`)
    }
    lines.push('', `Toplam: ${money(grand.total)}`)
    return lines.join('\n')
  }, [payableRows, grand.total, payDay, donemMetni, mode])

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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Yevmiye" value={money(grand.wage)} />
        <Stat label="Prim" value={money(grand.bonus)} tone={grand.bonus < 0 ? 'bad' : 'default'} />
        <Stat
          label="Avans kesintisi"
          value={grand.advance === 0 ? '—' : `−${money(grand.advance)}`}
          tone={grand.advance > 0 ? 'bad' : 'default'}
        />
        <Stat label="Ödenecek" value={money(grand.total)} tone="warn" />
      </div>

      {loading && !data && <Spinner />}

      <Card
        title="Çalışan başına ödeme"
        action={
          payableRows.length > 0 && (
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
                        {r.wageMode === 'odemesiz' && (
                          <span className="shrink-0 rounded-md bg-stone-200 px-1.5 py-0.5 text-[10px] font-semibold text-stone-600">
                            ödeme yok
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-stone-500">
                        {workedDays} gün · yevmiye {money(r.wageTotal)}
                        {r.bonusTotal !== 0 && ` · prim ${money(r.bonusTotal)}`}
                        {r.advanceTotal > 0 && (
                          <span className="text-red-700"> · avans −{money(r.advanceTotal)}</span>
                        )}
                      </span>
                      {/* Avans hakedişi aştıysa fazlası kendiliğinden gelecek
                          döneme devretmiyor; elle takip edilmesi gerekiyor. */}
                      {r.total < 0 && (
                        <span className="mt-0.5 block text-xs text-red-700">
                          Avans hakedişi {money(Math.abs(r.total))} aştı. Bu tutar gelecek haftaya
                          kendiliğinden devretmez — sonraki dönemde elle avans olarak yaz.
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-right">
                      <span
                        className={`block font-semibold tabular-nums ${
                          r.total < 0 ? 'text-red-700' : 'text-stone-900'
                        }`}
                      >
                        {money(r.total)}
                      </span>
                      <span className="text-[11px] text-brand-700">
                        {isOpen ? 'gizle ▴' : 'aç ▾'}
                      </span>
                    </span>
                  </button>

                  {isOpen && (
                    <div className="mt-2 space-y-2">
                      <EmployeeEntry
                        employeeId={r.id}
                        from={period.from}
                        to={period.to}
                        bonuses={(data?.bonuses ?? []).filter((b) => b.employee_id === r.id)}
                        advances={(data?.advances ?? []).filter((a) => a.employee_id === r.id)}
                        onChanged={reload}
                      />
                      {r.days.length > 0 && (
                    <ul className="space-y-1 rounded-xl bg-stone-50 p-2">
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
                            {d.advance > 0 && (
                              <span className="text-red-700"> −{money(d.advance)}</span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <SettingsCard settings={s} onSaved={reload} />

      <p className="text-xs text-stone-500">
        Haftalık ödemede pazartesi günü <strong>bir önceki pazartesi–pazar</strong> dönemi ödenir.
        Aynı gün iki vardiya çalışılsa da bir gün sayılır. Kademe sayacı kişinin işe başladığı ilk
        günden işler, seçtiğin dönemden değil. <strong>Avans</strong>, verildiği tarihin düştüğü
        ödeme döneminde hakedişten düşülür.
      </p>

      <PrintDoc
        title={mode === 'haftalik' ? `Ödeme listesi — ${formatLong(payDay)}` : 'Ödeme listesi'}
        period={`${formatShort(period.from)} – ${formatShort(period.to)}`}
      >
        <PrintFacts
          items={[
            { label: 'Yevmiye', value: money(grand.wage) },
            { label: 'Prim', value: money(grand.bonus) },
            { label: 'Avans', value: grand.advance === 0 ? '—' : `−${money(grand.advance)}` },
            { label: 'Toplam ödenecek', value: money(grand.total) },
          ]}
        />

        <PrintSection title="Çalışan başına ödeme">
          {payableRows.length === 0 ? (
            <PrintEmpty>Bu dönemde çalışma kaydı yok.</PrintEmpty>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Çalışan</th>
                  <th className="num">Gün</th>
                  <th className="num">Yevmiye</th>
                  <th className="num">Prim</th>
                  <th className="num">Avans</th>
                  <th className="num">Ödenecek</th>
                  <th className="sign-col">İmza</th>
                </tr>
              </thead>
              <tbody>
                {payableRows.map((r) => (
                  <tr key={r.id} className="sign-row">
                    <td>
                      {r.name}
                      {r.wageMode === 'odemesiz' && <span className="muted"> (ödeme yok)</span>}
                    </td>
                    <td className="num muted">{r.days.filter((d) => d.dayIndex !== null).length}</td>
                    <td className="num">{money(r.wageTotal)}</td>
                    <td className="num">{r.bonusTotal === 0 ? '—' : money(r.bonusTotal)}</td>
                    <td className="num">
                      {r.advanceTotal === 0 ? '—' : `−${money(r.advanceTotal)}`}
                    </td>
                    <td className="num">{money(r.total)}</td>
                    <td />
                  </tr>
                ))}
                <tr className="total-row">
                  <td>Toplam</td>
                  <td />
                  <td className="num">{money(grand.wage)}</td>
                  <td className="num">{money(grand.bonus)}</td>
                  <td className="num">
                    {grand.advance === 0 ? '—' : `−${money(grand.advance)}`}
                  </td>
                  <td className="num">{money(grand.total)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          )}
        </PrintSection>

        {payableRows.length > 0 && (
          <PrintSection title="Gün gün döküm">
            <table>
              <thead>
                <tr>
                  <th className="num">Tarih</th>
                  <th className="num">Kaçıncı gün</th>
                  <th className="num">Yevmiye</th>
                  <th className="num">Prim</th>
                  <th className="num">Avans</th>
                </tr>
              </thead>
              <tbody>
                {payableRows.map((r) => (
                  <Fragment key={r.id}>
                    <tr className="group-row">
                      <td colSpan={5}>
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
                        <td className="num">{d.advance === 0 ? '—' : `−${money(d.advance)}`}</td>
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

/* ------------------------------------- Satır içi prim / avans girişi */

type EntryKind = 'prim' | 'avans'

/**
 * Prim ve avans, çalışanın kendi satırının içinden giriliyor.
 *
 * Önceden sayfanın altında iki ayrı form vardı ve her seferinde açılır
 * listeden kişiyi seçmek gerekiyordu; yanlış kişiyi seçmek ya da kaydın
 * gittiğini fark etmemek kolaydı. Burada kişi zaten belli, kaydedince
 * satırın toplamı gözünün önünde değişiyor.
 */
function EmployeeEntry({
  employeeId,
  from,
  to,
  bonuses,
  advances,
  onChanged,
}: {
  employeeId: string
  from: string
  to: string
  bonuses: EmployeeBonus[]
  advances: EmployeeAdvance[]
  onChanged: () => void
}) {
  const [kind, setKind] = useState<EntryKind | null>(null)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  // Dönem içindeysek bugün, değilsek dönemin son günü.
  const [date, setDate] = useState(() => {
    const now = today()
    return now >= from && now <= to ? now : to
  })
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function open(next: EntryKind) {
    setKind(next)
    setAmount('')
    setNote('')
    setError(null)
    setSaved(null)
  }

  async function save() {
    const value = parseAmount(amount)
    if (value === null) {
      setError('Tutarı anlayamadım. Örnek: 1.500 ya da 1500')
      return
    }
    if (kind === 'avans' && value <= 0) {
      setError('Avans sıfırdan büyük olmalı.')
      return
    }
    if (kind === 'prim' && value === 0) {
      setError('Prim 0 olamaz. Kesinti için eksi yaz.')
      return
    }

    setBusy(true)
    setError(null)
    const { error } =
      kind === 'prim'
        ? // upsert değil insert: aynı kişiye aynı gün ikinci prim
          // yazıldığında birincinin üzerine yazmasın.
          await supabase.from('employee_bonuses').insert({
            work_date: date,
            employee_id: employeeId,
            amount: value,
            note: note.trim() || null,
          })
        : await supabase.from('employee_advances').insert({
            paid_date: date,
            employee_id: employeeId,
            amount: value,
            note: note.trim() || null,
          })

    if (error) setError(errorMessage(error))
    else {
      setSaved(`${kind === 'prim' ? 'Prim' : 'Avans'} eklendi: ${money(value)}`)
      setAmount('')
      setNote('')
      setKind(null)
      setTimeout(() => setSaved(null), 3000)
      onChanged()
    }
    setBusy(false)
  }

  async function remove(table: 'employee_bonuses' | 'employee_advances', id: string) {
    setBusy(true)
    const { error } = await supabase.from(table).delete().eq('id', id)
    if (error) setError(errorMessage(error))
    else onChanged()
    setBusy(false)
  }

  const kayitlar = [
    ...bonuses.map((b) => ({
      id: b.id,
      table: 'employee_bonuses' as const,
      date: b.work_date,
      label: 'Prim',
      amount: Number(b.amount),
      note: b.note,
    })),
    ...advances.map((a) => ({
      id: a.id,
      table: 'employee_advances' as const,
      date: a.paid_date,
      label: 'Avans',
      amount: -Number(a.amount),
      note: a.note,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date))

  return (
    <div className="rounded-xl border border-stone-200 p-2">
      {error && (
        <div className="mb-2">
          <ErrorBox message={error} />
        </div>
      )}
      {saved && (
        <p className="mb-2 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-800">
          ✓ {saved}
        </p>
      )}

      {kind === null ? (
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" className="flex-1" onClick={() => open('prim')}>
            + Prim
          </Button>
          <Button size="sm" variant="secondary" className="flex-1" onClick={() => open('avans')}>
            + Avans
          </Button>
        </div>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label={kind === 'prim' ? 'Prim tutarı (₺)' : 'Avans tutarı (₺)'}>
              <Input
                inputMode="decimal"
                autoFocus
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
              />
            </Field>
            <Field label="Tarih">
              <Input
                type="date"
                value={date}
                min={from}
                max={to}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Açıklama" className="mt-2">
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="İsteğe bağlı"
            />
          </Field>
          <p className="mt-1 text-xs text-stone-500">
            {kind === 'prim'
              ? 'Eksi yazarsan kesinti olur.'
              : 'Verdiğin ön ödeme; bu dönemin hakedişinden düşülür.'}
          </p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" className="flex-1" onClick={() => void save()} disabled={busy}>
              Kaydet
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setKind(null)} disabled={busy}>
              Vazgeç
            </Button>
          </div>
        </>
      )}

      {kayitlar.length > 0 && (
        <ul className="mt-2 divide-y divide-stone-100">
          {kayitlar.map((k) => (
            <li key={k.id} className="flex items-center justify-between gap-2 py-1.5 text-xs">
              <span className="min-w-0 truncate text-stone-600">
                {formatShort(k.date)} · {k.label}
                {k.note ? ` · ${k.note}` : ''}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <span
                  className={`tabular-nums font-semibold ${
                    k.amount < 0 ? 'text-red-700' : 'text-emerald-700'
                  }`}
                >
                  {k.amount > 0 ? '+' : '−'}
                  {money(Math.abs(k.amount))}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => void remove(k.table, k.id)}
                  disabled={busy}
                  aria-label="Sil"
                >
                  ✕
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
