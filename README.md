# vitalwatch-node

[VitalWatch Hub](https://github.com/CestnyTR/vitalwatch-hub) için Node.js raporlayıcı: sunucu
hataları, SSR hataları, yavaş istekler.

Bağımlılık yok. Build adımı yok. Node 18.17+.

---

## Kapsam — ve neden bu kadar dar

Bu paket **yalnızca sunucu tarafını** kapsar. Tarayıcı hataları hub'dan servis edilen
`t.js` ile toplanır ve o dosya bilinçli olarak npm'e taşınmadı:

| | Tarayıcı (`t.js`) | Node (bu paket) |
|---|---|---|
| Dağıtım | Hub'dan servis edilir | npm |
| Güncelleme | **5 dakikada tüm sitelere yayılır**, kimse deploy etmez | Her projede `npm update` |
| Neden | Merkezî güncelleme, paket ergonomisinden değerli | Sunucuda script etiketi çalışmaz — hosted seçenek yok |

Node tarafında paket **zorunlu**, ama kopyalanan bir dosya yerine paket olması da bilinçli:
kopya dosyalar güncellenmez ve bu **sessizce** olur. Bu projede tam olarak öyle bir hata
yaşandı — süre ölçümündeki bir kusur ve mesajdan oturum kimliği sızması, ancak paket
güncellenebildiği için tüm projelere ulaştı.

---

## Kurulum

```bash
npm install vitalwatch-node
```

`.env` dosyasına — Laravel paketiyle aynı değişken isimleri:

```env
VITALWATCH_ENABLED=true
VITALWATCH_URL=https://vitalwatch.example.com
VITALWATCH_KEY=proje-anahtari
VITALWATCH_SECRET=<panelden alınan 64 karakterlik secret>
VITALWATCH_ENV=production
```

### Kurulumu doğrulayın

```bash
npx vitalwatch-status
```

Bu adım atlanmamalı. Paketin en pahalı arıza biçimi sessiz çalışmamadır: secret eksik
kopyalanmışsa hiçbir şey patlamaz, hiçbir log düşmez — hub geçersiz imzaya da `204` döner.
Kurulum aylarca çalışmıyor olabilir ve o sessizlik "sorun yok" sanılır.

```bash
npx vitalwatch-status --test         # gerçek bir sınama olayı — panelde hata olarak görünür
npx vitalwatch-status --vitalwatch   # yalnızca canlılık isteği — panele hata düşürmez
```

`--test` tek bir kurulumu doğrularken doğru seçim: taşıma ile temizlik birlikte sınanmış
olur ve olay panelde gözle görülür. **Onlarca kurulumu gezen bir güncelleme döngüsünde ise
`--vitalwatch` kullanılır** — `--test` orada panele onlarca sahte hata bırakır, yani izleme
aracı kendi gürültüsünü üretir.

Verinin gerçekten ulaştığı yalnızca **hub panelinden** doğrulanır: proje satırındaki
bağlantı durumu `Bağlı` görünmelidir. Komut bunu kendi başına söyleyemez, çünkü hub
geçerli ile geçersiz imzayı dışarıya aynı yanıtla karşılar.

Komut ayrıca şunları gösterir:

- **Sürüm etiketi** ve nereden bulunduğu (bkz. [Sürüm etiketi](#sürüm-etiketi)).
- **Güncel sürüm:** npm'deki son sürüm (`registry.npmjs.org`, 2 saniye zaman aşımı).
  Kurulu sürümden yeniyse `Güncelleme var: npm install vitalwatch-node@latest`
  uyarısı basılır. Bu bir uyarıdır, komutun çıkış kodunu değiştirmez; npm'e
  ulaşılamazsa `denetlenemedi` yazar, o da başarısızlık sayılmaz.
  `VITALWATCH_STATUS_OFFLINE=1` denetimi tamamen atlar. Denetim **yalnızca bu komutta**
  yapılır — izlenen uygulamanın çalışma yolunda npm'e hiçbir istek gitmez.

---

## Hızlı kurulum reçetesi

Bu bölüm bilerek adım adım ve eksiksiz yazıldı: bir yapay zekâ asistanına ya da ekipten
birine olduğu gibi verilebilir. Sıra önemlidir.

**Ön koşul:** VitalWatch panelinde proje açılmış olmalı; anahtar ve secret oradan gelir.
Tarayıcı tarafı da kurulacaksa projeye **origin** eklenmesi zorunludur — tanımsız
origin'den gelen olaylar sessizce reddedilir.

```bash
# 1. Paketi kur
npm install vitalwatch-node
```

```env
# 2. .env — proje kökünde. Paket bu dosyayı kendisi okur; framework'ün
#    yüklemesini beklemez (ön yükleme sırasında henüz yüklenmemiş olur).
#    Değişken adlarına NEXT_PUBLIC_ / NUXT_PUBLIC_ ÖNEKİ KOYMAYIN —
#    o önek değeri tarayıcı paketine gömer ve secret internete çıkar.
VITALWATCH_ENABLED=true
VITALWATCH_URL=https://vitalwatch.example.com
VITALWATCH_KEY=proje-anahtari
VITALWATCH_SECRET=64-karakterlik-secret
VITALWATCH_ENV=production
```

```js
// 3. Süreci başlatan yere tek satır. PM2 kullanılıyorsa ecosystem dosyasına:
module.exports = {
    apps: [{
        name: 'uygulamam',
        script: 'server.js',
        env: {
            NODE_OPTIONS: '--require vitalwatch-node/auto',
        },
    }],
};
```

```bash
# 4. Yeniden başlat — --update-env ŞART.
#    Onsuz PM2 eski ortamı korur, NODE_OPTIONS süreçte görünmez ve kurulum
#    sessizce çalışmaz.
pm2 restart uygulamam --update-env

# 5. Doğrula
npx vitalwatch-status
npx vitalwatch-status --test
```

Son adım hub'a bir sınama olayı gönderir. **Panelden doğrulayın:** proje satırındaki
bağlantı durumu `Bağlı` görünmelidir. Komut bunu kendi başına söyleyemez — hub geçerli ile
geçersiz imzayı dışarıya aynı yanıtla karşılar.

### Neye dokunulur, neye dokunulmaz

| | Nereye |
|---|---|
| Paket | `package.json` (npm install) |
| Ayarlar | `.env` |
| Yükleme | Süreci başlatan yer — PM2 config, systemd unit ya da start komutu |
| **Uygulama kaynağı** | **Dokunulmaz** |

`NODE_OPTIONS` uygulamanın kendi `.env` dosyasına yazılamaz: Node onu süreç başlarken
okur, `.env` ise uygulama çalışmaya başladıktan sonra okunur. Node'un kısıtı, tasarım
tercihi değil. **Yalnızca bu satır** için geçerli — `VITALWATCH_*` değişkenleri `.env`'de
durabilir, paket o dosyayı kendisi okur.

Okuma önceliği: `process.env` > `.env.<NODE_ENV>` > `.env.local` > `.env`. Süreç ortamı
her zaman kazanır; dosya yalnızca boşluğu doldurur. Yalnızca `VITALWATCH_` ile başlayan
anahtarlar okunur.

### Bu reçetenin kapsamadıkları

- **Next'in kendi içinde yakaladığı SSR render hataları.** `instrumentation.js` gerekir
  (aşağıda).
- **Tarayıcı hataları.** Onlar hub'dan servis edilen `t.js` ile toplanır; HTML'e bir
  `<script>` etiketi eklenmesi gerekir. Paket bunu otomatik enjekte etmez ve etmemeli:
  yanıt gövdesini değiştirmek `Content-Length`'i bozar, streaming SSR'ı kırar ve
  sıkıştırmayla çakışır.
- **Framework'ün kendi içinde yakaladığı hataların sınıfı ve stack'i.** Kodsuz kurulum
  yalnızca "HTTP 500" görür; hatanın kendisi için [framework adaptörü](#framework-adaptörleri)
  eklenir — çoğunda tek satır.

---

## Kullanım

### Kodsuz kurulum (önerilen)

Uygulama kaynağına **tek satır eklemeden**: Node'a paketi uygulamadan önce yüklemesini
söylersiniz, kancalar orada kurulur.

```
NODE_OPTIONS=--require vitalwatch-node/auto
```

PM2 ile:

```js
// ecosystem.config.cjs
module.exports = {
    apps: [{
        name: 'uygulamam',
        script: 'server.js',
        env: {
            NODE_OPTIONS: '--require vitalwatch-node/auto',
        },
    }],
};
```

Bu satır **uygulamanın kendi `.env` dosyasına yazılamaz**: `NODE_OPTIONS` Node başlarken
okunur, uygulama `.env`'i ise çalışmaya başladıktan sonra. Node'un kısıtı, tasarım tercihi
değil. Geri kalan her ayar (anahtar, secret, eşikler, açma/kapama) `.env`'den okunur.

Kapsadıkları: yakalanmamış hatalar, işlenmemiş promise reddi, 5xx yanıtlar, yavaş istekler.
`node:http` üzerinden geçen her şey — Next, Express, Nuxt/Nitro, Fastify, düz Node.

Yol ham adresten yazılır: yalnızca kimlik gibi görünen parçalar değişir (`/urunler/1042` →
`/urunler/{id}`, UUID → `{uuid}`, uzun hex → `{hash}`), okunur parçalar olduğu gibi kalır
(`/oyun/deprem-cantasi`) — hangi sayfanın bozulduğu panelde görünsün.

İki taviz var:

- **Framework'ün yakaladığı hatada yalnızca durum kodu görünür.** Nuxt, Fastify, Nest
  gibi framework'ler hatayı kendileri yakalayıp 500'e çeviriyor; `node:http` katmanına
  hatanın kendisi ulaşmıyor. Sınıf ve stack için [framework adaptörü](#framework-adaptörleri)
  eklenir.
- **Next'in `onRequestError` kancası kurulmaz.** SSR render hatalarının bir kısmı Next
  tarafından yakalanıp `node:http` katmanına ulaşmaz; onlar için aşağıdaki
  `instrumentation.js` gerekir.

### Next.js (SSR)

SSR hataları tarayıcıya hiç ulaşmaz — `t.js` de error boundary de göremez. Bu kanca
olmadan SSR katmanı tamamen kör kalır.

```js
// instrumentation.js  (proje kökü)
export async function register() {
    const { hookProcess } = await import('vitalwatch-node');
    hookProcess();
}

// Next 15+
export { nextOnRequestError as onRequestError } from 'vitalwatch-node';
```

Next 14'te `onRequestError` yoktur; orada yalnızca `register()` çalışır ve yakalanmamış
hatalar toplanır.

### Express

```js
const { express: vitalwatch } = require('vitalwatch-node');

app.use(vitalwatch());          // rotalardan ÖNCE — süre ölçümü için
// ... rotalar ...
app.use(vitalwatch.errors());   // hata middleware'i EN SONA
```

`vitalwatch.errors()` hatayı **yutmaz**, `next(hata)` ile zincire devreder; uygulamanın kendi
hata sayfası çalışmaya devam eder.

4xx taşıyan hata (`status` / `statusCode` 400–499) gönderilmez — doğrulama ve bulunamadı
hataları arıza değil. Durum kodu taşımayan hata sunucu hatası sayılır ve gönderilir.

### Framework adaptörleri

Kodsuz kurulumun **üstüne** eklenir. Framework'ün kendi içinde yakaladığı hatayı sınıf ve
stack'iyle gönderir. 4xx (404, doğrulama, yetki) gönderilmez.

**Tek arıza, tek kayıt** — yalnızca yanıt nesnesine erişen adaptörlerde: Express
`errors()`, Nuxt/Nitro, Fastify, Koa, Hono (Node) ve NestJS (HTTP). Bunlar yanıtı
işaretler, kodsuz kurulum aynı istek için ayrıca "HTTP 500" açmaz.

**SvelteKit, React Router / Remix ve Next'te iki kayıt olur.** Bu kancalar yalnızca web
`Request`'ini veriyor, Node yanıt nesnesine erişim yok; işaret konamıyor. Kodsuz kurulum da
yüklüyse tek arıza panelde iki satır açar: stack'li `exception` ve stack'siz `http_5xx`.
Kodsuz kurulum yüklü değilse yalnızca `exception` gider.

Durum kodu hatanın **üstünden** okunur (`status`, `statusCode`, Nest'te `getStatus()`).
Durum kodu taşımayan bir hatayı uygulama kendi işleyicisinde 4xx'e çeviriyorsa
(Fastify `setErrorHandler`, Nest exception filter, Express'te kendi hata middleware'i) o
hata **yine gönderilir** — adaptör işleyicinin vereceği kararı önceden bilemez. Göndermek
istenmiyorsa hataya kodu koyun (`statusCode: 422`) ya da sınıfı `ignore`'a ekleyin.

**Nuxt 3/4** — tek satır, dosya eklemeye gerek yok:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
    modules: ['vitalwatch-node/nuxt'],
});
```

Sunucu uçları (`server/api`), SSR sayfa hataları ve `<NuxtErrorBoundary>` içinde kalan
render hataları. Modül yalnızca sunucu paketine girer; tarayıcı hataları `t.js`'in işi.

**Düz Nitro** (Analog, SolidStart dahil):

```ts
// server/plugins/vitalwatch.ts
import vitalwatch from 'vitalwatch-node/nitro';
export default defineNitroPlugin(vitalwatch);
```

**Fastify:**

```js
const { fastify: vitalwatch } = require('vitalwatch-node');
app.register(vitalwatch);   // rotalardan önce; iç içe kapsamlar da görülür
```

**Koa:**

```js
const { koa: vitalwatch } = require('vitalwatch-node');
vitalwatch(app);
```

Koa'nın kendi hata günlüğü korunur: Koa onu yalnızca kimse `error` dinlemiyorsa kuruyor,
dinleyici tek başına bizsek varsayılan elle çağrılır.

**Hono:**

```js
import { hono as vitalwatch } from 'vitalwatch-node';
app.use(vitalwatch());
```

`app.onError` kullanılmadı — tek işleyici tutuyor ve uygulamanınkini ezerdi.

Desteklenen çalışma ortamları: **Node (`@hono/node-server`) ve Bun.** Cloudflare Workers ve
diğer edge ortamları desteklenmez: paket `node:fs` ve `node:crypto` kullanıyor (Workers'ta
`nodejs_compat` olmadan yüklenemez) ve gönderim `waitUntil` ile beklenmiyor — yanıt
döndükten sonra çalışma ortamı gönderimi kesebilir, olay sessizce kaybolur. Bun'da
`node:http` kullanılmadığı için kodsuz kurulum ölçüm yapmaz; adaptör yine hatayı gönderir.

**NestJS:**

```ts
import { nest as vitalwatch } from 'vitalwatch-node';
app.useGlobalInterceptors(vitalwatch());
```

Filter değil interceptor: hatayı görür ve aynen yeniden fırlatır, uygulamanın kendi
exception filter'larına ve hata yanıtına dokunmaz.

HTTP dışı bağlamlar: mikroservis (`rpc`) ve WebSocket (`ws`) işleyicilerinde
`RpcException` / `WsException` ve alt sınıfları gönderilmez — istemciye dönen iş hatası,
arıza değil; durum kodu taşımadıkları için ada bakılıyor. Diğer hatalar (TypeError,
veritabanı) rota olmadan gönderilir. GraphQL'de 4xx `HttpException`'lar durum kodundan
elenir, geri kalanı gider. Guard ve middleware'de fırlatılan hatalar interceptor'a
ulaşmaz.

**SvelteKit** — `src/hooks.server.js`:

```js
import { sveltekit as vitalwatch } from 'vitalwatch-node';
export const handleError = vitalwatch();
// mevcut işleyici varsa sarılır, dönüşü korunur:
// export const handleError = vitalwatch(({ error }) => ({ message: 'Hata' }));
```

**React Router 7 / Remix** — `app/entry.server.tsx`:

```ts
import { reactRouter as vitalwatch } from 'vitalwatch-node';
export const handleError = vitalwatch();
```

Ziyaretçi sayfadan ayrılınca iptal edilen istekler gönderilmez.

**Express** için yukarıdaki `vitalwatch.errors()` aynı işi yapar; **Next** için
`instrumentation.js`.

### Elle bildirim

```js
const { report } = require('vitalwatch-node');

try {
    await riskliIs();
} catch (hata) {
    report(hata);          // await gerekmez, arka planda tamamlanır
    throw hata;            // hata YUTULMAZ
}
```

Kendi Express hata işleyicisinden bildiren uygulama `res`'i de verir:

```js
app.use((err, req, res, next) => {
    if (durum >= 500) report(err, { route, method: req.method, res });
    // ...
});
```

`res` verilmezse ölçüm middleware'i aynı istek için ayrıca stack'siz bir "HTTP 500"
açar ve tek arıza panelde iki kayıt olur. `res` hub'a gönderilmez, yalnızca işaret için.

İşaret yalnızca hata gerçekten gönderilecekse konur. Yok sayılan sınıf (`ignore`), kapalı
raporlayıcı ya da daha önce raporlanmış aynı hata nesnesinde (her istekte fırlatılan
modül düzeyi tek bir hata) yanıt işaretlenmez ve ölçümün "HTTP 500"ü tek iz olarak kalır.

---

## Ne toplar

- Yakalanmamış hatalar ve işlenmemiş promise reddi
- SSR render hataları (Next 15+, Nuxt, SvelteKit, React Router — adaptörle)
- Framework'ün kendi içinde yakaladığı hatalar, sınıf ve stack'iyle (adaptörle)
- 5xx dönen istekler
- Eşiği aşan yavaş istekler (varsayılan 1000 ms)

## Worker ve alt süreç çökmeleri

`hookProcess()` yalnızca ana thread'i kancalar. Bir **worker thread** içinde patlayan hata
ana thread'e istisna olarak ulaşmaz — worker nesnesinin `error` olayına düşer ve kimse
dinlemiyorsa hiçbir iz bırakmaz. Aynısı `fork()` ile açılan alt süreçler için de geçerli.

Kanca ebeveyn tarafına kuruluyor, worker'ın kendi dosyasına değil: o dosyayı uygulama
yazıyor ve her worker'da paketi çağırmayı hatırlamak gerekirdi.

Yakalananlar:

- Worker/alt süreçte yakalanmamış hata (`error` olayı)
- Sıfır olmayan çıkış kodu — hata olayı gelmeden ölmek

Aynı çöküş tek kayıt üretir: yakalanmamış hata önce `error` sonra `exit` tetikler, ikincisi
elenir. Hata **yutulmaz** — dinleyicisi olmayan bir `error` olayı Node tarafından ana
thread'e fırlatılmaya devam eder ve oradan `uncaughtException` olarak da raporlanır.

**`spawn` ve `exec` kapsam dışı.** Dış komutlarda sıfır olmayan çıkış kodu rutindir —
`grep` eşleşme bulamazsa 1 döner — ve hata saymak paneli anlamsız kayıtlarla doldururdu.
Ayrım IPC kanalından yapılır: `fork()` her zaman kanal açar, `spawn` açmaz.

### Neden prototip yamalanıyor

İlk uygulama `Worker` sınıfını bir alt sınıfla değiştiriyordu ve **çalışmadı**: uygulama
modülleri `const { Worker } = require('node:worker_threads')` ile referansı kendi yüklenme
anında kopyalıyor, bizden önce yüklenen her modül yamasız sürümü elinde tutuyordu. Kanca
sessizce devre dışı kalıyordu — izleme paketinde en pahalı arıza biçimi.

`prototype.emit` bu sorunu bilmiyor: bütün örnekler aynı prototipi paylaşır, hangi
referansla üretildikleri fark etmez. Kancanın kurulum sırasından bağımsız çalıştığı ayrıca
doğrulandı.

---

## Canlılık nabzı

Paket sekiz saatte bir hub'a **olay taşımayan** küçük bir istek gönderir.

Sebebi şu: hub bir kurulumun çalışıp çalışmadığını yalnızca gelen hatalardan
anlıyordu. Sonuç ters dönüyordu — hatasız çalışan bir uygulama hiç olay
göndermediği için "kurulum çalışmıyor olabilir" diye raporlanıyordu. Sağlıklı
olmak cezalandırılıyordu.

Artık kanıt isteğin kendisi. Canlılık isteği geldiği sürece hub kurulumun ayakta
olduğunu bilir; gelmediğinde söylediği şey gerçekten doğrudur.

| | |
|---|---|
| Aralık | 8 saat |
| Gövde | `{"events": []}` — hiçbir ölçüm taşımaz |
| Uç | Olayların gittiği uçla aynı, ek bir adres yok |
| İlk istek | Süreç başlar başlamaz — deploy sonrası kurulum kendini hemen kanıtlar |

Aralık, hub'ın 24 saatlik sessizlik eşiğinin üçte biri. Eşitlenseydi tek bir
kaçırılan istek — deploy, yeniden başlatma, kısa bir ağ kesintisi — kurulumu
bozuk gösterirdi. Üç turluk pay, iki kaçırmayı sorun etmez.

Zamanlayıcı `unref` edilmiştir: kısa ömürlü bir betiği ayakta tutmaz, işini
bitiren süreç normal şekilde kapanır.

`hookProcess()` çağrıldığında kendiliğinden başlar — kodsuz kurulum, Next
`instrumentation.ts` ve Express reçetelerinin hepsi bunu zaten çağırıyor.
Elle yönetmek isterseniz:

```js
const { startHeartbeat, stopHeartbeat } = require('vitalwatch-node');

startHeartbeat();          // varsayılan 8 saat
startHeartbeat(3600_000);  // ya da kendi aralığınız (ms)
stopHeartbeat();
```

`VITALWATCH_ENABLED=false` iken ya da yapılandırma eksikken hiç gönderilmez.

## Ne toplamaz

Bunlar yapılandırmayla dahi açılamaz — kodda karşılığı yoktur:

- IP adresi
- User-Agent
- İstek gövdesi / form verisi
- Query string **değerleri** (yalnızca yol saklanır)
- Oturum verisi, çerez
- Ham SQL literal değerleri

Mesaj ve stack trace gönderilmeden önce e-posta, TC kimlik no, telefon, IBAN, kart numarası
ve uzun rastgele diziler (oturum kimliği, API anahtarı) maskelenir. SQL literal değerleri
`?` ile değiştirilir — hem KVKK gereği hem gruplama için: aynı sorgu farklı parametrelerle
çalıştığında tek parmak izinde toplanır.

---

## Davranış garantileri — ihlal edilemez

Paket, kurulduğu uygulamayı **hiçbir şekilde etkilememelidir**:

1. **Hata yutulmaz.** Handler zinciri korunur, `throw` engellenmez, süreç sonlandırılmaz.
2. **Kendi hatasını raporlamaz.** Sonsuz döngü riski; tüm SDK kodu `try/catch` ile sarılır.
3. **Kullanıcı isteğini bekletmez.** Gönderim kısa zaman aşımıyla (varsayılan 2 sn) ve
   yanıt döndükten sonra yapılır.
4. **Hub erişilemezse sessizce vazgeçilir.** İzlenen uygulamada hata, log kirliliği veya
   yavaşlama oluşmaz.
5. **`VITALWATCH_ENABLED=false` iken hiçbir veri gönderilmez.**
6. **Canlılık nabzı süreci ayakta tutmaz.** Zamanlayıcı `unref` edilmiştir; işini
   bitiren betik kapanır.

> Bir izleme paketinin izlediği uygulamayı bozması, çözdüğü sorundan büyük bir sorundur.

---

## Yapılandırma

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `VITALWATCH_ENABLED` | `true` | `false` ise hiçbir veri gönderilmez |
| `VITALWATCH_URL` | — | Hub adresi |
| `VITALWATCH_KEY` | — | Panelden alınan proje anahtarı |
| `VITALWATCH_SECRET` | — | 64 karakter. **Yalnızca sunucuda bulunur** |
| `VITALWATCH_ENV` | `NODE_ENV` | `production` · `staging` · `local`. Takma adlar çevrilir: `prod`/`live` → production, `stage`/`stg`/`preprod`/`uat` → staging, `dev`/`development`/`test`/`testing` → local. Tanınmayan değeri hub reddeder; teşhis komutu hata verir |
| `VITALWATCH_RELEASE` | kendiliğinden | Sürüm etiketi (commit sha, tag). Boşsa bulunur, bkz. [Sürüm etiketi](#sürüm-etiketi) |
| `VITALWATCH_TIMEOUT` | `2000` | Gönderim zaman aşımı, **ms**. 100'ün altı saniye sayılır (`2` → 2000 ms) — Laravel ve Python aynı adla saniye bekliyor. Sonuç 100–10000 ms aralığına sıkıştırılır; geçersiz, sıfır ya da negatif değer 2000'e döner. Kural bütün paketlerde aynı |
| `VITALWATCH_SLOW_REQUEST_MS` | `1000` | Bu süreyi aşan istek yavaş sayılır |

Kod içinden de verilebilir:

```js
const { init } = require('vitalwatch-node');

init({ url: '...', key: '...', secret: '...', ignore: ['NotFoundError'] });
```

`init({ timeout })` da `VITALWATCH_TIMEOUT` ile aynı kuraldan geçer: `init({ timeout: 50 })`
50 ms değil 50 saniye demektir ve 10000 ms'ye sıkıştırılır.

### Sürüm etiketi

`VITALWATCH_RELEASE` neredeyse hiçbir projede dolu değildi; hub "bu hata X deploy'undan sonra
başladı" diyemiyordu. Etiket artık kurulumda bir kez, şu sırayla bulunur (Laravel ve Python
paketleriyle aynı kural):

1. `VITALWATCH_RELEASE` — kırpılır, en çok 64 karakter, olduğu gibi.
2. İlk dolu CI/PaaS değişkeni: `GIT_COMMIT`, `GIT_SHA`, `COMMIT_SHA`, `SOURCE_VERSION`,
   `VERCEL_GIT_COMMIT_SHA`, `RENDER_GIT_COMMIT`, `HEROKU_SLUG_COMMIT`, `CI_COMMIT_SHA`.
   Sha biçimindeyse (7–40 hex) küçük harf ilk 12 karakter, değilse en çok 64 karakter.
3. Uygulama kökündeki (`process.cwd()`) `.git`: `HEAD` → dal ref dosyası, yoksa
   `packed-refs`; ayrık HEAD doğrudan sha. `.git` bir dosyaysa (worktree, alt modül)
   içindeki `gitdir:` izlenir. Yalnızca geçerli 40 hanelik sha kabul edilir; ilk 12 karakter.
4. Hiçbiri yoksa etiket gönderilmez.

Sunucularımızda deploy `git pull` olduğu için `.git` yerinde duruyor ve çoğu kurulumda
hiçbir şey yazmak gerekmiyor. `git` programı çalıştırılmaz (alt süreç yok), yalnızca
kurulumda birkaç küçük dosya senkron okunur ve hiçbir koşulda hata fırlatmaz.

Deploy sonrası süreç yeniden başlatılınca yeni sha okunur. Başlatılmazsa bellekte hâlâ eski
kod çalışıyordur — eski sha o durumda **doğru** etikettir.

`init({ release })` verilirse her şeyi yener. `npx vitalwatch-status` etiketi kaynağıyla gösterir:
`Sürüm etiketi  a1b2c3d4e5f6 (kaynak: .git)` — kaynak `VITALWATCH_RELEASE`, değişkenin adı,
`.git` ya da `yok`.

---

## Toplu güncelleme

Aynı sunucudaki tüm Node projelerini tek seferde güncellemek için:

```bash
for d in /var/www/*/; do
  [ -d "$d/node_modules/vitalwatch-node" ] || continue
  echo "→ $d"
  (cd "$d" && npm install vitalwatch-node@latest && npx vitalwatch-status)
done
```

`npm update` **değil** `npm install @latest`: 1.0 altındaki sürümlerde `^0.2.1` kısıtı
`>=0.2.1 <0.3.0` anlamına geliyor ve `npm update` minor artışı bilerek atlıyor. Gerçek bir
kurulumda tam olarak bu yaşandı — komut "up to date" dedi, paket eski sürümde kaldı ve
kimse fark etmedi.

Son adım bilinçli: güncelleme sonrası yapılandırmanın hâlâ geçerli olduğunu doğrular.
Sessizce bozulan bir kurulum, hiç kurulmamış olandan daha tehlikelidir.

Hangi projenin hangi sürümde olduğu **panelden de görülür** — paket her olayla birlikte
`sdk_version` gönderiyor. Güncelleme körlemesine değil, hedefli yapılır.

---

## Geliştirme

```bash
npm test        # node:test, bağımlılık yok
```

Bağımlılık politikası: **mümkün olan en az bağımlılık.** Bu paket 8 projeye kurulacak; her
bağımlılık sürüm çakışması riski demektir. Tipler bu yüzden elle yazıldı, üretilmedi —
derleme zinciri eklenmedi.

## Lisans

MIT
