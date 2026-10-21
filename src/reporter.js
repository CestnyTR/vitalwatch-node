'use strict';

const { HubClient } = require('./client');
const Scrubber = require('./scrubber');
const { normalizeEnv } = require('./environment');

const SDK_VERSION = require('../package.json').version;

/*
| WeakSet yalnızca kendi modül örneğini görüyor. Nuxt paketi iki ayrı
| derleme çıktısına gömüyor (Nitro sunucusu ve Vue SSR paketi); ikisi aynı
| SSR hatasını görüyor ve her kopya kendi WeakSet'ine bakıp gönderiyordu —
| gerçek bir Nuxt 3.21 derlemesinde her hata panelde iki kez çıktı.
| İşaret hata nesnesinin üstünde, küresel sembolle: bütün kopyalar görür.
*/
const REPORTED = Symbol.for('vitalwatch.error.reported');

function markError(error) {
    try {
        // Sayılamaz: uygulamanın hatayı JSON'a çevirmesi ya da gezmesi değişmez.
        Object.defineProperty(error, REPORTED, { value: true });
    } catch {
        // Donmuş nesne — WeakSet tek başına korur.
    }
}

/**
 * Ölçüm biriktirir ve olayları hub'a gönderir.
 *
 * PHP paketinden (cestnytr/vitalwatch-laravel) bir yapısal fark var: orada Recorder istek
 * başına tekil, burada süreç boyunca tekil. Node'da tek süreç binlerce isteği
 * karşılıyor, istek başına durum tutmak sızıntı olurdu — bu yüzden istek
 * bağlamı çağrı anında parametre olarak geçiliyor, alanda saklanmıyor.
 */
class Reporter {
    constructor(options = {}) {
        this.client = new HubClient(options);
        this.enabled = options.enabled !== false;
        this.env = normalizeEnv(options.env);
        this.release = options.release || null;
        this.source = options.source || 'server';
        this.slowRequestMs = options.slowRequestMs ?? 1000;
        this.ignore = options.ignore || [];

        /*
         * Aynı hatayı iki kez raporlamamak için. WeakSet: hata nesnesi çöp
         * toplandığında kayıt da düşer, uzun ömürlü süreçte bellek sızmaz.
         */
        this.reported = new WeakSet();
    }

    configured() {
        return this.enabled && this.client.configured();
    }

    /**
     * `recordException` bu hatayı gönderecek mi — senkron, fırlatmaz.
     *
     * Yanıtı işaretleyen yollar (adaptörler, `report(hata, { res })`,
     * `errors()`) önce buna bakıyor. Gönderilmeyecek hatada işaret konursa
     * ölçüm de "HTTP 500" açmaz ve arıza hiç iz bırakmaz: modül düzeyinde
     * tek bir hata nesnesini her istekte fırlatan uygulamada ilk istekten
     * sonraki bütün 500'ler kayboluyordu. Gönderimin ağda başarısız olması
     * burada bilinemez; o durumda da tek kayıt kaybolur, iki değil.
     *
     * @param {unknown} error
     * @returns {boolean}
     */
    willRecord(error) {
        try {
            if (!this.configured() || this.ignored(error)) return false;

            if (error && typeof error === 'object') {
                return !(this.reported.has(error) || error[REPORTED]);
            }

            return true;
        } catch {
            return false;
        }
    }

    /**
     * @param {unknown} error
     * @param {{kind?: string, route?: string, method?: string}} [context]
     * @returns {Promise<{sent: boolean, status?: number, error?: string}>}
     */
    async recordException(error, context = {}) {
        try {
            if (!this.configured()) {
                return { sent: false, error: 'missing-config' };
            }

            if (this.ignored(error)) {
                return { sent: false, error: 'ignored' };
            }

            if (error && typeof error === 'object') {
                if (this.reported.has(error) || error[REPORTED]) {
                    return { sent: false, error: 'already-reported' };
                }

                this.reported.add(error);
                markError(error);
            }

            const message = error && error.message ? error.message : String(error);

            return await this.send({
                kind: context.kind || 'exception',
                // Veritabanı hataları SQL'i bağlanmış değerlerle taşır;
                // oturum kimliği, e-posta, kart numarası oradan sızabilir.
                msg: Scrubber.message(message, this.containsSql(error)),
                exception_class: (error && error.name) || 'Error',
                stack: Scrubber.stack(error && error.stack),
                route: context.route,
                method: context.method,
            });
        } catch (e) {
            // Kendi hatasını raporlamaz — sonsuz döngü riski. Sonuç yalnızca
            // teşhis komutu için üretiliyor.
            return { sent: false, error: (e && e.message) || String(e) };
        }
    }

