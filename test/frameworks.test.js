'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');

const vitalwatch = require('../src/index');
const nitro = require('../src/nitro');
const nuxtPlugin = require('../src/nuxt-plugin');
const nuxtModule = require('../src/nuxt');
const { wasReported } = require('../src/route');

/*
| Framework adaptörleri.
|
| Ortak dert: bu framework'ler handler hatasını kendi içinde yakalayıp
| yanıta çeviriyor. Kodsuz kurulum yalnızca "HTTP 500" görüyor — sınıf ve
| stack kayboluyor. Adaptör hatanın kendisini gönderiyor.
|
| Testler gerçek framework'leri yüklemiyor (paket bağımlılıksız); her
| adaptörün dayandığı kanca sözleşmesi sahte nesneyle birebir kuruluyor.
| Gerçek sürümlerle ayrıca uçtan uca denendi (bkz. CHANGELOG 0.5.0).
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

const flush = () => new Promise((r) => setImmediate(r));

/** Olay kancası kaydeden en küçük nesne (Nitro hooks / nuxtApp.hook). */
function hookable() {
    const hooks = {};

    return {
        hook(name, fn) {
            (hooks[name] = hooks[name] || []).push(fn);
        },
        call(name, ...args) {
            for (const fn of hooks[name] || []) fn(...args);
        },
    };
}

function nitroEvent(path, method = 'GET') {
    return { path, method, node: { req: { url: path, method }, res: {} } };
}

// --- Yol yazımı: kodsuz kurulumla aynı ---------------------------------------

/*
| Okunur parçalar olduğu gibi kalır; hangi sayfanın bozulduğu panelde
| görünmeli. Yalnızca kimlik gibi görünenler değişir.
*/
test('adaptör yolu kodsuz kurulumla aynı yazar', async () => {
    const hooks = hookable();
    nitro({ hooks });

    hooks.call('error', new Error('a'), { event: nitroEvent('/oyun/deprem-cantasi') });
    hooks.call('error', new Error('b'), { event: nitroEvent('/urunler/1042?q=x') });
    hooks.call('error', new Error('c'), { event: nitroEvent('/file/a1b2c3d4e5f60718') });
    await flush();

    assert.deepStrictEqual(
        sent.map((e) => e.route),
        ['/oyun/deprem-cantasi', '/urunler/{id}', '/file/{hash}'],
    );
});

// --- Nitro / Nuxt -------------------------------------------------------------

test('Nitro: istek hatası sınıf ve stack ile gönderilir', async () => {
    const hooks = hookable();
    nitro({ hooks });

    const event = nitroEvent('/api/siparis', 'POST');
    hooks.call('error', new TypeError('undefined okunamadı'), { event });
    await flush();

    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].kind, 'exception');
    assert.strictEqual(sent[0].exception_class, 'TypeError');
    assert.strictEqual(sent[0].method, 'POST');
    assert.ok(sent[0].stack.includes('frameworks.test.js'));
    assert.ok(wasReported(event.node.res), 'kodsuz kurulum "HTTP 500" tekrarlamamalı');
});

/*
| h3 her hatayı H3Error içine koyuyor. Sarmalayıcı gönderilseydi paneldeki
| sınıf hep "H3Error" olurdu ve iki farklı arıza ayırt edilemezdi.
*/
test('Nitro: H3Error sarmalayıcısı açılır, özgün sınıf gönderilir', async () => {
    const hooks = hookable();
    nitro({ hooks });

    const original = new RangeError('sınır aşıldı');
    const wrapped = Object.assign(new Error('sınır aşıldı'), {
        name: 'H3Error',
        statusCode: 500,
        cause: original,
    });

    hooks.call('error', wrapped, { event: nitroEvent('/x') });
    await flush();

    assert.strictEqual(sent[0].exception_class, 'RangeError');
});

/* h3 1.15'in gerçek sınıfı: ad yok, statik işaret var. */
test('Nitro: adsız h3 sarmalayıcısı statik işaretinden tanınır', async () => {
    const hooks = hookable();
    nitro({ hooks });

    class H3Error extends Error {
        static __h3_error__ = true;
    }
    const original = new SyntaxError('api');
    const wrapped = new H3Error('api', { cause: original });

    hooks.call('error', wrapped, { event: nitroEvent('/api/x') });
    await flush();

    assert.strictEqual(wrapped.name, 'Error', 'gerçek sürümdeki gibi adsız');
    assert.strictEqual(sent[0].exception_class, 'SyntaxError');
});

