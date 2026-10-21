# Değişiklik günlüğü

> **Ad değişikliği:** Paket VitalWatch adıyla yeniden adlandırıldı — npm paketi
> `vitalwatch-node`, teşhis komutu `vitalwatch-status`, ortam değişkenleri
> `VITALWATCH_*`, imza başlıkları `X-VitalWatch-Signature` / `X-VitalWatch-Timestamp`.
> Aşağıdaki geçmiş kayıtlar yeni adlarla yazılmıştır.

Semver. `0.x` sürümlerde **minor sıçraması kırıcı sayılır**; bu yüzden
`npm update` 0.3'ten 0.4'e geçmez ve "güncel" der. Yükseltirken:

```bash
npm install vitalwatch-node@latest
```

---

## 0.5.1

### Düzeltildi

- **Kodsuz kurulumda mount yolu kayboluyordu.** `auto.js` yolu yanıt
  bittiğinde `req.url`'den okuyordu; Express bağlı bir router'a girerken
  `req.url`'den mount yolunu siliyor. `app.use('/api', router)` altındaki
  `/api/urunler` panelde `/urunler` görünüyor, farklı ön eklere bağlı
  router'lar aynı kayda düşüyordu. Yol artık isteğin başında alınıyor
  (`originalUrl` varsa o). Express adaptörü (`vitalwatch.express()`) bundan
  etkilenmiyordu; o zaten `baseUrl` + `originalUrl` kullanıyor.

---

## 0.5.0

### Eklendi

- **Sürüm etiketi kendiliğinden bulunuyor.** `VITALWATCH_RELEASE` neredeyse
  hiçbir projede dolu değildi; hub "bu hata X deploy'undan sonra başladı"
  diyemiyordu. Sıra: `VITALWATCH_RELEASE` > CI/PaaS değişkenleri (`GIT_COMMIT`,
  `GIT_SHA`, `COMMIT_SHA`, `SOURCE_VERSION`, `VERCEL_GIT_COMMIT_SHA`,
  `RENDER_GIT_COMMIT`, `HEROKU_SLUG_COMMIT`, `CI_COMMIT_SHA`) > uygulama
  kökündeki `.git` (HEAD, dal ref'i, `packed-refs`, ayrık HEAD, `gitdir:`
  dosyası). Sha ilk 12 karakter, küçük harf. Deploy `git pull` olduğu için
  `.git` yerinde; süreç yeniden başlayınca yeni sha okunur, başlamazsa eski
  kod çalışıyordur ve eski sha doğrudur. `git` çalıştırılmaz, yalnızca
  kurulumda senkron dosya okuması; fırlatmaz. Kural Laravel ve Python ile
  ortak. `vitalwatch-status` etiketi kaynağıyla gösteriyor.
- **`vitalwatch-status` güncelleme denetimi.** npm'deki son sürümü gösteriyor;
  kurulu sürümden yeniyse `Güncelleme var: npm install
  vitalwatch-node@latest` uyarısı. Çıkış kodunu değiştirmez; npm'e
  ulaşılamazsa `denetlenemedi`. `VITALWATCH_STATUS_OFFLINE=1` atlar. Yalnızca
  teşhis komutunda — çalışma yolunda npm'e istek yok.
- **Ortam adı normalleştiriliyor.** Hub yalnızca production/staging/local
  kabul ediyor ve küme dışını — canlılık dahil — 204 dönüp atıyor.
  `NODE_ENV=development` ya da `prod` ile kurulan proje hiçbir şey
  göndermiyormuş gibi görünüyordu. Takma adlar çevriliyor (`prod`/`live`,
  `stage`/`stg`/`preprod`/`uat`, `dev`/`development`/`test`/`testing`);
  tanınmayan değer olduğu gibi gidiyor ve teşhis komutu hata veriyor.
  Tablo üç pakette aynı.
