'use strict';

/**
 * Kodsuz kurulum girişi.
 *
 *     NODE_OPTIONS="--require vitalwatch-node/auto"
 *
 * Uygulama kaynağına tek satır eklemeden çalışır: Node bu dosyayı uygulamadan
 * önce yükler, kancalar orada kurulur. Onlarca projeye kurulacak bir izleme
 * paketi için değerli — her projede dosya düzenlemek, hem iş hem de "biri
 * unutuldu ve kimse fark etmedi" riski demektir.
 *
 * Karşılığında iki taviz var ve ikisi de bilinçli:
 *
 * 1. **Hatanın kendisi yok, yalnızca durum kodu.** Framework'ler hatayı
 *    kendi içinde yakalayıp 500'e çeviriyor; buradan yalnızca "HTTP 500"
 *    görünür. Sınıf ve stack için framework adaptörü eklenir (bkz. README).
 * 2. **node:http yamalanıyor.** Yama yalnızca ölçüm ekler, isteği ne
 *    değiştirir ne geciktirir; her adımı try/catch içinde ve hata durumunda
 *    orijinal davranışa dönüyor.
 */

const { init, hookProcess, reporter } = require('./index');
const { routePattern, wasReported } = require('./route');

try {
    const r = init();

    /*
    | Kancalar `configured()` kontrolüne bakılmadan kurulur.
    |
    | Önceden bakılıyordu ve bir tuzak vardı: bu dosya Node başlarken
    | çalışıyor, framework kendi `.env`'ini çok sonra okuyor. Yapılandırma
    | o anda görünmüyorsa kanca hiç kurulmuyor ve uygulama ömrü boyunca
    | kurulmuyordu — hiçbir uyarı vermeden.
    |
    | Artık `.env` doğrudan okunuyor (bkz. env.js), ama yine de geç gelen
    | yapılandırmaya karşı korunmak gerekiyor. Kanca kurmanın maliyeti istek
    | başına tek bir boolean kontrolü; Reporter yapılandırma yoksa zaten
    | erken dönüyor.
    |
    | `enabled` istisna: VITALWATCH_ENABLED=false açık bir "hiçbir şey yapma"
    | talimatı ve sonradan değişmez (davranış garantisi 5).
    */
    if (r.enabled) {
        hookProcess();
        patchHttp();
    }
} catch {
    // Kodsuz kurulum, uygulamayı hiçbir koşulda başlatılamaz hâle getiremez.
}

/**
 * Gelen istekleri süre ve durum koduna göre ölçer.
 *
 * `Server.prototype.emit` yamalanıyor, `createServer` değil: uygulamalar
 * sunucuyu `new http.Server()`, `createServer()` ya da framework içinden
 * kurabiliyor; hepsi bu noktadan geçiyor.
 */
function patchHttp() {
    for (const moduleName of ['node:http', 'node:https']) {
        try {
            const http = require(moduleName);
            const Server = http.Server;

            if (!Server || Server.prototype.__vitalwatchPatched) continue;

            const originalEmit = Server.prototype.emit;

            Server.prototype.emit = function (event, req, res) {
                if (event === 'request') {
                    try {
                        measure(req, res);
                    } catch {
                        // Ölçüm kurulamadıysa istek yine de işlenir.
                    }
                }

                return originalEmit.apply(this, arguments);
            };

            Server.prototype.__vitalwatchPatched = true;
        } catch {
            // Modül yoksa geç.
        }
    }
}

function measure(req, res) {
    const startedAt = process.hrtime.bigint();

    /*
     * Yol İSTEĞİN BAŞINDA alınıyor, `finish` anında değil.
     *
     * Express bağlı bir router'a girerken `req.url`'den mount yolunu siliyor
     * (`app.use('/api', router)` altında `/api/urunler` → `/urunler`) ve
     * yanıt router'ın içinden gönderildiyse `finish` anında silinmiş hâli
     * duruyordu: `/api/urunler` panelde `/urunler` görünüyor, farklı ön
     * eklere bağlı router'lar aynı kayda düşüyordu. `emit('request')` anında
     * hiçbir framework henüz dokunmadı; `originalUrl` Express/Connect'in
     * sakladığı özgün adres, varsa o öncelikli.
     */
    const url = req.url;

    /*
     * `close` değil `finish` dinleniyor: `close` istemci bağlantıyı kestiğinde
     * de tetiklenir ve o istek "yavaş" sayılmamalı — süre kullanıcının
     * kopmasıyla ölçülmüş olur.
     */
    res.once('finish', () => {
        try {
            // Adaptör asıl hatayı stack'iyle gönderdi; "HTTP 500" tekrar olur.
            if (res.statusCode >= 500 && wasReported(res)) return;

            reporter().recordRequest({
                route: routePattern(req.originalUrl || url),
                method: req.method,
                status: res.statusCode,
                durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
            });
        } catch {
            // Sessiz.
        }
    });
}

module.exports = { routePattern };
