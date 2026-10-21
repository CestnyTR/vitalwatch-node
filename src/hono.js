'use strict';

const { reportRequestError } = require('./route');

/**
 * Hono middleware'i.
 *
 *     import { hono as vitalwatch } from 'vitalwatch-node';
 *     app.use(vitalwatch());
 *
 * `app.onError` kullanılmadı: tek bir işleyici tutuyor ve kurmak
 * uygulamanın kendi hata sayfasını ezerdi. Hono yakaladığı hatayı `c.error`
 * alanına koyuyor; middleware onu `next()` döndükten sonra okuyor.
 */
function vitalwatchHono() {
    return async function vitalwatchHonoMiddleware(c, next) {
        await next();

        try {
            if (!c.error) return;

            reportRequestError(c.error, {
                url: c.req && c.req.path,
                method: c.req && c.req.method,
                status: c.res && c.res.status,
                // @hono/node-server gerçek yanıt nesnesini buraya koyuyor.
                res: c.env && c.env.outgoing,
            });
        } catch {
            // Yanıtı hiçbir koşulda bozmaz.
        }
    };
}

module.exports = { hono: vitalwatchHono };
