-- =====================================================================
-- Başlangıç verisi. 0001_init.sql çalıştırıldıktan SONRA çalıştır.
-- İsimleri kendine göre düzenle; uygulamadaki "Tanımlar" ekranından da
-- ekleyip çıkarabilirsin.
-- =====================================================================

insert into public.stands (name, location, sort_order) values
  ('Stand 1', null, 1),
  ('Stand 2', null, 2),
  ('Stand 3', null, 3)
on conflict do nothing;

-- Çalışanları uygulamadaki "Tanımlar > Çalışanlar" ekranından ekle.

-- Kahve çeşitleri
insert into public.products (name, sort_order) values
  ('Türk Kahvesi', 1),
  ('Dibek Kahvesi', 2),
  ('Menengiç Kahvesi', 3),
  ('Osmanlı Kahvesi', 4),
  ('Filtre Kahve', 5)
on conflict do nothing;

-- Her çeşit için gramajlar: 100g / 250g / 500g / 1kg paket + dökme (kg)
insert into public.product_variants (product_id, size_label, unit, grams, sort_order)
select p.id, s.label, s.unit, s.grams, s.ord
from public.products p
cross join (values
  ('100g',  'adet', 100,   1),
  ('250g',  'adet', 250,   2),
  ('500g',  'adet', 500,   3),
  ('1kg',   'adet', 1000,  4),
  ('Dökme', 'kg',   null,  5)
) as s(label, unit, grams, ord)
on conflict (product_id, size_label) do nothing;
