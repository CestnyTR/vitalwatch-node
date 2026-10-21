'use strict';

const Scrubber = require('./scrubber');

/**
 * Framework adaptörlerinin ortak parçaları.
 *
 * `routePattern` auto.js'ten buraya taşındı: auto.js yüklendiği anda kanca
 * kurar, adaptörler onu içe aktaramaz. Yol bütün girişlerde aynı yazılsın
 * diye tek yerde duruyor — adaptör ile kodsuz kurulum aynı isteği farklı
 * yazarsa panelde iki satır olur.
 */

/**
 * Ham yolu desene yaklaştırır: `/urunler/1042` → `/urunler/{id}`.
 *
 * Yalnızca kimlik gibi görünen parçalar değişir: sayı, uuid, uzun hash.
 * Okunur parçalar (`/oyun/deprem-cantasi`) olduğu gibi kalır — hangi
 * sayfanın bozulduğu panelde görünsün.
 */
function routePattern(url) {
    /*
    | Sıra önemli: normalize ÖNCE, temizlik SONRA.
    |
    | Ters sırada UUID'ler `[token]` desenine takılıyor (36 karakter, 24 hane
    | eşiğinin çok üstünde) ve `/siparis/{uuid}/detay` yerine
    | `/siparis/[token]/detay` çıkıyordu. Testin yakaladığı gerçek bir hataydı.
    */
    let path = String(url || '/')
        .split('?')[0]
        .split('#')[0];

    path =
        path
            .split('/')
            .map((segment) => {
                if (segment === '') return segment;

                // Sayı, uuid, uzun hash: hepsi kimlik.
                if (/^\d+$/.test(segment)) return '{id}';
                if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) {
                    return '{uuid}';
                }
                if (/^[0-9a-f]{16,}$/i.test(segment)) return '{hash}';

                return segment;
            })
            .join('/') || '/';

    // Yolun kendisi kişisel veri taşıyabilir: /kullanici/ahmet@ornek.com
    return Scrubber.text(path, 300) || '/';
}

/*
| Adaptör asıl hatayı gönderdiyse ölçüm aynı istek için ayrıca "HTTP 500"
| göndermesin: tek arıza panelde iki kayıt olur, ikincisi stack'siz ve
| bilgi taşımıyor.
|
| `Symbol.for` bilinçli: Nuxt/Nitro paketi derlenmiş çıktının kendi
| node_modules kopyasından yüklüyor, NODE_OPTIONS ile gelen auto ise kök
| kopyadan. İki ayrı modül örneği aynı işareti ancak küresel sembolle görür.
*/
const REPORTED = Symbol.for('vitalwatch.reported');

function markReported(res) {
    try {
        if (res && typeof res === 'object') res[REPORTED] = true;
    } catch {
        // Donmuş nesne vb. — işaretsiz kalır, en kötü ihtimalle çift kayıt.
    }
}

function wasReported(res) {
    try {
        return Boolean(res && res[REPORTED]);
    } catch {
        return false;
    }
}

/**
 * Durum kodu 500 altındaysa hata değil, uygulamanın bilinçli yanıtı:
 * 404, doğrulama hatası, yetkisiz erişim. Kod yoksa yakalanmamış hata
 * demektir ve framework onu 500'e çevirir.
 */
function isServerError(status) {
    const code = Number(status);

    return !Number.isFinite(code) || code === 0 || code >= 500;
}

/** Hata nesnesinden durum kodu; framework'ler farklı alan kullanıyor. */
function statusOf(error) {
    if (!error || typeof error !== 'object') return undefined;

    try {
        if (typeof error.getStatus === 'function') return error.getStatus();
    } catch {
        // Nest dışı bir getStatus — yok say.
    }

    return error.statusCode ?? error.status;
}

/**
 * Framework'ün sarmaladığı özgün hatayı çıkarır.
 *
 * h3 (Nuxt/Nitro) fırlatılan her hatayı `H3Error` içine koyuyor ve özgün
 * hatayı `cause`'da tutuyor. Sarmalayıcı gönderilirse paneldeki sınıf her
 * zaman `H3Error` olur — `TypeError` ile veritabanı hatası aynı görünür.
 */
function unwrap(error) {
    try {
        /*
         * `name` yeterli değil: h3 1.15 sınıfa ad vermiyor, gerçek
         * sarmalayıcının adı düz "Error". Sınıfın statik işareti kesin.
         */
        const h3 =
            error &&
            (error.name === 'H3Error' ||
                (error.constructor && error.constructor.__h3_error__ === true));

        if (h3 && error.cause instanceof Error) {
            return error.cause;
        }
    } catch {
        // Olduğu gibi gönderilir.
    }

    return error;
}

/**
 * Adaptörlerin ortak bildirim yolu. Hiçbir koşulda fırlatmaz.
 *
 * @param {unknown} error
 * @param {{url?: string, method?: string, status?: unknown, res?: object}} context
 */
function reportRequestError(error, { url, method, status, res } = {}) {
    try {
        if (!isServerError(status ?? statusOf(error))) return;

        const original = unwrap(error);
        const vitalwatch = require('./index');

        // Gönderilmeyecek hatada işaret yok: ölçümün "HTTP 500"ü tek iz olur.
        const willRecord = vitalwatch.reporter().willRecord(original);

        vitalwatch.report(original, {
            kind: 'exception',
            route: url ? routePattern(url) : undefined,
            method: method || undefined,
        });

        if (willRecord) markReported(res);
    } catch {
        // Adaptör uygulamanın hata yolunu hiçbir koşulda bozmaz.
    }
}

module.exports = {
    routePattern,
    markReported,
    wasReported,
    isServerError,
    statusOf,
    unwrap,
    reportRequestError,
};
