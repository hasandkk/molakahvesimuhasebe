-- =====================================================================
-- DENEME VERİSİ — uygulamayı doldurup gezmek için
--
-- 0001_init.sql çalıştırıldıktan sonra çalıştır. seed.sql'e gerek yok,
-- bu dosya kendi standlarını, çalışanlarını ve ürünlerini oluşturur.
--
-- Üretilen veri:
--   • 3 stand, 6 çalışan, 5 kahve çeşidi (fiyatlarıyla)
--   • Son 21 günün stok sayımları ve depo takviyeleri
--   • Aynı günlerin nakit/POS ciroları — stok hareketleriyle tutarlı,
--     yani "tahmini satış tutarı" ile gerçek ciro birbirini tutuyor
--   • Son 7 gün + bugün + YARIN için vardiya planı
--   • Para çekme, gider ve haftalık bankaya yatırma hareketleri
--   • İki kasa sayımı; biri bilerek 450 TL açık veriyor
--
-- Tarihler current_date'e göre üretilir, yani hangi gün çalıştırırsan
-- çalıştır "bugün" ve "yarın" ekranları dolu gelir.
--
-- Tekrar çalıştırılabilir: önce kendi ürettiği veriyi siler.
-- Temizlemek için: demo_data_temizle.sql
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Standlar
-- ---------------------------------------------------------------------
insert into public.stands (name, location, sort_order) values
  ('Kızılay Standı',      'Kızılay Meydanı',      1),
  ('Tunalı Standı',       'Tunalı Hilmi Caddesi', 2),
  ('Bahçelievler Standı', '7. Cadde',             3)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Çalışanlar
-- ---------------------------------------------------------------------
insert into public.employees (full_name, phone, daily_wage) values
  ('Ahmet Yılmaz',  '0532 111 22 33', 900),
  ('Mehmet Demir',  '0533 222 33 44', 900),
  ('Elif Kaya',     '0534 333 44 55', 950),
  ('Burak Şahin',   '0535 444 55 66', 900),
  ('Zeynep Aydın',  '0536 555 66 77', 950),
  ('Emre Çelik',    '0537 666 77 88', 850)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Kahve çeşitleri ve gramajları
--   base = 500g paket fiyatı; diğer gramajlar bunun katsayısı
-- ---------------------------------------------------------------------
insert into public.products (name, sort_order) values
  ('Türk Kahvesi',     1),
  ('Dibek Kahvesi',    2),
  ('Menengiç Kahvesi', 3),
  ('Osmanlı Kahvesi',  4),
  ('Filtre Kahve',     5)
on conflict do nothing;

insert into public.product_variants (product_id, size_label, unit, grams, price, sort_order)
select p.id, s.label, s.unit, s.grams, round(b.base * s.mult), s.ord
from public.products p
join (values
  ('Türk Kahvesi',     340),
  ('Dibek Kahvesi',    400),
  ('Menengiç Kahvesi', 460),
  ('Osmanlı Kahvesi',  380),
  ('Filtre Kahve',     320)
) as b(pname, base) on b.pname = p.name
cross join (values
  ('100g',  'adet',  100, 0.25, 1),
  ('250g',  'adet',  250, 0.55, 2),
  ('500g',  'adet',  500, 1.00, 3),
  ('1kg',   'adet', 1000, 1.85, 4),
  ('Dökme', 'kg',   null, 1.75, 5)
) as s(label, unit, grams, mult, ord)
on conflict (product_id, size_label) do update set price = excluded.price;

-- ---------------------------------------------------------------------
-- Hareketli veri
-- ---------------------------------------------------------------------
do $$
declare
  demo_stands   text[] := array['Kızılay Standı', 'Tunalı Standı', 'Bahçelievler Standı'];
  demo_people   text[] := array['Ahmet Yılmaz', 'Mehmet Demir', 'Elif Kaya',
                                'Burak Şahin', 'Zeynep Aydın', 'Emre Çelik'];
  stand_ids     uuid[];
  emp_ids       uuid[];
  emp_count     int;
  v_offset      int;
  v_day         date;
  v_ix          int;
  v_slot        int;
  v_variant     record;
  v_count_id    uuid;
  v_transfer_id uuid;
  v_opening     boolean;
  v_prev        numeric;
  v_incoming    numeric;
  v_available   numeric;
  v_sold        numeric;
  v_day_total   numeric;
  v_factor      numeric;
  v_real        numeric;
  v_cash        numeric;
  v_amount      numeric;
  v_last_bank   date;
