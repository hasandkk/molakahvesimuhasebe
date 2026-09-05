# ☕ Mola Kahvesi — Stand Yönetim Paneli

Kahve standları için vardiya planlama, stok takibi ve maaş hesabı uygulaması.
React + Vite + TypeScript + Tailwind, arka planda Supabase (Postgres + Auth).

## Ne yapar

| Ekran        | İçerik |
|--------------|--------|
| **Özet**     | Yarınki planın tamamı (hangi standda kim, hangi saatte) ve **gruba atılacak mesajı tek dokunuşla kopyalama** · atama yapılmamış stand uyarısı · satışı girilmemiş standlar |
| **Vardiya**  | **Gün** görünümünde plan yapılır, **Hafta** görünümünde tüm hafta tek ekranda görülür. Standart vardiyalar 08:00–15:30 ve 15:30–23:00; saatler değiştirilebilir. Aynı vardiyada birden fazla kişi çalışabilir, eğitime gelenler ayrı tür olarak yazılır. Saat çakışması uyarı verir. Mesaj stand bazlı veya toplu kopyalanır |
| **Harcama**  | İşletme harcamaları. Girerken **Hasan** ya da **Akın** seçilir, tutar ve serbest açıklama yazılır; ay sonunda kim ne kadar harcamış tek ekranda. PDF olarak da çıkar |
| **Maaş**     | Haftalık ödeme listesi (pazartesi ödemesi), prim ve **ön ödeme (avans)** girişi, ücret kademeleri. PDF olarak imza sütunlu ödeme listesi çıkarır |
| **Stok**     | **Günlük satış** girişi (asıl günlük iş) · **Sayım** ile ara sıra fiziki kontrol ve fire/kayıp tespiti · depodan standa **transfer** |
| **Raporlar** | Üç sekme: **Özet** (stand ve çalışan başına vardiya sayıları) · **Vardiya geçmişi** (gün gün kim hangi standda, hangi saatte; çalışana göre süzülebilir) · **Satış geçmişi** (hangi gün hangi standda ne satıldı + sayım farkları). Her sekme **PDF olarak yazdırılabilir** |
| **Tanımlar** | Stand ve çalışan ekleme, **isim/bilgi düzenleme**, pasifleştirme; çalışan silme (geçmişi varsa uyarır) · kahve çeşidi yönetimi |

Telefonda alt menüde günlük/haftalık işler var (Özet · Vardiya · Stok · Harcama ·
Maaş · Rapor); ayda bir açılan **Tanımlar** başlıktaki dişliye taşındı. Masaüstünde
hepsi kenar menüsünde.

Stand sayısı sabit değil — “Tanımlar” ekranından istediğin kadar stand ekler,
kullanmadığını pasifleştirirsin. Tüm ekranlar aktif standları otomatik takip eder.

### Stok mantığı

Günlük iş **satış girmektir**, stok saymak değil:

```
teorik stok = son fiziki sayım
              + gelen transferler − giden transferler
              − o tarihe kadarki satışlar
```

Her akşam “Günlük satış” sekmesinden o gün kaç sattığını yazarsın; stok
kendiliğinden düşer. Toplam stoğu her gün saymana gerek yok.

**Sayım** ara sıra yapılan fiziki kontroldür:

```
fark = sayılan − teorik stok      (eksi = fire / kayıp / girilmemiş satış)
```

Bir standın ilk sayımı baz oluşturur, sapma sayılmaz — öncesinde
karşılaştıracak bir şey yoktur.

**Programda hiçbir yerde para/ciro hesabı yoktur.** Kampanya ve çoklu satış
olduğu için adet × fiyat gerçek ciroyu vermez. Ürün fiyatı alanı bilgi
amaçlıdır, hiçbir hesaba girmez. (Ciro takibi ayrı bir mobil programda yapılıyor.)

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

### Çakışma kuralı

