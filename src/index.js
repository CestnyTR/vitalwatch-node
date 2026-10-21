'use strict';

const { env: readEnv } = require('./env');
const { Reporter, SDK_VERSION } = require('./reporter');
const Scrubber = require('./scrubber');
const { hookWorkers } = require('./workers');
const { markReported } = require('./route');
const { resolveRelease } = require('./release');

/**
 * vitalwatch-node — Node tarafı raporlayıcı.
 *
 * Kapsamı bilinçli olarak dar: **sunucu tarafı.** Tarayıcı hataları hub'dan
 * servis edilen `t.js` ile toplanır ve o dosya npm'e taşınmaz — hosted olması
 * merkezî güncellemeyi mümkün kılıyor, paket olsaydı her düzeltme için 13
 * projenin yeniden dağıtılması gerekirdi.
 *
 * Node tarafında hosted seçenek yok: sunucuda script etiketi çalışmaz. Burada
 * paket tek yol, ve kopyalanan dosya yerine paket olması gerekli — kopya
 * dosyalar güncellenmez ve bu **sessizce** olur.
 */

/** @type {Reporter|null} */
let instance = null;

/**
 * Ortam değişkenlerinden yapılandırma. Laravel paketiyle aynı isimler
 * kullanılıyor: aynı projeyi iki dilde izleyen ekip iki ayrı isim seti
 * öğrenmek zorunda kalmasın.
 *
 * `process.env` değil `readEnv()`: ön yükleme sırasında framework henüz kendi
 * `.env`'ini okumamış oluyor ve süreç ortamı boş görünüyor.
 */
function fromEnvironment() {
    const e = { ...process.env, ...readEnv() };

    return {
        enabled: e.VITALWATCH_ENABLED !== 'false',
        url: e.VITALWATCH_URL,
        key: e.VITALWATCH_KEY,
        secret: e.VITALWATCH_SECRET,
        env: e.VITALWATCH_ENV || e.NODE_ENV || 'production',
        // VITALWATCH_RELEASE > CI/PaaS değişkeni > .git; bkz. release.js.
        release: resolveRelease(e).value,
        timeout: e.VITALWATCH_TIMEOUT ? Number(e.VITALWATCH_TIMEOUT) : 2000,
        slowRequestMs: e.VITALWATCH_SLOW_REQUEST_MS
            ? Number(e.VITALWATCH_SLOW_REQUEST_MS)
            : 1000,
    };
}

/**
 * Raporlayıcıyı kurar. Çağrılmazsa ilk kullanımda ortam değişkenlerinden
 * kendiliğinden kurulur — kurulum adımını unutmak sessiz arıza üretmesin.
 *
 * @param {Record<string, unknown>} [options]
 */
function init(options = {}) {
    instance = new Reporter({ ...fromEnvironment(), ...options });

    return instance;
}

function reporter() {
    if (!instance) init();

    return instance;
}

/**
 * Bir hatayı hub'a bildirir. Hiçbir koşulda hata fırlatmaz ve **beklenmesi
 * gerekmez**: `await` edilmezse arka planda tamamlanır.
 *
 * Kendi hata işleyicisinden çağıran uygulama `res` verirse yanıt
 * işaretlenir ve ölçüm aynı istek için ayrıca "HTTP 500" açmaz. Verilmezse
 * tek arıza panelde iki kayıt olur: biri stack'li, biri stack'siz. `res`
 * yalnızca işaret için; hub'a gönderilmez. Hata gönderilmeyecekse (yok
 * sayılan sınıf, aynı nesne daha önce raporlanmış) işaret konmaz.
 *
 * @param {unknown} error
 * @param {{kind?: string, route?: string, method?: string, res?: object}} [context]
 */
function report(error, context) {
    const { res, ...rest } = context || {};
    const r = reporter();

    /*
     * Yalnızca gerçekten gönderilecek hatada işaretlenir. Aksi halde
     * (yok sayılan sınıf, daha önce raporlanmış aynı nesne, kapalı
     * raporlayıcı) ölçüm de sussun ve arıza hiç iz bırakmasın istenmez.
     */
    if (res && r.willRecord(error)) markReported(res);

    return r.recordException(error, rest);
}

/**
 * Yakalanmamış hataları ve işlenmemiş promise reddini dinler.
 *
 * Süreci **sonlandırmaz ve davranışı değiştirmez**: Node'un varsayılan
 * davranışı korunur. Bir izleme paketinin süreç yönetimine karışması,
 * çözdüğü sorundan büyük bir sorundur.
 */
