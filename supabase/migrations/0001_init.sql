-- =====================================================================
-- Mola Kahvesi — Stand Yönetim / Muhasebe / Stok şeması
-- Supabase SQL Editor'de bu dosyanın tamamını çalıştır.
--
-- Not: created_by (auth.users) foreign key'leri bilerek indekslenmedi.
-- Bu kolonlar hiçbir sorguda filtre olarak kullanılmıyor; indeks yalnızca
-- bir auth kullanıcısı silinirken işe yarar ki bu neredeyse hiç olmaz.
-- Diğer tüm foreign key kolonları indekslidir.
--
-- Betik istendiği kadar tekrar çalıştırılabilir. Rapor fonksiyonları
-- create or replace'ten önce düşürülüyor: dönüş kolonları değiştiğinde
-- Postgres "cannot change return type of existing function" hatası verir.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Rapor fonksiyonlarını önce düşür.
--
-- Postgres, create or replace ile bir fonksiyonun döndürdüğü kolonları
-- değiştirmeye izin vermez ("cannot change return type of existing
-- function"). Bu yüzden betiğin tekrar tekrar çalışabilmesi için
-- fonksiyonları baştan siliyoruz; hemen aşağıda yeniden oluşturuluyorlar.
--
-- İmza yazmak yerine ada göre siliyoruz: veritabanında eski bir sürümden
-- kalma farklı parametreli bir kopya varsa o da temizlensin.
--
-- Trigger fonksiyonlarına (set_updated_at, handle_new_user) dokunulmaz;
-- onlara bağlı trigger'lar var ve dönüş tipleri hiç değişmiyor.
-- ---------------------------------------------------------------------
do $drop_fns$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as imza
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'stand_stock_report', 'stock_daily_sales', 'stock_count_variance',
        'stock_daily_movement', 'payroll', 'cash_summary', 'cash_balance_until'
      )
  loop
    execute 'drop function ' || fn.imza || ' cascade';
  end loop;
