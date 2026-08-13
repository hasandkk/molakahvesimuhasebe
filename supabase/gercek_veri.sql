-- =====================================================================
-- GERÇEK VERİ — sıfırdan kurulum
--
-- DİKKAT: Bu betik veritabanındaki TÜM verileri siler ve aşağıdaki
-- gerçek verileri yazar. Deneme verisi, eski standlar, eski çalışanlar,
-- eski ciro/sayım/kasa kayıtları — hepsi gider.
--
-- 0001_init.sql çalıştırıldıktan sonra çalıştır.
-- Bundan sonra demo_data.sql'i BİR DAHA çalıştırma, deneme standlarını
-- geri getirir.
--
-- Kurulan veri:
--   • 3 stand: Feneryolu, Kelkit Vadisi, Ziyade Opet
--   • 5 çalışan
--   • Tek ürün: Mola Kahvesi (100g / 250g / 500g / 1kg / Dökme)
--   • Her stand için bugün tarihli açılış stok sayımı
--
-- NOT 1 — Fiyatlar boş bırakıldı. Uygulamada "Tanımlar > Ürünler"
--   ekranından her gramajın satış fiyatını gir; stok farkından tahmini
--   ciro hesabı ancak fiyat girilince çalışır.
--
-- NOT 2 — Dökme kahve kg cinsinden tutulur. Feneryolu 1 kg, Kelkit
--   Vadisi 6 kg, Ziyade Opet 10 kg olarak girildi. Farklıysa uygulamadan
--   "Stok > Akşam sayımı" ekranından düzelt.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) Her şeyi sil
-- ---------------------------------------------------------------------
truncate
  public.stock_count_items,
  public.stock_counts,
  public.stock_transfer_items,
  public.stock_transfers,
  public.daily_revenues,
  public.cash_movements,
  public.cash_counts,
  public.shift_assignments,
  public.product_variants,
  public.products,
  public.employees,
  public.stands
cascade;

-- ---------------------------------------------------------------------
-- 2) Standlar
-- ---------------------------------------------------------------------
insert into public.stands (name, sort_order) values
  ('Feneryolu',     1),
  ('Kelkit Vadisi', 2),
  ('Ziyade Opet',   3);

-- ---------------------------------------------------------------------
-- 3) Çalışanlar
-- ---------------------------------------------------------------------
insert into public.employees (full_name) values
  ('İlayda Dalgıç'),
  ('Esranur Bedir'),
  ('Şevval Akyıldız'),
  ('Atilla Yaghoubi'),
  ('Akın Bedir');

-- ---------------------------------------------------------------------
-- 4) Ürün ve gramajlar (fiyatlar uygulamadan girilecek)
-- ---------------------------------------------------------------------
insert into public.products (name, sort_order) values ('Mola Kahvesi', 1);

insert into public.product_variants (product_id, size_label, unit, grams, sort_order)
select p.id, s.label, s.unit, s.grams, s.ord
from public.products p
cross join (values
  ('100g',  'adet',  100, 1),
  ('250g',  'adet',  250, 2),
  ('500g',  'adet',  500, 3),
  ('1kg',   'adet', 1000, 4),
  ('Dökme', 'kg',   null, 5)
) as s(label, unit, grams, ord)
where p.name = 'Mola Kahvesi';

-- ---------------------------------------------------------------------
-- 5) Açılış stok sayımı — bugün tarihli
--    Yarın akşam sayım girdiğinde "eksilen" bu rakamlara göre hesaplanır.
-- ---------------------------------------------------------------------
with sayimlar as (
  insert into public.stock_counts (count_date, stand_id, note)
  select current_date, s.id, 'Açılış sayımı'
  from public.stands s
  returning id, stand_id
),
veri(stand, gramaj, miktar) as (values
  ('Feneryolu',     '100g',   10),
  ('Feneryolu',     '250g',   20),
  ('Feneryolu',     '500g',   39),
  ('Feneryolu',     '1kg',    21),
  ('Feneryolu',     'Dökme',   1),

  ('Kelkit Vadisi', '100g',   22),
  ('Kelkit Vadisi', '250g',  101),
  ('Kelkit Vadisi', '500g',   33),
  ('Kelkit Vadisi', '1kg',    38),
  ('Kelkit Vadisi', 'Dökme',   6),

  ('Ziyade Opet',   '100g',   23),
  ('Ziyade Opet',   '250g',   59),
  ('Ziyade Opet',   '500g',   42),
  ('Ziyade Opet',   '1kg',    17),
  ('Ziyade Opet',   'Dökme',  10)
)
insert into public.stock_count_items (count_id, variant_id, quantity)
select sc.id, v.id, d.miktar
from veri d
join public.stands st         on st.name = d.stand
join sayimlar sc              on sc.stand_id = st.id
join public.product_variants v on v.size_label = d.gramaj
join public.products p         on p.id = v.product_id and p.name = 'Mola Kahvesi';

commit;
