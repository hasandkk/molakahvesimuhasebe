import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useQuery } from '../lib/useQuery'
import { fetchActiveEmployees, fetchActiveStands } from '../lib/refData'
import { formatLong, today, tomorrow, weekDays } from '../lib/date'
import { buildShiftMessage, groupByStand, groupLabel } from '../lib/shiftMessage'
import type { Employee, ShiftAssignment, Stand } from '../lib/types'
import { Button, Card, Empty, ErrorBox, Spinner, Stat } from '../components/ui'

type Data = {
  stands: Stand[]
  employees: Employee[]
  tomorrowShifts: ShiftAssignment[]
  weekShifts: number
  soldTodayStandIds: Set<string>
}

async function load(): Promise<Data> {
  const day = today()
  const next = tomorrow()
  const week = weekDays(day)

  const [stands, employees, shifts, weekRows, sales] = await Promise.all([
    fetchActiveStands(),
    fetchActiveEmployees(),
    supabase.from('shift_assignments').select('*').eq('work_date', next),
    supabase
      .from('shift_assignments')
      .select('kind')
      .gte('work_date', week[0])
      .lte('work_date', week[6]),
    supabase.from('stock_sales').select('stand_id').eq('sale_date', day),
  ])

  const err = shifts.error ?? weekRows.error ?? sales.error
  if (err) throw err

  return {
    stands,
    employees,
    tomorrowShifts: (shifts.data ?? []) as ShiftAssignment[],
    weekShifts: (weekRows.data ?? []).filter((r) => r.kind !== 'egitim').length,
    soldTodayStandIds: new Set((sales.data ?? []).map((s) => s.stand_id)),
  }
}

export default function Dashboard() {
  const { data, loading, error } = useQuery(load, [])
  const [copied, setCopied] = useState(false)

  const nameOf = useMemo(() => {
    const map = new Map((data?.employees ?? []).map((e) => [e.id, e.full_name]))
    return (a: ShiftAssignment) => map.get(a.employee_id) ?? '—'
  }, [data])

  const groups = useMemo(
    () => groupByStand(data?.tomorrowShifts ?? [], nameOf),
    [data, nameOf],
  )

  /** Eğitim vardiya sayılmaz: sadece eğitim varsa stand hâlâ "atama yok". */
  const emptyStands = (data?.stands ?? []).filter(
    (s) => !(groups.get(s.id) ?? []).some((g) => g.kind !== 'egitim'),
  )
  const missingSales = (data?.stands ?? []).filter((s) => !data?.soldTodayStandIds.has(s.id))

  const message = data ? buildShiftMessage(tomorrow(), data.stands, groups, nameOf) : ''

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(message)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* pano yoksa sessiz geç */
    }
  }

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
          {emptyStands.length > 0 && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
              Yarın <strong>{emptyStands.map((s) => s.name).join(', ')}</strong> için kimse
              atanmamış.{' '}
              <Link to="/vardiya" className="font-semibold underline">
                Planı yap →
              </Link>
            </div>
          )}

          {/* Asıl günlük iş: yarının planını görüp gruba atmak. */}
          <Card
            title={`Yarın — ${formatLong(tomorrow())}`}
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
                  const list = groups.get(stand.id) ?? []
                  return (
                    <li key={stand.id} className="rounded-xl bg-stone-50 px-3 py-2">
                      <div className="text-sm font-medium text-stone-800">{stand.name}</div>
                      {list.length === 0 ? (
                        <div className="text-sm font-medium text-red-700">atama yok</div>
                      ) : (
                        <ul className="mt-0.5 space-y-0.5">
                          {list.map((g) => (
                            <li
                              key={g.id}
                              className={`text-xs ${
                                g.kind === 'egitim' ? 'text-amber-700' : 'text-stone-600'
                              }`}
                            >
                              <span className="tabular-nums">{groupLabel(g)}</span>
                              {' · '}
                              {g.items.map(nameOf).join(', ')}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}

            {data.stands.length > 0 && (
              <Button className="mt-3 w-full" onClick={() => void copyMessage()}>
                {copied ? '✓ Mesaj kopyalandı' : 'Gruba atılacak mesajı kopyala'}
              </Button>
            )}
          </Card>

          <div className="grid grid-cols-2 gap-3">
            <Stat
              label="Yarın atanan"
              value={`${data.stands.length - emptyStands.length}/${data.stands.length}`}
              sub="stand"
              tone={emptyStands.length > 0 ? 'warn' : 'good'}
            />
            <Stat label="Bu hafta vardiya" value={data.weekShifts} />
          </div>

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
