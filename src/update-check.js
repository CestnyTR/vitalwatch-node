'use strict';

/**
 * `vitalwatch-status` için güncelleme denetimi. YALNIZCA teşhis komutunda
 * kullanılır; `index.js` bu dosyayı yüklemez — izlenen uygulamanın çalışma
 * yolunda npm'e hiçbir istek atılmaz.
 *
 * Ağ hatası, zaman aşımı, bozuk yanıt: sonuç "denetlenemedi", komutun çıkış
 * kodu değişmez. Güncelleme olması da bir hata değil, uyarı.
 */

const REGISTRY_URL = 'https://registry.npmjs.org/vitalwatch-node/latest';
const TIMEOUT_MS = 2000;

/**
 * `v1.2.3`, `1.2.3-beta.1` → `{ parts: [1,2,3], prerelease: bool }`.
 * Geçersizse null.
 */
function parse(version) {
    if (typeof version !== 'string') return null;

    const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
        version.trim(),
    );
    if (!match) return null;

    return {
        parts: [Number(match[1]), Number(match[2]), Number(match[3])],
        prerelease: match[4] !== undefined,
    };
}

/**
 * `latest`, `installed`dan yeni mi. Sayısal karşılaştırma (1.10.0 > 1.9.0).
 * Ön sürüm etiketinin içi karşılaştırılmaz: aynı numarada ön sürüm her
 * zaman eskidir. Geçersiz girdide false — "güncelleme var" demek için emin
 * olmak gerekir.
 */
function isNewer(latest, installed) {
    const a = parse(latest);
    const b = parse(installed);
    if (!a || !b) return false;

    for (let i = 0; i < 3; i++) {
        if (a.parts[i] !== b.parts[i]) return a.parts[i] > b.parts[i];
    }

    return !a.prerelease && b.prerelease;
}

/**
 * npm'deki en güncel sürüm; alınamazsa null. Fırlatmaz.
 *
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<string|null>}
 */
async function latestVersion(fetchImpl = globalThis.fetch) {
    try {
        const response = await fetchImpl(REGISTRY_URL, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (!response || !response.ok) return null;

        const body = await response.json();
        const version = body && body.version;

        return parse(version) ? String(version).trim() : null;
    } catch {
        return null;
    }
}

/**
 * Teşhis komutunun basacağı satırlar.
 *
 * @param {string} installed
 * @param {{env?: Record<string, string|undefined>, fetch?: typeof fetch}} [options]
 * @returns {Promise<{latest: string|null, skipped: boolean, newer: boolean}>}
 */
async function checkForUpdate(installed, { env = process.env, fetch: fetchImpl } = {}) {
    // Laravel ve Python paketleriyle aynı kabul kümesi.
    if (['1', 'true', 'yes', 'on', 'evet'].includes(String(env.VITALWATCH_STATUS_OFFLINE ?? '').trim().toLowerCase())) {
        return { latest: null, skipped: true, newer: false };
    }

    const latest = await latestVersion(fetchImpl);

    return { latest, skipped: false, newer: latest !== null && isNewer(latest, installed) };
}

module.exports = { checkForUpdate, latestVersion, isNewer, parse, REGISTRY_URL };
