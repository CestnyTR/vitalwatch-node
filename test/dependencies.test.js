'use strict';

const { test, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash, createHmac } = require('node:crypto');
const { spawnSync } = require('node:child_process');

const {
    parseLockfile,
    hashPackages,
    readDependencies,
    DependencySchedule,
    MAX_PACKAGES,
} = require('../src/dependencies');
const { Reporter } = require('../src/reporter');
const { ENV_NAMES } = require('../src/release');

/*
| Bağımlılık listesi: hub OSV.dev'e bakıp proje başına açık uyarısı üretiyor.
| Sözleşme dört SDK'da aynı; özet (hash) hub'da yeniden hesaplanabilmeli.
*/

const OPTIONS = {
    url: 'https://hub.sample',
    key: 'example-project',
    secret: 'a'.repeat(64),
    env: 'production',
};

const temps = [];

function tempRoot(lock) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vitalwatch-deps-'));
    temps.push(dir);
    if (lock !== undefined) {
        fs.writeFileSync(path.join(dir, 'package-lock.json'), typeof lock === 'string' ? lock : JSON.stringify(lock));
    }

    return dir;
}

after(() => {
    while (temps.length) fs.rmSync(temps.pop(), { recursive: true, force: true });
});

let sent = [];
let originalFetch;

beforeEach(() => {
    sent = [];
    originalFetch = global.fetch;

    global.fetch = async (url, options) => {
        sent.push({ url, headers: options.headers, raw: options.body, body: JSON.parse(options.body) });

        return { status: 204, ok: true };
    };
});

afterEach(() => {
    global.fetch = originalFetch;
});

// --- Ayrıştırma ---------------------------------------------------------------

const V3 = {
    name: 'app',
    lockfileVersion: 3,
    packages: {
        '': { name: 'app', version: '1.0.0', dependencies: { next: '^16' } },
        'node_modules/next': { version: '16.1.6' },
        'node_modules/react': { version: '19.0.0' },
        'node_modules/eslint': { version: '9.0.0', dev: true },
        'node_modules/local-lib': { resolved: '../lib', link: true },
        'node_modules/next/node_modules/react': { version: '18.3.1' },
        'node_modules/@scope/pkg': { version: '2.0.0' },
        'node_modules/a/node_modules/@scope/pkg': { version: '2.0.0' },
        'node_modules/no-version': {},
        'node_modules/opt': { version: '1.0.0', optional: true },
        'node_modules/dev-opt': { version: '1.1.0', devOptional: true },
        'node_modules/alias': { name: 'real-pkg', version: '3.0.0' },
        'packages/workspace-a': { name: 'workspace-a', version: '0.0.1' },
    },
};

test('v3: packages haritası, iç içe node_modules, dev/link/sürümsüz atlanır', () => {
    assert.deepStrictEqual(parseLockfile(V3), [
        { name: '@scope/pkg', version: '2.0.0' },
        { name: 'dev-opt', version: '1.1.0' },
        { name: 'next', version: '16.1.6' },
        { name: 'opt', version: '1.0.0' },
        { name: 'react', version: '18.3.1' },
        { name: 'react', version: '19.0.0' },
        { name: 'real-pkg', version: '3.0.0' },
    ]);
});

test('v2: packages varsa eski dependencies ağacı yok sayılır', () => {
    const lock = {
        lockfileVersion: 2,
        packages: { '': {}, 'node_modules/express': { version: '4.21.0' } },
        dependencies: { express: { version: '4.21.0' }, ignored: { version: '1.0.0' } },
    };

    assert.deepStrictEqual(parseLockfile(lock), [{ name: 'express', version: '4.21.0' }]);
});

test('v1: dependencies ağacı özyinelemeli, dev ve file: atlanır', () => {
    const lock = {
        lockfileVersion: 1,
        dependencies: {
            express: {
                version: '4.17.1',
                dependencies: { qs: { version: '6.7.0' }, debug: { version: '2.6.9' } },
            },
            qs: { version: '6.11.0' },
            debug: { version: '2.6.9' },
            mocha: { version: '10.0.0', dev: true, dependencies: { chai: { version: '4.0.0' } } },
            local: { version: 'file:../local' },
        },
    };

    assert.deepStrictEqual(parseLockfile(lock), [
        { name: 'debug', version: '2.6.9' },
        { name: 'express', version: '4.17.1' },
        { name: 'qs', version: '6.11.0' },
        { name: 'qs', version: '6.7.0' },
    ]);
});

test('bozuk girdide boş liste, fırlatmaz', () => {
    for (const input of [null, 42, 'x', {}, { packages: null }, { packages: { 'node_modules/a': 'x' } }]) {
        assert.deepStrictEqual(parseLockfile(input), [], JSON.stringify(input));
    }
});