/* cause taşıyan sıradan hata açılmaz: sarmalayıcı olan yalnızca h3. */
test('Nitro: cause taşıyan sıradan hata olduğu gibi gönderilir', async () => {
    const hooks = hookable();
    nitro({ hooks });

    hooks.call('error', new TypeError('dış', { cause: new Error('iç') }), { event: nitroEvent('/x') });
    await flush();

    assert.strictEqual(sent[0].exception_class, 'TypeError');
});

/* 404 ve doğrulama hataları uygulamanın bilinçli yanıtı, arıza değil. */
test('Nitro: 4xx hataları gönderilmez', async () => {
    const hooks = hookable();
    nitro({ hooks });

    const notFound = Object.assign(new Error('Page not found'), { statusCode: 404 });
    hooks.call('error', notFound, { event: nitroEvent('/none') });
    await flush();

    assert.strictEqual(sent.length, 0);
});

/* İstek dışı hatalar hookProcess'in işi; iki kez gönderilmez. */
test('Nitro: istek bağlamı olmayan hata atlanır', async () => {
    const hooks = hookable();
    nitro({ hooks });

    hooks.call('error', new Error('arka plan'), { tags: ['unhandledRejection'] });
    await flush();

    assert.strictEqual(sent.length, 0);
});

/*
| Error boundary ile yakalanan SSR hatası Nitro'ya ulaşmıyor, sayfa 200
| dönüyor. vue:error olmadan tamamen kayboluyordu.
*/
test('Nuxt: SSR render hatası vue:error ile gönderilir', async () => {
    const app = hookable();
    app.ssrContext = { event: nitroEvent('/oyun/sel') };
    nuxtPlugin(app);

    app.call('vue:error', new Error('bileşen çizilemedi'));
    await flush();

    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].route, '/oyun/sel');
});

/* Yakalanmayan render hatası iki kancadan da geçer; tek kayıt olmalı. */
test('Nuxt: aynı hata iki kancadan geçince tek kayıt', async () => {
    const hooks = hookable();
    const app = hookable();
    app.ssrContext = { event: nitroEvent('/') };
    nitro({ hooks });
    nuxtPlugin(app);

    const error = new Error('render');
    app.call('vue:error', error);
    hooks.call('error', Object.assign(new Error('render'), { name: 'H3Error', cause: error }), {
        event: app.ssrContext.event,
    });
    await flush();

    assert.strictEqual(sent.length, 1);
});

test('Nuxt modülü iki eklentiyi kaydeder, uygulama eklentisi yalnızca sunucuda', () => {
    const nuxt = { options: {} };
    nuxtModule({}, nuxt);

    assert.strictEqual(nuxt.options.nitro.plugins.length, 1);
    assert.ok(nuxt.options.nitro.plugins[0].endsWith('nitro.js'));
    assert.strictEqual(nuxt.options.plugins[0].mode, 'server');
    assert.ok(nuxt.options.plugins[0].src.endsWith('nuxt-plugin.mjs'));
});

/*
| Nuxt eklentiyi ESM varsayılan dışa aktarımından alıyor; `#app` yalnızca
| Nuxt derlemesinde çözülüyor, burada dosya metni denetleniyor. Gerçek
| derleme ayrıca denendi.
*/
test('Nuxt uygulama eklentisinin ESM kapısı mantığı defineNuxtPlugin ile sarar', () => {
    const source = require('node:fs').readFileSync(
        require('node:path').join(__dirname, '../src/nuxt-plugin.mjs'),
        'utf8',
    );

    assert.match(source, /import plugin from '\.\/nuxt-plugin\.js'/);
    assert.match(source, /export default defineNuxtPlugin\(\{ name: 'vitalwatch', setup: plugin \}\)/);
});

/*
| Nuxt paketi iki ayrı derleme çıktısına gömüyor ve iki kopya aynı SSR
| hatasını görüyor. Kopyalar birbirinin WeakSet'ini göremediği için kayıt
| hata nesnesinin üstünde tutuluyor.
*/
test('aynı hata ayrı raporlayıcı örneklerinden tek kez gönderilir', async () => {
    const { Reporter } = require('../src/reporter');
    const first = new Reporter(OPTIONS);
    const second = new Reporter(OPTIONS);

    const error = new Error('render');
    await first.recordException(error);
    await second.recordException(error);

    assert.strictEqual(sent.length, 1);
    assert.deepStrictEqual(Object.keys(error), [], 'işaret sayılamaz olmalı');
});

