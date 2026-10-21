'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');

const vitalwatch = require('../src/index');
const { express } = require('../src/express');

/*
| Express / Connect middleware'i.
|
| MÜŞTERİ PROJELERİNE KURULAN KOD ve bugüne kadar hiçbir testi yoktu. Sessiz
| bozulması en pahalı yer burası: ölçüm durursa hub'a veri gelmez ve bu
| "sorun yok" gibi görünür — izleme aracının yapabileceği en kötü hata.
|
| Testler gerçek Express'i yüklemiyor: middleware yalnızca `req`/`res`
| sözleşmesine dayanıyor ve `res` bir EventEmitter. Sahte nesne o
| sözleşmeyi birebir taşıyor; Express'i kurmak testi yavaşlatır ve
| yakalamadığı hiçbir kusuru yakalamaz.
*/

const OPTIONS = {
    url: 'https://hub.sample',
    key: 'example-project',
    secret: 'a'.repeat(64),
    env: 'production',
    // Eşik düşürülüyor: her istek "yavaş" sayılsın ve ölçümün kendisi
    // görünür olsun. Eşiğin doğruluğu reporter.test.js'in işi.
    slowRequestMs: 0,
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

/** Express'in verdiği `res` kadarı: `finish`/`close` yayan bir emitter. */
function fakeResponse(status = 200) {
    const res = new EventEmitter();
    res.statusCode = status;

    return res;
}

function fakeRequest(overrides = {}) {
    return { method: 'GET', originalUrl: '/', url: '/', ...overrides };
}

/** Middleware'i çalıştırır, `finish` yayar ve gönderimin bitmesini bekler. */
async function runMiddleware(req, res, middleware = express()) {
    let nextCalled = false;
    middleware(req, res, () => {
        nextCalled = true;
    });

    res.emit('finish');
    // recordRequest async: mikro görev kuyruğu boşalsın.
    await new Promise((r) => setImmediate(r));

    return nextCalled;
}

test('tamamlanan istek ölçülür ve hub a gönderilir', async () => {
    const res = fakeResponse(200);
    await runMiddleware(fakeRequest({ originalUrl: '/urunler' }), res);

    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].route, 'GET /urunler');
    assert.strictEqual(sent[0].method, 'GET');
    assert.strictEqual(sent[0].kind, 'slow_request');
});

test('middleware zinciri kesmez', async () => {
    const continued = await runMiddleware(fakeRequest(), fakeResponse());

    assert.strictEqual(continued, true, 'next() çağrılmalı, yoksa istek asılı kalır');
});

/*
| ROTA DESENİ GÖNDERİLİR, GERÇEK YOL DEĞİL.
|
| Gerçek yol gönderilseydi iki sorun birden doğardı: `/urunler/1`,
| `/urunler/2`… her biri ayrı bir kayıt olur ve gruplama çökerdi; ayrıca
| yolun içindeki id kişisel veri taşıyabilir.
*/
test('rota deseni kullanılır, gerçek id yolda taşınmaz', async () => {
    await runMiddleware(
        fakeRequest({ originalUrl: '/urunler/42', route: { path: '/urunler/:id' } }),
        fakeResponse(),
    );

    assert.strictEqual(sent[0].route, 'GET /urunler/:id');
    assert.ok(!JSON.stringify(sent[0]).includes('42'), 'gerçek id sızmamalı');
});

test('alt yola bağlı router da desenle raporlanır', async () => {
    await runMiddleware(
        fakeRequest({ originalUrl: '/api/urunler/42', baseUrl: '/api', route: { path: '/urunler/:id' } }),
        fakeResponse(),
    );

    assert.strictEqual(sent[0].route, 'GET /api/urunler/:id');
});

/* M3: query string kayıttan önce atılır. */
test('query string atılır', async () => {
    await runMiddleware(fakeRequest({ originalUrl: '/search?email=a@b.com&q=x' }), fakeResponse());

    assert.strictEqual(sent[0].route, 'GET /search');
    assert.ok(!JSON.stringify(sent[0]).includes('a@b.com'), 'e-posta sızmamalı');
});

test('5xx yanıtı sunucu hatası olarak işaretlenir', async () => {
    await runMiddleware(fakeRequest({ originalUrl: '/odeme' }), fakeResponse(500));

    assert.strictEqual(sent[0].kind, 'http_5xx');
    assert.strictEqual(sent[0].status, 500);
});

