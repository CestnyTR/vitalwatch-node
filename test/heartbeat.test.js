'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const { Reporter } = require('../src/reporter');

const OPTIONS = {
    url: 'https://hub.sample',
    key: 'example-project',
    secret: 'a'.repeat(64),
    env: 'production',
};

let sent = [];
let originalFetch;

beforeEach(() => {
    sent = [];
    originalFetch = global.fetch;

    global.fetch = async (url, options) => {
        sent.push({ url, body: JSON.parse(options.body) });

        return { status: 204, ok: true };
    };
});

afterEach(() => {
    global.fetch = originalFetch;
});

/*
 * Hub bir kurulumun çalıştığını yalnızca hata gelmesinden anlıyordu; hatasız
 * uygulama "kurulum bozuk" görünüyordu. Kanıt artık isteğin kendisi.
 */
test('canlılık isteği olay taşımaz', async () => {
    const result = await new Reporter(OPTIONS).heartbeat();

    assert.equal(result.sent, true);
    assert.equal(sent.length, 1);

    // Boş toplu istek: hub sıfır olay işler ama canlılığı damgalar.
    assert.deepEqual(sent[0].body.events, []);
});

test('canlılık isteği kimlik alanlarını taşır', async () => {
    await new Reporter(OPTIONS).heartbeat();

    const { body } = sent[0];

    // Hangi eksenin canlı olduğu source'tan okunuyor: sunucudan gelen istek
    // tarayıcı eksenini canlı göstermemeli.
    assert.equal(body.source, 'server');
    assert.equal(body.env, 'production');
    // Sürüm olmadan hangi projenin eski SDK'da kaldığı görülemez.
    assert.ok(body.sdk_version);
});

test('yapılandırma eksikse istek atılmaz', async () => {
    const result = await new Reporter({ enabled: true }).heartbeat();

    assert.equal(result.sent, false);
    assert.equal(sent.length, 0);
});

test('kapalı paket canlılık göndermez', async () => {
    const result = await new Reporter({ ...OPTIONS, enabled: false }).heartbeat();

    assert.equal(result.sent, false);
    assert.equal(sent.length, 0);
});
