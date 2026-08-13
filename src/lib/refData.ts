import { supabase } from './supabase'
import type { Employee, Stand } from './types'

/**
 * Stand, çalışan gibi nadiren değişen veriler her sayfa geçişinde yeniden
 * çekiliyordu. Burada kısa ömürlü bir bellek önbelleği tutuluyor:
 *   • aynı anda gelen istekler tek çağrıya bindirilir,
 *   • TTL boyunca sayfa geçişleri ağ beklemez.
 * Tanımlar ekranı bir değişiklik yaptığında invalidateRefData() çağırır.
 */
type Entry = { at: number; promise: Promise<unknown> }

const entries = new Map<string, Entry>()
const TTL_MS = 60_000

function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = entries.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise as Promise<T>

  const promise = fn().catch((err: unknown) => {
    // Başarısız isteği önbellekte tutma, bir sonraki denemede tekrar sorulsun.
    entries.delete(key)
    throw err
  })
  entries.set(key, { at: Date.now(), promise })
  return promise
}

export function invalidateRefData() {
  entries.clear()
}

export function fetchActiveStands(): Promise<Stand[]> {
  return cached('stands:active', async () => {
    const { data, error } = await supabase
      .from('stands')
      .select('*')
      .eq('is_active', true)
      .order('sort_order')
      .order('name')
    if (error) throw error
    return (data ?? []) as Stand[]
  })
}

export function fetchAllStands(): Promise<Stand[]> {
  return cached('stands:all', async () => {
    const { data, error } = await supabase.from('stands').select('*').order('sort_order').order('name')
    if (error) throw error
    return (data ?? []) as Stand[]
  })
}

/** Geçmiş raporlarda pasifleştirilmiş çalışanlar da görünmeli. */
export function fetchAllEmployees(): Promise<Employee[]> {
  return cached('employees:all', async () => {
    const { data, error } = await supabase.from('employees').select('*').order('full_name')
    if (error) throw error
    return (data ?? []) as Employee[]
  })
}

export function fetchActiveEmployees(): Promise<Employee[]> {
  return cached('employees:active', async () => {
    const { data, error } = await supabase
      .from('employees')
      .select('*')
      .eq('is_active', true)
      .order('full_name')
    if (error) throw error
    return (data ?? []) as Employee[]
  })
}
