'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const { normalizeEnv } = require('../src/environment');
const { Reporter } = require('../src/reporter');

/*
| Hub yalnızca production/staging/local kabul ediyor ve küme dışını —
| canlılık dahil — sessizce atıyor. NODE_ENV=development ile kurulan proje
| hiçbir şey göndermiyormuş gibi görünüyordu. Tablo Laravel ve Python
| paketleriyle aynı.
*/
test('yaygın ortam adları hub ın kabul ettiği karşılığa çevrilir', () => {
    const statuses = [
        [undefined, 'production'], ['', 'production'], ['prod', 'production'], ['Live', 'production'],
        ['stage', 'staging'], ['UAT', 'staging'], ['preprod', 'staging'],
        ['development', 'local'], ['dev', 'local'], ['testing', 'local'], ['test', 'local'],
        ['production', 'production'], ['staging', 'staging'], ['local', 'local'],
    ];

    for (const [input, expected] of statuses) {
        assert.strictEqual(normalizeEnv(input), expected, String(input));
    }
});

/* Bilinmeyeni production saymak test verisini canlıya karıştırırdı. */
test('tanınmayan ortam olduğu gibi kalır', () => {
    assert.strictEqual(normalizeEnv('qa-eu'), 'qa-eu');
});

test('raporlayıcı normalleştirilmiş ortamı gönderir', () => {
    assert.strictEqual(new Reporter({ env: 'development' }).env, 'local');
});

test('vitalwatch-status tanınmayan ortamda hata verir', () => {
    const bin = path.join(__dirname, '../bin/vitalwatch-status.js');
    const env = {
        ...process.env,
        VITALWATCH_URL: 'https://hub.sample', VITALWATCH_KEY: 'k', VITALWATCH_SECRET: 'a'.repeat(64), VITALWATCH_ENV: 'qa-eu',
        // Güncelleme denetimi npm'e gitmesin: test ağa çıkmaz.
        VITALWATCH_STATUS_OFFLINE: '1',
    };

    assert.throws(() => execFileSync(process.execPath, [bin], { env, cwd: __dirname, stdio: 'pipe' }), (error) =>
        String(error.stdout).concat(String(error.stderr)).includes('kabul edilmez'),
    );

    const good = execFileSync(process.execPath, [bin], { env: { ...env, VITALWATCH_ENV: 'prod' }, cwd: __dirname, stdio: 'pipe' });
    assert.ok(String(good).includes('production (prod)'));
});
