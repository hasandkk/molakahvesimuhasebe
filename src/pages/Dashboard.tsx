import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useQuery } from '../lib/useQuery'
import { fetchActiveStands } from '../lib/refData'
import { formatLong, today, tomorrow, weekDays } from '../lib/date'
import type { Stand } from '../lib/types'
import { Card, Empty, ErrorBox, Spinner, Stat } from '../components/ui'

type Data = {
  stands: Stand[]
  tomorrowByStand: Map<string, number>
  trainingByStand: Map<string, number>
  weekShifts: number
  soldTodayStandIds: Set<string>
}

async function load(): Promise<Data> {
  const day = today()
  const next = tomorrow()
  const week = weekDays(day)

  const [stands, shifts, weekRows, sales] = await Promise.all([
    fetchActiveStands(),
    supabase.from('shift_assignments').select('stand_id, kind').eq('work_date', next),
    supabase
      .from('shift_assignments')
      .select('kind')
      .gte('work_date', week[0])
      .lte('work_date', week[6]),
    supabase.from('stock_sales').select('stand_id').eq('sale_date', day),
  ])

  const err = shifts.error ?? weekRows.error ?? sales.error
  if (err) throw err

  // Eğitime gelenler vardiya sayılmaz — bir standda sadece eğitim varsa
  // o stand hâlâ "atama yok" durumundadır.
  const tomorrowByStand = new Map<string, number>()
  const trainingByStand = new Map<string, number>()
  for (const row of shifts.data ?? []) {
    const target = row.kind === 'egitim' ? trainingByStand : tomorrowByStand
    target.set(row.stand_id, (target.get(row.stand_id) ?? 0) + 1)
  }

  return {
    stands,
    tomorrowByStand,
    trainingByStand,
    weekShifts: (weekRows.data ?? []).filter((r) => r.kind !== 'egitim').length,
    soldTodayStandIds: new Set((sales.data ?? []).map((s) => s.stand_id)),
  }
}

export default function Dashboard() {
  const { data, loading, error } = useQuery(load, [])

  const assigned = data ? data.stands.filter((s) => (data.tomorrowByStand.get(s.id) ?? 0) > 0) : []
  const missingSales = data ? data.stands.filter((s) => !data.soldTodayStandIds.has(s.id)) : []

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
          <div className="grid grid-cols-3 gap-3">
            <Stat
              label="Yarın atanan"
              value={`${assigned.length}/${data.stands.length}`}
              sub="stand"
              tone={assigned.length < data.stands.length ? 'warn' : 'good'}
            />
            <Stat label="Bu hafta vardiya" value={data.weekShifts} />
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
                  const training = data.trainingByStand.get(stand.id) ?? 0
                  return (
                    <li
                      key={stand.id}
                      className="flex items-center justify-between rounded-xl bg-stone-50 px-3 py-2 text-sm"
                    >
                      <span className="text-stone-800">{stand.name}</span>
                      <span className={count === 0 ? 'font-medium text-red-700' : 'text-stone-600'}>
                        {count === 0 ? 'atama yok' : `${count} kişi`}
                        {training > 0 && (
                          <span className="ml-1 text-amber-700">+{training} eğitim</span>
                        )}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>

          <Card
            title="Bugün satış girilmeyen standlar"
            action={
              <Link to="/stok" className="text-xs font-medium text-brand-700 hover:underline">
                Gir →
              </Link>
            }
          >
            {data.stands.length > 0 && missingSales.length === 0 ? (
              <p className="text-sm text-emerald-700">Tüm standların satışı girilmiş ✓</p>
            ) : (
              <ul className="space-y-1 text-sm text-stone-700">
                {missingSales.map((s) => (
                  <li key={s.id}>• {s.name}</li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </>
  )
}
