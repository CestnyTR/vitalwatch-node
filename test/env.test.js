'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const { env: readEnv, forget } = require('../src/env');

let dir;
let previousCwd;
let previousEnv;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vitalwatch-'));
    previousCwd = process.cwd();
    previousEnv = { ...process.env };
    process.chdir(dir);
    forget();
});

afterEach(() => {
    process.chdir(previousCwd);
    rmSync(dir, { recursive: true, force: true });
    process.env = previousEnv;
    forget();
});

function write(name, content) {
    writeFileSync(join(dir, name), content);
}

/**
 * Gerçek bir kurulumda yaşandı: `.env` doğru doldurulmuşken `npx vitalwatch-status`
 * "TANIMSIZ" dedi. Teşhis aracının yanlış teşhis koyması, hiç teşhis
 * koymamaktan kötüdür.
 */
test('.env dosyasından okur', () => {
    delete process.env.VITALWATCH_URL;
    write('.env', 'VITALWATCH_URL=https://hub.sample\nVITALWATCH_KEY=sample\n');

    const e = readEnv();

    assert.strictEqual(e.VITALWATCH_URL, 'https://hub.sample');
    assert.strictEqual(e.VITALWATCH_KEY, 'sample');
});

test('süreç ortamı dosyayı ezer', () => {
    process.env.VITALWATCH_URL = 'https://surecten';
    write('.env', 'VITALWATCH_URL=https://dosyadan\n');

    assert.strictEqual(readEnv().VITALWATCH_URL, 'https://surecten');
});

test('.env.<NODE_ENV> .env dosyasını ezer', () => {
    delete process.env.VITALWATCH_URL;
    process.env.NODE_ENV = 'production';

    write('.env', 'VITALWATCH_URL=https://genel\n');
    write('.env.production', 'VITALWATCH_URL=https://uretim\n');

    assert.strictEqual(readEnv().VITALWATCH_URL, 'https://uretim');
});

test('yorum, tırnak ve export öneki ayrıştırılır', () => {
    delete process.env.VITALWATCH_URL;
    delete process.env.VITALWATCH_KEY;
    delete process.env.VITALWATCH_SECRET;

    write(
        '.env',
        [
            '# yorum satırı',
            'export VITALWATCH_URL=https://hub.sample',
            'VITALWATCH_KEY="quoted-value"',
            "VITALWATCH_SECRET='single-quote'",
            '',
        ].join('\n'),
    );

    const e = readEnv();

    assert.strictEqual(e.VITALWATCH_URL, 'https://hub.sample');
    assert.strictEqual(e.VITALWATCH_KEY, 'quoted-value');
    assert.strictEqual(e.VITALWATCH_SECRET, 'single-quote');
});

/** Paketin başka hiçbir değişkeni görmesine gerek yok. */
test('VITALWATCH_ dışındaki anahtarlar okunmaz', () => {
    write('.env', 'DB_PASSWORD=gizli\nVITALWATCH_KEY=sample\n');

    const e = readEnv();

    assert.strictEqual(e.DB_PASSWORD, undefined);
    assert.strictEqual(e.VITALWATCH_KEY, 'sample');
});

test('dosya yoksa hata vermez', () => {
    assert.doesNotThrow(() => readEnv());
});
