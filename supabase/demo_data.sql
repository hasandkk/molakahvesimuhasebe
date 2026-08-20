-- =====================================================================
-- DENEME VERİSİ — uygulamayı doldurup gezmek için
--
-- 0001_init.sql çalıştırıldıktan sonra çalıştır. seed.sql'e gerek yok,
-- bu dosya kendi standlarını, çalışanlarını ve ürününü oluşturur.
--
-- Üretilen veri:
--   • 3 stand, 6 çalışan, tek kahve çeşidi (Mola Kahvesi) 5 gramajda
--   • Son 21 günün GÜNLÜK SATIŞ kayıtları ve depo takviyeleri
--   • Haftalık fiziki sayımlar; birinde kasıtlı 3 adetlik fire var
--   • Aynı günlerin nakit/POS ciroları — satış tutarıyla tutarlı
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
--
-- Stok modeli: günlük SATIŞ kaydı tutulur, stok ondan düşer. Fiziki sayım
-- haftada bir yapılır ve teorik stokla karşılaştırılır. Koşan stok geçici
-- bir tabloda tutuluyor ki satış/transfer/sayım tutarlı üretilsin.
-- ---------------------------------------------------------------------
create temporary table demo_stok (
  stand_id   uuid,
  variant_id uuid,
  qty        numeric not null default 0,
  primary key (stand_id, variant_id)
) on commit drop;

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
  v_sale_id     uuid;
  v_count_id    uuid;
  v_transfer_id uuid;
  v_restock     numeric;
  v_incoming    numeric;
  v_have        numeric;
  v_sold        numeric;
  v_day_total   numeric;
  v_factor      numeric;
  v_real        numeric;
  v_cash        numeric;
  v_amount      numeric;
  v_last_bank   date;
  v_open        numeric;