// --- Fastify ------------------------------------------------------------------

function fakeFastify() {
    const hooks = {};

    return {
        addHook(name, fn) {
            hooks[name] = fn;
        },
        run(name, ...args) {
            return new Promise((resolve) => hooks[name](...args, resolve));
        },
    };
}

test('Fastify: onError hatayı gönderir ve zinciri sürdürür', async () => {
    const app = fakeFastify();
    let done = false;
    vitalwatch.fastify(app, {}, () => (done = true));

    // onError anında Fastify durum kodunu henüz yazmamış: gerçek sürümde 200.
    const reply = { statusCode: 200, raw: {} };
    await app.run('onError', { url: '/api/odeme/77', method: 'POST' }, reply, new Error('kart servisi'));
    await flush();

    assert.ok(done, 'eklenti kaydı tamamlanmalı');
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].route, '/api/odeme/{id}');
    assert.ok(wasReported(reply.raw));
});

test('Fastify: 4xx gönderilmez', async () => {
    const app = fakeFastify();
    vitalwatch.fastify(app, {}, () => {});

    const validation = Object.assign(new Error('doğrulama'), { statusCode: 400 });
    await app.run('onError', { url: '/x', method: 'GET' }, { statusCode: 200 }, validation);
    // Uygulama kodu önceden koyup düz Error fırlattı.
    await app.run('onError', { url: '/y', method: 'GET' }, { statusCode: 403 }, new Error('permission'));
    await flush();

    assert.strictEqual(sent.length, 0);
});

/*
| Fastify'daki sıra: hatanın kendi kodu önceden konmuş koddan önce gelir.
| Uygulama reply.code(403) dedikten sonra 503 taşıyan hata fırlarsa yanıt
| 503'tür ve arıza sayılmalı.
*/
test('Fastify: hatanın kodu önceden konmuş koddan önce gelir', async () => {
    const app = fakeFastify();
    vitalwatch.fastify(app, {}, () => {});

    const unavailable = Object.assign(new Error('bakım'), { statusCode: 503 });
    await app.run('onError', { url: '/z', method: 'GET' }, { statusCode: 403 }, unavailable);
    await flush();

    assert.strictEqual(sent.length, 1);
});

/*
| Fastify eklentileri kendi kapsamına kapatıyor. İşaret olmasa kanca
| yalnızca eklentinin içinde çalışır ve uygulamanın rotaları kör kalırdı.
*/
test('Fastify: kapsam dışına taşınır (skip-override)', () => {
    assert.strictEqual(vitalwatch.fastify[Symbol.for('skip-override')], true);
});

// --- Koa ----------------------------------------------------------------------

test('Koa: error olayı gönderilir', async () => {
    const app = new EventEmitter();
    app.onerror = () => {};
    vitalwatch.koa(app);

    app.emit('error', new Error('db'), { originalUrl: '/siparis/5', method: 'GET', res: {} });
    await flush();

    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].route, '/siparis/{id}');
});

/*
| Koa kendi hata günlüğünü yalnızca kimse `error` dinlemiyorsa kuruyor.
| Adaptör dinleyici eklediği an uygulamanın stderr satırları kesilirdi.
*/
test('Koa: tek dinleyici bizsek Koa nın kendi günlüğü korunur', () => {
    const app = new EventEmitter();
    const logged = [];
    app.onerror = (e) => logged.push(e);
    vitalwatch.koa(app);

    const error = new Error('x');
    app.emit('error', error, {});

    assert.deepStrictEqual(logged, [error]);
});

test('Koa: uygulamanın kendi dinleyicisi varsa varsayılan çağrılmaz', () => {
    const app = new EventEmitter();
    const logged = [];
    app.onerror = (e) => logged.push(e);
    app.on('error', () => {});
    vitalwatch.koa(app);

    app.emit('error', new Error('x'), {});

    assert.strictEqual(logged.length, 0);
});

