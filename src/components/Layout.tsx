import { Suspense, useEffect } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'

/**
 * Sayfa paketleri küçük (2-4 KB). Tarayıcı boşa düştüğünde hepsini indir ki
 * menüye dokunulduğunda geçiş beklemesiz olsun.
 */
function usePrefetchPages() {
  useEffect(() => {
    const prefetch = () => {
      void import('../pages/Shifts')
      void import('../pages/Stock')
      void import('../pages/Payroll')
      void import('../pages/Reports')
      void import('../pages/Settings')
    }
    const idle = window.requestIdleCallback
    if (idle) {
      const handle = idle(prefetch, { timeout: 3000 })
      return () => window.cancelIdleCallback?.(handle)
    }
    const timer = setTimeout(prefetch, 1500)
    return () => clearTimeout(timer)
  }, [])
}

/** Sayfa paketi inerken gösterilen iskelet — boş ekran yerine. */
function PageSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-6 w-40 animate-pulse rounded-lg bg-stone-200" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-2xl bg-stone-200" />
        ))}
      </div>
      <div className="h-48 animate-pulse rounded-2xl bg-stone-200" />
    </div>
  )
}

/**
 * Alt menüde günlük/haftalık işler var. Tanımlar (stand, çalışan, ürün
 * ekleme) ayda bir açılıyor; alt menüde yer kaplamasın diye mobilde
 * başlıktaki dişliye taşındı, masaüstü kenar menüsünde duruyor.
 */
const NAV = [
  { to: '/', label: 'Özet', icon: '🏠', end: true },
  { to: '/vardiya', label: 'Vardiya', icon: '📋' },
  { to: '/stok', label: 'Stok', icon: '📦' },
  { to: '/maas', label: 'Maaş', icon: '💰' },
  { to: '/raporlar', label: 'Rapor', icon: '📊' },
]

const SETTINGS_NAV = { to: '/tanimlar', label: 'Tanımlar', icon: '⚙️', end: false }

export default function Layout() {
  const { displayName, signOut } = useAuth()
  usePrefetchPages()

  return (
    <div className="min-h-dvh md:flex">
      {/* Masaüstü kenar menüsü */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-stone-200 bg-white md:flex">
        <div className="px-4 py-5">
          <div className="text-base font-semibold text-brand-800">☕ Mola Kahvesi</div>
          <div className="text-xs text-stone-500">Stand yönetimi</div>
        </div>
        <nav className="flex-1 space-y-1 px-2">
          {[...NAV, SETTINGS_NAV].map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition ${
                  isActive ? 'bg-brand-100 text-brand-900' : 'text-stone-600 hover:bg-stone-100'
                }`
              }
            >
              <span aria-hidden>{item.icon}</span>
              {item.label === 'Tanım' ? 'Tanımlar' : item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-stone-200 p-3">
          <div className="truncate px-1 pb-2 text-xs text-stone-500">{displayName}</div>
          <button
            onClick={() => void signOut()}
            className="w-full rounded-xl px-3 py-2 text-left text-sm text-stone-600 hover:bg-stone-100"
          >
            Çıkış yap
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobil başlık — kaydırırken üstte kalır */}
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-stone-200 bg-white/95 px-4 py-3 backdrop-blur md:hidden">
          <span className="text-sm font-semibold text-brand-800">☕ Mola Kahvesi</span>
          <span className="-mr-2 flex items-center gap-1">
            <NavLink
              to={SETTINGS_NAV.to}
              aria-label="Tanımlar"
              className={({ isActive }) =>
                `grid h-9 w-9 place-items-center rounded-lg text-base active:bg-stone-100 ${
                  isActive ? 'bg-brand-100' : ''
                }`
              }
            >
              <span aria-hidden>{SETTINGS_NAV.icon}</span>
            </NavLink>
            <button
              onClick={() => void signOut()}
              className="rounded-lg px-2 py-1 text-xs text-stone-500 active:bg-stone-100"
            >
              Çıkış
            </button>
          </span>
        </header>

        <main className="flex-1 px-4 py-4 pb-[calc(5rem+env(safe-area-inset-bottom))] md:px-6 md:py-6 md:pb-6">
          <div className="mx-auto w-full max-w-5xl space-y-4">
            <Suspense fallback={<PageSkeleton />}>
              <Outlet />
            </Suspense>
          </div>
        </main>

        {/* Mobil alt menü */}
        <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-stone-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex min-w-0 flex-col items-center gap-0.5 px-0.5 py-2 text-[10px] font-medium leading-none transition ${
                  isActive ? 'text-brand-800' : 'text-stone-500'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={`grid h-7 w-10 place-items-center rounded-lg text-base transition ${
                      isActive ? 'bg-brand-100' : ''
                    }`}
                    aria-hidden
                  >
                    {item.icon}
                  </span>
                  <span className="w-full truncate text-center">{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  )
}