    /**
     * İstek bitiminde çağrılır. Yalnızca yavaş istek veya 5xx raporlanır;
     * her isteği göndermek izlenen uygulamaya da hub'a da yük olurdu.
     */
    async recordRequest({ route, method, status, durationMs }) {
        try {
            if (!this.configured()) return;

            const slow = durationMs >= this.slowRequestMs;
            if (!slow && status < 500) return;

            const label = `${method} ${route}`;

            await this.send({
                kind: status >= 500 ? 'http_5xx' : 'slow_request',
                msg:
                    status >= 500
                        ? `${label} — HTTP ${status}`
                        : `${label} — ${Math.round(durationMs)} ms`,
                route: label,
                method,
                status,
                duration_ms: Math.round(durationMs),
                memory_mb: Math.round(process.memoryUsage().rss / 1048576),
            });
        } catch {
            // Sessiz.
        }
    }

    /**
     * Ortak alanları ekleyip gönderir.
     *
     * @param {Record<string, unknown>} event
     * @returns {Promise<{sent: boolean, status?: number, error?: string}>}
     */
    async send(event) {
        const body = {
            ...event,
            env: this.env,
            source: this.source,
            release: this.release,
            /*
             * Çalışma ortamı ve SDK sürümü. Hub bunları bağlamda saklıyor;
             * sdk_version olmadan hangi projenin eski sürümde kaldığı
             * görülemez ve güncelleme körlemesine yapılır.
             */
            runtime: 'node',
            runtime_version: process.version,
            sdk_version: SDK_VERSION,
        };

        for (const key of Object.keys(body)) {
            if (body[key] === null || body[key] === undefined) {
                delete body[key];
            }
        }

        return await this.client.send(body);
    }

    /**
     * "Buradayım" — olay taşımayan canlılık isteği.
     *
     * Hub'ın bir kurulumun çalıştığını anlamasının tek yolu buydu: hata
     * gelmesi. Sonuç ters dönüyordu — hatasız çalışan uygulama "kurulum
     * bozuk" görünüyordu. Artık kanıt isteğin kendisi; boş bir toplu istek
     * yeterli ve ayrı bir uca gerek yok.
     *
     * @returns {Promise<{sent: boolean, status?: number, error?: string}>}
     */
    async heartbeat() {
        if (!this.configured()) {
            return { sent: false, error: 'missing-config' };
        }

        return await this.send({ events: [] });
    }

    /**
     * Mesajı SQL taşıyan hatalar. Sürücü paketlerine bağımlılık kurulmadığı
     * için ada ve içeriğe bakılıyor.
     */
    containsSql(error) {
        const name = (error && error.name) || '';
        const message = (error && error.message) || '';

        return (
            /sequelize|prisma|query|database|pg|mysql/i.test(name) ||
            /\bselect\b|\binsert\b|\bupdate\b|\bdelete\b/i.test(message)
        );
    }

    ignored(error) {
        const name = (error && error.name) || '';

        /*
         * `instanceof` yalnızca sınıfa uygulanır. Dize girdiye uygulanınca
         * TypeError fırlatıyordu; recordException onu yakalayıp vazgeçtiği
         * için `ignore: ['Ad']` veren kurulumda adı TUTMAYAN bütün hatalar
         * da sessizce düşüyordu.
         */
        return this.ignore.some(
            (entry) =>
                entry === name ||
                (typeof entry === 'function' && Boolean(error) && error instanceof entry),
        );
    }
}

module.exports = { Reporter, SDK_VERSION };
