'use strict';

const { reportRequestError } = require('./route');

/**
 * Nuxt uygulama eklentisi — yalnızca sunucuda (SSR) çalışır.
 *
 * `<NuxtErrorBoundary>` ya da `onErrorCaptured` ile yakalanan render
 * hataları Nitro'ya hiç ulaşmıyor: sayfa 200 döner, hata sessizce kaybolur.
 * `vue:error` onları da görüyor.
 *
 * Yakalanmayan render hatası hem burada hem Nitro'da görünür; aynı hata
 * nesnesi olduğu için raporlayıcı ikincisini eliyor.
 *
 * Elle kaydetmeye gerek yok, modül ekliyor (bkz. nuxt.js).
 */
function vitalwatchNuxtPlugin(nuxtApp) {
    try {
        nuxtApp.hook('vue:error', (error) => {
            try {
                const event = nuxtApp.ssrContext && nuxtApp.ssrContext.event;
                const node = (event && event.node) || {};

                reportRequestError(error, {
                    url: event ? event.path || (node.req && node.req.url) : undefined,
                    method: event ? event.method || (node.req && node.req.method) : undefined,
                    res: node.res,
                });
            } catch {
                // Render'ı hiçbir koşulda bozmaz.
            }
        });
    } catch {
        // Beklenmeyen Nuxt sürümü — eklenti sessizce devre dışı kalır.
    }
}

module.exports = vitalwatchNuxtPlugin;
module.exports.default = vitalwatchNuxtPlugin;