/*
| `close` istemci bağlantıyı kestiğinde de tetikleniyor ve o istek "yavaş"
| sayılmamalı — süre kullanıcının kopmasıyla ölçülmüş olur. Middleware
| yalnızca `finish` dinliyor; bu test o kararı sabitliyor.
*/
test('istemci bağlantıyı keserse ölçüm yazılmaz', async () => {
    const res = fakeResponse();
    express()(fakeRequest(), res, () => {});

    res.emit('close');
    await new Promise((r) => setImmediate(r));

    assert.strictEqual(sent.length, 0);
});

test('aynı istek iki kez raporlanmaz', async () => {
    const res = fakeResponse();
    express()(fakeRequest(), res, () => {});

    res.emit('finish');
    res.emit('finish');
    await new Promise((r) => setImmediate(r));

    assert.strictEqual(sent.length, 1, 'once() kullanılmalı');
});

/*
| İZLEME KODU İSTEĞİ BOZMAZ. Hub erişilemezse, ağ düşerse ya da raporlayıcı
| patlarsa uygulamanın isteği yine tamamlanmalı.
*/
test('raporlayıcı patlarsa istek etkilenmez', async () => {
    global.fetch = async () => {
        throw new Error('ağ yok');
    };

    const continued = await runMiddleware(fakeRequest(), fakeResponse());

    assert.strictEqual(continued, true);
});

// ------------------------------------------------------------------ errors()

test('hata middleware i hatayı raporlar', async () => {
    const error = new Error('ödeme patladı');
    let forwarded = null;

    express.errors()(
        error,
        fakeRequest({ originalUrl: '/odeme', route: { path: '/odeme' } }),
        fakeResponse(500),
        (e) => {
            forwarded = e;
        },
    );

    await new Promise((r) => setImmediate(r));

    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].route, '/odeme');
    assert.ok(sent[0].msg.includes('ödeme patladı'));
});

/*
| HATA YUTULMAZ. Yutulsaydı uygulamanın kendi hata sayfası hiç çalışmaz ve
| kullanıcı boş yanıt alırdı — izleme eklemek uygulamayı bozardı.
*/
test('hata middleware i hatayı zincire devreder', async () => {
    const error = new Error('x');
    let forwarded = null;

    express.errors()(error, fakeRequest(), fakeResponse(500), (e) => {
        forwarded = e;
    });

    assert.strictEqual(forwarded, error, 'aynı hata next(error) ile geçmeli');
});

test('raporlama patlasa da hata zincire devredilir', async () => {
    global.fetch = async () => {
        throw new Error('ağ yok');
    };

    const error = new Error('x');
    let forwarded = null;

    express.errors()(error, fakeRequest(), fakeResponse(500), (e) => {
        forwarded = e;
    });

    assert.strictEqual(forwarded, error);
});

/*
| 4xx çağıranın hatası; kamuya açık API'de sürekli akar ve panelde gerçek
| arızayı gömer. Diğer adaptörlerle aynı kural. Zincir yine sürer.
*/
test('hata middleware i 4xx göndermez ama zincire devreder', async () => {
    const notFound = Object.assign(new Error('kayıt yok'), { status: 404 });
    let forwarded = null;

    express.errors()(notFound, fakeRequest(), fakeResponse(), (e) => (forwarded = e));
    await new Promise((r) => setImmediate(r));

    assert.strictEqual(sent.length, 0);
    assert.strictEqual(forwarded, notFound);
});

test('hata middleware i durum kodu taşımayan ve 5xx hatayı gönderir', async () => {
    const unavailable = Object.assign(new Error('bakım'), { statusCode: 503 });

    express.errors()(new Error('düz'), fakeRequest(), fakeResponse(), () => {});
    express.errors()(unavailable, fakeRequest(), fakeResponse(), () => {});
    await new Promise((r) => setImmediate(r));

    assert.strictEqual(sent.length, 2);
});

/*
| Kendi hata işleyicisini yazan uygulama (gyd-backend) report() çağırıyor.
| `res` verince ölçüm middleware'i aynı istek için "HTTP 500" açmamalı;
| `res` hub'a gitmemeli.
*/
test('report a res verilince ölçüm HTTP 500 tekrarlamaz, res gönderilmez', async () => {
    const req = fakeRequest({ originalUrl: '/api/ilan' });
    const res = fakeResponse(500);

    express()(req, res, () => {});
    vitalwatch.report(new Error('db'), { route: '/api/ilan', method: 'GET', res });
    res.emit('finish');
    await new Promise((r) => setImmediate(r));

    assert.deepStrictEqual(sent.map((e) => e.kind), ['exception']);
    assert.ok(!('res' in sent[0]));
});