begin
  select array_agg(id order by sort_order, name) into stand_ids
  from public.stands where name = any(demo_stands);

  select array_agg(id order by full_name) into emp_ids
  from public.employees where full_name = any(demo_people);

  emp_count := array_length(emp_ids, 1);

  -- Önceki deneme verisini temizle (stand'a bağlı her şey cascade ile gider)
  delete from public.stock_counts      where stand_id = any(stand_ids);
  delete from public.stock_transfers   where stand_id = any(stand_ids);
  delete from public.daily_revenues    where stand_id = any(stand_ids);
  delete from public.shift_assignments where stand_id = any(stand_ids);
  delete from public.cash_movements    where note like '[demo]%';
  delete from public.cash_counts       where note like '[demo]%';

  -- ---- Stok ve ciro: son 21 gün -------------------------------------
  for v_offset in reverse 20..0 loop
    v_day := current_date - v_offset;

    for v_ix in 1..array_length(stand_ids, 1) loop

      -- İlk gün açılış yüklemesi, sonra 4 günde bir takviye
      v_opening := (v_offset = 20);
      v_transfer_id := null;
      if v_opening or v_offset % 4 = 0 then
        insert into public.stock_transfers (transfer_date, stand_id, direction, note)
        values (v_day, stand_ids[v_ix], 'in',
                case when v_opening then 'Açılış yüklemesi' else 'Depodan takviye' end)
        returning id into v_transfer_id;
      end if;

      insert into public.stock_counts (count_date, stand_id, note)
      values (v_day, stand_ids[v_ix], null)
      returning id into v_count_id;

      v_day_total := 0;

      for v_variant in
        select v.id, v.unit, v.price, v.sort_order as v_ord, p.sort_order as p_ord
        from public.product_variants v
        join public.products p on p.id = v.product_id
        where v.is_active and p.is_active
        order by p.sort_order, v.sort_order
      loop
        -- Bir önceki sayımdaki miktar
        select i.quantity into v_prev
        from public.stock_counts c
        join public.stock_count_items i on i.count_id = c.id and i.variant_id = v_variant.id
        where c.stand_id = stand_ids[v_ix] and c.count_date < v_day
        order by c.count_date desc
        limit 1;
        v_prev := coalesce(v_prev, 0);

        -- Bugün standa giren mal (takviye ~4 günlük satışı karşılar)
        v_incoming := 0;
        if v_transfer_id is not null then
          if v_variant.unit = 'kg' then
            v_incoming := case when v_opening then 6 + (v_variant.p_ord % 3)
                               else 1.0 + (v_variant.p_ord % 3) * 0.5 end;
          else
            v_incoming := case when v_opening then 10 + ((v_variant.p_ord + v_variant.v_ord) % 4)
                               else 1 + ((v_variant.p_ord + v_variant.v_ord) % 3) end;
          end if;
          insert into public.stock_transfer_items (transfer_id, variant_id, quantity)
          values (v_transfer_id, v_variant.id, v_incoming);
        end if;

        v_available := v_prev + v_incoming;

        -- Günün satışı (deterministik; eldeki stoktan fazla olamaz)
        -- Paketli ürünler günde 0-2 adet, dökme kahve 0,1-0,7 kg satar.
        if v_variant.unit = 'kg' then
          v_sold := least(v_available,
                          0.1 + ((v_offset + v_variant.p_ord * 3 + v_ix) % 5) * 0.15);
        else
          v_sold := least(v_available,
                          greatest(0, ((v_offset * 2 + v_variant.p_ord * 3
                                        + v_variant.v_ord + v_ix * 4) % 6) - 3));
        end if;

        -- Akşam sayımı = eldeki − satılan
        insert into public.stock_count_items (count_id, variant_id, quantity)
        values (v_count_id, v_variant.id, v_available - v_sold);

        v_day_total := v_day_total + v_sold * coalesce(v_variant.price, 0);
      end loop;

      -- Gerçek ciro, stok farkının ±%3 çevresinde (fire, ikram, yuvarlama)
      v_factor := 0.97 + ((v_offset + v_ix) % 7) * 0.01;
      v_real   := round(v_day_total * v_factor, 2);
      v_cash   := round(v_real * 0.6, 2);

      -- 5 gün önce Kızılay standında kasaya 450 TL eksik teslim edilmiş
      if v_offset = 5 and v_ix = 1 then
        v_cash := greatest(v_cash - 450, 0);
      end if;

      insert into public.daily_revenues (business_date, stand_id, cash_amount, pos_amount)
      values (v_day, stand_ids[v_ix], v_cash, v_real - v_cash);
    end loop;
  end loop;

  -- ---- Haftada iki kez bankaya yatırma ------------------------------
  -- Biriken nakdin %85'i yatırılır; kalanı kasada döner sermaye olur.
  v_last_bank := current_date - 21;
  for v_offset in reverse 18..2 loop
    if v_offset % 3 = 0 then
      v_day := current_date - v_offset;

      select coalesce(sum(cash_amount), 0) into v_amount
      from public.daily_revenues
      where stand_id = any(stand_ids)
        and business_date > v_last_bank
        and business_date <= v_day;

      if v_amount > 0 then
        insert into public.cash_movements
          (movement_date, stand_id, type, amount, person_name, note)
        values (v_day, null, 'bankaya', round(v_amount * 0.85, 2), 'Hasan',
                '[demo] Bankaya yatırma');
      end if;

      v_last_bank := v_day;
    end if;
  end loop;

  -- ---- Vardiya: son 7 gün, bugün ve yarın ---------------------------
  for v_offset in reverse 7..-1 loop
    v_day := current_date - v_offset;

    for v_ix in 1..array_length(stand_ids, 1) loop
      for v_slot in 0..1 loop
        insert into public.shift_assignments (work_date, stand_id, employee_id, role)
        values (
          v_day,
          stand_ids[v_ix],
          emp_ids[1 + (((v_ix - 1) * 2 + v_slot + v_offset + 10) % emp_count)],
          case when v_slot = 0 then 'sorumlu' else null end
        )
        on conflict do nothing;
      end loop;
    end loop;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- Para çekme ve giderler
-- ---------------------------------------------------------------------
insert into public.cash_movements (movement_date, stand_id, type, amount, person_name, category, note) values
  (current_date - 18, null, 'cekim', 3000, 'Hasan',   null,            '[demo] Kişisel'),
  (current_date - 16, null, 'gider', 1850, 'Hasan',   'bardak/karton', '[demo] Toptancıdan bardak'),
  (current_date - 12, null, 'cekim', 2500, 'Ortağım', null,            '[demo] Kişisel'),
  (current_date - 11, null, 'gider',  900, 'Hasan',   'yakıt',         '[demo] Servis aracı'),
  (current_date -  9, null, 'gider', 9000, 'Hasan',   'kira',          '[demo] Depo kirası'),
  (current_date -  6, null, 'cekim', 2000, 'Hasan',   null,            '[demo] Kişisel'),
  (current_date -  5, null, 'gider', 1200, 'Ortağım', 'bakım',         '[demo] Değirmen bakımı'),
  (current_date -  3, null, 'cekim', 2500, 'Ortağım', null,            '[demo] Kişisel'),
  (current_date -  1, null, 'gider', 1400, 'Hasan',   'bardak/karton', '[demo] Karton bardak');

-- ---------------------------------------------------------------------
-- Kasa sayımları — beklenen tutar o güne kadarki bakiyeden hesaplanır
-- ---------------------------------------------------------------------
insert into public.cash_counts (count_date, stand_id, counted_amount, expected_amount, note)
values (
  current_date - 12, null,
  public.cash_balance_until(current_date - 12),
  public.cash_balance_until(current_date - 12),
  '[demo] Kasa tam tuttu'
);

insert into public.cash_counts (count_date, stand_id, counted_amount, expected_amount, note)
values (
  current_date - 4, null,
  greatest(public.cash_balance_until(current_date - 4) - 450, 0),
  public.cash_balance_until(current_date - 4),
  '[demo] Sayımda açık çıktı'
);

commit;
