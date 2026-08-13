import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useQuery } from '../lib/useQuery'
import { fetchAllStands } from '../lib/refData'
import { startOfMonth, today } from '../lib/date'
import { money } from '../lib/format'
import { MOVEMENT_LABELS, type CashMovement, type Stand } from '../lib/types'
import { Card, Empty, ErrorBox, Field, Input, Spinner, Stat } from '../components/ui'

type RevenueRow = { business_date: string; stand_id: string; cash_amount: number; pos_amount: number }
type ShiftRow = {
  work_date: string
  employee_id: string
  kind: 'vardiya' | 'egitim'
  employees: { full_name: string } | null
}

type Data = {
  stands: Stand[]
  revenues: RevenueRow[]
  movements: CashMovement[]
  shifts: ShiftRow[]
}

async function load(from: string, to: string): Promise<Data> {
  const [stands, revenues, movements, shifts] = await Promise.all([
    fetchAllStands(),
    supabase
      .from('daily_revenues')
      .select('business_date, stand_id, cash_amount, pos_amount')
      .gte('business_date', from)
      .lte('business_date', to),
    supabase
      .from('cash_movements')
      .select('*')
      .gte('movement_date', from)
      .lte('movement_date', to),
    supabase
      .from('shift_assignments')
      .select('work_date, employee_id, kind, employees(full_name)')
      .gte('work_date', from)
      .lte('work_date', to),
  ])

  const err = revenues.error ?? movements.error ?? shifts.error
  if (err) throw err

  return {
    stands,
    revenues: (revenues.data ?? []) as RevenueRow[],
    movements: (movements.data ?? []) as CashMovement[],
    shifts: (shifts.data ?? []) as unknown as ShiftRow[],
  }
}

export default function Reports() {
  const [from, setFrom] = useState(startOfMonth(today()))
  const [to, setTo] = useState(today())
  const { data, loading, error } = useQuery(() => load(from, to), [from, to])

  const totals = useMemo(() => {
    const cash = (data?.revenues ?? []).reduce((s, r) => s + Number(r.cash_amount), 0)
    const pos = (data?.revenues ?? []).reduce((s, r) => s + Number(r.pos_amount), 0)
    const out = (data?.movements ?? [])
      .filter((m) => m.type !== 'giris')
      .reduce((s, m) => s + Number(m.amount), 0)
    return { cash, pos, total: cash + pos, out }
  }, [data])

  const byStand = useMemo(() => {
    if (!data) return []
    return data.stands
      .map((stand) => {
        const rows = data.revenues.filter((r) => r.stand_id === stand.id)
        const cash = rows.reduce((s, r) => s + Number(r.cash_amount), 0)
        const pos = rows.reduce((s, r) => s + Number(r.pos_amount), 0)
        return { stand, cash, pos, total: cash + pos, days: rows.length }
      })
      .filter((r) => r.days > 0 || r.stand.is_active)
      .sort((a, b) => b.total - a.total)
  }, [data])

  const byPerson = useMemo(() => {
    const map = new Map<string, number>()
    for (const m of data?.movements ?? []) {
      if (m.type !== 'cekim') continue
      const key = m.person_name?.trim() || 'Belirtilmemiş'
      map.set(key, (map.get(key) ?? 0) + Number(m.amount))
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [data])

  const byCategory = useMemo(() => {
    const map = new Map<string, number>()
    for (const m of data?.movements ?? []) {
      if (m.type !== 'gider') continue
      const key = m.category?.trim() || 'Diğer'
      map.set(key, (map.get(key) ?? 0) + Number(m.amount))
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [data])

  const byEmployee = useMemo(() => {
    const map = new Map<string, { shifts: number; trainings: number }>()
    for (const s of data?.shifts ?? []) {
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
      <h1 className="text-lg font-semibold text-stone-900">Raporlar</h1>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Başlangıç">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Bitiş">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>

      {error && <ErrorBox message={error} />}
      {loading && !data && <Spinner />}

      {data && (
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
                {/* Mobil: kart listesi — yatay kaydırma yok */}
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

                {/* Masaüstü: tablo */}
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
                      {row.trainings > 0 && (
                        <span className="ml-1 text-amber-700">· {row.trainings} eğitim</span>
                      )}
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
                      {m.movement_date} · {MOVEMENT_LABELS[m.type]}
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
      )}
    </>
  )
}
