/**
 * vitalwatch-node
 *
 * Tipler elle yazıldı, üretilmedi: paketin build adımı yok ve olmamalı —
 * bağımlılık politikası gereği (bkz. README) derleme zinciri eklenmiyor.
 */

export interface VitalWatchOptions {
    /** false ise hiçbir veri gönderilmez. */
    enabled?: boolean;
    /** Hub adresi, örn. https://vitalwatch.example.com */
    url?: string;
    /** Panelden alınan proje anahtarı. */
    key?: string;
    /** 64 karakterlik proje secret'i. Yalnızca sunucuda bulunur. */
    secret?: string;
    /** production | staging | local */
    env?: string;
    /**
     * Sürüm etiketi (commit sha, tag). Verilmezse `init()` bulur:
     * `VITALWATCH_RELEASE` > CI/PaaS değişkenleri > uygulama kökündeki `.git`.
     */
    release?: string;
    /**
     * Gönderim zaman aşımı, ms. Varsayılan 2000. 100'ün altı saniye sayılır
     * (`2` → 2000 ms); sonuç 100–10000 ms aralığına sıkıştırılır. Geçersiz,
     * sıfır ya da negatif değer varsayılana döner.
     */
    timeout?: number;
    /** Bu süreyi aşan istekler yavaş sayılır (ms). Varsayılan 1000. */
    slowRequestMs?: number;
    /** Raporlanmayacak hata adları veya sınıfları. */
    ignore?: Array<string | Function>;
    /** 'server' | 'ssr' */
    source?: string;
}

export interface EventContext {
    kind?: string;
    route?: string;
    method?: string;
}

/** `report()` bağlamı: `EventContext` + yanıt nesnesi. */
export interface ReportContext extends EventContext {
    /**
     * Yanıt nesnesi verilirse ve hata gerçekten gönderilecekse işaretlenir;
     * ölçüm aynı istek için ayrıca "HTTP 500" açmaz. Hub'a gönderilmez.
     * `Reporter.recordException` bunu kabul etmez — işaret yalnızca
     * `report()` üzerinden konur.
     */
    res?: object;
}

/**
 * Gönderim sonucu. Yalnızca teşhis komutu okuyor; izleme yolu görmezden
 * geliyor — gönderim başarısızsa yapılacak bir şey yok.
 */
export interface SendResult {
    sent: boolean;
    status?: number;
    error?: string;
}

export declare class Reporter {
    constructor(options?: VitalWatchOptions);
    configured(): boolean;
    /** `recordException` bu hatayı gönderecek mi — senkron, fırlatmaz. */
    willRecord(error: unknown): boolean;
    recordException(error: unknown, context?: EventContext): Promise<SendResult>;
    recordRequest(measurement: {
        route: string;
        method: string;
        status: number;
        durationMs: number;
    }): Promise<void>;
}

/** Raporlayıcıyı kurar. Çağrılmazsa ilk kullanımda ortamdan kurulur. */
export declare function init(options?: VitalWatchOptions): Reporter;

/** Bir hatayı bildirir. Hiçbir koşulda hata fırlatmaz. */
export declare function report(error: unknown, context?: ReportContext): Promise<SendResult>;

/** uncaughtException ve unhandledRejection dinlenir; süreç davranışı değişmez. */
export declare function hookProcess(): Reporter;

export declare function reporter(): Reporter;

/**
 * Süreç boyunca düzenli "buradayım" isteği; ilkini hemen atar. Varsayılan
 * 8 saat. Zamanlayıcı `unref`li, süreci ayakta tutmaz. `hookProcess()`
 * bunu zaten çağırır; kendi süreç dinleyicilerini yazan uygulama tek başına
 * kullanır.
 */
export declare function startHeartbeat(intervalMs?: number): ReturnType<typeof setInterval>;

export declare function stopHeartbeat(): void;

/** Express/Connect middleware. Rotalardan önce eklenir. */
export declare function express(options?: VitalWatchOptions): (
    req: any,
    res: any,
    next: (error?: unknown) => void,
) => void;

export declare namespace express {
    /** Express hata middleware'i. Hatayı yutmaz, zincire devreder. */
    function errors(): (
        error: unknown,
        req: any,
        res: any,
        next: (error?: unknown) => void,
    ) => void;
}

/** Next 15+ `instrumentation.js` içinden dışa aktarılır. */
export declare function nextOnRequestError(
    error: unknown,
    request?: { path?: string; method?: string },
    context?: unknown,
): Promise<SendResult> | void;

/** Fastify eklentisi: `app.register(fastify)`. Kapsamı üst seviyeye taşır. */
export declare function fastify(app: any, options?: unknown, done?: () => void): void;

/** Koa: `koa(app)`. Koa'nın kendi hata günlüğü korunur. */
export declare function koa<T>(app: T): T;

/** Hono middleware'i: `app.use(hono())`. */
export declare function hono(): (c: any, next: () => Promise<void>) => Promise<void>;

/** NestJS global interceptor'ı: `app.useGlobalInterceptors(nest())`. */
export declare function nest(): { intercept(context: any, next: { handle(): any }): any };

/** SvelteKit `handleError`. Mevcut işleyici verilirse sarılır, dönüşü korunur. */
export declare function sveltekit<R = unknown>(
    handler?: (input: { error: unknown; event: any; status?: number; message?: string }) => R,
): (input: { error: unknown; event: any; status?: number; message?: string }) => R | undefined;

/** React Router 7 / Remix `handleError`. İptal edilen istekler raporlanmaz. */
export declare function reactRouter(
    handler?: (error: unknown, args: { request: Request; [key: string]: unknown }) => void,
): (error: unknown, args: { request: Request; [key: string]: unknown }) => void;

export declare const version: string;

export declare const Scrubber: {
    text(value: unknown, limit: number): string | null;
    path(value: unknown): string | null;
    sql(value: unknown): string | null;
    message(value: unknown, containsSql?: boolean): string | null;
    stack(value: unknown): string | null;
};
