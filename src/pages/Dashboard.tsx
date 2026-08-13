import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useQuery } from '../lib/useQuery'
import { formatLong, startOfMonth, today, tomorrow } from '../lib/date'
import { money } from '../lib/format'
import type { Stand } from '../lib/types'
import { Card, Empty, ErrorBox, Spinner, Stat } from '../components/ui'

type Data = {
  stands: Stand[]
  todayCash: number
  todayPos: number
  monthCash: number
  monthPos: number
  cashBalance: number
  tomorrowByStand: Map<string, number>
  countedStandIds: Set<string>
  missingRevenueStandIds: string[]
}

async function load(): Promise<Data> {
  const day = today()
  const next = tomorrow()
  const monthStart = startOfMonth(day)

  const [stands, monthRevenues, summary, shifts, counts] = await Promise.all([
    supabase.from('stands').select('*').eq('is_active', true).order('sort_order').order('name'),
    supabase
      .from('daily_revenues')
      .select('business_date, stand_id, cash_amount, pos_amount')
      .gte('business_date', monthStart)
      .lte('business_date', day),
    supabase.rpc('cash_summary'),
    supabase.from('shift_assignments').select('stand_id').eq('work_date', next),
    supabase.from('stock_counts').select('stand_id').eq('count_date', day),
  ])

  const err = stands.error ?? monthRevenues.error ?? summary.error ?? shifts.error ?? counts.error
  if (err) throw err

  const rows = monthRevenues.data ?? []
  const todayRows = rows.filter((r) => r.business_date === day)

  const tomorrowByStand = new Map<string, number>()
  for (const row of shifts.data ?? []) {
    tomorrowByStand.set(row.stand_id, (tomorrowByStand.get(row.stand_id) ?? 0) + 1)
  }

  const standList = (stands.data ?? []) as Stand[]
  const summaryRow = Array.isArray(summary.data) ? (summary.data[0] as { cash_balance: number } | undefined) : null

  return {
    stands: standList,
    todayCash: todayRows.reduce((s, r) => s + Number(r.cash_amount), 0),
    todayPos: todayRows.reduce((s, r) => s + Number(r.pos_amount), 0),
    monthCash: rows.reduce((s, r) => s + Number(r.cash_amount), 0),
    monthPos: rows.reduce((s, r) => s + Number(r.pos_amount), 0),
    cashBalance: Number(summaryRow?.cash_balance ?? 0),
    tomorrowByStand,
    countedStandIds: new Set((counts.data ?? []).map((c) => c.stand_id)),
    missingRevenueStandIds: standList
      .filter((s) => !todayRows.some((r) => r.stand_id === s.id))
      .map((s) => s.id),
  }
}

export default function Dashboard() {
  const { data, loading, error } = useQuery(load, [])

  return (
    <>
      <div>
        <h1 className="text-lg font-semibold text-stone-900">Özet</h1>
        <p className="text-sm text-stone-500">{formatLong(today())}</p>
      </div>

      {error && <ErrorBox message={error} />}
      {loading && !data && <Spinner />}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Bugün ciro" value={money(data.todayCash + data.todayPos)} sub={`Nakit ${money(data.todayCash)} · POS ${money(data.todayPos)}`} />
            <Stat label="Bu ay ciro" value={money(data.monthCash + data.monthPos)} sub={`Nakit ${money(data.monthCash)} · POS ${money(data.monthPos)}`} />
            <Stat
              label="Kasadaki nakit"
              value={money(data.cashBalance)}
              tone={data.cashBalance < 0 ? 'bad' : 'good'}
            />
            <Stat label="Aktif stand" value={data.stands.length} />
          </div>

          <Card
            title={`Yarınki vardiya — ${formatLong(tomorrow())}`}
            action={
              <Link to="/vardiya" className="text-xs font-medium text-brand-700 hover:underline">
                Düzenle →
              </Link>
            }
          >
            {data.stands.length === 0 ? (
              <Empty>Henüz stand tanımlanmamış.</Empty>
            ) : (
              <ul className="space-y-2">
                {data.stands.map((stand) => {
                  const count = data.tomorrowByStand.get(stand.id) ?? 0
                  return (
                    <li
                      key={stand.id}
                      className="flex items-center justify-between rounded-xl bg-stone-50 px-3 py-2 text-sm"
                    >
                      <span className="text-stone-800">{stand.name}</span>
                      <span className={count === 0 ? 'font-medium text-red-700' : 'text-stone-600'}>
                        {count === 0 ? 'atama yok' : `${count} kişi`}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card
              title="Bugün ciro girilmeyen standlar"
              action={
                <Link to="/kasa" className="text-xs font-medium text-brand-700 hover:underline">
                  Gir →
                </Link>
              }
            >
              {data.missingRevenueStandIds.length === 0 ? (
                <p className="text-sm text-emerald-700">Tüm standların cirosu girilmiş ✓</p>
              ) : (
                <ul className="space-y-1 text-sm text-stone-700">
                  {data.missingRevenueStandIds.map((id) => (
                    <li key={id}>• {data.stands.find((s) => s.id === id)?.name}</li>
                  ))}
                </ul>
              )}
            </Card>

            <Card
              title="Bugün sayım yapılmayan standlar"
              action={
                <Link to="/stok" className="text-xs font-medium text-brand-700 hover:underline">
                  Say →
                </Link>
              }
            >
              {data.stands.every((s) => data.countedStandIds.has(s.id)) && data.stands.length > 0 ? (
                <p className="text-sm text-emerald-700">Tüm standlar sayıldı ✓</p>
              ) : (
                <ul className="space-y-1 text-sm text-stone-700">
                  {data.stands
                    .filter((s) => !data.countedStandIds.has(s.id))
                    .map((s) => (
                      <li key={s.id}>• {s.name}</li>
                    ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  )
}
