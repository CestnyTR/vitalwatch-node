'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const vitalwatch = require('../src/index');
const { nextOnRequestError } = require('../src/next');

/*
| Next.js sunucu tarafı hata kancası.
|
| SSR sırasında oluşan hatalar tarayıcıya HİÇ ULAŞMIYOR: `t.js` onları
| göremez, error boundary de göremez. Bu kanca olmadan SSR katmanı tamamen
| kör kalıyor — ve körlük sessiz, çünkü sayfa 500 dönse bile hub'a tek
| kayıt düşmüyor.
|
| Müşteri projelerine kurulan kod ve bugüne kadar hiçbir testi yoktu.
*/

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
        sent.push(JSON.parse(options.body));

        return { status: 204, ok: true };
    };

    vitalwatch.init(OPTIONS);
});

afterEach(() => {
    global.fetch = originalFetch;
});

/** Kanca async: gönderim kuyruğu boşalsın. */
const flush = () => new Promise((r) => setImmediate(r));

test('SSR hatası hub a bildirilir', async () => {
    nextOnRequestError(new Error('veri çekilemedi'), {
        path: '/urunler',
        method: 'GET',
    });

    await flush();

    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].kind, 'exception');
    assert.strictEqual(sent[0].route, '/urunler');
    assert.strictEqual(sent[0].method, 'GET');
    assert.ok(sent[0].msg.includes('veri çekilemedi'));
});

/* M3: Next yolu query string ile veriyor, kayıttan önce atılır. */
test('query string atılır', async () => {
    nextOnRequestError(new Error('x'), {
        path: '/search?email=a@b.com&q=phone',
        method: 'GET',
    });

    await flush();

    assert.strictEqual(sent[0].route, '/search');
    assert.ok(!JSON.stringify(sent[0]).includes('a@b.com'), 'e-posta sızmamalı');
});

/*
| KANCA HİÇBİR KOŞULDA RENDER'I BOZMAZ. Next bu fonksiyonu hata yolunda
| çağırıyor; buradan fırlayan bir istisna, kullanıcının gördüğü hata
| sayfasını da düşürürdü — izleme eklemek uygulamayı bozardı.
*/
test('istek nesnesi eksikken fırlatmaz', async () => {
    assert.doesNotThrow(() => nextOnRequestError(new Error('x')));
    assert.doesNotThrow(() => nextOnRequestError(new Error('x'), null));
    assert.doesNotThrow(() => nextOnRequestError(new Error('x'), {}));

    await flush();
});

test('raporlayıcı patlasa da fırlatmaz', async () => {
    global.fetch = async () => {
        throw new Error('ağ yok');
    };

    assert.doesNotThrow(() =>
        nextOnRequestError(new Error('x'), { path: '/', method: 'GET' }),
    );

    await flush();
});

test('hata yerine atılan düz değer de bildirilir', async () => {
    // `throw 'metin'` geçerli JavaScript ve Next onu olduğu gibi veriyor.
    nextOnRequestError('bir şeyler ters gitti', { path: '/', method: 'GET' });

    await flush();

    assert.strictEqual(sent.length, 1);
    assert.ok(sent[0].msg.includes('bir şeyler ters gitti'));
});

test('yol verilmediğinde rota alanı gönderilmez', async () => {
    nextOnRequestError(new Error('x'), { method: 'POST' });

    await flush();

    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].route, undefined);
    assert.strictEqual(sent[0].method, 'POST');
});

/*
| Kanal AYIRT EDİLEBİLİR OLMALI: SSR hatası sunucudan geliyor ve panelde
| tarayıcı hatasından ayrı durmalı, yoksa "bu hata nerede oldu" sorusu
| cevapsız kalır.
*/
test('kaynak sunucu olarak işaretlenir', async () => {
    nextOnRequestError(new Error('x'), { path: '/', method: 'GET' });

    await flush();

    assert.strictEqual(sent[0].source, 'server');
    assert.strictEqual(sent[0].runtime, 'node');
});
