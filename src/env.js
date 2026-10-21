'use strict';

const { readFileSync } = require('node:fs');
const { join } = require('node:path');

/**
 * Yapılandırmayı süreç ortamından ve `.env` dosyalarından okur.
 *
 * `.env` okuması gereksiz görünebilir — çoğu framework zaten okuyor. Ama iki
 * durumda okumuyor ve ikisi de sessiz arıza üretiyordu:
 *
 * 1. **`--require` ile ön yükleme.** `auto.js`, Node başlarken çalışır;
 *    Next/Nuxt kendi `.env`'ini çok daha sonra okur. Bu noktada `process.env`
 *    boştur, paket "yapılandırma eksik" deyip hiçbir kanca kurmaz ve hiçbir
 *    şey söylemez.
 * 2. **`npx vitalwatch-status`.** Ayrı bir süreç; uygulamanın `.env`'i hiç
 *    yüklenmez. Gerçek bir kurulumda `.env` doğru doldurulmuşken komut
 *    "TANIMSIZ" dedi — teşhis aracının yanlış teşhis koyması, hiç teşhis
 *    koymamaktan kötüdür.
 *
 * Öncelik: `process.env` > `.env.<NODE_ENV>` > `.env.local` > `.env`.
 * Süreç ortamı **her zaman kazanır**; dosya yalnızca boşluğu doldurur.
 *
 * Yalnızca `VITALWATCH_` ile başlayan anahtarlar okunur — paketin başka hiçbir
 * değişkeni görmesine gerek yok.
 */

const PREFIX = 'VITALWATCH_';

let cache = null;

/** @returns {Record<string, string>} */
function env() {
    if (cache) return cache;

    const values = {};

    // Sondan başa: önce en zayıf kaynak yazılır, güçlü olan üzerine yazar.
    for (const file of files().reverse()) {
        Object.assign(values, read(file));
    }

    for (const [key, value] of Object.entries(process.env)) {
        if (key.startsWith(PREFIX) && value !== undefined && value !== '') {
            values[key] = value;
        }
    }

    cache = values;

    return values;
}

/** @returns {string[]} güçlüden zayıfa */
function files() {
    const name = process.env.NODE_ENV;

    return [name ? `.env.${name}` : null, '.env.local', '.env'].filter(Boolean);
}

/**
 * Küçük bir `.env` ayrıştırıcı — bağımlılık politikası gereği `dotenv`
 * eklenmiyor. Desteklenenler: `ANAHTAR=deger`, tırnaklı değer, `#` yorum,
 * `export ` öneki. `.env` sözdiziminin tamamı değil ama bu paketin okuduğu
 * beş değişken için fazlasıyla yeterli.
 *
 * @returns {Record<string, string>}
 */
function read(file) {
    const values = {};

    let content;
    try {
        content = readFileSync(join(process.cwd(), file), 'utf8');
    } catch {
        // Dosya yoksa ya da okunamıyorsa sessizce geç.
        return values;
    }

    for (const raw of content.split('\n')) {
        const line = raw.trim().replace(/^export\s+/, '');

        if (!line || line.startsWith('#')) continue;

        const separator = line.indexOf('=');
        if (separator < 1) continue;

        const key = line.slice(0, separator).trim();
        if (!key.startsWith(PREFIX)) continue;

        let value = line.slice(separator + 1).trim();

        // Tırnak içindeyse tırnaklar atılır; değilse satır sonu yorumu kesilir.
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        } else {
            value = value.split(' #')[0].trim();
        }

        if (value !== '') values[key] = value;
    }

    return values;
}

/** Test için: önbelleği düşürür. */
function forget() {
    cache = null;
}

module.exports = { env, forget };
