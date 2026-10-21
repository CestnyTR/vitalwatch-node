'use strict';

const { reportRequestError, statusOf } = require('./route');

/**
 * Fastify eklentisi.
 *
 *     const { fastify: vitalwatch } = require('vitalwatch-node');
 *     app.register(vitalwatch);
 *
 * Fastify handler hatalarını kendisi yakalayıp yanıta çeviriyor; `onError`
 * kancası hatayı yanıt gönderilmeden önce görüyor. Hatayı değiştirmez,
 * uygulamanın kendi `setErrorHandler`'ı çalışmaya devam eder.
 */
function vitalwatchFastify(app, options, done) {
    try {
        app.addHook('onError', (request, reply, error, next) => {
            reportRequestError(error, {
                url: request && request.url,
                method: request && request.method,
                status: status(error, reply),
                res: reply && reply.raw,
            });

            next();
        });
    } catch {
        // Kanca kurulamazsa uygulama yine de açılır.
    }

    if (typeof done === 'function') done();
}

/**
 * `onError` anında `reply.statusCode` henüz yazılmamış: hata ne olursa
 * olsun 200 görünüyor ve ona bakılsaydı hiçbir hata gönderilmezdi.
 * Fastify kodu hatadan alıyor; uygulama `reply.code(4xx)` ile önceden
 * koymuşsa onu koruyor. Aynı sıra burada.
 */
function status(error, reply) {
    const fromError = statusOf(error);
    if (fromError !== undefined) return fromError;

    const current = reply && reply.statusCode;

    return current >= 400 ? current : undefined;
}

/*
 * Fastify her eklentiyi kendi kapsamına kapatıyor; kanca yalnızca eklentinin
 * içindeki rotalarda çalışır ve uygulamanın rotaları kör kalırdı.
 * `skip-override` kancayı üst kapsama taşır — fastify-plugin'in yaptığı şey,
 * bağımlılık eklemeden.
 */
vitalwatchFastify[Symbol.for('skip-override')] = true;
vitalwatchFastify[Symbol.for('fastify.display-name')] = 'vitalwatch';

module.exports = { fastify: vitalwatchFastify };
