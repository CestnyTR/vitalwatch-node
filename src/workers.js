'use strict';

/**
 * Worker thread ve fork edilmiş süreçlerin çökmesini yakalar.
 *
 * `hookProcess()` yalnızca ana thread'i kancalar: `uncaughtException` ve
 * `unhandledRejection` orada dinlenir. Bir worker içinde patlayan hata ana
 * thread'e istisna olarak ulaşmaz — worker nesnesinin `error` olayı olarak
 * gelir ve kimse dinlemiyorsa **hiçbir iz bırakmaz**.
 *
 * Worker'ın kendi dosyasına SDK kurmak çözüm değil: o dosyayı uygulama
 * yazıyor ve her worker'da paketi çağırmayı hatırlamak gerekirdi. Kanca
 * ebeveyn tarafına konuyor — worker kodu ne yaparsa yapsın çalışır.
 *
 * ## Neden yapıcı değil prototip yamalanıyor
 *
 * İlk deneme `threads.Worker`'ı bir alt sınıfla değiştiriyordu ve
 * **çalışmadı**: uygulama modülleri `const { Worker } = require(...)` ile
 * referansı kendi yüklenme anında kopyalıyor. Bizden önce yüklenen her modül
 * yamasız sürümü elinde tutuyor ve kanca sessizce devre dışı kalıyor.
 *
 * `prototype.emit` bu sorunu bilmiyor: bütün örnekler aynı prototipi
 * paylaşıyor, hangi referansla üretildikleri fark etmiyor. `auto.js` de
 * `Server.prototype.emit` için aynı yöntemi kullanıyor.
 *
 * `spawn`/`exec` bilerek KAPSAM DIŞI: dış komutlarda sıfır olmayan çıkış
 * kodu rutindir (`grep` eşleşme bulamazsa 1 döner) ve hata saymak paneli
 * anlamsız kayıtlarla doldururdu. Ayrım IPC kanalından yapılıyor — `fork()`
 * her zaman kanal açar, `spawn` açmaz.
 */

let hooked = false;

/**
 * @param {(error: unknown, context: {kind?: string, route?: string}) => void} report
 */
function hookWorkers(report) {
    // İki kez sarılırsa her hata iki kez raporlanır; hookProcess birden
    // fazla yerden çağrılabiliyor.
    if (hooked) {
        return;
    }

    hooked = true;

    patch(safeRequire('node:worker_threads')?.Worker, report, 'worker');
    patch(safeRequire('node:child_process')?.ChildProcess, report, 'fork');
}

function safeRequire(name) {
    try {
        return require(name);
    } catch {
        // Çok eski Node; kanca kurulmaz, uygulama etkilenmez.
        return null;
    }
}

/**
 * Prototipin `emit`'ini sarar: çöküş olaylarını raporlar, olayı aynen
 * geçirir.
 */
function patch(CustomError, report, route) {
    if (typeof CustomError !== 'function' || !CustomError.prototype) {
        return;
    }

    const originalEmit = CustomError.prototype.emit;

    if (typeof originalEmit !== 'function') {
        return;
    }

    CustomError.prototype.emit = function (event, ...args) {
        try {
            gozle(this, event, args, report, route);
        } catch {
            // İzleme kodu olay akışını bozmaz.
        }

        return originalEmit.apply(this, arguments);
    };
}

function gozle(target, event, args, report, route) {
    /*
     * Alt süreçlerde yalnızca fork edilenler izleniyor. IPC kanalı ayrımı
     * veriyor: fork() her zaman kanal açar, spawn/exec açmaz.
     *
     * Kanal `exit` anında çoktan kapanmış oluyor, o yüzden sürecin yaşadığı
     * herhangi bir olayda işaretleniyor ve karar o işarete bakıyor. İlk olay
     * `spawn` — çöküş ne kadar erken olursa olsun ondan sonra gelir.
     */
    if (route === 'fork') {
        // Yalnızca `channel`: `_channel` özel alan ve okunması Node'un
        // deprecation uyarısını tetikliyor — paket log kirliliği üretmez.
        if (target.channel) {
            target.__vitalwatchForked = true;
        }

        if (!target.__vitalwatchForked) {
            return;
        }
    }

    if (event === 'error') {
        // Yakalanmamış hata önce `error` sonra `exit` tetikler; bayrak aynı
        // çöküşün iki kayıt üretmesini engelliyor.
        target.__vitalwatchReported = true;
        report(args[0], { kind: 'exception', route });

        return;
    }

    if (event !== 'exit' || target.__vitalwatchReported) {
        return;
    }

    const code = args[0];

    if (code === 0 || code === null || code === undefined) {
        return;
    }

    /*
     * Hata olayı gelmeden sıfır olmayan kodla çıkmak: süreç kendini
     * sonlandırmış ya da öldürülmüş. Ebeveynde başka hiçbir belirtisi olmaz.
     */
    const signal = args[1];
    const name = route === 'worker' ? 'Worker' : 'Alt süreç';

    report(
        new Error(`${name} ${code} koduyla sonlandı${signal ? ` (${signal})` : ''}`),
        { kind: 'exception', route },
    );
}

module.exports = { hookWorkers };
