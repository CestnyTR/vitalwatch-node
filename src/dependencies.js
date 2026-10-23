'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

/**
 * Bağımlılık listesi — hub'ın OSV.dev üzerinden güvenlik açığı uyarısı
 * üretebilmesi için uygulamanın **production** paketlerinin ad ve sürümleri.
 *
 * Sözleşme dört SDK'da (node, laravel, python, dotnet) birebir aynı:
 *
 * - Uç: `POST /api/i/{key}/deps`, `/server` ile aynı imza.
 * - Gövde: kimlik alanları + `dependencies: {v, ecosystem, manifest, hash, packages}`.
 * - `hash`: ada, sonra sürüme göre sıralı (sıradan kod birimi karşılaştırması,
 *   yerel ayara bağlı değil) `ad@sürüm\n` satırlarının sha256 hex'i.
 * - En çok 5000 paket; serileştirilmiş gövde 500 KB'ı aşarsa hiç gönderilmez.
 *
 * Kaynak yalnızca `package-lock.json`. pnpm/yarn/bun kilit dosyaları
 * okunmuyor: biçimleri ayrı ayrıştırıcı ister ve bağımlılık sıfır kuralı
 * YAML ayrıştırıcı eklemeyi yasaklıyor. O projelerde hiçbir şey gönderilmez,
 * teşhis komutu bunu açıkça yazar.
 *
 * Diske hiçbir şey yazılmaz: son gönderilen özet süreç belleğinde tutulur.
 * Yeniden başlatma bir kez yeniden gönderim demek — hub için zararsız.
 */

const MANIFEST = 'package-lock.json';
const MAX_PACKAGES = 5000;
const MAX_BODY_BYTES = 500 * 1024;

const STARTUP_DELAY_MS = 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const RESEND_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Kilit dosyası içeriğinden paket listesi. Fırlatmaz; anlaşılamayan biçimde
 * boş liste döner.
 *
 * @param {any} lock Ayrıştırılmış package-lock.json
 * @returns {Array<{name: string, version: string}>} sıralı, tekilleştirilmiş, sınırlı
 */
function parseLockfile(lock) {
    const found = [];

    try {
        if (lock && typeof lock === 'object') {
            // v2 her iki biçimi birden taşır; `packages` daha doğru (iç içe
            // kurulumları ve takma adları tam gösterir), o öncelikli.
            if (lock.packages && typeof lock.packages === 'object') {
                fromPackages(lock.packages, found);
            } else if (lock.dependencies && typeof lock.dependencies === 'object') {
                fromDependencyTree(lock.dependencies, found, 0);
            }
        }
    } catch {
        // Bozuk girdi — ne bulunduysa o.
    }

    return canonical(found);
}

/** lockfileVersion 2/3: `node_modules/a/node_modules/b` biçimli düz harita. */
function fromPackages(packages, found) {
    for (const [key, entry] of Object.entries(packages)) {
        if (key === '' || !entry || typeof entry !== 'object') continue;
        if (entry.dev === true || entry.link === true) continue;

        const marker = key.lastIndexOf('node_modules/');
        // node_modules altında olmayan anahtar çalışma alanının (workspace)
        // kendi kaynak klasörü — uygulamanın kendi kodu, kayıt paketi değil.
        if (marker === -1) continue;

        /*
         * Takma ad (`"x": "npm:gercek@1"`) anahtarda takma adı, `name`
         * alanında gerçek paketi taşır. Açık veritabanı gerçek adı tanır.
         */
        const name = typeof entry.name === 'string' && entry.name
            ? entry.name
            : key.slice(marker + 'node_modules/'.length);

        push(found, name, entry.version);
    }
}

/** lockfileVersion 1: iç içe `dependencies` ağacı. */
function fromDependencyTree(tree, found, depth) {
    // Bozuk ya da döngülü yapıya karşı derinlik sınırı.
    if (depth > 64) return;

    for (const [name, entry] of Object.entries(tree)) {
        if (!entry || typeof entry !== 'object' || entry.dev === true) continue;

        // v1'de yerel bağlantılar `file:` sürümüyle yazılır (v2'deki link: true).
        if (typeof entry.version === 'string' && !entry.version.startsWith('file:')) {
            push(found, name, entry.version);
        }

        if (entry.dependencies && typeof entry.dependencies === 'object') {
            fromDependencyTree(entry.dependencies, found, depth + 1);
        }
    }
}

function push(found, name, version) {
    if (typeof name !== 'string' || typeof version !== 'string') return;

    name = name.trim();
    version = version.trim();

    if (name && version) found.push({ name, version });
}

/**
 * Ada, sonra sürüme göre sıralar; aynı ad@sürüm tekilleşir, farklı
 * sürümler ayrı kalır (ikisi de açıklı olabilir). Sınır sıralamadan sonra.
 */
function canonical(list) {
    const seen = new Set();
    const unique = [];

    for (const item of list) {
        const id = `${item.name}@${item.version}`;
        if (seen.has(id)) continue;
        seen.add(id);
        unique.push({ name: item.name, version: item.version });
    }

    // localeCompare değil: özet dört SDK'da ve hub'da aynı çıkmalı.
    unique.sort((a, b) => compare(a.name, b.name) || compare(a.version, b.version));

    return unique.slice(0, MAX_PACKAGES);
}

