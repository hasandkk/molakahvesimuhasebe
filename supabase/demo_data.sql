-- =====================================================================
-- DENEME VERİSİ — uygulamayı doldurup gezmek için
--
-- 0001_init.sql çalıştırıldıktan sonra çalıştır. seed.sql'e gerek yok,
-- bu dosya kendi standlarını, çalışanlarını ve ürününü oluşturur.
--
-- Üretilen veri:
--   • 3 stand, 6 çalışan, tek kahve çeşidi (Mola Kahvesi) 5 gramajda
--   • Son 21 günün stok sayımları ve depo takviyeleri
--   • Aynı günlerin nakit/POS ciroları — stok hareketleriyle tutarlı,
--     yani "tahmini satış tutarı" ile gerçek ciro birbirini tutuyor
--   • Son 7 gün + bugün + YARIN için vardiya planı
--   • Para çekme, gider ve düzenli bankaya yatırma hareketleri
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
-- Eski çok ürünlü deneme verisinden kalan kahve çeşitlerini kaldır.
-- (Bu betiğin önceki sürümü 5 çeşit oluşturuyordu. Ürün silinince ona
--  bağlı gramajlar, sayım kalemleri ve transfer kalemleri de gider.)
-- ---------------------------------------------------------------------
delete from public.products
where name in ('Türk Kahvesi', 'Dibek Kahvesi', 'Menengiç Kahvesi',
               'Osmanlı Kahvesi', 'Filtre Kahve');

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
  ('Emre Çelik',    '0537 666 77 88', 850),
  ('Seda Aksoy',    '0538 777 88 99', 900),
  ('Kerem Yıldız',  '0539 888 99 00', 850),
  ('Hakan Öztürk',  '0530 999 00 11', 900)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Tek ürün, 5 gramaj — fiyatlarıyla
-- ---------------------------------------------------------------------
insert into public.products (name, sort_order) values
  ('Mola Kahvesi', 1)
on conflict do nothing;

insert into public.product_variants (product_id, size_label, unit, grams, price, sort_order)
select p.id, s.label, s.unit, s.grams, s.price, s.ord
from public.products p
cross join (values
  ('100g',  'adet',  100,  95, 1),
  ('250g',  'adet',  250, 209, 2),
  ('500g',  'adet',  500, 380, 3),
  ('1kg',   'adet', 1000, 703, 4),
  ('Dökme', 'kg',   null, 665, 5)
) as s(label, unit, grams, price, ord)
where p.name = 'Mola Kahvesi'
on conflict (product_id, size_label) do update set price = excluded.price;

-- ---------------------------------------------------------------------
-- Hareketli veri
-- ---------------------------------------------------------------------
do $$
declare
  demo_stands   text[] := array['Kızılay Standı', 'Tunalı Standı', 'Bahçelievler Standı'];
  demo_people   text[] := array['Ahmet Yılmaz', 'Mehmet Demir', 'Elif Kaya',
                                'Burak Şahin', 'Zeynep Aydın', 'Emre Çelik',
                                'Seda Aksoy', 'Kerem Yıldız', 'Hakan Öztürk'];
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
  v_restock     numeric;
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
        select v.id, v.unit, v.price, v.sort_order as v_ord
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

        -- Takviye miktarı ≈ 4 günlük satış. Açılışta bunun iki katı.
        v_restock := case v_variant.v_ord
                       when 1 then 26   -- 100g
                       when 2 then 20   -- 250g
                       when 3 then 14   -- 500g
                       when 4 then 4    -- 1kg
                       else 8           -- Dökme (kg)
                     end;

        v_incoming := 0;
        if v_transfer_id is not null then
          v_incoming := case when v_opening then v_restock * 2 else v_restock end;
          insert into public.stock_transfer_items (transfer_id, variant_id, quantity)
          values (v_transfer_id, v_variant.id, v_incoming);
        end if;

        v_available := v_prev + v_incoming;

        -- Günün satışı: küçük gramajlar çok, büyükler az satar.
        -- Deterministik ve eldeki stoktan fazla olamaz.
        v_sold := case v_variant.v_ord
                    when 1 then 4 + ((v_offset * 2 + v_ix * 3) % 6)        -- 100g:  4-9 adet
                    when 2 then 3 + ((v_offset * 3 + v_ix * 2) % 5)        -- 250g:  3-7 adet
                    when 3 then 2 + ((v_offset + v_ix * 5) % 4)            -- 500g:  2-5 adet
                    when 4 then ((v_offset * 2 + v_ix) % 3)                -- 1kg:   0-2 adet
                    else 1.0 + ((v_offset + v_ix * 2) % 5) * 0.5           -- Dökme: 1-3 kg
                  end;
        v_sold := least(v_available, v_sold);

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

  -- ---- Üç günde bir bankaya yatırma ---------------------------------
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
      -- v_slot 0 = sabah vardiyası, 1 = akşam vardiyası
      for v_slot in 0..1 loop
        insert into public.shift_assignments
          (work_date, stand_id, employee_id, kind, start_time, end_time, role)
        values (
          v_day,
          stand_ids[v_ix],
          emp_ids[1 + (((v_ix - 1) * 2 + v_slot + v_offset + 10) % emp_count)],
          'vardiya',
          case when v_slot = 0 then time '08:00' else time '15:30' end,
          case when v_slot = 0 then time '15:30' else time '23:00' end,
          case when v_slot = 0 then 'sorumlu' else null end
        )
        on conflict do nothing;
      end loop;
    end loop;

    -- Yoğun günlerde Kızılay'ın sabah vardiyasında iki kişi birden çalışır
    if v_offset = -1 or v_offset % 3 = 0 then
      insert into public.shift_assignments
        (work_date, stand_id, employee_id, kind, start_time, end_time)
      values (v_day, stand_ids[1], emp_ids[1 + ((6 + v_offset + 10) % emp_count)],
              'vardiya', time '08:00', time '15:30')
      on conflict do nothing;
    end if;

    -- Eğitime gelenler: Tunalı'da vardiyadakinin yanında dururlar.
    -- Yarın iki kişi birden eğitimde.
    if v_offset = -1 or v_offset % 5 = 0 then
      insert into public.shift_assignments
        (work_date, stand_id, employee_id, kind, start_time, end_time)
      values (v_day, stand_ids[2], emp_ids[1 + ((7 + v_offset + 10) % emp_count)],
              'egitim', null, null)
      on conflict do nothing;
    end if;

    if v_offset in (-1, 0) then
      insert into public.shift_assignments
        (work_date, stand_id, employee_id, kind, start_time, end_time)
      values (v_day, stand_ids[2], emp_ids[1 + ((8 + v_offset + 10) % emp_count)],
              'egitim', null, null)
      on conflict do nothing;
    end if;
  end loop;

  -- 2 gün önce Bahçelievler'de sabah vardiyası geç açılmış (özel saat örneği)
  update public.shift_assignments
  set start_time = '10:00', end_time = '17:00'
  where work_date = current_date - 2
    and stand_id = stand_ids[3]
    and start_time = time '08:00';
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
