'use strict';

const Scrubber = require('./scrubber');

/**
 * Next.js sunucu tarafı hata kancası.
 *
 * Next 15+ `instrumentation.js` dosyasından `onRequestError` dışa aktarır ve
 * **SSR sırasında oluşan hataları** buraya verir. Bu hatalar tarayıcıya hiç
 * ulaşmaz — `t.js` onları göremez, error boundary de göremez. Bu kanca
 * olmadan SSR katmanı tamamen kör kalır.
 *
 *     // instrumentation.js
 *     export async function register() {
 *         const { hookProcess } = await import('vitalwatch-node');
 *         hookProcess();
 *     }
 *
 *     export const onRequestError = (await import('vitalwatch-node'))
 *         .nextOnRequestError;
 *
 * Next 14'te `onRequestError` yoktur; orada yalnızca `register()` içindeki
 * `hookProcess()` çalışır ve yakalanmamış hatalar toplanır.
 */
function nextOnRequestError(error, request, context) {
    try {
        const reporter = require('./index').reporter();

        return reporter.recordException(error, {
            kind: 'exception',
            // Next yolu query string ile verebilir; M3 gereği atılır.
            route: request && request.path ? Scrubber.path(request.path) : undefined,
            method: (request && request.method) || undefined,
        });
    } catch {
        // Kanca hiçbir koşulda render'ı bozmaz.
    }
}

module.exports = { nextOnRequestError };
