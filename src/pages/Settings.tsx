import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useQuery } from '../lib/useQuery'
import { invalidateRefData } from '../lib/refData'
import { money, parseNumber } from '../lib/format'
import { WAGE_MODE_LABELS, type Employee, type Product, type ProductVariant, type Stand, type WageMode } from '../lib/types'
import { Button, Card, Empty, ErrorBox, Field, Input, Select, Spinner, Tabs } from '../components/ui'

type Tab = 'standlar' | 'calisanlar' | 'urunler'

const DEFAULT_VARIANTS = [
  { size_label: '100g', unit: 'adet' as const, grams: 100, sort_order: 1 },
  { size_label: '250g', unit: 'adet' as const, grams: 250, sort_order: 2 },
  { size_label: '500g', unit: 'adet' as const, grams: 500, sort_order: 3 },
  { size_label: '1kg', unit: 'adet' as const, grams: 1000, sort_order: 4 },
  { size_label: 'Dökme', unit: 'kg' as const, grams: null, sort_order: 5 },
]

export default function Settings() {
  const [tab, setTab] = useState<Tab>('standlar')

  return (
    <>
      <h1 className="text-lg font-semibold text-stone-900">Tanımlar</h1>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'standlar', label: 'Standlar' },
          { id: 'calisanlar', label: 'Çalışanlar' },
          { id: 'urunler', label: 'Ürünler' },
        ]}
      />

      {tab === 'standlar' && <StandsPanel />}
      {tab === 'calisanlar' && <EmployeesPanel />}
      {tab === 'urunler' && <ProductsPanel />}
    </>
  )
}

