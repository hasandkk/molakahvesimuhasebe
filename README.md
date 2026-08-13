# ☕ Mola Kahvesi — Stand Yönetim Paneli

Kahve standları için vardiya planlama, kasa/muhasebe ve stok sayımı uygulaması.
React + Vite + TypeScript + Tailwind, arka planda Supabase (Postgres + Auth).

## Ne yapar

| Ekran        | İçerik |
|--------------|--------|
| **Özet**     | Bugünkü ciro, aylık ciro, kasadaki nakit, yarınki vardiya durumu, ciro/sayım girilmemiş standlar |
| **Vardiya**  | Gün seç → her standa çalışan ata → gruba atılacak mesajı tek tuşla kopyala. Standart vardiyalar 08:00–15:30 ve 15:30–23:00; saatler her atama için tek tek değiştirilebilir. Aynı vardiyada birden fazla kişi çalışabilir. Eğitime gelenler ayrı tür olarak yazılır, saat girmek zorunlu değildir. “Bir önceki günü kopyala” kısayolu var |
| **Kasa**     | Stand bazlı gün sonu nakit/POS girişi · para çekme, gider, kasaya giriş, bankaya yatırma hareketleri · fiziki kasa sayımı ve açık/fazla tespiti |
| **Stok**     | Akşam sayımı (100g/250g/500g/1kg/dökme) · depodan standa mal transferi · beklenen–sayılan farkı ve tahmini satış tutarı |
| **Raporlar** | Tarih aralığında stand bazlı ciro, kim ne kadar çekti, gider kalemleri, çalışan başına vardiya sayısı |
| **Tanımlar** | Stand, çalışan ve kahve çeşidi/fiyat yönetimi |

Stand sayısı sabit değil — “Tanımlar” ekranından istediğin kadar stand ekler,
kullanmadığını pasifleştirirsin. Tüm ekranlar aktif standları otomatik takip eder.

### Stok mantığı

```
beklenen stok = bir önceki sayım + aradaki giren transferler − çıkan transferler
eksilen       = beklenen − bu akşamki sayım        (normalde satılan miktar)
tahmini ciro  = Σ (eksilen × ürün fiyatı)
```

“Eksilen” eksi çıkıyorsa girilmemiş bir transfer ya da sayım hatası vardır.
Tahmini ciroyu o günün gerçek nakit+POS toplamıyla karşılaştırarak açığı görebilirsin.

### Vardiya mantığı

Bir atama ya **vardiya** ya da **eğitim** olur:

- **Vardiya** — normal çalışan, saatleri bellidir. Aynı standın aynı vardiyasına
  istediğin kadar kişi yazabilirsin. Aynı kişi sabah bir standda, akşam başka
  standda çalışabilir.
- **Eğitim** — vardiyadaki birinin yanına gelen kişi. Tam vardiya durmadığı için
  saat girmek zorunlu değil; istersen saat de verebilirsin. Aynı anda birden
  fazla kişi eğitimde olabilir.

Eğitim kayıtları vardiya sayılmaz: bir standda sadece eğitim varsa Özet ekranı
o standı hâlâ “atama yok” diye uyarır, Raporlar da vardiya ile eğitimi ayrı sayar.

### Kasa mantığı

```
kasadaki nakit = Σ nakit ciro − çekimler − giderler − bankaya yatanlar + kasaya girişler
```

POS tutarları doğrudan bankaya geçtiği için nakit bakiyeye dahil edilmez, ayrı takip edilir.
“Kasa sayımı” ekranında saydığın parayı girersin; sistem olması gerekenle karşılaştırıp
açık/fazla tutarını hesaplar ve kaydeder.

## Kurulum

### 1. Veritabanı

Supabase panelinde **SQL Editor**’ü aç ve sırayla çalıştır:

1. `supabase/migrations/0001_init.sql` — tablolar, fonksiyonlar, RLS politikaları
2. Sonra ikisinden **birini** seç:
   - `supabase/seed.sql` — boş başlangıç: 3 stand ve tek kahve çeşidi
     (Mola Kahvesi, 5 gramajda), başka veri yok
   - `supabase/demo_data.sql` — **deneme verisi**: son 21 günün stok sayımları,
     ciroları, vardiya planları, para hareketleri ve kasa sayımları. Uygulamayı
     dolu görmek için bunu kullan. Tarihler `current_date`'e göre üretildiği için
     "bugün" ve "yarın" ekranları hep dolu gelir.

Deneme verisini sonradan silmek için: `supabase/demo_data_temizle.sql`

**Gerçek kullanıma geçerken:** `supabase/gercek_veri.sql` her şeyi sıfırlayıp
gerçek standları (Feneryolu, Kelkit Vadisi, Ziyade Opet), çalışanları ve açılış
stok sayımını yükler. Bundan sonra `demo_data.sql` çalıştırılmamalı.

### 2. Kullanıcılar

Uygulamada kayıt ekranı **yoktur**; hesaplar panelden açılır.

1. **Authentication → Users → Add user** ile kendine ve ortağına birer hesap aç
   (e-posta + şifre, “Auto Confirm User” işaretli).
