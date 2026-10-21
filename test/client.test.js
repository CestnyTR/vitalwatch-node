'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { HubClient, timeoutMs } = require('../src/client');

/*
| VITALWATCH_TIMEOUT üç pakette aynı adı taşıyor ama Laravel ve Python saniye,
| bu paket milisaniye bekliyordu. `2` yazan birinin gönderimleri 2 ms'de
| kesilir ve hiçbir olay ulaşmazdı. Kural artık ortak: 100 ve üstü
| milisaniye, altı saniye.
*/
test('zaman aşımı milisaniye, 100 ün altı saniye sayılır', () => {
    const cases = [
        [2000, 2000], ['1500', 1500], [2, 2000], ['0.5', 500],
        [0, 2000], ['abc', 2000], [undefined, 2000], [null, 2000],
        ['', 2000], [-5, 2000], [NaN, 2000], [Infinity, 2000], [-Infinity, 2000],
    ];

    for (const [input, expected] of cases) {
        assert.strictEqual(timeoutMs(input), expected, String(input));
    }
});

test('istemci kuralı kullanır', () => {
    assert.strictEqual(new HubClient({ timeout: 3 }).timeout, 3000);
    assert.strictEqual(new HubClient({}).timeout, 2000);
});

/*
| Sıkıştırma: 100 ms'nin altı hub'a ulaşmaya yetmez, 10 saniyenin üstü
| gönderimi askıda tutar. Kural bütün paketlerde aynı.
*/
test('zaman aşımı 100 ile 10000 ms arasına sıkıştırılır', () => {
    const cases = [
        [0.05, 100], ['0.01', 100], [100, 100], [10000, 10000],
        [10001, 10000], [60000, 10000], [99, 10000], [30, 10000], [10, 10000],
    ];

    for (const [input, expected] of cases) {
        assert.strictEqual(timeoutMs(input), expected, String(input));
    }
});

test('kod içinden verilen zaman aşımı da aynı kuraldan geçer', () => {
    assert.strictEqual(new HubClient({ timeout: 50 }).timeout, 10000);
    assert.strictEqual(new HubClient({ timeout: 999999 }).timeout, 10000);
});