/**
 * Canlılık isteklerinin aralığı.
 *
 * Hub 24 saat ses çıkmayan kurulumu "sessiz" sayıyor. Aralık eşiğe eşit
 * olsaydı tek bir kaçırılan istek — deploy, yeniden başlatma, birkaç
 * dakikalık ağ kesintisi — projeyi anında bozuk gösterirdi. Üçte bir güvenli
 * tolerans: iki tur kaçsa bile alarm çalmaz.
 *
 * Sıklaştırmanın bilgi değeri yok: kurulumun çalışıp çalışmadığı saatlik
 * değişen bir şey değil ve sitenin ayakta olup olmadığını hub kendi
 * probuyla zaten ölçüyor.
 */
const HEARTBEAT_MS = 8 * 60 * 60 * 1000;

let heartbeatTimer = null;

/**
 * Süreç boyunca düzenli "buradayım" gönderir.
 *
 * Süreç başlarken hemen bir istek atılır: deploy sonrası kurulum kendini
 * anında kanıtlar, sekiz saat beklemez.
 */
function startHeartbeat(intervalMs = HEARTBEAT_MS) {
    // İki kez çağrılırsa ikinci zamanlayıcı kurulmaz; hookProcess birden
    // fazla yerden çağrılabiliyor (auto, instrumentation, elle).
    if (heartbeatTimer) {
        return heartbeatTimer;
    }

    reporter().heartbeat();

    heartbeatTimer = setInterval(() => reporter().heartbeat(), intervalMs);

    /*
     * unref: zamanlayıcı süreci hayatta tutmasın. Kısa ömürlü bir betik
     * işini bitirince kapanmalı — izleme paketi onu sekiz saat ayakta
     * tutarsa CLI komutları asla dönmez.
     */
    if (typeof heartbeatTimer.unref === 'function') {
        heartbeatTimer.unref();
    }

    return heartbeatTimer;
}

function stopHeartbeat() {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
}

function hookProcess() {
    const r = reporter();

    process.on('uncaughtException', (error) => {
        r.recordException(error, { kind: 'exception' });

        /*
         * Yeniden fırlatılmıyor ve process.exit çağrılmıyor: dinleyici
         * eklendiği an Node'un varsayılan "çök" davranışı zaten devre dışı
         * kalıyor. Uygulamanın kendi dinleyicisi varsa o karar verir.
         */
    });

    process.on('unhandledRejection', (reason) => {
        r.recordException(reason, { kind: 'exception' });
    });

    /*
     * Worker ve fork kancaları: ana thread'in uncaughtException'ı onları
     * görmüyor. Worker içinde patlayan hata yalnızca worker nesnesinin
     * `error` olayına düşer ve kimse dinlemiyorsa hiçbir iz bırakmaz.
     */
    hookWorkers((error, context) => r.recordException(error, context));

    // Kancalarla birlikte: hookProcess her kurulum reçetesinin ortak adımı,
    // canlılığın ayrıca hatırlanması gereken bir çağrı olmaması gerekiyor.
    startHeartbeat();

    return r;
}

/*
| Adaptörler önce sabite alınıyor, sonra kısa yazımla dışa aktarılıyor.
|
| `express: require('./express').express` biçimi ESM'den adlandırılmış
| içe aktarmayı kırıyordu: Node, CommonJS dışa aktarımlarını çalıştırmadan
| metinden okuyor ve yalnızca kısa yazımı tanıyor. `import { hono } from`
| satırı "Named export not found" veriyordu; Next paketleyicisi bunu
| gizliyordu, saf Node ESM'de (Hono, SvelteKit, Nuxt sunucusu) görünüyordu.
*/
const { express } = require('./express');
const { nextOnRequestError } = require('./next');
const { fastify } = require('./fastify');
const { koa } = require('./koa');
const { hono } = require('./hono');
const { nest } = require('./nest');
const { sveltekit } = require('./sveltekit');
const { reactRouter } = require('./react-router');
const version = SDK_VERSION;

module.exports = {
    init,
    report,
    hookProcess,
    startHeartbeat,
    stopHeartbeat,
    reporter,
    Reporter,
    Scrubber,
    version,
    express,
    nextOnRequestError,
    fastify,
    koa,
    hono,
    nest,
    sveltekit,
    reactRouter,
};