Aynı kişi aynı gün farklı standlarda çalışabilir — sabah birinde, akşam
diğerinde. Yasak olan **saatlerin çakışması**. Bitişik vardiyalar (12:00'de
biten ve 12:00'de başlayan) çakışma sayılmaz. Çakışan kişi ekleme listesinde
seçilemez ve sebebi yazar; kayıtlı planda çakışma varsa ekranın üstünde
kırmızı uyarı çıkar.

### Silme ve pasifleştirme

Bir **standı** silmek, o standın tüm satış, sayım ve vardiya geçmişini de
siler (foreign key cascade). Bu yüzden stand silme yoktur; kullanılmayan stand
**pasifleştirilir** — ekranlarda görünmez, geçmişi durur.

**Çalışan** silinebilir, ama silmeden önce kaç vardiya ve prim kaydı olduğu
gösterilir. Kayıt varsa uyarı çıkar ve pasifleştirme önerilir; silmek geçmiş
maaş hesaplarını değiştirir. Hiç kaydı olmayan biri (yanlış eklenmiş isim gibi)
uyarısız silinebilir.

### Maaş mantığı

```
ilk N gün (varsayılan 3) -> kademe 1 ücreti (varsayılan 1.000 ₺)
devamı                   -> kademe 2 ücreti (varsayılan 1.500 ₺)
```

İlk gün de normal vardiya sayılır — ayrı bir ücretsiz eğitim günü yoktur.
Yemek ücreti hesaba katılmaz.

Tutarların hepsi “Maaş → Ücret kademeleri” ekranından değiştirilebilir.

Her çalışan için **ücret modeli** seçilir (“Tanımlar → Çalışanlar”):

- **Kademeli** — yukarıdaki sıra uygulanır. Varsayılan ve normal durum.
- **Ödeme yok** — yevmiye 0. Ortaklar ve ücretsiz çalışanlar için.
  Kişi listede görünür ama tutarı sıfırdır; yine de prim yazılabilir.

Eskiden bir de **“ilk günden tam ücret”** modu vardı: program kurulmadan önce
çalışmaya başlamış kişiler kademe sayacında yeniden 1. güne düşmesin diye.
Onların kayıtlı çalışma günü 3'ü geçtiği için kademeli mod zaten tam ücreti
veriyor; mod kaldırıldı. Betik, eski `tam` kayıtlarını kısıt eklenmeden önce
`kademeli`ye çeviriyor.

Bir çalışana özel tutar vermek istersen aynı ekrandaki yevmiye alanını doldur;
o kişi son kademede genel tutar yerine kendi ücretini alır.

Güne özel **prim** yazılabilir; eksi değer kesinti anlamına gelir.

### Ön ödeme (avans)

Çalışan hafta ortasında para isteyip alabiliyor. Bu tutar “Maaş → Ön ödeme
(avans)” bölümüne yazılır ve o dönemin hakedişinden düşülür:

```
ödenecek = yevmiye + prim − avans
```

Avans **verildiği tarihin düştüğü ödeme döneminde** kesilir. Tutar her zaman
pozitif girilir, hesapta eksi olarak işlenir. Prim'den farklı olarak aynı
kişiye aynı gün birden fazla avans yazılabilir — üst üste yazmaz, ayrı kayıt
olur.

**Bilinen sınır:** avans o haftanın hakedişini aşarsa kişinin tutarı eksiye
düşer ve bu fark **kendiliğinden gelecek haftaya devretmez**. Ekran bunu
kırmızı bir uyarıyla söyler; kalan tutarı sonraki dönemde elle avans olarak
yazman gerekir. Otomatik devir, ödemelerin “yapıldı” olarak işaretlenmesini
gerektiriyor; program şu an ödeme durumu tutmuyor.

### Haftalık ödeme

Ödeme her pazartesi yapılır ve **bir önceki pazartesi–pazar** dönemini kapsar.
Maaş sekmesindeki “Haftalık ödeme” görünümü bunu doğrudan gösterir: üstte ödeme
günü ve kapsanan dönem, altta çalışan başına ödenecek tutar ve genel toplam.
Liste tek tuşla metin olarak kopyalanabilir.

Varsayılan olarak **yaklaşan ödeme** açılır — hafta ortasında bakınca içinde
bulunulan hafta (bugün dahil) görünür. “Seçili aralık” sekmesiyle istediğin
tarih aralığı için de hesaplatabilirsin.

İki önemli davranış:

- **Kademe sayacı kişinin işe başladığı ilk günden işler**, seçilen dönemden
  değil. Yoksa her ödeme döneminde herkes yeniden “ilk gün” olurdu.
- **Aynı gün iki vardiya çalışılsa da bir gün sayılır** — ücret günlük.

### Harcama mantığı

Harcamayı yapan **iki ortaktan biridir**: Hasan ya da Akın. İsimler
veritabanında bir check kısıtıyla sabitlenmiş — yanlış isim kaydedilemez.
Üçüncü bir ortak eklemek gerekirse `0001_init.sql` içindeki
`expenses_spender_check` listesine adını yaz, betiği tekrar çalıştır ve
`src/lib/types.ts` içindeki `EXPENSE_SPENDERS` dizisine ekle; veri kaybı olmaz.

Ekran ay ay çalışır, varsayılan içinde bulunulan aydır. Üstte toplam ve kişi
başı tutarlar durur.

Girişte kategori/kalem seçimi **yoktur**; tutar, tarih ve serbest bir açıklama
yazılır. Kişi başı toplamlarda da yüzde payı ya da "kim daha çok harcadı"
karşılaştırması gösterilmez — iki ortak arasında yarış havası yaratıyordu.
Sadece düz tutarlar ve kayıt sayısı görünür.

`expenses.category` kolonu tabloda duruyor ama artık okunmuyor da yazılmıyor
da; önceki sürümde girilmiş kayıtlar silinmesin diye bırakıldı.

### Marka

Renkler ürün ambalajından alındı: gövde rengi **derin bordo** (`brand-700`,
`#6b1f32`), vurgu **altın** (`gold-500`, `#c9a259`). Tailwind teması
`src/index.css` içindeki `@theme` bloğunda.

Logo ambalajdaki kilidi tekrar eder: altın kare çerçeve, içinde geometrik
"MOLA". Tek çizim `src/components/Logo.tsx` ve `public/logo.svg` içinde;
PWA/sekme ikonları (`icon-192`, `icon-512`, `icon-maskable-512`,
`apple-touch-icon`, `favicon-32`) bu çizimden üretildi.

Ambalajdaki dikey tarama dokusu bilerek alınmadı — 32-48 pikselde harfleri
parçalayıp okunmaz hale getiriyor. Altın, beyaz üzerinde metin için yeterli
kontrastı vermediğinden yazıda kullanılmaz; sadece işarette durur.

Menü ikonları tek renk çizgi ikonlar (`src/components/icons.tsx`). Önceden
emoji kullanılıyordu; her işletim sisteminde farklı görünüyor ve markayla
ilgisiz renkler taşıyorlardı.

### PDF raporları

“Raporlar” ve “Maaş” ekranlarındaki **PDF / Yazdır** düğmesi, o an açık olan
raporu A4 düzeninde çıkarır. Menü, filtre ve düğmeler çıktıya karışmaz:
ekrandaki mobil kartlar yerine yazdırmaya özel tablolar basılır.

Çıktı tarayıcının yazdırma penceresinden üretilir — hedef olarak
“PDF olarak kaydet” seçilirse dosya olarak iner. Telefonda da çalışır
(iOS'ta Paylaş → Yazdır, Android'de Chrome → Yazdır → PDF olarak kaydet).
Bu yol seçildiği için Türkçe karakterler sorunsuz çıkar ve uygulamaya ek
bir PDF kütüphanesi yüklenmez.

Maaş ekranının çıktısı bir **ödeme listesidir**: çalışan başına gün sayısı,
yevmiye, prim, ödenecek tutar ve elden imzalatmak için bir **imza sütunu**
içerir. Teknik tarafı `src/components/print.tsx` ve `src/index.css`
içindeki `@media print` bloğunda.

## Kurulum

### 1. Veritabanı

Supabase panelinde **SQL Editor**’ü aç ve sırayla çalıştır:

1. `supabase/migrations/0001_init.sql` — tablolar, fonksiyonlar, RLS politikaları
2. Sonra ikisinden **birini** seç:
   - `supabase/seed.sql` — boş başlangıç: 3 stand ve tek kahve çeşidi
     (Mola Kahvesi, 5 gramajda), başka veri yok
   - `supabase/demo_data.sql` — **deneme verisi**: son 21 günün stok sayımları,
     satışları ve vardiya planları. Uygulamayı dolu görmek için bunu kullan. Tarihler `current_date`'e göre üretildiği için
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

1. **Akşam** — Stok ekranında her stand için o günün satışını gir.
2. **Akşam** — Vardiya ekranında yarının planını yap (“Dünkünü kopyala” çoğu günü tek dokunuşla halleder), sonra Özet ekranından “Gruba atılacak mesajı kopyala”.
3. **Ara ara** — Stok → Sayım ile fiziki stoğu say, fire/kayıp var mı bak.
4. **Pazartesi** — Raporlar → Maaş’ta haftanın ödeme listesini çıkar, istersen PDF olarak yazdır.

## Mobil

Uygulama telefon öncelikli tasarlandı — akşam satış girişi ve vardiya planı
standın başında telefonla yapılıyor.

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
