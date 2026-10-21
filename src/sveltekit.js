'use strict';

const { reportRequestError } = require('./route');

/**
 * SvelteKit `handleError` kancası — `src/hooks.server.js`:
 *
 *     import { sveltekit as vitalwatch } from 'vitalwatch-node';
 *     export const handleError = vitalwatch();
 *
 * Mevcut bir handleError varsa sarılır, dönüşü aynen korunur:
 *
 *     export const handleError = vitalwatch(({ error }) => ({ message: 'Hata' }));
 */
function vitalwatchSvelteKit(handler) {
    return function handleError(input) {
        try {
            const { error, event, status } = input || {};

            reportRequestError(error, {
                url: event && event.url && event.url.pathname,
                method: event && event.request && event.request.method,
                // SvelteKit 404'ü de buraya veriyor; o bir hata değil.
                status,
            });
        } catch {
            // Hata sayfasının çizilmesini bozmaz.
        }

        return typeof handler === 'function' ? handler(input) : undefined;
    };
}

module.exports = { sveltekit: vitalwatchSvelteKit };
