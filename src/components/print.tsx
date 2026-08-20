import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'

/**
 * Yazdırma / PDF çıktısı ekrandaki mobil kartlardan üretilmez: her rapor
 * sekmesi kendi tablo düzenini buraya basar. İçerik body'nin sonundaki
 * #print-root'a portal ile taşınır; @media print kuralı #root'u gizleyip
 * onu gösterir (bkz. src/index.css).
 *
 * Böylece ekran düzenine hiç dokunmadan A4'e oturan düz bir belge çıkar:
 * menü, filtre ve düğmeler çıktıya karışmaz.
 *
 * Sadece açık olan sekme mount edildiği için yazdırılan da her zaman
 * ekranda bakılan rapordur.
 */
export function PrintDoc({
  title,
  period,
  children,
}: {
  title: string
  period: string
  children: ReactNode
}) {
  const host = typeof document === 'undefined' ? null : document.getElementById('print-root')
  if (!host) return null

  return createPortal(
    <article className="print-doc">
      <header className="print-head">
        <div>
          <h1>Mola Kahvesi</h1>
          <p className="print-sub">{title}</p>
        </div>
        <div className="print-meta">
          <p>{period}</p>
          <p>Yazdırma: {new Date().toLocaleDateString('tr-TR')}</p>
        </div>
      </header>
      {children}
    </article>,
    host,
  )
}

export function PrintSection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  )
}

export function PrintEmpty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>
}

/** Rapor başındaki tek satırlık künye: "Toplam ciro … Nakit … POS …" */
export function PrintFacts({ items }: { items: { label: string; value: string }[] }) {
  return (
    <table className="print-facts">
      <tbody>
        <tr>
          {items.map((it) => (
            <td key={it.label}>
              <span className="fact-label">{it.label}</span>
              <span className="fact-value">{it.value}</span>
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  )
}
