import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'

export function Card({
  title,
  action,
  children,
  className = '',
}: {
  title?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`rounded-2xl border border-stone-200 bg-white shadow-sm ${className}`}>
      {(title || action) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-stone-700">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  )
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'icon'
}

export function Button({ variant = 'primary', size = 'md', className = '', ...props }: ButtonProps) {
  const base =
    'inline-flex select-none items-center justify-center gap-1.5 rounded-xl font-medium transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50'
  // Dokunma hedefleri en az ~36-44px; mobilde parmakla isabet ettirmek için.
  const sizes = {
    sm: 'min-h-9 px-3 py-2 text-xs',
    md: 'min-h-11 px-4 py-2.5 text-sm',
    icon: 'h-9 w-9 shrink-0 p-0 text-base leading-none',
  }
  const variants = {
    primary: 'bg-brand-700 text-white hover:bg-brand-800 active:bg-brand-900',
    secondary: 'bg-stone-100 text-stone-800 hover:bg-stone-200 border border-stone-300',
    ghost: 'text-stone-500 hover:bg-stone-200/70 hover:text-stone-800',
    danger: 'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100',
  }
  return <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...props} />
}

export function Field({
  label,
  hint,
  children,
  className = '',
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-stone-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-stone-500">{hint}</span>}
    </label>
  )
}

// text-base (16px) mobilde şart: iOS daha küçük yazı tipli bir alana
// odaklanıldığında sayfayı otomatik yakınlaştırıyor.
const controlClass =
  'w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-base text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:bg-stone-100 sm:text-sm'

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${controlClass} ${className}`} {...props} />
}

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${controlClass} ${className}`} {...props} />
}

/** Saat kutusu — aynı zoom kuralı burada da geçerli. */
export function TimeInput({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="time"
      className={`min-h-9 rounded-lg border border-stone-300 bg-white px-2 py-1 text-base tabular-nums text-stone-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 sm:text-xs ${className}`}
      {...props}
    />
  )
}

export function Stat({
  label,
  value,
  tone = 'default',
  sub,
}: {
  label: string
  value: ReactNode
  tone?: 'default' | 'good' | 'bad' | 'warn'
  sub?: ReactNode
}) {
  const tones = {
    default: 'text-stone-900',
    good: 'text-emerald-700',
    bad: 'text-red-700',
    warn: 'text-amber-700',
  }
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-3 shadow-sm sm:p-4">
      <div className="text-xs font-medium text-stone-500">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums sm:text-xl ${tones[tone]}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] leading-tight text-stone-500 sm:text-xs">{sub}</div>}
    </div>
  )
}

export function Spinner({ label = 'Yükleniyor…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-stone-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-stone-300 border-t-brand-600" />
      {label}
    </div>
  )
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{message}</div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-stone-500">{children}</p>
}

/**
 * Mobilde iki sütuna sarar, masaüstünde tek sıra olur — yatay kaydırma yok.
 */
export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: ReactNode }[]
  active: T
  onChange: (id: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-1 rounded-xl bg-stone-200/70 p-1">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`min-h-10 flex-1 basis-[calc(50%-0.25rem)] rounded-lg px-2 py-2 text-sm font-medium transition sm:basis-0 ${
            active === tab.id
              ? 'bg-white text-stone-900 shadow-sm'
              : 'text-stone-600 hover:text-stone-900'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

export function DateNav({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  const shift = (days: number) => {
    const [y, m, d] = value.split('-').map(Number)
    const next = new Date(y, m - 1, d + days)
    const iso = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(
      next.getDate(),
    ).padStart(2, '0')}`
    onChange(iso)
  }
  return (
    <div className="flex items-center gap-2">
      <Button variant="secondary" size="icon" onClick={() => shift(-1)} aria-label="Önceki gün">
        ‹
      </Button>
      <Input type="date" value={value} onChange={(e) => onChange(e.target.value)} className="flex-1" />
      <Button variant="secondary" size="icon" onClick={() => shift(1)} aria-label="Sonraki gün">
        ›
      </Button>
    </div>
  )
}

/**
 * Mobilde ekranın altına yapışan işlem çubuğu. Uzun formlarda kaydet
 * düğmesine ulaşmak için başa dönmek gerekmesin diye. Masaüstünde gizli.
 */
export function StickyBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 -mx-4 mt-4 border-t border-stone-200 bg-white/95 px-4 py-3 backdrop-blur md:hidden">
      {children}
    </div>
  )
}
