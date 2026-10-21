'use strict';

const { reportRequestError } = require('./route');

/**
 * Koa.
 *
 *     const { koa: vitalwatch } = require('vitalwatch-node');
 *     vitalwatch(app);
 *
 * Koa hataları uygulamanın `error` olayına veriyor.
 */
function vitalwatchKoa(app) {
    try {
        app.on('error', function vitalwatchKoaError(error, ctx) {
            reportRequestError(error, {
                url: ctx && (ctx.originalUrl || ctx.url),
                method: ctx && ctx.method,
                res: ctx && ctx.res,
            });

            /*
             * Koa kendi hata günlüğünü yalnızca `error` olayını dinleyen
             * kimse yoksa kuruyor. Bu dinleyici eklendiği an uygulamanın
             * stderr'e yazdığı hata satırları sessizce kesilirdi — izleme
             * paketi uygulamanın davranışını değiştirmiş olurdu.
             * Tek dinleyici bizsek Koa'nın varsayılanı elle çağrılıyor.
             */
            try {
                if (app.listenerCount('error') === 1 && typeof app.onerror === 'function') {
                    app.onerror(error);
                }
            } catch {
                // Günlük yazılamadıysa yapılacak bir şey yok.
            }
        });
    } catch {
        // Dinleyici kurulamazsa uygulama yine de açılır.
    }

    return app;
}

module.exports = { koa: vitalwatchKoa };