test('özet: ad sonra sürüm sırası, her satır ad@sürüm\\n', () => {
    const packages = parseLockfile(V3);
    const expected = createHash('sha256')
        .update(packages.map((p) => `${p.name}@${p.version}\n`).join(''))
        .digest('hex');

    assert.strictEqual(hashPackages(packages), expected);
    assert.strictEqual(
        hashPackages([{ name: 'a', version: '1.0.0' }, { name: 'b', version: '2.0.0' }]),
        createHash('sha256').update('a@1.0.0\nb@2.0.0\n').digest('hex'),
    );

    // Anahtar sırası özeti değiştirmez.
    const shuffled = { ...V3, packages: Object.fromEntries(Object.entries(V3.packages).reverse()) };
    assert.strictEqual(hashPackages(parseLockfile(shuffled)), hashPackages(packages));
});

test('sıralama yerel ayara değil kod birimine göre (büyük harf önce)', () => {
    const lock = { packages: { 'node_modules/b': { version: '1' }, 'node_modules/B': { version: '1' }, 'node_modules/a': { version: '1' } } };

    assert.deepStrictEqual(parseLockfile(lock).map((p) => p.name), ['B', 'a', 'b']);
});

test('en çok 5000 paket', () => {
    const packages = {};
    for (let i = 0; i < MAX_PACKAGES + 250; i++) packages[`node_modules/p${String(i).padStart(5, '0')}`] = { version: '1.0.0' };

    const list = parseLockfile({ lockfileVersion: 3, packages });

    assert.strictEqual(list.length, 5000);
    assert.strictEqual(list[4999].name, 'p04999');
});

test('readDependencies: kilit dosyası yoksa desteklenmiyor, bozuksa okunamadı', () => {
    assert.deepStrictEqual(readDependencies(tempRoot()), { supported: false, error: 'no-lockfile' });
    assert.deepStrictEqual(readDependencies(tempRoot('{bozuk')), { supported: false, error: 'unreadable-lockfile' });

    const result = readDependencies(tempRoot(V3));
    assert.strictEqual(result.supported, true);
    assert.deepStrictEqual(Object.keys(result.dependencies), ['v', 'ecosystem', 'manifest', 'hash', 'packages']);
    assert.strictEqual(result.dependencies.v, 1);
    assert.strictEqual(result.dependencies.ecosystem, 'npm');
    assert.strictEqual(result.dependencies.manifest, 'package-lock.json');
    assert.match(result.dependencies.hash, /^[0-9a-f]{64}$/);
});

// --- Gönderim ---------------------------------------------------------------

function dependenciesOf(lock) {
    return readDependencies(tempRoot(lock)).dependencies;
}

test('/deps: /server ile aynı imza ve kimlik alanları', async () => {
    const reporter = new Reporter({ ...OPTIONS, release: 'abc123' });

    await reporter.heartbeat();
    const result = await reporter.sendDependencies(dependenciesOf(V3));

    assert.deepStrictEqual(result, { sent: true, status: 204 });
    assert.strictEqual(sent.length, 2);

    const [server, deps] = sent;
    assert.strictEqual(server.url, 'https://hub.sample/api/i/example-project/server');
    assert.strictEqual(deps.url, 'https://hub.sample/api/i/example-project/deps');
    assert.deepStrictEqual(Object.keys(deps.headers), Object.keys(server.headers));

    const timestamp = deps.headers['X-VitalWatch-Timestamp'];
    const expected = createHmac('sha256', OPTIONS.secret).update(`${timestamp}.${deps.raw}`).digest('hex');
    assert.strictEqual(deps.headers['X-VitalWatch-Signature'], `sha256=${expected}`);

    for (const key of ['env', 'source', 'release', 'runtime', 'runtime_version', 'sdk_version']) {
        assert.strictEqual(deps.body[key], server.body[key], key);
    }
    assert.strictEqual(deps.body.events, undefined);
    assert.strictEqual(deps.body.dependencies.packages.length, 7);
});

test('500 KB üstü gövde gönderilmez, uyarı bir kez', async () => {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (message) => warnings.push(message);

    try {
        const big = { packages: {} };
        for (let i = 0; i < 5000; i++) big.packages[`node_modules/${'n'.repeat(100)}${i}`] = { version: '1.0.0' };

        const reporter = new Reporter(OPTIONS);
        const dependencies = dependenciesOf(big);

        assert.deepStrictEqual(await reporter.sendDependencies(dependencies), { sent: false, error: 'too-large' });
        assert.deepStrictEqual(await reporter.sendDependencies(dependencies), { sent: false, error: 'too-large' });
        assert.strictEqual(sent.length, 0);
        assert.strictEqual(warnings.length, 1);
        assert.match(warnings[0], /larger than 500 KB/);
    } finally {
        console.warn = originalWarn;
    }
});

