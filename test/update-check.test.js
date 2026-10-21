'use strict';

const { test, after } = require('node:test');
const fs = require('node:fs');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const { checkForUpdate, latestVersion, isNewer, REGISTRY_URL } = require('../src/update-check');
const { version } = require('../src/index');
const { ENV_NAMES } = require('../src/release');

/*
| `vitalwatch-status` npm'deki son sürümü gösterir. Yalnızca teşhis komutunda;
| ağ hatası ya da güncelleme olması komutu başarısız saymaz.
*/

test('sürümler sayısal karşılaştırılır, ön sürüm eskidir', () => {
    const newer = [
        ['0.5.1', '0.5.0'], ['0.10.0', '0.9.9'], ['1.0.0', '0.99.99'], ['v0.6.0', '0.5.0'],
        ['0.5.0', '0.5.0-beta.1'], ['0.5.0', 'v0.5.0-rc.2'],
    ];
    const notNewer = [
        ['0.5.0', '0.5.0'], ['0.4.9', '0.5.0'], ['0.9.0', '0.10.0'], ['0.5.0-beta.1', '0.5.0'],
        ['0.5.0-beta.2', '0.5.0-beta.1'], ['broken', '0.5.0'], ['0.6.0', 'broken'], [undefined, '0.5.0'], ['0.6', '0.5.0'],
    ];

    for (const [a, b] of newer) assert.strictEqual(isNewer(a, b), true, `${a} > ${b}`);
    for (const [a, b] of notNewer) assert.strictEqual(isNewer(a, b), false, `${a} !> ${b}`);
});

test('son sürüm npm registry den okunur, zaman aşımıyla', async () => {
    let called;
    const latest = await latestVersion(async (url, options) => {
        called = { url, options };

        return { ok: true, json: async () => ({ name: 'vitalwatch-node', version: '0.7.1' }) };
    });

    assert.strictEqual(latest, '0.7.1');
    assert.strictEqual(called.url, 'https://registry.npmjs.org/vitalwatch-node/latest');
    assert.strictEqual(called.url, REGISTRY_URL);
    assert.ok(called.options.signal instanceof AbortSignal);
});

test('ağ hatası, HTTP hatası ve bozuk yanıt null döner, fırlatmaz', async () => {
    const cases = [
        async () => {
            throw new Error('ağ yok');
        },
        async () => ({ ok: false, status: 503, json: async () => ({ version: '9.9.9' }) }),
        async () => ({ ok: true, json: async () => { throw new SyntaxError('json değil'); } }),
        async () => ({ ok: true, json: async () => ({ version: 'latest' }) }),
        async () => ({ ok: true, json: async () => null }),
        async () => undefined,
        'fonksiyon değil',
    ];

    for (const fetchImpl of cases) {
        assert.strictEqual(await latestVersion(fetchImpl), null);
    }
});

test('VITALWATCH_STATUS_OFFLINE=1 denetimi atlar, ağa çıkılmaz', async () => {
    let calls = 0;
    const result = await checkForUpdate('0.5.0', {
        env: { VITALWATCH_STATUS_OFFLINE: '1' },
        fetch: async () => {
            calls++;
        },
    });

    assert.deepStrictEqual(result, { latest: null, skipped: true, newer: false });
    assert.strictEqual(calls, 0);
});

test('checkForUpdate yeni sürümü bildirir', async () => {
    const reply = (v) => async () => ({ ok: true, json: async () => ({ version: v }) });

    assert.deepStrictEqual(await checkForUpdate('0.5.0', { env: {}, fetch: reply('0.6.0') }), {
        latest: '0.6.0', skipped: false, newer: true,
    });
    assert.deepStrictEqual(await checkForUpdate('0.5.0', { env: {}, fetch: reply('0.5.0') }), {
        latest: '0.5.0', skipped: false, newer: false,
    });
    assert.deepStrictEqual(await checkForUpdate('0.5.0', { env: {}, fetch: async () => { throw new Error('x'); } }), {
        latest: null, skipped: false, newer: false,
    });
});

// --- Komutun kendisi ---------------------------------------------------------

const BIN = path.join(__dirname, '../bin/vitalwatch-status.js');
const EMPTY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vitalwatch-status-'));
after(() => fs.rmSync(EMPTY_DIR, { recursive: true, force: true }));

