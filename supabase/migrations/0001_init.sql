-- =====================================================================
-- Mola Kahvesi — Stand Yönetim / Muhasebe / Stok şeması
-- Supabase SQL Editor'de bu dosyanın tamamını çalıştır.
--
-- Not: created_by (auth.users) foreign key'leri bilerek indekslenmedi.
-- Bu kolonlar hiçbir sorguda filtre olarak kullanılmıyor; indeks yalnızca
-- bir auth kullanıcısı silinirken işe yarar ki bu neredeyse hiç olmaz.
-- Diğer tüm foreign key kolonları indekslidir.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Ortak yardımcılar
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- profiles — giriş yapan kullanıcılar (sen + ortağın)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '',
  role        text not null default 'admin' check (role in ('admin', 'personel')),
  created_at  timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- stands — kahve standları (sayısı değişebilir)
-- ---------------------------------------------------------------------
create table if not exists public.stands (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  location    text,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index if not exists stands_name_uniq on public.stands (lower(name));

-- ---------------------------------------------------------------------
-- employees — çalışanlar (sisteme giriş yapmazlar, sadece kayıtlıdırlar)
-- ---------------------------------------------------------------------
create table if not exists public.employees (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null,
  phone       text,
  daily_wage  numeric(12,2),
  note        text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index if not exists employees_name_uniq on public.employees (lower(full_name));

-- ---------------------------------------------------------------------
-- products / product_variants — kahve çeşitleri ve gramajları
--   variant.unit = 'adet'  -> paketli (100g / 250g / 500g / 1kg)
--   variant.unit = 'kg'    -> dökme (ondalıklı sayılır)
-- ---------------------------------------------------------------------
create table if not exists public.products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index if not exists products_name_uniq on public.products (lower(name));

create table if not exists public.product_variants (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products(id) on delete cascade,
  size_label  text not null,
  unit        text not null default 'adet' check (unit in ('adet', 'kg')),
  grams       numeric(10,2),
  price       numeric(12,2),
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (product_id, size_label)
);

-- ---------------------------------------------------------------------
-- shift_assignments — hangi gün, hangi standda, kim, hangi saatlerde
--   Standart vardiyalar 08:00-15:30 ve 15:30-23:00, ama saatler
--   atama bazında serbestçe değiştirilebilir.
--
--   kind = 'vardiya' -> normal çalışan, saatleri bellidir
--   kind = 'egitim'  -> eğitime gelen kişi; vardiyada duran birinin
--                       yanında bulunur, tam vardiya kalmaz. Saat girmek
--                       zorunlu değildir, bu yüzden saatler NULL olabilir.
-- ---------------------------------------------------------------------
create table if not exists public.shift_assignments (
  id           uuid primary key default gen_random_uuid(),
  work_date    date not null,
  stand_id     uuid not null references public.stands(id) on delete cascade,
  employee_id  uuid not null references public.employees(id) on delete cascade,
  kind         text not null default 'vardiya' check (kind in ('vardiya', 'egitim')),
  start_time   time,
  end_time     time,
  role         text,
  note         text,
  created_by   uuid references auth.users(id) default auth.uid(),
  created_at   timestamptz not null default now()
);

-- Bu betiğin önceki sürümlerini çalıştırdıysan eksik kolonlar burada eklenir.
alter table public.shift_assignments
  add column if not exists start_time time,
  add column if not exists end_time   time,
  add column if not exists kind       text not null default 'vardiya';

-- Eğitim kayıtlarında saat girilmeyebildiği için saatler NULL olabilmeli.
alter table public.shift_assignments
  alter column start_time drop not null,
  alter column end_time   drop not null;

do $$
begin
  alter table public.shift_assignments
    add constraint shift_assignments_kind_check check (kind in ('vardiya', 'egitim'));
exception
  when duplicate_object then null;
end;
$$;

-- Aynı kişi aynı gün sabah bir standda, akşam başka standda çalışabilir;
-- bu yüzden benzersizlik kuralına vardiya türü ve başlangıç saati de dahil.
-- NULLS NOT DISTINCT: saatsiz eğitim kaydı aynı standa iki kez eklenemesin.
alter table public.shift_assignments
  drop constraint if exists shift_assignments_work_date_stand_id_employee_id_key;
drop index if exists public.shift_assignments_uniq;
create unique index shift_assignments_uniq
  on public.shift_assignments (work_date, stand_id, employee_id, kind, start_time)
  nulls not distinct;

create index if not exists shift_assignments_date_idx on public.shift_assignments (work_date);
create index if not exists shift_assignments_stand_idx on public.shift_assignments (stand_id);
create index if not exists shift_assignments_employee_idx on public.shift_assignments (employee_id);

-- ---------------------------------------------------------------------
-- daily_revenues — stand başına gün sonu nakit / POS cirosu
-- ---------------------------------------------------------------------
create table if not exists public.daily_revenues (
  id             uuid primary key default gen_random_uuid(),
  business_date  date not null,
  stand_id       uuid not null references public.stands(id) on delete cascade,
  cash_amount    numeric(12,2) not null default 0 check (cash_amount >= 0),
  pos_amount     numeric(12,2) not null default 0 check (pos_amount >= 0),
  note           text,
  created_by     uuid references auth.users(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (business_date, stand_id)
);
create index if not exists daily_revenues_date_idx on public.daily_revenues (business_date);
create index if not exists daily_revenues_stand_idx on public.daily_revenues (stand_id);

drop trigger if exists daily_revenues_updated_at on public.daily_revenues;
create trigger daily_revenues_updated_at
  before update on public.daily_revenues
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- cash_movements — kasadan para çekme / gider / nakit giriş / bankaya yatırma
--   stand_id NULL  => merkez kasa
--   type 'giris'   => kasaya para girişi (+), diğerleri çıkış (-)
-- ---------------------------------------------------------------------
create table if not exists public.cash_movements (
  id             uuid primary key default gen_random_uuid(),
  movement_date  date not null default current_date,
  stand_id       uuid references public.stands(id) on delete set null,
  type           text not null check (type in ('cekim', 'gider', 'giris', 'bankaya')),
  amount         numeric(12,2) not null check (amount > 0),
  person_name    text,
  category       text,
  note           text,
  created_by     uuid references auth.users(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  signed_amount  numeric(12,2) generated always as
                   (case when type = 'giris' then amount else -amount end) stored
);
create index if not exists cash_movements_date_idx on public.cash_movements (movement_date);
create index if not exists cash_movements_stand_idx on public.cash_movements (stand_id);

-- ---------------------------------------------------------------------
-- cash_counts — fiziki kasa sayımı (açık/fazla tespiti)
-- ---------------------------------------------------------------------
create table if not exists public.cash_counts (
  id               uuid primary key default gen_random_uuid(),
  count_date       date not null,
  stand_id         uuid references public.stands(id) on delete cascade,
  counted_amount   numeric(12,2) not null check (counted_amount >= 0),
  expected_amount  numeric(12,2),
  note             text,
  created_by       uuid references auth.users(id) default auth.uid(),
  created_at       timestamptz not null default now()
);
create index if not exists cash_counts_date_idx on public.cash_counts (count_date);
create index if not exists cash_counts_stand_idx on public.cash_counts (stand_id);

-- ---------------------------------------------------------------------
-- stock_counts / stock_count_items — akşam stok sayımı
-- ---------------------------------------------------------------------
create table if not exists public.stock_counts (
  id          uuid primary key default gen_random_uuid(),
  count_date  date not null,
  stand_id    uuid not null references public.stands(id) on delete cascade,
  note        text,
  created_by  uuid references auth.users(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (count_date, stand_id)
);
create index if not exists stock_counts_date_idx on public.stock_counts (count_date);
create index if not exists stock_counts_stand_idx on public.stock_counts (stand_id);

drop trigger if exists stock_counts_updated_at on public.stock_counts;
create trigger stock_counts_updated_at
  before update on public.stock_counts
  for each row execute function public.set_updated_at();

create table if not exists public.stock_count_items (
  id          uuid primary key default gen_random_uuid(),
  count_id    uuid not null references public.stock_counts(id) on delete cascade,
  variant_id  uuid not null references public.product_variants(id) on delete cascade,
  quantity    numeric(12,3) not null default 0 check (quantity >= 0),
  unique (count_id, variant_id)
);
create index if not exists stock_count_items_variant_idx on public.stock_count_items (variant_id);

-- ---------------------------------------------------------------------
-- stock_transfers / items — depodan standa mal çıkışı, standdan iade
--   direction 'in'  => standa giren mal
--   direction 'out' => standdan çıkan / iade edilen mal
-- ---------------------------------------------------------------------
create table if not exists public.stock_transfers (
  id             uuid primary key default gen_random_uuid(),
  transfer_date  date not null,
  stand_id       uuid not null references public.stands(id) on delete cascade,
  direction      text not null check (direction in ('in', 'out')),
  note           text,
  created_by     uuid references auth.users(id) default auth.uid(),
  created_at     timestamptz not null default now()
);
create index if not exists stock_transfers_date_idx on public.stock_transfers (transfer_date);
create index if not exists stock_transfers_stand_idx on public.stock_transfers (stand_id);

create table if not exists public.stock_transfer_items (
  id           uuid primary key default gen_random_uuid(),
  transfer_id  uuid not null references public.stock_transfers(id) on delete cascade,
  variant_id   uuid not null references public.product_variants(id) on delete cascade,
  quantity     numeric(12,3) not null check (quantity > 0)
);
create index if not exists stock_transfer_items_transfer_idx on public.stock_transfer_items (transfer_id);
create index if not exists stock_transfer_items_variant_idx on public.stock_transfer_items (variant_id);

-- ---------------------------------------------------------------------
-- stand_stock_report(stand, tarih)
--   Bir önceki sayım + aradaki transferler = beklenen stok.
--   Beklenen - sayılan = o dönemde eksilen (satılan) miktar.
-- ---------------------------------------------------------------------
create or replace function public.stand_stock_report(p_stand_id uuid, p_date date)
returns table (
  variant_id    uuid,
  product_id    uuid,
  product_name  text,
  size_label    text,
  unit          text,
  price         numeric,
  prev_date     date,
  prev_qty      numeric,
  transfer_in   numeric,
  transfer_out  numeric,
  expected_qty  numeric,
  counted_qty   numeric,
  sold_qty      numeric,
  sold_amount   numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with prev as (
    select sc.id, sc.count_date
    from public.stock_counts sc
    where sc.stand_id = p_stand_id and sc.count_date < p_date
    order by sc.count_date desc
    limit 1
  ),
  cur as (
    select sc.id
    from public.stock_counts sc
    where sc.stand_id = p_stand_id and sc.count_date = p_date
  ),
  prev_items as (
    select i.variant_id, i.quantity
    from public.stock_count_items i
    join prev on i.count_id = prev.id
  ),
  cur_items as (
    select i.variant_id, i.quantity
    from public.stock_count_items i
    join cur on i.count_id = cur.id
  ),
  moves as (
    select ti.variant_id,
           sum(case when t.direction = 'in'  then ti.quantity else 0 end) as tin,
           sum(case when t.direction = 'out' then ti.quantity else 0 end) as tout
    from public.stock_transfers t
    join public.stock_transfer_items ti on ti.transfer_id = t.id
    where t.stand_id = p_stand_id
      and t.transfer_date > coalesce((select p.count_date from prev p), '-infinity'::date)
      and t.transfer_date <= p_date
    group by ti.variant_id
  )
  select
    v.id,
    p.id,
    p.name,
    v.size_label,
    v.unit,
    v.price,
    (select pr.count_date from prev pr)                                        as prev_date,
    coalesce(pi.quantity, 0)                                                   as prev_qty,
    coalesce(m.tin, 0)                                                         as transfer_in,
    coalesce(m.tout, 0)                                                        as transfer_out,
    coalesce(pi.quantity, 0) + coalesce(m.tin, 0) - coalesce(m.tout, 0)        as expected_qty,
    ci.quantity                                                                as counted_qty,
    case when ci.quantity is null then null
         else coalesce(pi.quantity, 0) + coalesce(m.tin, 0) - coalesce(m.tout, 0) - ci.quantity
    end                                                                        as sold_qty,
    case when ci.quantity is null then null
         else (coalesce(pi.quantity, 0) + coalesce(m.tin, 0) - coalesce(m.tout, 0) - ci.quantity)
              * coalesce(v.price, 0)
    end                                                                        as sold_amount
  from public.product_variants v
  join public.products p on p.id = v.product_id
  left join prev_items pi on pi.variant_id = v.id
  left join cur_items  ci on ci.variant_id = v.id
  left join moves      m  on m.variant_id  = v.id
  where v.is_active and p.is_active
  order by p.sort_order, p.name, v.sort_order, v.size_label;
$$;

-- ---------------------------------------------------------------------
-- stock_daily_movement(baslangic, bitis, stand)
--   Bir tarih aralığındaki HER sayım için o güne ait eksilen miktarı verir.
--   stand_stock_report tek gün/tek stand içindir; bu geriye dönük döküm için.
--
--   Her sayım kendinden önceki sayımla karşılaştırılır (lag). Aralığın ilk
--   gününün karşılaştırması aralıktan önceki sayıma göre yapılabilsin diye
--   temel CTE tarihe göre süzülmez, süzme en sonda yapılır.
--
--   Karşılaştırma tabanı olmayan satırlar (ilk sayım, öncesinde transfer de
--   yoksa) döndürülmez — orada "eksilen" diye bir kavram yoktur.
-- ---------------------------------------------------------------------
create or replace function public.stock_daily_movement(
  p_from date,
  p_to date,
  p_stand_id uuid default null
)
returns table (
  count_date    date,
  stand_id      uuid,
  stand_name    text,
  variant_id    uuid,
  product_name  text,
  size_label    text,
  unit          text,
  prev_date     date,
  prev_qty      numeric,
  transfer_in   numeric,
  transfer_out  numeric,
  expected_qty  numeric,
  counted_qty   numeric,
  sold_qty      numeric,
  sold_amount   numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with sayimlar as (
    select
      sc.id,
      sc.stand_id,
      sc.count_date,
      lag(sc.id)         over (partition by sc.stand_id order by sc.count_date) as prev_id,
      lag(sc.count_date) over (partition by sc.stand_id order by sc.count_date) as prev_date
    from public.stock_counts sc
    where p_stand_id is null or sc.stand_id = p_stand_id
  ),
  kalemler as (
    select s.id as count_id, s.stand_id, s.count_date, s.prev_id, s.prev_date,
           i.variant_id, i.quantity as counted
    from sayimlar s
    join public.stock_count_items i on i.count_id = s.id
  ),
  hareketler as (
    select t.stand_id, ti.variant_id, t.transfer_date,
           sum(case when t.direction = 'in'  then ti.quantity else 0 end) as tin,
           sum(case when t.direction = 'out' then ti.quantity else 0 end) as tout
    from public.stock_transfers t
    join public.stock_transfer_items ti on ti.transfer_id = t.id
    group by t.stand_id, ti.variant_id, t.transfer_date
  )
  select
    k.count_date,
    k.stand_id,
    st.name,
    k.variant_id,
    p.name,
    v.size_label,
    v.unit,
    k.prev_date,
    coalesce(pi.quantity, 0),
    m.tin,
    m.tout,
    coalesce(pi.quantity, 0) + m.tin - m.tout                                   as expected_qty,
    k.counted,
    coalesce(pi.quantity, 0) + m.tin - m.tout - k.counted                       as sold_qty,
    (coalesce(pi.quantity, 0) + m.tin - m.tout - k.counted) * coalesce(v.price, 0) as sold_amount
  from kalemler k
  join public.stands st           on st.id = k.stand_id
  join public.product_variants v  on v.id = k.variant_id
  join public.products p          on p.id = v.product_id
  left join public.stock_count_items pi
         on pi.count_id = k.prev_id and pi.variant_id = k.variant_id
  cross join lateral (
    select coalesce(sum(h.tin), 0) as tin, coalesce(sum(h.tout), 0) as tout
    from hareketler h
    where h.stand_id = k.stand_id
      and h.variant_id = k.variant_id
      and h.transfer_date > coalesce(k.prev_date, '-infinity'::date)
      and h.transfer_date <= k.count_date
  ) m
  where k.count_date between p_from and p_to
    and (k.prev_date is not null or m.tin <> 0 or m.tout <> 0)
  order by k.count_date desc, st.sort_order, st.name, p.sort_order, v.sort_order;
$$;

-- ---------------------------------------------------------------------
-- Kasa özetleri
--   Nakit bakiye = toplam nakit ciro + hareketlerin işaretli toplamı.
--   POS tutarları bankaya gittiği için nakit bakiyeye dahil edilmez.
-- ---------------------------------------------------------------------
create or replace function public.cash_balance_until(p_date date)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce((
      select sum(cash_amount) from public.daily_revenues where business_date <= p_date
    ), 0)
    + coalesce((
      select sum(signed_amount) from public.cash_movements where movement_date <= p_date
    ), 0);
$$;

create or replace function public.cash_summary()
returns table (
  cash_income   numeric,
  pos_income    numeric,
  withdrawals   numeric,
  expenses      numeric,
  to_bank       numeric,
  deposits      numeric,
  cash_balance  numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with rev as (
    select coalesce(sum(cash_amount), 0) as cash_income,
           coalesce(sum(pos_amount), 0)  as pos_income
    from public.daily_revenues
  ),
  mv as (
    select
      coalesce(sum(amount) filter (where type = 'cekim'), 0)   as withdrawals,
      coalesce(sum(amount) filter (where type = 'gider'), 0)   as expenses,
      coalesce(sum(amount) filter (where type = 'bankaya'), 0) as to_bank,
      coalesce(sum(amount) filter (where type = 'giris'), 0)   as deposits,
      coalesce(sum(signed_amount), 0)                          as net
    from public.cash_movements
  )
  select rev.cash_income, rev.pos_income, mv.withdrawals, mv.expenses, mv.to_bank, mv.deposits,
         rev.cash_income + mv.net
  from rev, mv;
$$;

-- ---------------------------------------------------------------------
-- RLS — sadece giriş yapmış kullanıcılar (sen + ortağın) her şeye erişir.
-- Supabase Dashboard > Authentication > Sign In / Providers bölümünden
-- "Allow new users to sign up" kapatılmalı ki dışarıdan kayıt olunamasın.
-- ---------------------------------------------------------------------
do $$
declare
  t text;
  tables text[] := array[
    'stands', 'employees', 'products', 'product_variants',
    'shift_assignments', 'daily_revenues', 'cash_movements', 'cash_counts',
    'stock_counts', 'stock_count_items', 'stock_transfers', 'stock_transfer_items'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_authenticated_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true)',
      t || '_authenticated_all', t
    );
  end loop;
end;
$$;

alter table public.profiles enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (true);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
