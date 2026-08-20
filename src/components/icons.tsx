/**
 * Menü ikonları.
 *
 * Emoji kullanılıyordu; her cihazda farklı görünüyor (Android, iOS ve
 * Windows'un kendi emoji setleri var) ve marka renkleriyle hiç ilgisi
 * olmayan renkler taşıyorlar. Bunlar tek renk, currentColor ile çizilir —
 * seçili sekmede bordo, diğerlerinde gri olurlar.
 */
type IconProps = { className?: string }

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: 'false' as const,
}

export function IconHome({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M3.5 11.5 12 4l8.5 7.5" />
      <path d="M6 10.2V20h12v-9.8" />
      <path d="M10 20v-5h4v5" />
    </svg>
  )
}

export function IconShifts({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="3.5" y="5.5" width="17" height="15" rx="2.5" />
      <path d="M3.5 10h17" />
      <path d="M8 3.5v4M16 3.5v4" />
      <path d="M7.5 13.5h4M7.5 17h9" />
    </svg>
  )
}

export function IconStock({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 3.5 20.5 8v8L12 20.5 3.5 16V8z" />
      <path d="M3.5 8 12 12.5 20.5 8" />
      <path d="M12 12.5v8" />
    </svg>
  )
}

export function IconPayroll({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
      <circle cx="12" cy="12" r="2.8" />
      <path d="M6 10v4M18 10v4" />
    </svg>
  )
}

export function IconReports({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 4v16h16" />
      <path d="M8.5 17v-4M13 17v-7.5M17.5 17v-5.5" />
    </svg>
  )
}

export function IconSettings({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 7h8.5M17 7h3" />
      <circle cx="14.7" cy="7" r="2.2" />
      <path d="M4 17h8.5M17 17h3" />
      <circle cx="14.7" cy="17" r="2.2" />
      <path d="M4 12h3.5M12 12h8" />
      <circle cx="9.7" cy="12" r="2.2" />
    </svg>
  )
}
