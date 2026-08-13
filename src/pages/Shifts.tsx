import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useQuery } from '../lib/useQuery'
import { addDays, formatLong, tomorrow } from '../lib/date'
import type { Employee, ShiftAssignment, Stand } from '../lib/types'
import { Button, Card, DateNav, Empty, ErrorBox, Select, Spinner } from '../components/ui'

type Data = { stands: Stand[]; employees: Employee[]; assignments: ShiftAssignment[] }

async function load(date: string): Promise<Data> {
  const [stands, employees, assignments] = await Promise.all([
    supabase.from('stands').select('*').eq('is_active', true).order('sort_order').order('name'),
    supabase.from('employees').select('*').eq('is_active', true).order('full_name'),
    supabase.from('shift_assignments').select('*').eq('work_date', date),
  ])
  const err = stands.error ?? employees.error ?? assignments.error
  if (err) throw err
  return {
    stands: (stands.data ?? []) as Stand[],
    employees: (employees.data ?? []) as Employee[],
    assignments: (assignments.data ?? []) as ShiftAssignment[],
  }
}

export default function Shifts() {
  const [date, setDate] = useState(tomorrow())
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const { data, loading, error, reload } = useQuery(() => load(date), [date])

  const employeeById = useMemo(() => {
    const map = new Map<string, Employee>()
    for (const e of data?.employees ?? []) map.set(e.id, e)
    return map
  }, [data])

  const byStand = useMemo(() => {
    const map = new Map<string, ShiftAssignment[]>()
    for (const a of data?.assignments ?? []) {
      const list = map.get(a.stand_id) ?? []
      list.push(a)
      map.set(a.stand_id, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) =>
        (employeeById.get(a.employee_id)?.full_name ?? '').localeCompare(
          employeeById.get(b.employee_id)?.full_name ?? '',
          'tr',
        ),
      )
    }
    return map
  }, [data, employeeById])

  const assignedIds = useMemo(
    () => new Set((data?.assignments ?? []).map((a) => a.employee_id)),
    [data],
  )

  const shareText = useMemo(() => {
    if (!data) return ''
    const lines = [`📅 ${formatLong(date)} — Vardiya Planı`, '']
    for (const stand of data.stands) {
      const list = byStand.get(stand.id) ?? []
      lines.push(`☕ ${stand.name}`)
      if (list.length === 0) {
        lines.push('• (kimse atanmadı)')
      } else {
        for (const a of list) {
          const name = employeeById.get(a.employee_id)?.full_name ?? '—'
          lines.push(`• ${name}${a.role ? ` (${a.role})` : ''}`)
        }
      }
      lines.push('')
    }
    return lines.join('\n').trim()
  }, [data, date, byStand, employeeById])

  async function run(fn: () => Promise<{ error: unknown }>) {
    setBusy(true)
    setActionError(null)
    const { error } = await fn()
    if (error) setActionError(error instanceof Error ? error.message : String(error))
    else await reload()
    setBusy(false)
  }

  async function addAssignment(standId: string, employeeId: string) {
    if (!employeeId) return
    await run(async () =>
      supabase.from('shift_assignments').insert({
        work_date: date,
        stand_id: standId,
        employee_id: employeeId,
      }),
    )
  }

  async function removeAssignment(id: string) {
    await run(async () => supabase.from('shift_assignments').delete().eq('id', id))
  }

  async function copyPreviousDay() {
    setBusy(true)
    setActionError(null)
    const prev = addDays(date, -1)
    const { data: prevRows, error: readError } = await supabase
      .from('shift_assignments')
      .select('stand_id, employee_id, role')
      .eq('work_date', prev)

    if (readError) {
      setActionError(readError.message)
      setBusy(false)
      return
    }
    if (!prevRows || prevRows.length === 0) {
      setActionError(`${formatLong(prev)} için kayıtlı vardiya yok.`)
      setBusy(false)
      return
    }

    const { error: insertError } = await supabase
      .from('shift_assignments')
      .upsert(
        prevRows.map((r) => ({ ...r, work_date: date })),
        { onConflict: 'work_date,stand_id,employee_id', ignoreDuplicates: true },
      )

    if (insertError) setActionError(insertError.message)
    else await reload()
    setBusy(false)
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(shareText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setActionError('Panoya kopyalanamadı, metni elle seçip kopyalayabilirsin.')
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-stone-900">Vardiya Planı</h1>
          <p className="text-sm text-stone-500">{formatLong(date)}</p>
        </div>
        <div className="w-full sm:w-72">
          <DateNav value={date} onChange={setDate} />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => setDate(tomorrow())}>
          Yarın
        </Button>
        <Button variant="secondary" size="sm" onClick={() => void copyPreviousDay()} disabled={busy}>
          Bir önceki günü kopyala
        </Button>
      </div>

      {error && <ErrorBox message={error} />}
      {actionError && <ErrorBox message={actionError} />}
      {loading && !data && <Spinner />}

      {data && data.stands.length === 0 && (
        <Card>
          <Empty>Henüz stand tanımlanmamış. “Tanımlar” ekranından stand ekle.</Empty>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {data?.stands.map((stand) => {
          const list = byStand.get(stand.id) ?? []
          const available = data.employees.filter((e) => !assignedIds.has(e.id))
          return (
            <Card
              key={stand.id}
              title={stand.name}
              action={<span className="text-xs text-stone-500">{list.length} kişi</span>}
            >
              <ul className="space-y-2">
                {list.length === 0 && <Empty>Kimse atanmadı</Empty>}
                {list.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between rounded-xl bg-stone-50 px-3 py-2 text-sm"
                  >
                    <span>{employeeById.get(a.employee_id)?.full_name ?? '—'}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void removeAssignment(a.id)}
                      disabled={busy}
                      aria-label="Çıkar"
                    >
                      ✕
                    </Button>
                  </li>
                ))}
              </ul>

              <Select
                className="mt-3"
                value=""
                disabled={busy || available.length === 0}
                onChange={(e) => void addAssignment(stand.id, e.target.value)}
              >
                <option value="">
                  {available.length === 0 ? 'Boşta çalışan kalmadı' : '+ Çalışan ekle…'}
                </option>
                {available.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.full_name}
                  </option>
                ))}
              </Select>
            </Card>
          )
        })}
      </div>

      {data && data.stands.length > 0 && (
        <Card
          title="Gruba atılacak mesaj"
          action={
            <Button size="sm" onClick={() => void copyText()}>
              {copied ? '✓ Kopyalandı' : 'Metni kopyala'}
            </Button>
          }
        >
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl bg-stone-50 p-3 font-sans text-sm text-stone-800">
            {shareText}
          </pre>
        </Card>
      )}
    </>
  )
}