end;
$drop_fns$;

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
--   wage_mode = 'kademeli' -> ilk günler düşük yevmiye, sonrası tam ücret
--   wage_mode = 'tam'      -> ilk günden itibaren tam ücret.
--                             Deneyimli işe alımlar ve program kurulmadan
--                             önce çalışmaya başlamış kişiler için.
--   wage_mode = 'odemesiz' -> hiç yevmiye yok.
--                             Ortaklar ve ücretsiz çalışanlar için.
--   daily_wage doluysa son kademede genel tutar yerine o kullanılır.
create table if not exists public.employees (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null,
  phone       text,
  daily_wage  numeric(12,2),
  wage_mode   text not null default 'kademeli'
                check (wage_mode in ('kademeli', 'tam', 'odemesiz')),
  note        text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index if not exists employees_name_uniq on public.employees (lower(full_name));

-- Betiğin önceki sürümünü çalıştırdıysan kolon burada eklenir.
alter table public.employees
  add column if not exists wage_mode text not null default 'kademeli';

alter table public.employees drop constraint if exists employees_wage_mode_check;
alter table public.employees
  add constraint employees_wage_mode_check
  check (wage_mode in ('kademeli', 'tam', 'odemesiz'));

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
-- payroll_settings — maaş kademeleri. Tek satırdır (id her zaman true).
--   ilk tier1_days gün  -> tier1_wage
--   ondan sonrası       -> tier2_wage
--   İlk gün de normal vardiya sayılır, ayrı bir eğitim günü indirimi yok.
--   Çalışana özel ücret girilmişse (employees.daily_wage) son kademede
--   tier2_wage yerine o kullanılır.
--   first_day_wage / first_day_meal / meal_wage kolonları eski kurala aitti;
--   artık okunmuyor, eski kurulumlar bozulmasın diye tabloda bırakıldı.
-- ---------------------------------------------------------------------
create table if not exists public.payroll_settings (
  id              boolean primary key default true check (id),
  first_day_wage  numeric(12,2) not null default 0,
  first_day_meal  numeric(12,2) not null default 0,
  tier1_days      int           not null default 3 check (tier1_days >= 0),
  tier1_wage      numeric(12,2) not null default 1000,
  tier2_wage      numeric(12,2) not null default 1500,
  meal_wage       numeric(12,2) not null default 0,
  updated_at      timestamptz   not null default now()
);

insert into public.payroll_settings (id) values (true) on conflict (id) do nothing;

drop trigger if exists payroll_settings_updated_at on public.payroll_settings;
create trigger payroll_settings_updated_at
  before update on public.payroll_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- employee_bonuses — güne özel prim. Eksi değer kesinti anlamına gelir.
-- ---------------------------------------------------------------------
create table if not exists public.employee_bonuses (
  id           uuid primary key default gen_random_uuid(),
  work_date    date not null,
  employee_id  uuid not null references public.employees(id) on delete cascade,
  amount       numeric(12,2) not null check (amount <> 0),
  note         text,
  created_by   uuid references auth.users(id) default auth.uid(),
  created_at   timestamptz not null default now(),
  unique (work_date, employee_id)
);
create index if not exists employee_bonuses_date_idx on public.employee_bonuses (work_date);
create index if not exists employee_bonuses_employee_idx on public.employee_bonuses (employee_id);

-- ---------------------------------------------------------------------
-- payroll(baslangic, bitis)
--   Aralıktaki her çalışma günü için, o günün kişinin İŞE BAŞLAMASINDAN
--   itibaren kaçıncı günü olduğunu verir. Kademe sayacı seçilen aralıktan
--   değil, kişinin ilk gününden işlemeli — yoksa her ay herkes yeniden
--   "ilk gün" olur. Bu yüzden sıra numarası tüm geçmiş üzerinden
--   hesaplanır, süzme en sonda yapılır.
--
--   Aynı gün iki vardiya çalışılsa da bir gün sayılır; shifts kolonu kaç
--   vardiya olduğunu bilgi olarak taşır.
-- ---------------------------------------------------------------------
create or replace function public.payroll(p_from date, p_to date)
returns table (
  employee_id  uuid,
  full_name    text,
  work_date    date,
  day_index    int,
  shifts       int,
  is_training  boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with gunler as (
    select sa.employee_id,
           sa.work_date,
           count(*)                        as shifts,
           bool_and(sa.kind = 'egitim')    as is_training
    from public.shift_assignments sa
    group by sa.employee_id, sa.work_date
  ),
  sirali as (
    select g.*,
           row_number() over (partition by g.employee_id order by g.work_date) as day_index
    from gunler g
  )
  select s.employee_id, e.full_name, s.work_date,
         s.day_index::int, s.shifts::int, s.is_training
  from sirali s
  join public.employees e on e.id = s.employee_id
  where s.work_date between p_from and p_to
  order by e.full_name, s.work_date;
$$;

-- =====================================================================
-- KASA TABLOLARI — ARTIK KULLANILMIYOR
-- Kasa modülü programdan kaldırıldı (ciro, para çekme, gider, kasa
-- sayımı). Tablolar eski kayıtlar silinmesin diye duruyor; uygulama
-- bunlara hiç dokunmuyor. Geçmiş veriye ihtiyacın kalmazsa Supabase SQL
-- Editor'de tek tek "drop table ... cascade" ile silebilirsin.
-- =====================================================================

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
-- stock_sales / stock_sale_items — GÜNLÜK SATIŞ
--   Asıl günlük veri girişi budur: "bugün 250g'den 5 tane sattık".
--   Stok bundan düşülerek hesaplanır. Sayım (stock_counts) ise ara sıra
--   yapılan fiziki kontroldür; teorik stokla tutmuyorsa fark fire/kayıptır.
-- ---------------------------------------------------------------------
create table if not exists public.stock_sales (
  id          uuid primary key default gen_random_uuid(),
  sale_date   date not null,
  stand_id    uuid not null references public.stands(id) on delete cascade,
  note        text,
  created_by  uuid references auth.users(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (sale_date, stand_id)
);
create index if not exists stock_sales_date_idx on public.stock_sales (sale_date);
create index if not exists stock_sales_stand_idx on public.stock_sales (stand_id);

drop trigger if exists stock_sales_updated_at on public.stock_sales;
create trigger stock_sales_updated_at
  before update on public.stock_sales
  for each row execute function public.set_updated_at();

create table if not exists public.stock_sale_items (
  id          uuid primary key default gen_random_uuid(),
  sale_id     uuid not null references public.stock_sales(id) on delete cascade,
  variant_id  uuid not null references public.product_variants(id) on delete cascade,
  quantity    numeric(12,3) not null default 0 check (quantity >= 0),
  unique (sale_id, variant_id)
);
create index if not exists stock_sale_items_variant_idx on public.stock_sale_items (variant_id);

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
--   Bir standın o tarihteki stok durumu.
--
--   son sayım
--     + gelen transferler − giden transferler
--     − o tarihe kadarki satışlar
--     = teorik stok (on_hand)
--
--   O tarihte fiziki sayım da yapıldıysa variance = sayılan − teorik.
--   Eksi çıkarsa kayıp/fire, artı çıkarsa fazla vardır.
--
--   Transfer ve satışlar "son sayımdan SONRA, bu tarihe kadar" alınır;
--   sayım akşam yapıldığı için o günün satışları da dahildir.
-- ---------------------------------------------------------------------
create or replace function public.stand_stock_report(p_stand_id uuid, p_date date)
returns table (
  variant_id     uuid,
  product_id     uuid,
  product_name   text,
  size_label     text,
  unit           text,
  price          numeric,
  prev_date      date,
  prev_qty       numeric,
  transfer_in    numeric,
  transfer_out   numeric,
  sold_before    numeric,
  sold_today     numeric,
  on_hand_before numeric,
  on_hand        numeric,
  counted_qty    numeric,
  variance       numeric
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
    select sc.id from public.stock_counts sc
    where sc.stand_id = p_stand_id and sc.count_date = p_date
  ),
  prev_items as (
    select i.variant_id, i.quantity
    from public.stock_count_items i join prev on i.count_id = prev.id
  ),
  cur_items as (
    select i.variant_id, i.quantity
    from public.stock_count_items i join cur on i.count_id = cur.id
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
  ),
  sales as (
    select si.variant_id,
           sum(case when s.sale_date < p_date then si.quantity else 0 end) as before_today,
           sum(case when s.sale_date = p_date then si.quantity else 0 end) as on_day
    from public.stock_sales s
    join public.stock_sale_items si on si.sale_id = s.id
    where s.stand_id = p_stand_id
      and s.sale_date > coalesce((select p.count_date from prev p), '-infinity'::date)
      and s.sale_date <= p_date
    group by si.variant_id
  )
  select
    v.id,
    p.id,
    p.name,
    v.size_label,
    v.unit,
    v.price,
    (select pr.count_date from prev pr),
    coalesce(pi.quantity, 0),
    coalesce(m.tin, 0),
    coalesce(m.tout, 0),
    coalesce(sl.before_today, 0),
    coalesce(sl.on_day, 0),
    coalesce(pi.quantity, 0) + coalesce(m.tin, 0) - coalesce(m.tout, 0)
      - coalesce(sl.before_today, 0)                                          as on_hand_before,
    coalesce(pi.quantity, 0) + coalesce(m.tin, 0) - coalesce(m.tout, 0)
      - coalesce(sl.before_today, 0) - coalesce(sl.on_day, 0)                 as on_hand,
    ci.quantity                                                               as counted_qty,
    case when ci.quantity is null then null
         else ci.quantity - (coalesce(pi.quantity, 0) + coalesce(m.tin, 0) - coalesce(m.tout, 0)
                             - coalesce(sl.before_today, 0) - coalesce(sl.on_day, 0))
    end                                                                       as variance
  from public.product_variants v
  join public.products p on p.id = v.product_id
  left join prev_items pi on pi.variant_id = v.id
  left join cur_items  ci on ci.variant_id = v.id
  left join moves      m  on m.variant_id  = v.id
  left join sales      sl on sl.variant_id = v.id
  where v.is_active and p.is_active
  order by p.sort_order, p.name, v.sort_order, v.size_label;
$$;

-- ---------------------------------------------------------------------
-- stock_daily_sales(baslangic, bitis, stand)
--   "Hangi gün hangi standda hangi gramajdan kaç tane satıldı."
--   Doğrudan girilen satış kayıtlarından gelir; iki sayım arasındaki farka
--   dayanmaz, o yüzden her gün sayım yapılmasa da doğrudur.
-- ---------------------------------------------------------------------
create or replace function public.stock_daily_sales(
  p_from date,
  p_to date,
  p_stand_id uuid default null
)
returns table (
  sale_date     date,
  stand_id      uuid,
  stand_name    text,
  variant_id    uuid,
  product_name  text,
  size_label    text,
  unit          text,
  quantity      numeric,
  amount        numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    s.sale_date,
    s.stand_id,
    st.name,
    si.variant_id,
    p.name,
    v.size_label,
    v.unit,
    si.quantity,
    si.quantity * coalesce(v.price, 0)
  from public.stock_sales s
  join public.stock_sale_items si on si.sale_id = s.id
  join public.stands st           on st.id = s.stand_id
  join public.product_variants v  on v.id = si.variant_id
  join public.products p          on p.id = v.product_id
  where s.sale_date between p_from and p_to
    and (p_stand_id is null or s.stand_id = p_stand_id)
    and si.quantity > 0
  order by s.sale_date desc, st.sort_order, st.name, p.sort_order, v.sort_order;
$$;

-- ---------------------------------------------------------------------
-- stock_count_variance(baslangic, bitis, stand)
--   Fiziki sayımların teorik stoktan sapması — fire/kayıp takibi.
--   Eksi değer stokta olması gerekenden az bulunduğunu gösterir.
-- ---------------------------------------------------------------------
create or replace function public.stock_count_variance(
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
  on_hand       numeric,
  counted_qty   numeric,
  variance      numeric,
  variance_amount numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.count_date,
    c.stand_id,
    st.name,
    r.variant_id,
    r.product_name,
    r.size_label,
    r.unit,
    r.on_hand,
    r.counted_qty,
    r.variance,
    r.variance * coalesce(r.price, 0)
  from public.stock_counts c
  join public.stands st on st.id = c.stand_id
  cross join lateral public.stand_stock_report(c.stand_id, c.count_date) r
  where c.count_date between p_from and p_to
    and (p_stand_id is null or c.stand_id = p_stand_id)
    and r.counted_qty is not null
    and r.variance is not null
    and r.variance <> 0
    -- Karşılaştırma tabanı olmadan fire hesaplanamaz: bir standın İLK sayımı
    -- baz oluşturur, sapma değildir. Öncesinde sayım ya da transfer olmalı.
    and (r.prev_date is not null or r.transfer_in <> 0 or r.transfer_out <> 0)
  order by c.count_date desc, st.sort_order, st.name;
$$;

-- ---------------------------------------------------------------------
-- Kasa özet fonksiyonları (cash_summary, cash_balance_until) kaldırıldı.
-- Yukarıdaki drop bloğu bu betik her çalıştığında onları da düşürür.
-- ---------------------------------------------------------------------


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
    'stock_counts', 'stock_count_items', 'stock_transfers', 'stock_transfer_items',
    'payroll_settings', 'employee_bonuses',
    'stock_sales', 'stock_sale_items'
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