function compare(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}

/** Sıralı listenin sha256 hex özeti: her satır `ad@sürüm\n`. */
function hashPackages(packages) {
    const hash = createHash('sha256');

    for (const item of packages) hash.update(`${item.name}@${item.version}\n`);

    return hash.digest('hex');
}

/**
 * Uygulama kökündeki kilit dosyasını okur. Fırlatmaz.
 *
 * @param {string} [root] varsayılan `process.cwd()` — `.env` okuması ve sürüm
 *   etiketi de aynı kökü kullanıyor.
 * @returns {{supported: true, dependencies: object} | {supported: false, error: string}}
 */
function readDependencies(root) {
    let content;

    try {
        content = fs.readFileSync(path.join(root === undefined ? process.cwd() : root, MANIFEST), 'utf8');
    } catch {
        // Next standalone çıktısı, pnpm/yarn/bun projesi: kilit dosyası yok.
        return { supported: false, error: 'no-lockfile' };
    }

    try {
        const packages = parseLockfile(JSON.parse(content));

        return {
            supported: true,
            dependencies: {
                v: 1,
                ecosystem: 'npm',
                manifest: MANIFEST,
                hash: hashPackages(packages),
                packages,
            },
        };
    } catch {
        return { supported: false, error: 'unreadable-lockfile' };
    }
}

/**
 * Arka plan zamanlayıcısı.
 *
 * Başlangıçtan 60 sn sonra ilk gönderim; ardından saatte bir kilit dosyası
 * yeniden okunur ve özet son gönderilenden farklıysa ya da son başarılı
 * gönderimden bu yana 24 saat geçtiyse gönderilir. Özet değişikliği ancak
 * süreç yeniden başlatılmadan dosya değiştiğinde olur (yerinde deploy);
 * yeniden başlatmada zaten baştan gönderiliyor.
 *
 * Gönderim başarısızsa (ağ, zaman aşımı) durum güncellenmez, bir sonraki
 * kontrol yeniden dener. Zamanlayıcılar `unref`: süreci ayakta tutmaz.
 */
class DependencySchedule {
    /**
     * @param {{
     *   send: (dependencies: object) => Promise<{sent: boolean}>,
     *   read?: () => ReturnType<typeof readDependencies>,
     *   now?: () => number,
     *   timers?: {setTimeout: Function, clearTimeout: Function, setInterval: Function, clearInterval: Function},
     *   delayMs?: number, checkMs?: number, resendMs?: number,
     * }} options
     */
    constructor(options) {
        this.sendFn = options.send;
        this.read = options.read || (() => readDependencies());
        this.now = options.now || Date.now;
        this.timers = options.timers || { setTimeout, clearTimeout, setInterval, clearInterval };
        this.delayMs = options.delayMs ?? STARTUP_DELAY_MS;
        this.checkMs = options.checkMs ?? CHECK_INTERVAL_MS;
        this.resendMs = options.resendMs ?? RESEND_INTERVAL_MS;

        this.lastHash = null;
        this.lastSentAt = null;
        this.running = false;
        this.startTimer = null;
        this.checkTimer = null;
    }

    start() {
        if (this.startTimer || this.checkTimer) return;

        this.startTimer = this.timers.setTimeout(() => {
            this.startTimer = null;
            this.check();

            this.checkTimer = this.timers.setInterval(() => this.check(), this.checkMs);
            unref(this.checkTimer);
        }, this.delayMs);

        unref(this.startTimer);
    }

    stop() {
        if (this.startTimer) this.timers.clearTimeout(this.startTimer);
        if (this.checkTimer) this.timers.clearInterval(this.checkTimer);
        this.startTimer = null;
        this.checkTimer = null;
    }

    /**
     * Gerekirse gönderir. Fırlatmaz; eşzamanlı ikinci çağrı atlanır.
     *
     * @returns {Promise<boolean>} gönderim yapıldı mı
     */
    async check() {
        if (this.running) return false;
        this.running = true;

        try {
            const result = this.read();
            if (!result || !result.supported) return false;

            const { hash } = result.dependencies;
            const due =
                hash !== this.lastHash ||
                this.lastSentAt === null ||
                this.now() - this.lastSentAt >= this.resendMs;

            if (!due) return false;

            const sent = await this.sendFn(result.dependencies);

            if (sent && sent.sent) {
                this.lastHash = hash;
                this.lastSentAt = this.now();

                return true;
            }

            return false;
        } catch {
            return false;
        } finally {
            this.running = false;
        }
    }
}

function unref(timer) {
    if (timer && typeof timer.unref === 'function') timer.unref();
}

module.exports = {
    parseLockfile,
    hashPackages,
    readDependencies,
    DependencySchedule,
    MANIFEST,
    MAX_PACKAGES,
    MAX_BODY_BYTES,
    STARTUP_DELAY_MS,
    CHECK_INTERVAL_MS,
    RESEND_INTERVAL_MS,
};
