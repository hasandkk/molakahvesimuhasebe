/**
 * Hata nesnesinden okunabilir mesaj çıkarır.
 *
 * Supabase'in PostgrestError'ı bir `Error` örneği DEĞİL, düz bir nesnedir
 * ({ message, details, hint, code }). `String(err)` bu yüzden
 * "[object Object]" veriyordu ve gerçek sebep tamamen kayboluyordu.
 *
 * Sık karşılaşılan birkaç hata Türkçeye çevriliyor; gerisi olduğu gibi
 * gösteriliyor ve varsa kod sona ekleniyor ki arayan biri neyi arayacağını
 * bilsin.
 */
export function errorMessage(err: unknown): string {
  if (err == null) return 'Bilinmeyen hata.'
  if (typeof err === 'string') return err

  const e = err as {
    message?: unknown
    details?: unknown
    hint?: unknown
    code?: unknown
    error_description?: unknown
  }

  const raw =
    (typeof e.message === 'string' && e.message) ||
    (typeof e.error_description === 'string' && e.error_description) ||
    ''

  if (!raw) {
    try {
      return JSON.stringify(err)
    } catch {
      return 'Bilinmeyen hata.'
    }
  }

  const friendly = translate(raw, typeof e.code === 'string' ? e.code : '')
  if (friendly) return friendly

  const parts = [raw]
  if (typeof e.details === 'string' && e.details && e.details !== raw) parts.push(e.details)
  if (typeof e.hint === 'string' && e.hint) parts.push(e.hint)
  const code = typeof e.code === 'string' && e.code ? ` (${e.code})` : ''
  return parts.join(' — ') + code
}

function translate(message: string, code: string): string | null {
  const m = message.toLowerCase()

  // Oturum düştü / token yenilenemedi. En sık "bazen çıkan" hata bu.
  if (
    code === 'PGRST301' ||
    m.includes('jwt expired') ||
    m.includes('invalid claim') ||
    m.includes('refresh token')
  ) {
    return 'Oturumun zaman aşımına uğradı. Sayfayı yenile; sorun sürerse çıkıp tekrar gir.'
  }

  // Tarayıcı sunucuya hiç ulaşamadı: kopuk internet, uçak modu, uyku sonrası.
  if (m.includes('failed to fetch') || m.includes('networkerror') || m.includes('load failed')) {
    return 'İnternete ulaşılamadı. Bağlantını kontrol edip tekrar dene.'
  }

  if (m.includes('fetch') && m.includes('abort')) {
    return 'İstek zaman aşımına uğradı. Tekrar dene.'
  }

  // Betik çalıştırılmamış ya da eksik çalıştırılmış.
  if (code === 'PGRST202' || m.includes('could not find the function')) {
    return 'Veritabanı fonksiyonu bulunamadı. Supabase SQL Editor’de 0001_init.sql betiğini tekrar çalıştır.'
  }
  if (code === '42P01' || m.includes('does not exist') || m.includes('schema cache')) {
    return 'Veritabanı tablosu/kolonu bulunamadı. Supabase SQL Editor’de 0001_init.sql betiğini tekrar çalıştır.'
  }

  if (code === '23505') return 'Bu kayıt zaten var.'
  if (code === '42501' || m.includes('row-level security')) {
    return 'Bu işlem için yetkin yok. Çıkıp tekrar girmeyi dene.'
  }

  return null
}