- **Framework adaptörleri:** Nuxt (modül), Nitro, Fastify, Koa, Hono, NestJS,
  SvelteKit, React Router 7 / Remix.

  Bu framework'ler handler hatasını kendi içinde yakalayıp yanıta çeviriyor;
  kodsuz kurulum yalnızca "HTTP 500" görüyordu, hata sınıfı ve stack
  kayboluyordu. Adaptör hatanın kendisini gönderiyor. 4xx gönderilmiyor.

  Yanıt nesnesine erişen adaptörler (Nuxt/Nitro, Fastify, Koa, Hono-Node,
  NestJS-HTTP) yanıtı işaretliyor; kodsuz kurulum aynı istek için ayrıca
  "HTTP 500" açmıyor. **SvelteKit, React Router / Remix ve Next'te işaret
  konamıyor** (kanca yalnızca web `Request`'i veriyor): kodsuz kurulum da
  yüklüyse tek arıza iki kayıt olur — `exception` ve `http_5xx`.

  Hono yalnızca Node (`@hono/node-server`) ve Bun'da; Workers/edge
  desteklenmiyor (`node:fs`/`node:crypto`, `waitUntil` yok).

  NestJS'te HTTP dışı bağlamlarda (`rpc`, `ws`) `RpcException` /
  `WsException` ve alt sınıfları gönderilmiyor: istemciye dönen iş hatası.

  Durum kodu taşımayan hatayı uygulama kendi işleyicisinde 4xx'e
  çeviriyorsa (Fastify `setErrorHandler`, Nest filter) hata yine gidiyor;
  adaptör bu kararı önceden göremiyor.

  Yol yazımı kodsuz kurulumla aynı: `/oyun/deprem-cantasi` olduğu gibi,
  yalnızca sayı / UUID / uzun hex değişiyor.

  Gerçek sürümlerle uçtan uca denendi: Nuxt 3.21.11, Fastify 5.12, Koa 3.2,
  Hono + @hono/node-server, NestJS. Nuxt denemesi üç kusur yakaladı ve
  üçü de düzeltildi: CommonJS uygulama eklentisini Nuxt sessizce boş
  fonksiyonla değiştiriyordu (ESM kapı eklendi); h3 sarmalayıcısının adı
  olmadığı için her hata `Error` görünüyordu (statik işaretten tanınıyor);
  paket iki derleme çıktısına gömüldüğü için SSR hataları iki kez
  gidiyordu (işaret hata nesnesinde, küresel sembolle).

- **`report(hata, { res })`.** Kendi hata işleyicisini yazan uygulama `res`
  verirse ölçüm aynı istek için "HTTP 500" açmıyor. gyd-backend'de her 5xx
  panelde iki kayıttı: `errorHandler`'ın gönderdiği ve ölçüm
  middleware'inin açtığı. İşaret yalnızca hata gerçekten gönderilecekse
  konuyor (yeni `Reporter#willRecord`): yok sayılan sınıfta ya da her
  istekte fırlatılan tek bir hata nesnesinin ikinci geçişinde "HTTP 500"
  tek iz olarak kalıyor.
- **Tipler:** `nitro.d.ts` / `nuxt.d.ts` (`export =` — `moduleResolution`
  `node16` ve `bundler` ile derlenerek denendi), `ReportContext` (`res`
  yalnızca `report()`'ta), `Reporter#willRecord`.
- **`startHeartbeat` / `stopHeartbeat` tipleri.** 0.4.0'dan beri çalışma
  zamanında vardı, `types/index.d.ts`'te yoktu; TypeScript projesi kendi
  tip dosyasını yazmak zorunda kalıyordu.

### Değişti

- **`vitalwatch.errors()` 4xx göndermiyor.** Diğer adaptörlerle aynı kural.
  Önceden her hata gidiyordu ve kamuya açık API'de doğrulama hataları
  paneli dolduruyordu; gyd-backend middleware'i bu yüzden hiç kullanmamıştı.

### Düzeltildi

- **`VITALWATCH_TIMEOUT=2` gönderimi 2 ms'de kesiyordu.** Laravel ve Python aynı
  adla saniye bekliyor; aynı değeri kopyalayan bir kurulumda hiçbir olay
  ulaşmıyordu — sessizce. Artık 100'ün altı saniye sayılıyor; sonuç
  100–10000 ms aralığına sıkıştırılıyor, geçersiz / sıfır / negatif /
  sonsuz değer 2000 ms'ye dönüyor. Kural bütün paketlerde ortak ve
  `init({ timeout })` için de geçerli.
- **`ignore: ['Ad']` diğer bütün hataları düşürüyordu.** Ad listesindeki
  dizeye `instanceof` uygulanıyor, TypeError fırlıyor ve `recordException`
  vazgeçiyordu: adı tutmayan hiçbir hata gönderilmiyordu. `instanceof`
  artık yalnızca sınıf girdilerine uygulanıyor.
- **`vitalwatch.errors()` `next`'i iki kez çağırabiliyordu.** 4xx dalında
  `next` try'ın içindeydi; senkron fırlatırsa catch yutuyor ve akış ikinci
  `next(hata)`'ya düşüyordu. Artık tek çağrı, try'ın dışında.
- **Maskeleme okunur adları bozuyordu.** Yükleme dosya adları okunur kalıyor. `<ad>-<zaman damgası>-<rastgele>.jpeg`
  biçimindeki adlar panelde `/uploads/discount/[token][card]-752066249.jpeg`
  diye çıkıyordu: zaman damgası kart, uzun ad jeton sanılıyordu.
  
  - **Kart:** yalnızca 2–9 ile başlayan ve Luhn'dan geçen dizi maskelenir;
    milisaniye damgası 1 ile başlıyor. Bilinçli taviz: yanlış yazılmış
    (Luhn'dan geçmeyen) kart numarası ve 1 ile başlayan UATP kartları artık
    maskelenmiyor.
  - **Jeton:** 16+ karakterlik bölünmemiş parça taşıyan ya da harf içeren hex
    dizi (UUID, hash) maskelenir. Tireyle birleşmiş kısa parçalar okunur addır.
    Bilinçli taviz: tire/alt çizgiyle 16 karakterden kısa parçalara bölünmüş
    rastgele anahtarlar (bazı base64url jetonları, `AIza…` biçimli anahtarlar)
    maskelenmeden geçebilir.
  - **Telefon:** önünde rakam varsa eşleşmez. Son on hanesi 5 ile başlayan
    zaman damgası `179[phone]` oluyordu. Başında `+` olmadan yazılan `90`
    ülke kodu (`905321234567`) ayrıca tanınıyor — ilk sürümde bu kural o
    biçimi maskesiz bırakıyordu.
  
  Kurallar hub, `t.js`, Node, Laravel ve Python'da birebir aynı; 28 ortak
  vektörle karşılaştırıldı.
- **Tek arıza iki kayıt oluyordu.** Express'in `errors()` middleware'i hatayı
  gönderiyor, ölçüm middleware'i aynı istek için stack'siz bir "HTTP 500"
  daha açıyordu. Yanıt artık işaretleniyor; ölçüm ve kodsuz kurulum
  işaretli istekte 5xx kaydı açmıyor.
- **ESM'den adlandırılmış içe aktarım çalışmıyordu.** `import {
  nextOnRequestError } from 'vitalwatch-node'` saf Node ESM'de "Named
  export not found" veriyordu: dışa aktarımlar Node'un metinden okuyamadığı
  `key: require(...)` biçimindeydi. Next paketleyicisi bunu gizliyordu.

---

## 0.4.2

### Düzeltildi

- **Express: mount yolu rota desenine dahil edilmiyordu.** `app.use('/api',
  router)` altındaki bir uç `/api/urunler/:id` yerine `/urunler/:id` diye
  raporlanıyordu.

  Sonucu gruplama hatasıydı ve sessizdi: farklı ön eklere bağlı iki router
  aynı kayda düşüyordu. `/api/urunler/:id` ile `/admin/urunler/:id` panelde
  tek satır oluyor, hata sayaçları toplanıyor ve endpoint yüzdelikleri iki
  ayrı ucu birbirine karıştırıyordu.

  Koşul ters kuruluydu: `req.route.path` doluysa kısa devre yapıp tek başına
  dönüyordu; mount yolunu ekleyen dal ancak `route.path` BOŞKEN — yani
  eklenecek bir şey yokken — çalışıyordu.

### Eklendi

- **`src/express.js` ve `src/next.js` için testler.** İki dosya da müşteri
  projelerine kuruluyordu ve hiçbir testleri yoktu; yukarıdaki kusur o
  boşluk kapatılırken çıktı.

  22 test: rota deseni, mount yolu, query string temizliği (M3), 5xx
  işaretlemesi, istemci kopmasında ölçüm yazılmaması, hatanın yutulmaması,
  ve raporlayıcı patladığında isteğin etkilenmemesi. Dört mutasyonun dördü
  de yakalanıyor.

---

## 0.4.1

### Eklendi

- **`vitalwatch-status --vitalwatch`** — bağlantıyı panele hata düşürmeden sınar.

  `--test` gerçek bir istisna gönderiyor ve tek bir kurulumu doğrularken
  doğru: taşıma ile temizlik birlikte sınanmış oluyor. Ama onlarca kurulumu
  gezen bir güncelleme döngüsünde panele onlarca sahte hata bırakır —
  izleme aracının kendi gürültüsünü üretmesi.

  `--vitalwatch` olay taşımıyor; kabul edildiğinde projenin bağlantı durumunu
  tazeliyor. HTTP 204 hâlâ kabul kanıtı değil (uç geçersiz imzaya da 204
  döner) ama kabulün gerçek kanıtı artık panelde: bağlantı "Bağlı" olur.

---

## 0.4.0

**Hub gereksinimi:** Bu sürümün canlılık nabzını hub'ın tanıması için
`vw_projects` tablosundaki canlılık kolonlarının göçü uygulanmış
olmalı. Uygulanmadan yükseltmek zarar vermez — canlılık isteği kabul edilir,
yalnızca kaydedilmez.

### Eklendi

- **Canlılık nabzı.** Sekiz saatte bir olay taşımayan bir istek gönderilir
  (`{"events": []}`). Hub bir kurulumun çalıştığını yalnızca gelen hatalardan
  anlıyordu; hatasız çalışan uygulama "kurulum bozuk" görünüyordu. Kanıt artık
  isteğin kendisi.

  Aralık, hub'ın 24 saatlik sessizlik eşiğinin üçte biri: tek bir kaçırılan
  istek — deploy, yeniden başlatma — kurulumu bozuk göstermesin.

  `hookProcess()` ile kendiliğinden başlar. Elle yönetim için `startHeartbeat`
  ve `stopHeartbeat` dışa açıldı. Zamanlayıcı `unref` edilmiştir; kısa ömürlü
  betikleri ayakta tutmaz.

- **Worker thread ve `fork()` çökmeleri.** `hookProcess()` yalnızca ana
  thread'i kancalıyordu; worker içinde patlayan hata hiçbir iz bırakmıyordu.
  Yakalanmamış hatalar ve sıfır olmayan çıkış kodları raporlanıyor.

  `spawn`/`exec` bilinçli olarak kapsam dışı: dış komutlarda sıfır olmayan
  çıkış kodu rutindir ve hata saymak paneli anlamsız kayıtlarla doldururdu.

### Düzeltildi

- `npm test` Node 24'te hiç çalışmıyordu: `node --test test/` dizini modül
  sanıp hata veriyordu. 33 test görünmez durumdaydı.

---

## 0.3.0

- Gönderim sonucu döndürülüyor (`{sent, status, error}`); `vitalwatch-status --test`
  artık gerçek sonucu okuyor, koşulsuz başarı yazmıyor.
- Tanımlayıcılar İngilizceye çevrildi.

## 0.2.1

- E-posta maskeleme deseni yollardaki eğik çizgileri yutuyordu.

## 0.2.0

- Express middleware, Next `onRequestError` kancası.

## 0.1.0

- İlk sürüm.
