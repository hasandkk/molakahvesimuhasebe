-- =====================================================================
-- DENEME VERİSİNİ SİL
--
-- demo_data.sql'in oluşturduğu her şeyi kaldırır. Gerçek kullanıma
-- geçmeden önce bunu çalıştır.
--
-- Standlar silinince onlara bağlı ciro, vardiya, sayım ve transfer
-- kayıtları da otomatik silinir (cascade).
--
-- Not: Mola Kahvesi ürünü, gramajları ve fiyatları BİLEREK silinmez —
-- bunları gerçekten kullanacaksın. Silmek istersen en alttaki satırın
-- başındaki -- işaretini kaldır.
-- =====================================================================

begin;

delete from public.stands
where name in ('Kızılay Standı', 'Tunalı Standı', 'Bahçelievler Standı');

delete from public.employees
where full_name in ('Ahmet Yılmaz', 'Mehmet Demir', 'Elif Kaya',
                    'Burak Şahin', 'Zeynep Aydın', 'Emre Çelik');

delete from public.cash_movements where note like '[demo]%';
delete from public.cash_counts    where note like '[demo]%';

-- Ürünü de silmek istersen (gramajları ve fiyatları da gider):
-- delete from public.products where name = 'Mola Kahvesi';

commit;