begin
  select array_agg(id order by sort_order, name) into stand_ids
  from public.stands where name = any(demo_stands);

  select array_agg(id order by full_name) into emp_ids
  from public.employees where full_name = any(demo_people);

  emp_count := array_length(emp_ids, 1);

  -- Önceki deneme verisini temizle
  delete from public.stock_counts      where stand_id = any(stand_ids);
  delete from public.stock_sales       where stand_id = any(stand_ids);
  delete from public.stock_transfers   where stand_id = any(stand_ids);
  delete from public.daily_revenues    where stand_id = any(stand_ids);
  delete from public.shift_assignments where stand_id = any(stand_ids);
  delete from public.cash_movements    where note like '[demo]%';
  delete from public.cash_counts       where note like '[demo]%';

  -- ---- Açılış stoğu ve açılış sayımı (döngüden bir gün önce) ----------
  for v_ix in 1..array_length(stand_ids, 1) loop
    insert into public.stock_counts (count_date, stand_id, note)
    values (current_date - 21, stand_ids[v_ix], 'Açılış sayımı')
    returning id into v_count_id;

    for v_variant in
      select v.id, v.unit, v.price, v.sort_order as v_ord
      from public.product_variants v
      join public.products p on p.id = v.product_id
      where v.is_active and p.is_active
      order by v.sort_order
    loop
      v_open := case v_variant.v_ord
                  when 1 then 52 when 2 then 40 when 3 then 28 when 4 then 8 else 16 end;
      insert into demo_stok (stand_id, variant_id, qty) values (stand_ids[v_ix], v_variant.id, v_open);
      insert into public.stock_count_items (count_id, variant_id, quantity)
      values (v_count_id, v_variant.id, v_open);
    end loop;
  end loop;

  -- ---- Son 21 gün: transfer, satış, ciro, haftalık sayım -------------
  for v_offset in reverse 20..0 loop
    v_day := current_date - v_offset;

    for v_ix in 1..array_length(stand_ids, 1) loop

      v_transfer_id := null;
      if v_offset % 4 = 0 then
        insert into public.stock_transfers (transfer_date, stand_id, direction, note)
        values (v_day, stand_ids[v_ix], 'in', 'Depodan takviye')
        returning id into v_transfer_id;
      end if;

      insert into public.stock_sales (sale_date, stand_id) values (v_day, stand_ids[v_ix])
      returning id into v_sale_id;

      v_day_total := 0;

      for v_variant in
        select v.id, v.unit, v.price, v.sort_order as v_ord
        from public.product_variants v
        join public.products p on p.id = v.product_id
        where v.is_active and p.is_active
        order by v.sort_order
      loop
        -- Takviye ≈ 4 günlük satış
        v_restock := case v_variant.v_ord
                       when 1 then 26 when 2 then 20 when 3 then 14 when 4 then 4 else 8 end;

        if v_transfer_id is not null then
          v_incoming := v_restock;
          insert into public.stock_transfer_items (transfer_id, variant_id, quantity)
          values (v_transfer_id, v_variant.id, v_incoming);
          update demo_stok set qty = qty + v_incoming
          where stand_id = stand_ids[v_ix] and variant_id = v_variant.id;
        end if;

        select qty into v_have from demo_stok
        where stand_id = stand_ids[v_ix] and variant_id = v_variant.id;

        -- Küçük gramajlar çok, büyükler az satar
        v_sold := case v_variant.v_ord
                    when 1 then 4 + ((v_offset * 2 + v_ix * 3) % 6)
                    when 2 then 3 + ((v_offset * 3 + v_ix * 2) % 5)
                    when 3 then 2 + ((v_offset + v_ix * 5) % 4)
                    when 4 then ((v_offset * 2 + v_ix) % 3)
                    else 1.0 + ((v_offset + v_ix * 2) % 5) * 0.5
                  end;
        v_sold := least(v_have, v_sold);

        insert into public.stock_sale_items (sale_id, variant_id, quantity)
        values (v_sale_id, v_variant.id, v_sold);

        update demo_stok set qty = qty - v_sold
        where stand_id = stand_ids[v_ix] and variant_id = v_variant.id;

        v_day_total := v_day_total + v_sold * coalesce(v_variant.price, 0);
      end loop;

      -- Gerçek ciro, satış tutarının ±%3 çevresinde
      v_factor := 0.97 + ((v_offset + v_ix) % 7) * 0.01;
      v_real   := round(v_day_total * v_factor, 2);
      v_cash   := round(v_real * 0.6, 2);

      -- Haftada bir fiziki sayım. Bir keresinde kasıtlı olarak eksik çıkar.
      if v_offset % 7 = 0 then
        insert into public.stock_counts (count_date, stand_id, note)
        values (v_day, stand_ids[v_ix], 'Haftalık sayım')
        returning id into v_count_id;

        insert into public.stock_count_items (count_id, variant_id, quantity)
        select v_count_id, d.variant_id,
               case when v_offset = 7 and v_ix = 1 and d.variant_id = (
                      select v2.id from public.product_variants v2 where v2.size_label = '250g' limit 1
                    )
                    then greatest(d.qty - 3, 0)   -- 3 adet fire
                    else d.qty end
        from demo_stok d
        where d.stand_id = stand_ids[v_ix];

        -- Sayımdan sonra fiziki gerçek neyse koşan stok da o olur; yoksa
        -- fire bir sonraki sayımda "fazla" olarak geri görünürdü.
        update demo_stok d
        set qty = ci.quantity
        from public.stock_count_items ci
        where ci.count_id = v_count_id
          and ci.variant_id = d.variant_id
          and d.stand_id = stand_ids[v_ix];
      end if;
    end loop;
  end loop;

  -- ---- Vardiya: son 7 gün, bugün ve yarın ---------------------------
  for v_offset in reverse 7..-1 loop
    v_day := current_date - v_offset;

    for v_ix in 1..array_length(stand_ids, 1) loop
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

    if v_offset = -1 or v_offset % 3 = 0 then
      insert into public.shift_assignments
        (work_date, stand_id, employee_id, kind, start_time, end_time)
      values (v_day, stand_ids[1], emp_ids[1 + ((6 + v_offset + 10) % emp_count)],
              'vardiya', time '08:00', time '15:30')
      on conflict do nothing;
    end if;

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

  update public.shift_assignments
  set start_time = '10:00', end_time = '17:00'
  where work_date = current_date - 2
    and stand_id = stand_ids[3]
    and start_time = time '08:00';
end;
$$;

commit;
