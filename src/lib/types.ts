export type Stand = {
  id: string
  name: string
  location: string | null
  sort_order: number
  is_active: boolean
}

export type Employee = {
  id: string
  full_name: string
  phone: string | null
  daily_wage: number | null
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

/** stand_stock_report() RPC satırı */
export type StockReportRow = {
  variant_id: string
  product_id: string
  product_name: string
  size_label: string
  unit: VariantUnit
  price: number | null
  prev_date: string | null
  prev_qty: number
  transfer_in: number
  transfer_out: number
  expected_qty: number
  counted_qty: number | null
  sold_qty: number | null
  sold_amount: number | null
}

/** stock_daily_movement() RPC satırı — bir günün bir gramajdaki eksilmesi */
export type StockMovementRow = {
  count_date: string
  stand_id: string
  stand_name: string
  variant_id: string
  product_name: string
  size_label: string
  unit: VariantUnit
  prev_date: string | null
  prev_qty: number
  transfer_in: number
  transfer_out: number
  expected_qty: number
  counted_qty: number
  sold_qty: number
  sold_amount: number
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
