'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const { Worker } = require('node:worker_threads');
const { fork } = require('node:child_process');
const { writeFileSync, mkdtempSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

const { hookWorkers } = require('../src/workers');

/*
 * hookProcess yalnızca ana thread'i kancalıyor: worker içinde patlayan hata
 * ana thread'e istisna olarak ulaşmaz, worker nesnesinin `error` olayına
 * düşer ve kimse dinlemiyorsa hiçbir iz bırakmaz.
 */
const raporlananlar = [];

beforeEach(() => {
    raporlananlar.length = 0;
});

// Modül tek sefer kancalanıyor (hooked bayrağı); dizi referansı sabit kalsın.
hookWorkers((error, context) => raporlananlar.push({ error, context }));

function tempFile(name, content) {
    const dizin = mkdtempSync(join(tmpdir(), 'vitalwatch-'));
    const path = join(dizin, name);
    writeFileSync(path, content);

    return path;
}

test('worker içindeki hata raporlanır', async () => {
    const path = tempFile('patlayan.js', 'throw new Error("worker patladi");');

    await new Promise((cozumle) => {
        const worker = new Worker(path);
        /*
         * Dinleyici şart: dinlenmeyen `error` olayını Node ana thread'e
         * fırlatır. Kanca bunu YUTMUYOR — yutsaydı uygulamanın kendi hata
         * yönetimini değiştirmiş olurduk. Dinleyicisi olmayan bir uygulamada
         * hata zaten uncaughtException'a düşer ve oradan raporlanır.
         */
        worker.on('error', () => {});
        worker.on('exit', () => setTimeout(cozumle, 20));
    });

    assert.equal(raporlananlar.length, 1);
    assert.match(String(raporlananlar[0].error.message), /worker patladi/);
    // Rota alanı hatayı ana thread'den ayırıyor.
    assert.equal(raporlananlar[0].context.route, 'worker');
});

test('sıfır olmayan kodla çıkan worker raporlanır', async () => {
    const path = tempFile('cikan.js', 'process.exit(3);');

    await new Promise((cozumle) => {
        const worker = new Worker(path);
        worker.on('exit', () => setTimeout(cozumle, 20));
    });

    assert.equal(raporlananlar.length, 1);
    assert.match(String(raporlananlar[0].error.message), /exited with code 3/);
});

test('temiz çıkan worker raporlanmaz', async () => {
    const path = tempFile('silent.js', '// hiçbir şey yapmaz');

    await new Promise((cozumle) => {
        const worker = new Worker(path);
        worker.on('exit', () => setTimeout(cozumle, 20));
    });

    assert.equal(raporlananlar.length, 0);
});

/*
 * Yakalanmamış hata önce `error` sonra `exit` tetikler; aynı çöküş iki kayıt
 * üretmemeli.
 */
test('tek çöküş tek kayıt üretir', async () => {
    const path = tempFile('single.js', 'throw new Error("bir kez");');

    await new Promise((cozumle) => {
        const worker = new Worker(path);
        worker.on('error', () => {});
        worker.on('exit', () => setTimeout(cozumle, 30));
    });

    assert.equal(raporlananlar.length, 1);
});

test('fork edilen sürecin çökmesi raporlanır', async () => {
    const path = tempFile('altsurec.js', 'process.exit(2);');

    await new Promise((cozumle) => {
        const cocuk = fork(path, [], { silent: true });
        cocuk.on('exit', () => setTimeout(cozumle, 20));
    });

    assert.equal(raporlananlar.length, 1);
    assert.equal(raporlananlar[0].context.route, 'fork');
});