test('Koa: 4xx gönderilmez', async () => {
    const app = new EventEmitter();
    app.onerror = () => {};
    vitalwatch.koa(app);

    app.emit('error', Object.assign(new Error('none'), { status: 404 }), { url: '/x' });
    await flush();

    assert.strictEqual(sent.length, 0);
});

// --- Hono ---------------------------------------------------------------------

test('Hono: c.error gönderilir', async () => {
    const outgoing = {};
    const c = {
        req: { path: '/api/user/12', method: 'DELETE' },
        env: { outgoing },
    };

    await vitalwatch.hono()(c, async () => {
        c.error = new Error('silinemedi');
        c.res = { status: 500 };
    });
    await flush();

    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].route, '/api/user/{id}');
    assert.strictEqual(sent[0].method, 'DELETE');
    assert.ok(wasReported(outgoing));
});

test('Hono: hatasız istek ve 4xx gönderilmez', async () => {
    const mw = vitalwatch.hono();

    await mw({ req: { path: '/' }, res: { status: 200 } }, async () => {});
    await mw({ req: { path: '/' }, res: { status: 401 }, error: new Error('permission') }, async () => {});
    await flush();

    assert.strictEqual(sent.length, 0);
});

/*
| Aynı hata nesnesi ikinci istekte gönderilmiyor (raporlayıcı eliyor). Yanıt
| yine de işaretlenseydi kodsuz kurulumun "HTTP 500"ü de susar ve ikinci
| arıza hiç iz bırakmazdı.
*/
test('adaptör gönderilmeyecek hatada yanıtı işaretlemez', async () => {
    const app = { hooks: hookable() };
    nitro(app);

    const singleton = new Error('bakım');
    const first = nitroEvent('/a');
    const second = nitroEvent('/a');

    app.hooks.call('error', singleton, { event: first });
    app.hooks.call('error', singleton, { event: second });
    await flush();

    assert.strictEqual(sent.length, 1);
    assert.ok(wasReported(first.node.res));
    assert.ok(!wasReported(second.node.res), 'gönderilmeyen hatada işaret olmamalı');
});

test('raporlayıcı kapalıyken adaptör yanıtı işaretlemez', async () => {
    vitalwatch.init({ ...OPTIONS, enabled: false });

    const app = { hooks: hookable() };
    nitro(app);

    const event = nitroEvent('/a');
    app.hooks.call('error', new Error('x'), { event });
    await flush();

    assert.strictEqual(sent.length, 0);
    assert.ok(!wasReported(event.node.res));
});

// --- NestJS -------------------------------------------------------------------

/** rxjs Observable'ın kullandığımız kadarı: kurucu + subscribe. */
class FakeObservable {
    constructor(subscribe) {
        this._subscribe = subscribe;
    }
    subscribe(observer) {
        return this._subscribe(observer);
    }
}

function nestContext(req, res = {}) {
    return {
        getType: () => 'http',
        switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    };
}

test('NestJS: hata gönderilir ve aynen yeniden fırlatılır', async () => {
    const error = new Error('service');
    const source = new FakeObservable((o) => o.error(error));
    const res = {};

    const out = vitalwatch.nest().intercept(nestContext({ originalUrl: '/api/report/3', method: 'GET' }, res), {
        handle: () => source,
    });

    let received;
    out.subscribe({ error: (e) => (received = e), next() {}, complete() {} });
    await flush();

    assert.strictEqual(received, error, 'hata yutulmamalı, aynı nesne iletilmeli');
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].route, '/api/report/{id}');
    assert.ok(wasReported(res));
});

test('NestJS: HttpException 4xx gönderilmez, değerler aynen geçer', async () => {
    const httpError = Object.assign(new Error('Not Found'), { getStatus: () => 404 });
    const values = [];

    vitalwatch
        .nest()
        .intercept(nestContext({ url: '/x' }), {
            handle: () =>
                new FakeObservable((o) => {
                    o.next(1);
                    o.error(httpError);
                }),
        })
        .subscribe({ next: (v) => values.push(v), error() {}, complete() {} });
    await flush();

    assert.deepStrictEqual(values, [1]);
    assert.strictEqual(sent.length, 0);
});

// --- SvelteKit / React Router -------------------------------------------------