test('kapalı, bağımlılık kapalı ya da yapılandırma eksikse gönderilmez', async () => {
    const dependencies = dependenciesOf(V3);

    assert.strictEqual((await new Reporter({ ...OPTIONS, enabled: false }).sendDependencies(dependencies)).sent, false);
    assert.deepStrictEqual(await new Reporter({ ...OPTIONS, dependencies: false }).sendDependencies(dependencies), {
        sent: false,
        error: 'disabled',
    });
    assert.strictEqual((await new Reporter({}).sendDependencies(dependencies)).sent, false);
    assert.strictEqual(sent.length, 0);
});

// --- Zamanlama ---------------------------------------------------------------

/** Sahte saat ve zamanlayıcılar: süre elle ilerletilir. */
function fakeClock() {
    let now = 1_000_000;
    let id = 0;
    const pending = new Map();

    const add = (fn, ms, repeat) => {
        const timer = { id: ++id, at: now + ms, ms, fn, repeat, unrefed: false, unref() { this.unrefed = true; } };
        pending.set(timer.id, timer);

        return timer;
    };

    return {
        now: () => now,
        pending,
        timers: {
            setTimeout: (fn, ms) => add(fn, ms, false),
            setInterval: (fn, ms) => add(fn, ms, true),
            clearTimeout: (t) => pending.delete(t.id),
            clearInterval: (t) => pending.delete(t.id),
        },
        async advance(ms) {
            const end = now + ms;
            for (;;) {
                const next = [...pending.values()].filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
                if (!next) break;
                now = next.at;
                if (next.repeat) next.at += next.ms;
                else pending.delete(next.id);
                next.fn();
                // Gönderim promise'leri çözülsün.
                for (let i = 0; i < 10; i++) await Promise.resolve();
            }
            now = end;
        },
    };
}