/*
| Hata middleware'i asıl hatayı gönderdi; ölçüm middleware'i aynı istek için
| stack'siz bir "HTTP 500" daha açmamalı.
*/
test('hata middleware i raporladıysa HTTP 500 tekrarlanmaz', async () => {
    const req = fakeRequest({ originalUrl: '/odeme' });
    const res = fakeResponse(500);

    express()(req, res, () => {});
    express.errors()(new Error('ödeme'), req, res, () => {});
    res.emit('finish');
    await new Promise((r) => setImmediate(r));

    assert.deepStrictEqual(sent.map((e) => e.kind), ['exception']);
});

/*
| `next` tek yerde ve try'ın dışında. İçeride çağrılıp senkron fırlatsaydı
| catch yutar ve akış ikinci `next(error)`'a düşerdi.
*/
test('hata middleware i next i tam bir kez çağırır, next fırlatsa bile', () => {
    for (const error of [
        Object.assign(new Error('kayıt yok'), { status: 404 }),
        new Error('server'),
    ]) {
        let calls = 0;
        const boom = new Error('sonraki katman');

        assert.throws(
            () =>
                express.errors()(error, fakeRequest(), fakeResponse(), () => {
                    calls++;
                    throw boom;
                }),
            (e) => e === boom,
            'next in hatası yutulmamalı',
        );
        assert.strictEqual(calls, 1, String(error.message));
    }
});

/*
| Modül düzeyinde tek hata nesnesi her istekte fırlatılıyor. Nesne ilk
| istekte raporlandı; ikinci istekte raporlayıcı onu tekrar göndermiyor.
| Yanıt yine de işaretlenseydi ölçüm de susar ve ikinci 500 hiç iz
| bırakmazdı.
*/
test('aynı hata nesnesi ikinci istekte gönderilmezse HTTP 500 ölçümü açılır', async () => {
    const singleton = new Error('bakım modu');

    for (let i = 0; i < 2; i++) {
        const req = fakeRequest({ originalUrl: '/odeme' });
        const res = fakeResponse(500);

        express()(req, res, () => {});
        express.errors()(singleton, req, res, () => {});
        res.emit('finish');
        await new Promise((r) => setImmediate(r));
    }

    assert.deepStrictEqual(sent.map((e) => e.kind), ['exception', 'http_5xx']);
});

test('report a verilen res, hata gönderilmeyecekse işaretlenmez', async () => {
    const singleton = new Error('db');

    for (let i = 0; i < 2; i++) {
        const req = fakeRequest({ originalUrl: '/api/ilan' });
        const res = fakeResponse(500);

        express()(req, res, () => {});
        vitalwatch.report(singleton, { res });
        res.emit('finish');
        await new Promise((r) => setImmediate(r));
    }

    assert.deepStrictEqual(sent.map((e) => e.kind), ['exception', 'http_5xx']);
});

test('yok sayılan hata sınıfında yanıt işaretlenmez', async () => {
    vitalwatch.init({ ...OPTIONS, ignore: ['BakimHatasi'] });

    const error = Object.assign(new Error('bakım'), { name: 'BakimHatasi' });
    const req = fakeRequest({ originalUrl: '/x' });
    const res = fakeResponse(503);

    express()(req, res, () => {});
    express.errors()(error, req, res, () => {});
    res.emit('finish');
    await new Promise((r) => setImmediate(r));

    assert.deepStrictEqual(sent.map((e) => e.kind), ['http_5xx']);
});

test('mount yolu altındaki kök çift eğik çizgi üretmez', async () => {
    await runMiddleware(
        fakeRequest({ originalUrl: '/api', baseUrl: '/api', route: { path: '/' } }),
        fakeResponse(),
    );

    assert.strictEqual(sent[0].route, 'GET /api');
});

/*
| Farklı ön eklere bağlı iki router AYRI kalmalı. Mount yolu düşerse ikisi
| de `/urunler/:id` olur ve hem hata gruplaması hem Katman B yüzdelikleri
| iki ayrı ucu tek satırda birleştirir.
*/
test('farklı mount yolları birbirine karışmaz', async () => {
    await runMiddleware(
        fakeRequest({ originalUrl: '/api/urunler/1', baseUrl: '/api', route: { path: '/urunler/:id' } }),
        fakeResponse(),
    );
    await runMiddleware(
        fakeRequest({ originalUrl: '/admin/urunler/1', baseUrl: '/admin', route: { path: '/urunler/:id' } }),
        fakeResponse(),
    );

    assert.deepStrictEqual(
        sent.map((s) => s.route),
        ['GET /api/urunler/:id', 'GET /admin/urunler/:id'],
    );
});

test('mount yolu yokken desen olduğu gibi kalır', async () => {
    await runMiddleware(
        fakeRequest({ originalUrl: '/urunler/1', route: { path: '/urunler/:id' } }),
        fakeResponse(),
    );

    assert.strictEqual(sent[0].route, 'GET /urunler/:id');
});
