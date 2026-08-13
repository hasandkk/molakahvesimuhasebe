export type Stand = {
  id: string
  name: string
  location: string | null
  sort_order: number
  is_active: boolean
}

/**
 * 'kademeli' — ilk gün ücretsiz, sonra kademe kademe artar
 * 'tam'      — ilk günden itibaren tam ücret + yemek (deneyimli işe alım
 *              ya da program kurulmadan önce başlamış kişi)
 * 'odemesiz' — hiç ödeme yok: yevmiye de yemek de 0 (ortaklar, ücretsiz
 *              çalışanlar). Prim girilirse yine de hesaba katılır.
 */
export type WageMode = 'kademeli' | 'tam' | 'odemesiz'

export const WAGE_MODE_LABELS: Record<WageMode, string> = {
  kademeli: 'Kademeli (eğitim → 3 gün → tam)',
  tam: 'İlk günden tam ücret',
  odemesiz: 'Ödeme yok (yevmiye ve yemek 0)',
}

export type Employee = {
  id: string
  full_name: string
  phone: string | null
  daily_wage: number | null
  wage_mode: WageMode
  note: string | null
  is_active: boolean
}

export type Product = {
  id: string
  name: string
  sort_order: number
  is_active: boolean
}

export type VariantUnit = 'adet' | 'kg'

export type ProductVariant = {
  id: string
  product_id: string
  size_label: string
  unit: VariantUnit
  grams: number | null
  price: number | null
  sort_order: number
  is_active: boolean
}

/** 'vardiya' = normal çalışan · 'egitim' = eğitime gelen, tam vardiya durmaz */
export type ShiftKind = 'vardiya' | 'egitim'

export type ShiftAssignment = {
  id: string
  work_date: string
  stand_id: string
  employee_id: string
  kind: ShiftKind
  /** "HH:MM:SS" — Postgres time. Eğitim kayıtlarında boş olabilir. */
  start_time: string | null
  end_time: string | null
  role: string | null
  note: string | null
}

/** Standart vardiyalar. Saatler atama bazında değiştirilebilir. */
export const SHIFT_PRESETS = [
  { id: 'sabah', label: 'Sabah', start: '08:00', end: '15:30' },
  { id: 'aksam', label: 'Akşam', start: '15:30', end: '23:00' },
] as const

export type DailyRevenue = {
  id: string
  business_date: string
  stand_id: string
  cash_amount: number
  pos_amount: number
  note: string | null
}

export type CashMovementType = 'cekim' | 'gider' | 'giris' | 'bankaya'

export type CashMovement = {
  id: string
  movement_date: string
  stand_id: string | null
  type: CashMovementType
  amount: number
  person_name: string | null
  category: string | null
  note: string | null
  signed_amount: number
  created_at: string
}

export type CashCount = {
  id: string
  count_date: string
  stand_id: string | null
  counted_amount: number
  expected_amount: number | null
  note: string | null
  created_at: string
}

export type StockCount = {
  id: string
  count_date: string
  stand_id: string
  note: string | null
}

export type StockTransfer = {
  id: string
  transfer_date: string
  stand_id: string
  direction: 'in' | 'out'
  note: string | null
  created_at: string
}

/** stand_stock_report() RPC satırı — bir standın bir tarihteki stok durumu */
export type StockReportRow = {
  variant_id: string
  product_id: string
  product_name: string
  size_label: string
  unit: VariantUnit
  price: number | null
  /** Karşılaştırmanın dayandığı son fiziki sayım; yoksa null */
  prev_date: string | null
  prev_qty: number
  transfer_in: number
  transfer_out: number
  /** Son sayımdan sonra, bu tarihten ÖNCE satılan */
  sold_before: number
  /** Bu tarihte satılan */
  sold_today: number
  /** Gün başındaki teorik stok */
  on_hand_before: number
  /** Gün sonundaki teorik stok */
  on_hand: number
  /** Bu tarihte fiziki sayım yapıldıysa sayılan miktar */
  counted_qty: number | null
  /** sayılan − teorik. Eksi = kayıp/fire */
  variance: number | null
}

/** stock_daily_sales() RPC satırı — o gün o standda satılan */
export type StockSaleRow = {
  sale_date: string
  stand_id: string
  stand_name: string
  variant_id: string
  product_name: string
  size_label: string
  unit: VariantUnit
  quantity: number
  amount: number
}

/** stock_count_variance() RPC satırı — sayımın teorik stoktan sapması */
export type StockVarianceRow = {
  count_date: string
  stand_id: string
  stand_name: string
  variant_id: string
  product_name: string
  size_label: string
  unit: VariantUnit
  on_hand: number
  counted_qty: number
  variance: number
  variance_amount: number
}

/** payroll() RPC satırı — bir çalışanın bir çalışma günü */
export type PayrollRow = {
  employee_id: string
  full_name: string
  work_date: string
  /** Kişinin işe başlamasından itibaren kaçıncı çalışma günü (1'den başlar) */
  day_index: number
  shifts: number
  is_training: boolean
}

export type PayrollSettings = {
  first_day_wage: number
  first_day_meal: number
  tier1_days: number
  tier1_wage: number
  tier2_wage: number
  meal_wage: number
}

export type EmployeeBonus = {
  id: string
  work_date: string
  employee_id: string
  amount: number
  note: string | null
}

export const MOVEMENT_LABELS: Record<CashMovementType, string> = {
  cekim: 'Para çekme',
  gider: 'Gider',
  giris: 'Kasaya giriş',
  bankaya: 'Bankaya yatırma',
}