function schedule(clock, state) {
    return new DependencySchedule({
        now: clock.now,
        timers: clock.timers,
        read: () => (state.supported === false ? { supported: false, error: 'no-lockfile' } : { supported: true, dependencies: { hash: state.hash } }),
        send: async (dependencies) => {
            state.sends.push(dependencies.hash);

            return { sent: state.fail ? false : true };
        },
    });
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

test('zamanlama: 60 sn gecikme, sonra 24 saatte bir; zamanlayıcılar unref', async () => {
    const clock = fakeClock();
    const state = { hash: 'h1', sends: [] };
    const s = schedule(clock, state);

    s.start();
    s.start(); // ikinci çağrı ikinci zamanlayıcı kurmaz
    assert.strictEqual(clock.pending.size, 1);
    assert.ok([...clock.pending.values()].every((t) => t.unrefed));

    await clock.advance(59 * 1000);
    assert.deepStrictEqual(state.sends, []);

    await clock.advance(1000);
    assert.deepStrictEqual(state.sends, ['h1']);
    assert.ok([...clock.pending.values()].every((t) => t.unrefed));

    await clock.advance(23 * HOUR);
    assert.deepStrictEqual(state.sends, ['h1'], 'özet aynı, 24 saat dolmadı');

    await clock.advance(1 * HOUR);
    assert.deepStrictEqual(state.sends, ['h1', 'h1'], '24 saat doldu');

    s.stop();
    assert.strictEqual(clock.pending.size, 0);
});

test('zamanlama: özet değişince 24 saati beklemeden gönderilir', async () => {
    const clock = fakeClock();
    const state = { hash: 'h1', sends: [] };
    const s = schedule(clock, state);

    s.start();
    await clock.advance(MINUTE);
    state.hash = 'h2';
    await clock.advance(HOUR);

    assert.deepStrictEqual(state.sends, ['h1', 'h2']);
    s.stop();
});

test('zamanlama: başarısız gönderim sonraki kontrolde yeniden denenir', async () => {
    const clock = fakeClock();
    const state = { hash: 'h1', sends: [], fail: true };
    const s = schedule(clock, state);

    s.start();
    await clock.advance(MINUTE);
    state.fail = false;
    await clock.advance(HOUR);
    await clock.advance(HOUR);

    assert.deepStrictEqual(state.sends, ['h1', 'h1']);
    s.stop();
});

test('zamanlama: kilit dosyası yoksa hiçbir şey gönderilmez; okuma hatası fırlatmaz', async () => {
    const clock = fakeClock();
    const state = { supported: false, sends: [] };
    const s = schedule(clock, state);

    s.start();
    await clock.advance(25 * HOUR);
    assert.deepStrictEqual(state.sends, []);
    s.stop();

    const broken = new DependencySchedule({ read: () => { throw new Error('x'); }, send: async () => ({ sent: true }) });
    assert.strictEqual(await broken.check(), false);
});

test('startDependencies: VITALWATCH_ENABLED=false ya da bağımlılık kapalıysa zamanlayıcı kurulmaz', () => {
    const vitalwatch = require('../src/index');

    try {
        vitalwatch.init({ ...OPTIONS, enabled: false });
        assert.strictEqual(vitalwatch.startDependencies(), null);

        vitalwatch.init({ ...OPTIONS, dependencies: false });
        assert.strictEqual(vitalwatch.startDependencies(), null);

        const clock = fakeClock();
        vitalwatch.init(OPTIONS);
        assert.ok(vitalwatch.startDependencies({ now: clock.now, timers: clock.timers }));
        assert.strictEqual(clock.pending.size, 1);
    } finally {
        vitalwatch.stopDependencies();
    }
});

test('VITALWATCH_DEPENDENCIES ortamdan okunur', () => {
    const vitalwatch = require('../src/index');
    const saved = process.env.VITALWATCH_DEPENDENCIES;

    try {
        process.env.VITALWATCH_DEPENDENCIES = 'false';
        require('../src/env').forget();
        assert.strictEqual(vitalwatch.init({}).dependencies, false);

        delete process.env.VITALWATCH_DEPENDENCIES;
        require('../src/env').forget();
        assert.strictEqual(vitalwatch.init({}).dependencies, true);
    } finally {
        if (saved === undefined) delete process.env.VITALWATCH_DEPENDENCIES;
        else process.env.VITALWATCH_DEPENDENCIES = saved;
        require('../src/env').forget();
    }
});

// --- vitalwatch-status ---------------------------------------------------------

const BIN = path.join(__dirname, '../bin/vitalwatch-status.js');

/** Komutu ayrı süreçte çalıştırır; fetch sahte, giden adresler stderr'e yazılır. */
function runStatus(cwd, args = [], extraEnv = {}) {
    const stub =
        "globalThis.fetch = async (url) => { process.stderr.write('FETCH ' + url + '\\n'); return { status: 204, ok: true }; };";

    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith('VITALWATCH_')) delete env[key];
    for (const key of ENV_NAMES) delete env[key];

    return spawnSync(process.execPath, ['-e', `${stub} require(${JSON.stringify(BIN)});`, '--', ...args], {
        env: {
            ...env,
            VITALWATCH_URL: 'https://hub.sample',
            VITALWATCH_KEY: 'k',
            VITALWATCH_SECRET: 'a'.repeat(64),
            VITALWATCH_ENV: 'production',
            VITALWATCH_STATUS_OFFLINE: '1',
            ...extraEnv,
        },
        cwd,
        encoding: 'utf8',
    });
}

test('vitalwatch-status Dependencies satırı', () => {
    const withLock = runStatus(tempRoot(V3));
    assert.strictEqual(withLock.status, 0, withLock.stderr);
    assert.match(withLock.stdout, /Dependencies\s+package-lock\.json · 7 packages/);

    const without = runStatus(tempRoot());
    assert.match(without.stdout, /Dependencies\s+not supported \(no package-lock\.json\)/);

    const disabled = runStatus(tempRoot(V3), [], { VITALWATCH_DEPENDENCIES: 'false' });
    assert.match(disabled.stdout, /Dependencies\s+disabled/);
});

test('vitalwatch-status --deps hemen gönderir ve HTTP durumunu yazar', () => {
    const result = runStatus(tempRoot(V3), ['--deps']);

    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /Dependency list sent: 7 packages \(HTTP 204\)/);
    assert.match(result.stderr, /FETCH https:\/\/hub\.sample\/api\/i\/k\/deps/);
});

test('vitalwatch-status --deps kilit dosyası yoksa ya da kapalıysa hata verir', () => {
    const none = runStatus(tempRoot(), ['--deps']);
    assert.strictEqual(none.status, 1);
    assert.match(none.stderr, /NOT SENT: not supported \(no package-lock\.json\)/);
    assert.doesNotMatch(none.stderr, /FETCH/);

    const disabled = runStatus(tempRoot(V3), ['--deps'], { VITALWATCH_DEPENDENCIES: 'false' });
    assert.strictEqual(disabled.status, 1);
    assert.match(disabled.stderr, /NOT SENT: disabled/);
});

test('vitalwatch-status --test bağımlılık göndermez', () => {
    const result = runStatus(tempRoot(V3), ['--test']);

    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stderr, /FETCH https:\/\/hub\.sample\/api\/i\/k\/server/);
    assert.doesNotMatch(result.stderr, /\/deps/);
});
