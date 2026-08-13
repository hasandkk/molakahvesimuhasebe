import { lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { useAuth } from './lib/auth'
import { supabaseConfigured } from './lib/supabase'
import Login from './pages/Login'

// Sayfalar ayrı paketlere bölünüyor: ilk açılışta sadece Özet ekranının
// kodu iniyor, diğerleri o sekmeye geçildiğinde yükleniyor.
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Shifts = lazy(() => import('./pages/Shifts'))
const Cash = lazy(() => import('./pages/Cash'))
const Stock = lazy(() => import('./pages/Stock'))
const Reports = lazy(() => import('./pages/Reports'))
const Settings = lazy(() => import('./pages/Settings'))

export default function App() {
  const { session, loading } = useAuth()

  if (!supabaseConfigured) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          <p className="font-semibold">Supabase bağlantısı yapılandırılmamış.</p>
          <p className="mt-2">
            Proje kökündeki <code className="rounded bg-amber-100 px-1">.env.example</code> dosyasını{' '}
            <code className="rounded bg-amber-100 px-1">.env</code> olarak kopyalayıp Supabase URL ve anon
            key değerlerini gir, sonra sunucuyu yeniden başlat.
          </p>
        </div>
      </div>
    )
  }

  if (loading) {
    return <div className="grid min-h-dvh place-items-center text-sm text-stone-500">Yükleniyor…</div>
  }

  if (!session) return <Login />

  return (
    <Routes>
      {/* Suspense sınırı Layout içinde; sayfa paketi inerken menü ekranda kalır. */}
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="vardiya" element={<Shifts />} />
        <Route path="kasa" element={<Cash />} />
        <Route path="stok" element={<Stock />} />
        <Route path="raporlar" element={<Reports />} />
        <Route path="tanimlar" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
