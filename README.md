# ☕ Mola Kahvesi — Stand Yönetim Paneli

Kahve standları için vardiya planlama, kasa/muhasebe ve stok sayımı uygulaması.
React + Vite + TypeScript + Tailwind, arka planda Supabase (Postgres + Auth).

## Ne yapar

| Ekran        | İçerik |
|--------------|--------|
| **Özet**     | Bugünkü ciro, aylık ciro, kasadaki nakit, yarınki vardiya durumu, ciro/sayım girilmemiş standlar |
| **Vardiya**  | Gün seç → her standa çalışan ata → gruba atılacak mesajı tek tuşla kopyala. “Bir önceki günü kopyala” kısayolu var |
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
   - `supabase/seed.sql` — boş başlangıç: 3 stand ve 5 kahve çeşidi, başka veri yok
   - `supabase/demo_data.sql` — **deneme verisi**: son 21 günün stok sayımları,
     ciroları, vardiya planları, para hareketleri ve kasa sayımları. Uygulamayı
     dolu görmek için bunu kullan. Tarihler `current_date`'e göre üretildiği için
     "bugün" ve "yarın" ekranları hep dolu gelir.

Deneme verisini sonradan silmek için: `supabase/demo_data_temizle.sql`

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
3. **Akşam** — Vardiya ekranında yarının planını yap, “Metni kopyala” ile gruba at.
4. **Para aldığında** — Kasa → Para hareketleri’ne kimin ne kadar aldığını yaz.
5. **Ara ara** — Kasa → Kasa sayımı ile fiziki parayı say, açık var mı bak.

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
  migrations/   0001_init.sql — şema, fonksiyonlar, RLS
  seed.sql      başlangıç verisi
```
