'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { createHmac } = require('node:crypto');

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
        sent.push({ url, options, body: JSON.parse(options.body) });

        return { status: 204, ok: true };
    };
});

afterEach(() => {
    global.fetch = originalFetch;
});

test('yapılandırma eksikse hiçbir şey gönderilmez', async () => {
    await new Reporter({ url: null, key: null, secret: null }).recordException(
        new Error('x'),
    );

    assert.strictEqual(sent.length, 0);
});

test('enabled false iken gönderim yapılmaz', async () => {
    await new Reporter({ ...OPTIONS, enabled: false }).recordException(new Error('x'));

    assert.strictEqual(sent.length, 0);
});

test('hata raporlanır ve imzalanır', async () => {
    await new Reporter(OPTIONS).recordException(new Error('Bir şey patladı'));

    assert.strictEqual(sent.length, 1);

    const { url, options, body } = sent[0];

    assert.strictEqual(url, 'https://hub.sample/api/i/example-project/server');
    assert.strictEqual(body.kind, 'exception');
    assert.strictEqual(body.msg, 'Bir şey patladı');
    assert.strictEqual(body.exception_class, 'Error');
    assert.strictEqual(body.runtime, 'node');
    assert.ok(body.sdk_version);

    // İmza gövdenin tamamını ve zaman damgasını kapsamalı.
    const timestamp = options.headers['X-VitalWatch-Timestamp'];
    const expected = createHmac('sha256', OPTIONS.secret)
        .update(`${timestamp}.${options.body}`)
        .digest('hex');

    assert.strictEqual(options.headers['X-VitalWatch-Signature'], `sha256=${expected}`);
});

test('aynı hata iki kez raporlanmaz', async () => {
    const r = new Reporter(OPTIONS);
    const error = new Error('repeat');

    await r.recordException(error);
    await r.recordException(error);

    assert.strictEqual(sent.length, 1);
});

test('yok sayılan hata adları raporlanmaz', async () => {
    const error = new Error('bulunamadı');
    error.name = 'NotFoundError';

    await new Reporter({ ...OPTIONS, ignore: ['NotFoundError'] }).recordException(error);

    assert.strictEqual(sent.length, 0);
});

test('raporlanan olayda kişisel veri bulunmaz', async () => {
    await new Reporter(OPTIONS).recordException(
        new Error('Kullanıcı ahmet@ornek.com için 12345678901 geçersiz'),
    );

    const msg = sent[0].body.msg;

    assert.ok(!msg.includes('john@sample.com'));
    assert.ok(!msg.includes('12345678901'));
});

test('eşik altındaki hızlı istek raporlanmaz', async () => {
    await new Reporter(OPTIONS).recordRequest({
        route: '/urunler',
        method: 'GET',
        status: 200,
        durationMs: 40,
    });

    assert.strictEqual(sent.length, 0);
});

test('yavaş istek raporlanır', async () => {
    await new Reporter(OPTIONS).recordRequest({
        route: '/urunler',
        method: 'GET',
        status: 200,
        durationMs: 2500,
    });

    assert.strictEqual(sent[0].body.kind, 'slow_request');
    assert.strictEqual(sent[0].body.duration_ms, 2500);
});

/** Hızlı da olsa 5xx her zaman raporlanır. */
test('5xx hızlı olsa da raporlanır', async () => {
    await new Reporter(OPTIONS).recordRequest({
        route: '/api/siparis',
        method: 'POST',
        status: 500,
        durationMs: 12,
    });

    assert.strictEqual(sent[0].body.kind, 'http_5xx');
    assert.strictEqual(sent[0].body.status, 500);
});

/**
 * Davranış garantisi: hub erişilemezse izlenen uygulamada hata oluşmaz.
 */
test('hub erişilemezse hata fırlatılmaz', async () => {
    global.fetch = async () => {
        throw new Error('ECONNREFUSED');
    };

    await new Reporter(OPTIONS).recordException(new Error('x'));
    // Buraya ulaşmak testin kendisidir.
    assert.ok(true);
});

/*
| willRecord, recordException'ın kararını senkron verir: yanıtı işaretleyen
| yollar buna bakıyor. Kararlar ayrışırsa ya çift kayıt ya hiç kayıt olur.
*/
test('willRecord recordException ile aynı kararı verir ve fırlatmaz', async () => {
    const r = new Reporter({ ...OPTIONS, ignore: ['Yoksay'] });
    const error = new Error('x');

    assert.strictEqual(r.willRecord(error), true);
    assert.strictEqual(r.willRecord('düz metin'), true);
    assert.strictEqual(r.willRecord(Object.assign(new Error('y'), { name: 'Yoksay' })), false);

    await r.recordException(error);
    assert.strictEqual(r.willRecord(error), false, 'raporlanmış nesne');
    assert.strictEqual(new Reporter(OPTIONS).willRecord(error), false, 'başka kopya da görür');

    assert.strictEqual(new Reporter({ ...OPTIONS, enabled: false }).willRecord(new Error('z')), false);
    assert.strictEqual(new Reporter({}).willRecord(new Error('z')), false);

    const hostile = new Proxy({}, { get() { throw new Error('decoy'); }, getPrototypeOf() { throw new Error('decoy'); } });
    assert.doesNotThrow(() => r.willRecord(hostile));
});

test('ad listesiyle yok sayma diğer hataları düşürmez', async () => {
    class CustomError extends Error {}
    const r = new Reporter({ ...OPTIONS, ignore: ['Yoksay', CustomError] });

    await r.recordException(new Error('gitmeli'));
    await r.recordException(new CustomError('gitmemeli'));
    await r.recordException(Object.assign(new Error('gitmemeli'), { name: 'Yoksay' }));

    assert.deepStrictEqual(sent.map((e) => e.body.msg), ['gitmeli']);
});
