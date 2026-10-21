'use strict';

const Scrubber = require('./scrubber');
const { markReported, wasReported, isServerError, statusOf } = require('./route');

/**
 * Express / Connect middleware: yavaş istek ve 5xx ölçümü.
 *
 * Kullanım — **rotalardan önce** eklenir:
 *
 *     const { express: vitalwatch } = require('vitalwatch-node');
 *     app.use(vitalwatch());
 *
 * Hata middleware'i olarak da eklenebilir; ikisi birlikte kullanılabilir:
 *
 *     app.use(vitalwatch.errors());
 */
function express(options = {}) {
    // Geç çözülüyor: init() middleware'den sonra çağrılmış olabilir.
    const get = () => require('./index').reporter();

    return function vitalwatchMiddleware(req, res, next) {
        const startedAt = process.hrtime.bigint();

        /*
         * `finish` yerine `close` da dinlenmeli mi diye düşünülebilir; hayır:
         * `close` istemci bağlantıyı kestiğinde de tetiklenir ve o istek
         * "yavaş" sayılmamalı — süre kullanıcının kopmasıyla ölçülmüş olur.
         */
        res.once('finish', () => {
            try {
                // errors() asıl hatayı gönderdi; "HTTP 500" tekrar olur.
                if (res.statusCode >= 500 && wasReported(res)) return;

                const durationMs =
                    Number(process.hrtime.bigint() - startedAt) / 1_000_000;

                get().recordRequest({
                    // Rota deseni gönderilir, gerçek id değil: hem gruplama
                    // çalışır hem yolda kişisel veri taşınmaz.
                    route: routePattern(req),
                    method: req.method,
                    status: res.statusCode,
                    durationMs,
                });
            } catch {
                // İzleme kodu isteği bozmaz.
            }
        });

        next();
    };
}

/**
 * Express hata middleware'i. Hatayı **yutmaz**, zincire devrederek geçirir.
 *
 * 4xx taşıyan hata (`status`/`statusCode` 400–499, örn. http-errors'un
 * NotFound'u) gönderilmez: diğer adaptörlerle aynı kural. Önceden her hata
 * gidiyordu ve kamuya açık bir API'de doğrulama hataları paneli dolduruyordu;
 * gyd-backend bu yüzden middleware'i hiç kullanmayıp elle yazmıştı.
 * Durum kodu taşımayan hata sunucu hatasıdır ve gönderilir.
 */
express.errors = function errors() {
    const get = () => require('./index').reporter();

    return function vitalwatchErrorMiddleware(error, req, res, next) {
        /*
         * `next` try'ın DIŞINDA ve tek yerde: içeride çağrılıp senkron
         * fırlatsaydı catch yutar, akış aşağı düşer ve `next` ikinci kez
         * çağrılırdı.
         */
        try {
            if (isServerError(statusOf(error))) {
                const r = get();
                // Gönderilmeyecek hatada işaret yok: "HTTP 500" tek iz olur.
                const willRecord = r.willRecord(error);

                r.recordException(error, {
                    route: routePattern(req),
                    method: req.method,
                });

                if (willRecord) markReported(res);
            }
        } catch {
            // Sessiz.
        }

        // Handler zinciri korunur; uygulamanın kendi hata sayfası çalışır.
        next(error);
    };
};

/**
 * Express'in eşleşen rota deseni (`/urunler/:id`), gerçek yol değil.
 * Desen yoksa yola düşülür ve query string atılır (M3).
 *
 * MOUNT YOLU DESENE DAHİL. `req.route.path` router'ın İÇİNDEKİ yolu veriyor,
 * mount yolunu değil: `app.use('/api', router)` altındaki `/urunler/:id`
 * için `req.baseUrl` = `/api` ve `req.route.path` = `/urunler/:id`. İkisi
 * birleştirilmezse farklı ön eklere bağlı iki router aynı kayda düşer —
 * `/api/urunler/:id` ile `/admin/urunler/:id` tek satır olur ve hem hata
 * gruplaması hem Katman B yüzdelikleri iki ayrı ucu birbirine karıştırır.
 *
 * Koşul eskiden ters kuruluydu: `req.route.path` doluysa kısa devre yapıp
 * tek başına dönüyordu ve mount yolunu ekleyen dal ancak `route.path`
 * BOŞKEN — yani eklenecek bir şey yokken — çalışıyordu.
 */
function routePattern(req) {
    const base = req.baseUrl || '';
    const inner = req.route && req.route.path ? String(req.route.path) : null;

    let pattern = null;

    if (inner !== null) {
        // Mount yolu altındaki kök (`router.get('/')`): `/api/` değil `/api`.
        pattern = base && inner === '/' ? base : base + inner;
    }

    return Scrubber.path(pattern || req.originalUrl || req.url) || '/';
}

module.exports = { express };