/**
 * Komutu ayrı süreçte çalıştırır; `fetch` önceden sahtesiyle değiştirilir,
 * test ağa çıkmaz. `fetchBody` null ise ağ hatası taklit edilir.
 */
function runStatus(fetchBody, extraEnv = {}) {
    const stub =
        fetchBody === null
            ? `globalThis.fetch = async () => { throw new Error('ağ yok'); };`
            : `globalThis.fetch = async (url) => { if (!String(url).includes('registry.npmjs.org')) throw new Error('beklenmeyen istek'); return { ok: true, json: async () => (${JSON.stringify(fetchBody)}) }; };`;

    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith('VITALWATCH_')) delete env[key];
    // Çalıştıran ortamın CI değişkenleri sürüm etiketi sınamasını bozmasın.
    for (const key of ENV_NAMES) delete env[key];

    return spawnSync(process.execPath, ['-e', `${stub} require(${JSON.stringify(BIN)});`], {
        env: {
            ...env,
            VITALWATCH_URL: 'https://hub.sample',
            VITALWATCH_KEY: 'k',
            VITALWATCH_SECRET: 'a'.repeat(64),
            VITALWATCH_ENV: 'production',
            ...extraEnv,
        },
        // Boş dizin: .git yok, .env yok.
        cwd: EMPTY_DIR,
        encoding: 'utf8',
    });
}

test('vitalwatch-status güncel sürümü gösterir; güncelleme uyarıdır, başarısızlık değil', () => {
    const newer = runStatus({ version: '99.0.0' });
    assert.strictEqual(newer.status, 0, newer.stderr);
    assert.match(newer.stdout, /Güncel sürüm\s+99\.0\.0/);
    assert.ok(newer.stdout.includes('Güncelleme var: npm install vitalwatch-node@latest'));

    const same = runStatus({ version });
    assert.strictEqual(same.status, 0, same.stderr);
    assert.match(same.stdout, new RegExp(`Güncel sürüm\\s+${version.replace(/\./g, '\\.')}`));
    assert.ok(!same.stdout.includes('Güncelleme var'));
});

test('vitalwatch-status npm e ulaşamazsa "denetlenemedi" yazar, çıkış kodu değişmez', () => {
    const result = runStatus(null);

    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /Güncel sürüm\s+denetlenemedi/);
});

test('vitalwatch-status çevrimdışı modda güncelleme satırı basmaz ve fetch çağırmaz', () => {
    const result = runStatus(null, { VITALWATCH_STATUS_OFFLINE: '1' });

    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(!result.stdout.includes('Güncel sürüm'));
});

test('vitalwatch-status sürüm etiketini ve kaynağını gösterir', () => {
    const fromEnv = runStatus(null, { VITALWATCH_STATUS_OFFLINE: '1', VITALWATCH_RELEASE: 'v9' });
    assert.match(fromEnv.stdout, /Sürüm etiketi\s+v9 \(kaynak: VITALWATCH_RELEASE\)/);

    const fromCi = runStatus(null, { VITALWATCH_STATUS_OFFLINE: '1', CI_COMMIT_SHA: 'ABCDEF1234567890' });
    assert.match(fromCi.stdout, /Sürüm etiketi\s+abcdef123456 \(kaynak: CI_COMMIT_SHA\)/);

    // Geçici dizinde .git yok, değişken yok.
    const none = runStatus(null, { VITALWATCH_STATUS_OFFLINE: '1' });
    assert.match(none.stdout, /Sürüm etiketi\s+tanımsız \(kaynak: yok\)/);
});

/* Laravel ve Python paketleriyle aynı kabul kümesi. */
test('çevrimdışı anahtarı evet/true/on değerlerini de kabul eder', async () => {
    for (const value of ['true', 'Evet', 'on', 'yes']) {
        let called = false;
        const result = await checkForUpdate('0.5.0', {
            env: { VITALWATCH_STATUS_OFFLINE: value },
            fetch: async () => {
                called = true;
                throw new Error('çağrılmamalı');
            },
        });

        assert.strictEqual(result.skipped, true, value);
        assert.strictEqual(called, false, value);
    }
});
