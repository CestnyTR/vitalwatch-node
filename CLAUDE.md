# vitalwatch-node — Çalışma Kuralları

Bu paket **izlenen Node projelerine** kurulur. Hub ayrı repodadır:
[vitalwatch-hub](https://github.com/CestnyTR/vitalwatch-hub) — tam şartname orada `docs/02-spec.md`.

Kardeş paketler: [vitalwatch-laravel](https://github.com/CestnyTR/vitalwatch-laravel) (PHP),
`t.js` (tarayıcı, hub reposunda `resources/sdk/t.js`).

## Dil

Yorumlar ve dokümantasyon Türkçe; **sınıf, fonksiyon ve değişken adları İngilizce** —
yerel değişkenler dahil. Kardeş paketlerle (`cestnytr/vitalwatch-laravel`) aynı kural.

Bu paket kurulurken "yerel değişkenler Türkçe olabilir" diye gevşek bir istisna yazılmıştı;
kaldırıldı. Karışık adlandırma okumayı zorlaştırıyor ve iki paket arasında geçiş yapan
kişiyi yavaşlatıyor.

README ve public API dokümantasyonu Türkçe.

---

## Bu paket public bir repodur

- **Hiçbir sır koda girmez.** Anahtar ve secret ortam değişkeninden okunur.
- Testlerde gerçekçi sağlayıcı öneki taşıyan sahte jeton kullanılmaz — GitHub'ın gizli
  anahtar taraması push'u engeller.
- MIT lisanslı; npm üzerinden dağıtılır.

---

## Kapsam sınırı — bilinçli

**Tarayıcı kodu bu pakete girmez.** `t.js` hub'dan servis edilir ve öyle kalmalıdır:
hosted olması, bir düzeltmenin 5 dakikada tüm sitelere yayılmasını sağlıyor. Aynı kodu
npm'e de koymak iki dağıtım kanalı yaratır ve biri kaçınılmaz olarak geride kalır.

Bu pakete yalnızca **sunucuda çalışan** kod girer: Node, SSR ve framework adaptörleri
(Express, Next, Nuxt/Nitro, Fastify, Koa, Hono, NestJS, SvelteKit, React Router).

Adaptörler framework'ü **içe aktarmaz** — bağımlılık sıfır kalır. Kanca sözleşmesine
dayanır; testler sahte nesneyle, yeni adaptör ayrıca gerçek sürümle uçtan uca denenir.

---

## Bağlayıcı kısıtlar

### Toplanmayacaklar

Yapılandırmayla dahi açılamaz — kodda karşılığı bulunmamalı:

- IP adresi
- User-Agent
- İstek gövdesi / form verisi
- Query string **değerleri** (yalnızca yol saklanır)
- Oturum verisi, çerez
- Ham SQL literal değerleri

### Temizlik desenleri kardeş paketlerle aynı kalır

`src/scrubber.js` içindeki desenler `cestnytr/vitalwatch-laravel` (PHP) ile birebir aynı davranmalıdır.
Ayrışırlarsa aynı hata iki SDK'da farklı maskelenir ve parmak izi bölünür — panelde tek
hata iki ayrı satır olarak görünür.

`t.js` bir istisna taşır: Unicode özellik kaçışı (`\p{L}`) kullanmaz, çünkü desteklemeyen
bir tarayıcıda regex literali ayrıştırma anında patlar ve script hiç çalışmaz. Gerçekçi
girdide davranış aynıdır.

---

## Davranış garantileri — ihlal edilemez

1. **Hata yutulmaz.** Handler zinciri korunur, `throw` engellenmez.
2. **Süreç yönetimine karışılmaz.** `process.exit` çağrılmaz, `uncaughtException`
   dinlenirken uygulamanın kendi kararı bozulmaz.
3. **Kendi hatasını raporlamaz.** Sonsuz döngü riski; tüm SDK kodu `try/catch` ile sarılır.
4. **Kullanıcı isteğini bekletmez.** Gönderim yanıt döndükten sonra, kısa zaman aşımıyla.
5. **Hub erişilemezse sessizce vazgeçilir.**
6. **`VITALWATCH_ENABLED=false` iken hiçbir veri gönderilmez.**

---

## Teknik tercihler

| Konu | Karar |
|---|---|
| Node | `>=18.17` — global `fetch` ve `AbortSignal.timeout` için |
| Modül biçimi | **CommonJS.** ESM projeler `import` ile sorunsuz kullanır; tersi Express tarafında sürtünme yaratırdı |
| Build adımı | **Yok.** Tipler elle yazılır (`types/index.d.ts`) |
| Test | `node:test` — bağımlılık eklemeden |
| Bağımlılık | **Sıfır.** Bu paket 8 projeye kurulacak; her bağımlılık sürüm çakışması riski |
| Sürümleme | Semver, git tag. npm'e yayınlanır |

### Süreç boyunca tekil, istek başına değil

PHP paketinde `Recorder` istek başına tekildir; burada süreç boyunca tekildir. Node'da tek
süreç binlerce isteği karşılar — istek başına durum tutmak bellek sızıntısı olurdu. İstek
bağlamı bu yüzden çağrı anında parametre olarak geçilir, alanda saklanmaz.

Aynı hatanın iki kez raporlanmasını `WeakSet` engeller: hata nesnesi çöp toplandığında
kayıt da düşer.

---

## Sessiz arıza karşıtı

Bu ailenin tekrarlayan hatası **sessizce çalışmama**. Hub geçersiz isteğe de `204` döner
(saldırgana geri bildirim verilmez), bu yüzden gönderen taraf reddedildiğini hiçbir zaman
öğrenemez.

Karşı tedbirler ve neden var oldukları:

- `npx vitalwatch-status` — yereldeki yanlış yapılandırmayı gösterir. Secret'in 64 karakter
  olması ayrıca kontrol edilir: en sık hata eksik kopyalamadır.
- Her olayla `sdk_version` gönderilir — panel hangi projenin eski sürümde kaldığını
  gösterir, güncelleme körlemesine yapılmaz.
- README'deki toplu güncelleme döngüsü `vitalwatch-status` ile biter: güncelleme sonrası
  yapılandırmanın hâlâ geçerli olduğu doğrulanır.
