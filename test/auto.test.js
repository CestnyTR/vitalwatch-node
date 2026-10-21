'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

/*
| auto.js yüklenirken ortamdan yapılandırma okur; testten önce kurulmalı.
*/
process.env.VITALWATCH_URL = 'https://hub.sample';
process.env.VITALWATCH_KEY = 'example-project';
process.env.VITALWATCH_SECRET = 'a'.repeat(64);
process.env.VITALWATCH_SLOW_REQUEST_MS = '0';

const { routePattern } = require('../src/auto');

let sent = [];
let originalFetch;

beforeEach(() => {
    sent = [];
    originalFetch = global.fetch;

    global.fetch = async (url, options) => {
        sent.push(JSON.parse(options.body));

        return { status: 204, ok: true };
    };
});

afterEach(() => {
    global.fetch = originalFetch;
});

/**
 * Kimlik taşıyan yol parçaları desene çevrilmezse her ürün sayfası ayrı bir
 * parmak izi üretir ve gruplama tamamen anlamsızlaşır.
 */
test('yol deseni kimlikleri normalize eder', () => {
    assert.strictEqual(routePattern('/urunler/1042'), '/urunler/{id}');
    assert.strictEqual(
        routePattern('/siparis/f47ac10b-58cc-4372-a567-0e02b2c3d479/detail'),
        '/siparis/{uuid}/detail',
    );
    assert.strictEqual(routePattern('/file/a1b2c3d4e5f60718'), '/file/{hash}');
    assert.strictEqual(routePattern('/urunler'), '/urunler');
});

test('yol deseni query string taşımaz', () => {
    assert.strictEqual(routePattern('/search?q=masked&token=abc'), '/search');
});

/**
 * Kodsuz kurulumun asıl iddiası bu: uygulama kaynağına dokunulmadan istekler
 * ölçülüyor.
 */
test('yamalanan sunucu isteği kod eklenmeden ölçer', async () => {
    const server = http.createServer((req, res) => {
        res.statusCode = 500;
        res.end('error');
    });

    await new Promise((done) => server.listen(0, done));

    const port = server.address().port;
    await rawFetch(`http://127.0.0.1:${port}/urunler/42`);

    // finish olayı ve gönderim aynı tick'te bitmiyor.
    await new Promise((done) => setTimeout(done, 50));

    server.close();

    const event = sent.find((e) => e.kind === 'http_5xx');

    assert.ok(event, '5xx olayı gönderilmeliydi');
    assert.strictEqual(event.status, 500);
    assert.strictEqual(event.route, 'GET /urunler/{id}');
});

/*
| Express bağlı router'a girerken req.url'den mount yolunu siliyor ve yanıt
| router içinden gönderilince silinmiş hâl kalıyordu. Test Express'in
| yaptığını taklit ediyor: originalUrl'i YAZMADAN req.url'yi kısaltıyor —
| düzeltme ikisinden birine değil, isteğin başındaki adrese dayanmalı.
*/
test('mount yolu router req.url\'yi kısaltsa da yolda kalır', async () => {
    const server = http.createServer((req, res) => {
        req.url = req.url.replace(/^\/api/, '') || '/';
        res.statusCode = 500;
        res.end('error');
    });

    await new Promise((done) => server.listen(0, done));
    await rawFetch(`http://127.0.0.1:${server.address().port}/api/urunler/42`);
    await new Promise((done) => setTimeout(done, 50));
    server.close();

    const event = sent.find((e) => e.kind === 'http_5xx');

    assert.ok(event, '5xx olayı gönderilmeliydi');
    assert.strictEqual(event.route, 'GET /api/urunler/{id}');
});

/*
| Framework adaptörü asıl hatayı stack'iyle gönderdiyse aynı istek için
| ikinci bir "HTTP 500" kaydı açılmaz — tek arıza, tek satır.
*/
test('adaptörün raporladığı istek için HTTP 500 tekrarlanmaz', async () => {
    const { markReported } = require('../src/route');
    const server = http.createServer((req, res) => {
        markReported(res);
        res.statusCode = 500;
        res.end('error');
    });

    await new Promise((done) => server.listen(0, done));
    await rawFetch(`http://127.0.0.1:${server.address().port}/x`);
    await new Promise((done) => setTimeout(done, 50));
    server.close();

    assert.strictEqual(sent.filter((e) => e.kind === 'http_5xx').length, 0);
});

/** Yama isteği ne değiştirmeli ne de bozmalı. */
test('yama isteğin yanıtını değiştirmez', async () => {
    const server = http.createServer((req, res) => {
        res.setHeader('content-type', 'text/plain');
        res.end('merhaba');
    });

    await new Promise((done) => server.listen(0, done));

    const port = server.address().port;
    const response = await rawFetch(`http://127.0.0.1:${port}/`);

    server.close();

    assert.strictEqual(response.body, 'merhaba');
    assert.strictEqual(response.status, 200);
});

/** global.fetch sahte; gerçek istek için ham http kullanılıyor. */
function rawFetch(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let body = '';
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () => resolve({ status: res.statusCode, body }));
        }).on('error', reject);
    });
}
