'use strict';

const { reportRequestError } = require('./route');

/**
 * NestJS global interceptor'ı.
 *
 *     import { nest as vitalwatch } from 'vitalwatch-node';
 *     app.useGlobalInterceptors(vitalwatch());
 *
 * Nest hataları exception filter'larında 500'e çeviriyor; Express hata
 * middleware'i onları hiç görmüyor.
 *
 * Filter değil interceptor seçildi: global filter uygulamanın kendi
 * filter'larıyla sıra yarışına girer ve hangisinin çalışacağı değişebilir.
 * Interceptor hatayı yalnızca görür ve aynen yeniden fırlatır — hata
 * yanıtına hiç dokunmaz.
 *
 * HTTP dışı bağlamlarda (`rpc`, `ws`) `RpcException` / `WsException` ve alt
 * sınıfları gönderilmez: istemciye yönelik iş hatası, arıza değil.
 * GraphQL'de 4xx `HttpException`'lar zaten durum kodundan elenir.
 *
 * rxjs içe aktarılmıyor: Nest'in döndürdüğü Observable'ın kendi sınıfı
 * kullanılıyor, paket bağımlılıksız kalıyor.
 */
function vitalwatchNest() {
    return {
        intercept(context, next) {
            const source = next.handle();

            try {
                const Observable = source.constructor;

                return new Observable((subscriber) =>
                    source.subscribe({
                        next: (value) => subscriber.next(value),
                        complete: () => subscriber.complete(),
                        error: (error) => {
                            report(context, error);
                            subscriber.error(error);
                        },
                    }),
                );
            } catch {
                return source;
            }
        },
    };
}

/*
| HTTP dışı bağlamlarda (mikroservis `rpc`, WebSocket `ws`) istemciye
| yönelik hata sınıfları. Durum kodu taşımıyorlar; bakılmasaydı her
| `throw new RpcException('geçersiz')` sunucu hatası sayılırdı. Nest'i içe
| aktarmadan tanımak için ada bakılıyor — alt sınıflar da kapsanıyor.
| Bunların dışındaki hatalar (TypeError, veritabanı) gönderilir.
*/
const CLIENT_FACING = new Set(['RpcException', 'WsException']);

function isClientFacing(error) {
    try {
        let proto = error && typeof error === 'object' ? Object.getPrototypeOf(error) : null;

        for (let depth = 0; proto && depth < 20; depth++) {
            const ctor = proto.constructor;
            if (ctor && CLIENT_FACING.has(ctor.name)) return true;
            proto = Object.getPrototypeOf(proto);
        }
    } catch {
        // Tanınamadı — gönderilir.
    }

    return false;
}

function report(context, error) {
    try {
        const type = context && typeof context.getType === 'function' ? context.getType() : undefined;

        if (type !== 'http' && isClientFacing(error)) return;

        const http = type === 'http' ? context.switchToHttp() : null;
        const req = http ? http.getRequest() : null;
        const res = http ? http.getResponse() : null;

        reportRequestError(error, {
            url: req ? req.originalUrl || req.url : undefined,
            method: req ? req.method : undefined,
            // Fastify platformunda yanıt `reply`, gerçek nesne `raw`.
            res: res ? res.raw || res : undefined,
        });
    } catch {
        // Hata yolunu hiçbir koşulda bozmaz.
    }
}

module.exports = { nest: vitalwatchNest };