2. **Authentication → Sign In / Providers → Allow new users to sign up** seçeneğini **kapat**.
   Böylece dışarıdan kimse kayıt olup verilere erişemez.

RLS politikaları “giriş yapmış her kullanıcı her şeye erişir” şeklindedir; güvenlik
kayıt olmanın kapalı olmasına dayanır, bu yüzden 2. adım önemlidir.

### 3. Uygulama

```bash
cp .env.example .env      # Supabase URL + anon key'i gir
npm install
npm run dev               # http://localhost:5173
```

`VITE_SUPABASE_ANON_KEY` değerini Supabase’de **Project Settings → API → anon public**
alanından alırsın. Anon key gizli değildir, tarayıcıya gitmesi normaldir; asıl koruma RLS’tedir.
**service_role** anahtarını asla bu dosyaya koyma.

### 4. Yayına alma

Vercel veya Netlify’a bağlaman yeterli:

- Build komutu: `npm run build`, çıktı klasörü: `dist`
- Ortam değişkenleri: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- SPA yönlendirmesi için `vercel.json` ve `public/_redirects` hazır

## Claude Code ile geliştirme

Depoda Supabase MCP sunucusu proje düzeyinde tanımlı (`.mcp.json`) ve Supabase'in
resmî agent skill'leri kurulu (`.agents/skills/`, `.claude/skills/` altından sembolik
bağlantılı). Depoyu klonlayıp Claude Code'u açtığında ikisi de hazır gelir; tek yapman
gereken MCP sunucusunda kimlik doğrulaması:

```bash
claude /mcp      # supabase sunucusunu seç → Authenticate
```

Bunu normal bir terminalde çalıştır (IDE eklentisi içinde değil), çünkü tarayıcıda
OAuth akışı açılıyor. Kimlik doğrulandıktan sonra Claude Code migration çalıştırma,
sorgu atma ve log inceleme işlerini doğrudan yapabilir.

Skill'leri güncellemek için: `npx skills add supabase/agent-skills`

## Günlük kullanım akışı

1. **Akşam** — Stok ekranında her stand için sayımı gir.
2. **Akşam** — Kasa ekranında her standın nakit ve POS cirosunu gir.
3. **Akşam** — Vardiya ekranında vardiyayı (sabah/akşam/özel saat) seçip yarının planını yap, “Metni kopyala” ile gruba at.
4. **Para aldığında** — Kasa → Para hareketleri’ne kimin ne kadar aldığını yaz.
5. **Ara ara** — Kasa → Kasa sayımı ile fiziki parayı say, açık var mı bak.

## Mobil

Uygulama telefon öncelikli tasarlandı — akşam sayımı ve ciro girişi standın
başında telefonla yapılıyor.

- Form alanları 16px: iOS bundan küçük yazı tipli bir alana odaklanınca sayfayı
  otomatik yakınlaştırıyor, bu engellendi.
- Sayım ve rapor tabloları dar ekranda karta dönüşüyor; hiçbir sayfa yana kaymıyor.
- Kaydet düğmeleri mobilde ekranın altına yapışıyor, uzun listede başa dönmek gerekmiyor.
- Dokunma hedefleri en az 36-44px.
- Ana ekrana eklenebilir (manifest + simgeler): tarayıcı çubuğu olmadan uygulama gibi açılır.

Chromium ile 390×844 (iPhone 12) ölçüsünde doğrulandı: yatay taşma yok,
form alanları 16px, düğmeler 44px, konsol hatası yok.

## Hız

- Sayfalar ayrı paketlere bölündü (`React.lazy`), kütüphaneler `vendor` ve
  `supabase` paketlerinde. Uygulama kodu değiştiğinde tarayıcı sadece ~5 KB
  yeniden indiriyor, 145 KB değil.
- Menüdeki sayfalar tarayıcı boşa düştüğünde önceden indiriliyor; geçişler beklemesiz.
- Stand ve çalışan listesi gibi nadiren değişen veriler 60 saniye bellekte
  tutuluyor (`src/lib/refData.ts`), her sayfa geçişinde yeniden çekilmiyor.
  Tanımlar ekranı bir değişiklik yaptığında önbellek düşürülüyor.
- Stok ekranı açılışta iki tur istek atıyordu, tek tura indirildi.

## Komutlar

```bash
npm run dev        # geliştirme sunucusu
npm run build      # tip kontrolü + üretim derlemesi
npm run typecheck  # sadece tip kontrolü
npm run preview    # derlenmiş sürümü yerelde çalıştır
```

## Yapı

```
src/
  components/   Layout (menü) ve ortak arayüz parçaları
  lib/          Supabase istemcisi, auth, tipler, tarih/para yardımcıları
  pages/        Dashboard, Shifts, Cash, Stock, Reports, Settings, Login
supabase/
  migrations/            0001_init.sql — şema, fonksiyonlar, RLS
  seed.sql               boş başlangıç verisi
  demo_data.sql          denemek için 21 günlük gerçekçi veri
  demo_data_temizle.sql  deneme verisini geri alır
  gercek_veri.sql        her şeyi sıfırlar, gerçek standları/çalışanları/stoğu yükler
```