function StandsPanel() {
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const { data, loading, error, reload } = useQuery(async () => {
    const { data, error } = await supabase.from('stands').select('*').order('sort_order').order('name')
    if (error) throw error
    return (data ?? []) as Stand[]
  }, [])

  async function add() {
    if (!name.trim()) return
    setBusy(true)
    setActionError(null)
    const { error } = await supabase
      .from('stands')
      .insert({ name: name.trim(), location: location.trim() || null, sort_order: (data?.length ?? 0) + 1 })
    if (error) setActionError(error.message)
    else {
      setName('')
      setLocation('')
      invalidateRefData()
      reload()
    }
    setBusy(false)
  }

  async function toggle(stand: Stand) {
    setBusy(true)
    const { error } = await supabase.from('stands').update({ is_active: !stand.is_active }).eq('id', stand.id)
    if (error) setActionError(error.message)
    else {
      invalidateRefData()
      reload()
    }
    setBusy(false)
  }

  return (
    <>
      <Card title="Yeni stand">
        {actionError && <div className="mb-3"><ErrorBox message={actionError} /></div>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Stand adı">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Örn: Kızılay Standı" />
          </Field>
          <Field label="Konum (isteğe bağlı)">
            <Input value={location} onChange={(e) => setLocation(e.target.value)} />
          </Field>
        </div>
        <Button className="mt-3" onClick={() => void add()} disabled={busy}>
          Stand ekle
        </Button>
      </Card>

      <Card title="Standlar">
        {error && <ErrorBox message={error} />}
        {loading && !data && <Spinner />}
        {data && data.length === 0 && <Empty>Henüz stand yok.</Empty>}
        <ul className="divide-y divide-stone-100">
          {data?.map((stand) => (
            <li key={stand.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <div>
                <div className={stand.is_active ? 'text-stone-800' : 'text-stone-400 line-through'}>
                  {stand.name}
                </div>
                {stand.location && <div className="text-xs text-stone-500">{stand.location}</div>}
              </div>
              <Button variant="secondary" size="sm" onClick={() => void toggle(stand)} disabled={busy}>
                {stand.is_active ? 'Pasifleştir' : 'Aktifleştir'}
              </Button>
            </li>
          ))}
        </ul>
      </Card>
    </>
  )
}

function EmployeesPanel() {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [wage, setWage] = useState('')
  const [mode, setMode] = useState<WageMode>('kademeli')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const { data, loading, error, reload } = useQuery(async () => {
    const { data, error } = await supabase.from('employees').select('*').order('full_name')
    if (error) throw error
    return (data ?? []) as Employee[]
  }, [])

  async function add() {
    if (!name.trim()) return
    setBusy(true)
    setActionError(null)
    const { error } = await supabase.from('employees').insert({
      full_name: name.trim(),
      phone: phone.trim() || null,
      daily_wage: wage.trim() ? parseNumber(wage) : null,
      wage_mode: mode,
    })
    if (error) setActionError(error.message)
    else {
      setName('')
      setPhone('')
      setWage('')
      setMode('kademeli')
      invalidateRefData()
      reload()
    }
    setBusy(false)
  }

  async function changeMode(employee: Employee, next: WageMode) {
    setBusy(true)
    setActionError(null)
    const { error } = await supabase.from('employees').update({ wage_mode: next }).eq('id', employee.id)
    if (error) setActionError(error.message)
    else {
      invalidateRefData()
      reload()
    }
    setBusy(false)
  }

  async function toggle(employee: Employee) {
    setBusy(true)
    const { error } = await supabase
      .from('employees')
      .update({ is_active: !employee.is_active })
      .eq('id', employee.id)
    if (error) setActionError(error.message)
    else {
      invalidateRefData()
      reload()
    }
    setBusy(false)
  }

  return (
    <>
      <Card title="Yeni çalışan">
        {actionError && <div className="mb-3"><ErrorBox message={actionError} /></div>}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Ad soyad">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Telefon">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
          </Field>
          <Field label="Yevmiye (₺)" hint="Boş bırakırsan genel tam ücret geçerli">
            <Input value={wage} onChange={(e) => setWage(e.target.value)} inputMode="decimal" />
          </Field>
        </div>
        <Field label="Ücret modeli" className="mt-3">
          <Select value={mode} onChange={(e) => setMode(e.target.value as WageMode)}>
            {(Object.keys(WAGE_MODE_LABELS) as WageMode[]).map((k) => (
              <option key={k} value={k}>
                {WAGE_MODE_LABELS[k]}
              </option>
            ))}
          </Select>
        </Field>
        <p className="mt-1 text-xs text-stone-500">
          Deneyimli birini alıyorsan “ilk günden tam ücret” seç; eğitim günü ve düşük kademe
          uygulanmaz.
        </p>
        <Button className="mt-3" onClick={() => void add()} disabled={busy}>
          Çalışan ekle
        </Button>
      </Card>

      <Card title="Çalışanlar">
        {error && <ErrorBox message={error} />}
        {loading && !data && <Spinner />}
        {data && data.length === 0 && <Empty>Henüz çalışan yok.</Empty>}
        <ul className="divide-y divide-stone-100">
          {data?.map((employee) => (
            <li key={employee.id} className="py-2.5 text-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div
                    className={`truncate ${employee.is_active ? 'text-stone-800' : 'text-stone-400 line-through'}`}
                  >
                    {employee.full_name}
                  </div>
                  <div className="text-xs text-stone-500">
                    {employee.phone ?? '—'}
                    {employee.daily_wage ? ` · ${money(employee.daily_wage)}/gün` : ''}
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  className="shrink-0"
                  onClick={() => void toggle(employee)}
                  disabled={busy}
                >
                  {employee.is_active ? 'Pasifleştir' : 'Aktifleştir'}
                </Button>
              </div>
              <Select
                className="mt-2 py-1.5 text-xs"
                value={employee.wage_mode}
                disabled={busy}
                onChange={(e) => void changeMode(employee, e.target.value as WageMode)}
              >
                {(Object.keys(WAGE_MODE_LABELS) as WageMode[]).map((k) => (
                  <option key={k} value={k}>
                    {WAGE_MODE_LABELS[k]}
                  </option>
                ))}
              </Select>
            </li>
          ))}
        </ul>
      </Card>
    </>
  )
}

type ProductWithVariants = Product & { product_variants: ProductVariant[] }

function ProductsPanel() {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [prices, setPrices] = useState<Record<string, string>>({})
  const [savedId, setSavedId] = useState<string | null>(null)

  const { data, loading, error, reload } = useQuery(async () => {
    const { data, error } = await supabase
      .from('products')
      .select('*, product_variants(*)')
      .order('sort_order')
      .order('name')
    if (error) throw error
    const list = (data ?? []) as ProductWithVariants[]
    for (const product of list) {
      product.product_variants.sort((a, b) => a.sort_order - b.sort_order)
    }
    return list
  }, [])

  async function addProduct() {
    if (!name.trim()) return
    setBusy(true)
    setActionError(null)

    const { data: product, error: productError } = await supabase
      .from('products')
      .insert({ name: name.trim(), sort_order: (data?.length ?? 0) + 1 })
      .select('id')
      .single()

    if (productError || !product) {
      setActionError(productError?.message ?? 'Ürün eklenemedi.')
      setBusy(false)
      return
    }

    const { error: variantError } = await supabase
      .from('product_variants')
      .insert(DEFAULT_VARIANTS.map((v) => ({ ...v, product_id: product.id as string })))

    if (variantError) setActionError(variantError.message)
    else {
      setName('')
      invalidateRefData()
      reload()
    }
    setBusy(false)
  }

  async function savePrice(variant: ProductVariant) {
    const raw = prices[variant.id]
    if (raw === undefined) return
    setBusy(true)
    setActionError(null)
    const { error } = await supabase
      .from('product_variants')
      .update({ price: raw.trim() === '' ? null : parseNumber(raw) })
      .eq('id', variant.id)
    if (error) setActionError(error.message)
    else {
      setSavedId(variant.id)
      setTimeout(() => setSavedId(null), 1500)
      invalidateRefData()
      reload()
    }
    setBusy(false)
  }

  async function toggleProduct(product: Product) {
    setBusy(true)
    const { error } = await supabase
      .from('products')
      .update({ is_active: !product.is_active })
      .eq('id', product.id)
    if (error) setActionError(error.message)
    else {
      invalidateRefData()
      reload()
    }
    setBusy(false)
  }

  return (
    <>
      <Card title="Yeni kahve çeşidi">
        {actionError && <div className="mb-3"><ErrorBox message={actionError} /></div>}
        <Field label="Ürün adı" hint="100g / 250g / 500g / 1kg / Dökme gramajları otomatik oluşturulur.">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Örn: Dibek Kahvesi" />
        </Field>
        <Button className="mt-3" onClick={() => void addProduct()} disabled={busy}>
          Ürün ekle
        </Button>
      </Card>

      {error && <ErrorBox message={error} />}
      {loading && !data && <Spinner />}
      {data && data.length === 0 && (
        <Card>
          <Empty>Henüz ürün yok.</Empty>
        </Card>
      )}

      {data?.map((product) => (
        <Card
          key={product.id}
          title={product.is_active ? product.name : `${product.name} (pasif)`}
          action={
            <Button variant="secondary" size="sm" onClick={() => void toggleProduct(product)} disabled={busy}>
              {product.is_active ? 'Pasifleştir' : 'Aktifleştir'}
            </Button>
          }
        >
          <p className="mb-3 text-xs text-stone-500">
            Fiyat bilgi amaçlıdır; kampanya ve çoklu satış olduğu için hiçbir ciro hesabında
            kullanılmaz. Ciro “Kasa” ekranından elle girilir.
          </p>
          <ul className="space-y-2">
            {product.product_variants.map((variant) => (
              <li key={variant.id} className="flex items-center gap-2 text-sm">
                <span className="w-24 shrink-0 text-stone-700">
                  {variant.size_label}
                  <span className="ml-1 text-xs text-stone-400">{variant.unit}</span>
                </span>
                <Input
                  inputMode="decimal"
                  className="min-w-0 flex-1 px-2 py-2 text-right"
                  placeholder={variant.price === null ? 'fiyat yok' : ''}
                  value={prices[variant.id] ?? (variant.price === null ? '' : String(variant.price))}
                  onChange={(e) => setPrices((p) => ({ ...p, [variant.id]: e.target.value }))}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  className="shrink-0"
                  onClick={() => void savePrice(variant)}
                  disabled={busy}
                >
                  {savedId === variant.id ? '✓' : 'Kaydet'}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </>
  )
}
