'use strict';

const { reportRequestError } = require('./route');

/**
 * React Router 7 (framework modu) ve Remix `handleError` —
 * `app/entry.server.tsx`:
 *
 *     import { reactRouter as vitalwatch } from 'vitalwatch-node';
 *     export const handleError = vitalwatch();
 */
function vitalwatchReactRouter(handler) {
    return function handleError(error, args) {
        try {
            const request = args && args.request;

            /*
             * Ziyaretçi sayfadan ayrılınca iptal edilen istekler de buraya
             * düşüyor. Belgeler bunları raporlamamayı öneriyor: arıza değil,
             * gezinme.
             */
            if (!(request && request.signal && request.signal.aborted)) {
                let url;
                try {
                    url = request ? new URL(request.url).pathname : undefined;
                } catch {
                    url = undefined;
                }

                reportRequestError(error, {
                    url,
                    method: request && request.method,
                });
            }
        } catch {
            // Sessiz.
        }

        return typeof handler === 'function' ? handler(error, args) : undefined;
    };
}

module.exports = { reactRouter: vitalwatchReactRouter };