/*
| Mikroservis (`rpc`) ve WebSocket (`ws`) bağlamlarında RpcException /
| WsException istemciye yönelik iş hatası; durum kodu taşımadıkları için
| elenmeseler her biri sunucu hatası sayılırdı. Diğer hatalar gider.
*/
function nonHttpContext(type) {
    return {
        getType: () => type,
        switchToHttp: () => {
            throw new Error('HTTP dışı bağlamda çağrılmamalı');
        },
    };
}

async function runNest(context, error) {
    let received;

    vitalwatch
        .nest()
        .intercept(context, { handle: () => new FakeObservable((o) => o.error(error)) })
        .subscribe({ next() {}, complete() {}, error: (e) => (received = e) });
    await flush();

    return received;
}

test('NestJS: rpc/ws bağlamında RpcException ve WsException gönderilmez, aynen geçer', async () => {
    class RpcException extends Error {}
    class WsException extends Error {}
    class SiparisBulunamadi extends RpcException {}

    for (const [type, error] of [
        ['rpc', new RpcException('geçersiz')],
        ['rpc', new SiparisBulunamadi('none')],
        ['ws', new WsException('unauthorized')],
    ]) {
        assert.strictEqual(await runNest(nonHttpContext(type), error), error);
    }

    assert.strictEqual(sent.length, 0);
});

test('NestJS: rpc/ws bağlamında diğer hatalar gönderilir', async () => {
    const rpcError = new TypeError('rpc');
    const wsError = new Error('ws');

    assert.strictEqual(await runNest(nonHttpContext('rpc'), rpcError), rpcError);
    assert.strictEqual(await runNest(nonHttpContext('ws'), wsError), wsError);

    assert.deepStrictEqual(sent.map((e) => e.exception_class), ['TypeError', 'Error']);
    assert.ok(sent.every((e) => !('route' in e)));
});

test('NestJS: graphql bağlamında 4xx HttpException gönderilmez, diğerleri gider', async () => {
    const forbidden = Object.assign(new Error('Forbidden'), { getStatus: () => 403 });

    await runNest(nonHttpContext('graphql'), forbidden);
    await runNest(nonHttpContext('graphql'), new RangeError('resolver'));

    assert.deepStrictEqual(sent.map((e) => e.exception_class), ['RangeError']);
});

test('SvelteKit: 500 gönderilir, 404 gönderilmez, işleyicinin dönüşü korunur', async () => {
    const handle = vitalwatch.sveltekit(() => ({ message: 'Bir hata oluştu' }));
    const event = (p) => ({ url: new URL('http://x' + p), request: { method: 'GET' } });

    const result = handle({ error: new Error('yük'), event: event('/haber/12'), status: 500 });
    handle({ error: new Error('Not found'), event: event('/none'), status: 404 });
    await flush();

    assert.deepStrictEqual(result, { message: 'Bir hata oluştu' });
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].route, '/haber/{id}');
});

test('React Router: gönderilir, iptal edilen istek gönderilmez', async () => {
    let called = 0;
    const handle = vitalwatch.reactRouter(() => called++);

    handle(new Error('loader'), {
        request: { url: 'http://x/panel/9?a=1', method: 'GET', signal: { aborted: false } },
    });
    handle(new Error('cancelled'), {
        request: { url: 'http://x/panel', method: 'GET', signal: { aborted: true } },
    });
    await flush();

    assert.strictEqual(called, 2, 'uygulamanın işleyicisi her durumda çalışmalı');
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].route, '/panel/{id}');
});

// --- Davranış garantisi -------------------------------------------------------

/* Adaptörler hiçbir koşulda uygulamanın hata yolunu bozmaz. */
test('bozuk girdide hiçbir adaptör fırlatmaz', async () => {
    const hooks = hookable();
    nitro({ hooks });
    assert.doesNotThrow(() => hooks.call('error', null, { event: {} }));
    assert.doesNotThrow(() => nitro(null));
    assert.doesNotThrow(() => nuxtPlugin(null));
    assert.doesNotThrow(() => nuxtModule({}, null));
    assert.doesNotThrow(() => vitalwatch.koa(null));
    assert.doesNotThrow(() => vitalwatch.fastify(null, {}, () => {}));
    assert.doesNotThrow(() => vitalwatch.sveltekit()(undefined));
    assert.doesNotThrow(() => vitalwatch.reactRouter()(undefined, undefined));
    await assert.doesNotReject(() => vitalwatch.hono()({}, async () => {}));
});
