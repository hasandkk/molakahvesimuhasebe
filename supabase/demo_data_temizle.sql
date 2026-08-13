-- =====================================================================
-- DENEME VERİSİNİ SİL
--
-- demo_data.sql'in oluşturduğu her şeyi kaldırır. Gerçek kullanıma
-- geçmeden önce bunu çalıştır.
--
-- Standlar silinince onlara bağlı ciro, vardiya, sayım ve transfer
-- kayıtları da otomatik silinir (cascade).
--
-- Not: Kahve çeşitleri (Türk Kahvesi, Dibek vb.) ve fiyatları BİLEREK
-- silinmez — muhtemelen bunları gerçekten kullanacaksın. Silmek
-- istersen en alttaki satırların başındaki -- işaretlerini kaldır.
-- =====================================================================

begin;

delete from public.stands
where name in ('Kızılay Standı', 'Tunalı Standı', 'Bahçelievler Standı');

delete from public.employees
where full_name in ('Ahmet Yılmaz', 'Mehmet Demir', 'Elif Kaya',
                    'Burak Şahin', 'Zeynep Aydın', 'Emre Çelik');

delete from public.cash_movements where note like '[demo]%';
delete from public.cash_counts    where note like '[demo]%';

-- Kahve çeşitlerini de silmek istersen:
-- delete from public.products
-- where name in ('Türk Kahvesi', 'Dibek Kahvesi', 'Menengiç Kahvesi',
--                'Osmanlı Kahvesi', 'Filtre Kahve');

commit;
