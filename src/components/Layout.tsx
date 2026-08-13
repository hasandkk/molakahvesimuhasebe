import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'

const NAV = [
  { to: '/', label: 'Özet', icon: '🏠', end: true },
  { to: '/vardiya', label: 'Vardiya', icon: '📋' },
  { to: '/kasa', label: 'Kasa', icon: '💵' },
  { to: '/stok', label: 'Stok', icon: '📦' },
  { to: '/raporlar', label: 'Rapor', icon: '📊' },
  { to: '/tanimlar', label: 'Tanımlar', icon: '⚙️' },
]

export default function Layout() {
  const { displayName, signOut } = useAuth()

  return (
    <div className="min-h-dvh md:flex">
      {/* Masaüstü kenar menüsü */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-stone-200 bg-white md:flex">
        <div className="px-4 py-5">
          <div className="text-base font-semibold text-brand-800">☕ Mola Kahvesi</div>
          <div className="text-xs text-stone-500">Stand yönetimi</div>
        </div>
        <nav className="flex-1 space-y-1 px-2">
          {NAV.map((item) => (
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
              {item.label}
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
        {/* Mobil başlık */}
        <header className="flex items-center justify-between border-b border-stone-200 bg-white px-4 py-3 md:hidden">
          <span className="text-sm font-semibold text-brand-800">☕ Mola Kahvesi</span>
          <button onClick={() => void signOut()} className="text-xs text-stone-500">
            Çıkış
          </button>
        </header>

        <main className="flex-1 px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-6">
          <div className="mx-auto w-full max-w-5xl space-y-4">
            <Outlet />
          </div>
        </main>

        {/* Mobil alt menü */}
        <nav className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-6 border-t border-stone-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium ${
                  isActive ? 'text-brand-800' : 'text-stone-500'
                }`
              }
            >
              <span className="text-base" aria-hidden>
                {item.icon}
              </span>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  )
}
