'use strict';

/**
 * Kişisel veri temizliği — gönderimden ÖNCE uygulanır.
 *
 * Hub tarafında aynı temizlik tekrar yapılır. İkisi de gereklidir: hub kendini
 * savunur, paket ise kişisel veriyi ağa hiç çıkarmaz. Bir sızıntı olacaksa ilk
 * savunma hattı burasıdır.
 *
 * Desenler `cestnytr/vitalwatch-laravel` (PHP) paketiyle birebir aynı tutulur; ikisi ayrışırsa
 * aynı hata iki farklı SDK'da farklı maskelenir ve parmak izi bölünür.
 */

const PATTERNS = [
    /*
    | PHP paketindeki desenin birebir karşılığı. Gevşek bir sürüm
    | (`[^\s@]+`) eğik çizgiyi de yutuyor ve `/kullanici/a@b.com/profil`
    | yolunun tamamını maskeliyordu — testin yakaladığı gerçek bir farktı.
    */
    [/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu, '[email]'],
    [/\bTR(?:[\s-]?\d){24}\b/gi, '[iban]'],
    // Aday; karar isCard'da — dosya adındaki zaman damgası kart sanılmasın.
    [/\b\d(?:[\s-]?\d){12,18}\b/g, (m) => (isCard(m) ? '[card]' : m)],
    [/\b[1-9]\d{10}\b/g, '[national_id]'],
    // Önünde rakam olamaz: `1795123456789` damgası `179[phone]` oluyordu.
    [/(?<!\d)(?:\+?90|0)?[\s-]?5\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/g, '[phone]'],
    /*
    | Uzun rastgele diziler: oturum kimliği, API anahtarı, jeton, hash.
    | Gerçek bir sızıntıda yakalandı — veritabanı hatasının mesajı SQL'i
    | bağlanmış değerlerle taşıyordu ve içinde oturum kimliği vardı.
    |
    | 24 hane eşiği bilinçli: oturum kimlikleri 40, API anahtarları 32+;
    | normal kelimeler ve sınıf adları bu uzunluğa ulaşmaz.
    */
    // Aday; karar isToken'da — okunur dosya adları maskelenmesin.
    [/[A-Za-z0-9][A-Za-z0-9_-]{23,}/g, (m) => (isToken(m) ? '[token]' : m)],
];

/**
 * Gerçek kart numarası: 2-9 ile başlar ve Luhn'dan geçer.
 *
 * Kart ağlarının hiçbiri 0/1 ile başlamıyor; milisaniye zaman damgası 1 ile
 * başlıyor. Yükleme dosya adlarındaki damga (`urun-1726571234567-75206.png`)
 * kart sanılıyor, panelde `[card]` görünüyordu. Her gerçek kart Luhn'u
 * geçtiği için kısıt gizlilikten bir şey kaybettirmez.
 */
function isCard(candidate) {
    const digits = candidate.replace(/\D/g, '');
    if (digits === '' || digits[0] < '2') return false;

    let sum = 0;
    let double = false;
    for (let i = digits.length - 1; i >= 0; i--) {
        let d = Number(digits[i]);
        if (double) {
            d *= 2;
            if (d > 9) d -= 9;
        }
        sum += d;
        double = !double;
    }

    return sum % 10 === 0;
}

/**
 * Rastgele dizi: tire/alt çizgiyle bölünmemiş 16+ karakterlik parça taşır ya
 * da harf içeren hex'tir (UUID, hash). Tireyle birleşmiş kısa parçalar okunur
 * addır: `kampanya-gorseli-yaz-indirimi-1726571234567`.
 *
 * Bilinen taviz: tire/alt çizgisi sık düşen base64url jetonların küçük bir
 * kısmı kaçabilir. Oturum kimliği, API anahtarı, JWT, hex ve UUID etkilenmez.
 */
function isToken(candidate) {
    // Düz CamelCase/camelCase ad jeton değildir: gerçek jeton ve oturum
    // kimlikleri neredeyse hep rakam taşır; rakamsız, yan yana iki büyük
    // harfi olmayan ve küçük harfle biten 24+ karakterlik rastgele dizinin
    // olasılığı 1/10.000'in çok altında. .NET'in `InvalidOperationException`
    // gibi adları maskeleniyor, yığın izleri okunmaz oluyordu.
    if (/^[A-Za-z][a-z]+(?:[A-Z][a-z]+)+$/.test(candidate)) return false;

    if (candidate.split(/[-_]/).some((part) => part.length >= 16)) return true;

    const compact = candidate.replace(/[-_]/g, '');

    return /^[0-9a-f]+$/i.test(compact) && /[a-f]/i.test(compact);
}

function text(value, limit) {
    if (value === null || value === undefined || value === '') return null;

    let s = String(value);
    for (const [pattern, yerine] of PATTERNS) s = s.replace(pattern, yerine);

    return s.slice(0, limit);
}

/** Query string ve fragment atılır; yalnızca yol kalır (M3). */
function path(value) {
    if (!value) return null;

    let path = String(value);

    try {
        // Taban adres yalnızca göreli yolları çözmek için; dışarı çıkmıyor.
        path = new URL(path, 'http://local').pathname;
    } catch {
        path = path.split('?')[0].split('#')[0];
    }

    return text(path, 300);
}

/**
 * SQL normalize: literal değerler `?` ile değiştirilir.
 * `where email = 'ahmet@ornek.com'` → `where email = ?`
 *
 * Hem KVKK gereği hem gruplama açısından doğru: aynı sorgu farklı
 * parametrelerle çalıştığında tek parmak izinde toplanır.
 */
function sql(value) {
    if (!value) return null;

    let s = String(value)
        .replace(/'(?:[^']|'')*'/g, '?')
        .replace(/"(?:[^"]|"")*"/g, '?')
        .replace(/\b\d+(?:\.\d+)?\b/g, '?')
        .replace(/\b(IN)\s*\(\s*\?(?:\s*,\s*\?)+\s*\)/gi, '$1 (?)');

    return text(s.replace(/\s+/g, ' ').trim(), 500);
}

/**
 * Hata mesajı.
 *
 * Veritabanı sürücülerinin hataları SQL'i bağlanmış değerlerle taşır; önce
 * SQL normalize edilir, sonra genel maskeleme uygulanır. Yalnızca sorgu
 * alanını temizlemek yetmiyordu — asıl sızıntı mesajın kendisinden oluyordu.
 */
function message(value, sqlIceriyor = false) {
    if (!value) return null;

    let s = String(value);

    if (sqlIceriyor) {
        s = s
            .replace(/'(?:[^']|'')*'/g, '?')
            .replace(/"(?:[^"]|"")*"(\s*=\s*)\S+/g, '"?"$1?');
    }

    return text(s, 500);
}

/**
 * Stack trace kısaltılır ve maskelenir. node_modules satırları atılmaz —
 * hatanın nerede olduğunu bulmak için zincirin tamamı gerekir — ama uzunluk
 * sınırlanır.
 */
function stack(value) {
    return text(value, 2000);
}

module.exports = { text, path, sql, message, stack };
