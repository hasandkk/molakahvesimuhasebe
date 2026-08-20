/**
 * Mola Kahvesi marka işareti — ürün ambalajındaki kilit: bordo zemin,
 * altın kare çerçeve, çerçevenin içinde geometrik "MOLA" yazısı.
 *
 * Harfler dolu değil çizgi olarak kuruldu; ambalajdaki ince geometrik
 * karakterin sadeleştirilmiş hali. Ambalajdaki dikey tarama dokusu bilerek
 * alınmadı: 32-48 pikselde (uygulama simgesi, sekme simgesi) o doku harfleri
 * parçalayıp okunmaz hale getiriyor.
 *
 * Tek çizim hem uygulama içinde hem public/ altındaki ikonlarda kullanılır;
 * PNG'ler bu çizimden üretildi (bkz. public/logo.svg).
 */

export const BRAND_BORDO = '#6b1f32'
export const BRAND_GOLD = '#c9a259'

/** Altın çerçeve + MOLA. Zemin dışarıdan verilir. */
export function LogoMark({
  className = '',
  color = BRAND_GOLD,
  withFrame = true,
}: {
  className?: string
  color?: string
  withFrame?: boolean
}) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden focusable="false">
      {withFrame && (
        <rect x="13" y="13" width="74" height="74" fill="none" stroke={color} strokeWidth="3" />
      )}
      <g fill="none" stroke={color} strokeWidth="3.4" strokeLinejoin="miter">
        <path d="M23 66V36l5.5 14L34 36v30" />
        <rect x="38" y="36" width="11" height="30" rx="4" />
        <path d="M53 36v30h9" />
        <path d="M66 66l5.5-30L77 66" />
        <path d="M67.6 57h7.8" />
      </g>
    </svg>
  )
}

/**
 * Marka rozeti: bordo kare içinde altın işaret. Emoji yerine bunu kullanmak
 * her cihazda aynı görünmesini sağlıyor.
 */
export function LogoBadge({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <span
      className={`inline-grid shrink-0 place-items-center rounded-[26%] ${className}`}
      style={{ background: BRAND_BORDO }}
    >
      <LogoMark className="h-[88%] w-[88%]" />
    </span>
  )
}

/** Rozet + isim — kenar menüsü, mobil başlık ve giriş ekranı için. */
export function Logo({
  className = '',
  size = 'md',
}: {
  className?: string
  size?: 'sm' | 'md'
}) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <LogoBadge className={size === 'sm' ? 'h-7 w-7' : 'h-8 w-8'} />
      <span
        className={`font-semibold tracking-tight text-brand-800 ${
          size === 'sm' ? 'text-sm' : 'text-base'
        }`}
      >
        Mola Kahvesi
      </span>
    </span>
  )
}
