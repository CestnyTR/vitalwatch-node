/**
 * vitalwatch-node
 *
 * Types are hand-written, not generated: the package has no build step and
 * should not have one — per the dependency policy (see README) no build
 * toolchain is added.
 */

export interface VitalWatchOptions {
    /** When false, no data is sent. */
    enabled?: boolean;
    /** Hub URL, e.g. https://vitalwatch.example.com */
    url?: string;
    /** Project key from the hub panel. */
    key?: string;
    /** 64-character project secret. Server-side only. */
    secret?: string;
    /** production | staging | local */
    env?: string;
    /**
     * Release tag (commit sha, tag). If omitted, `init()` resolves it:
     * `VITALWATCH_RELEASE` > CI/PaaS variables > `.git` in the app root.
     */
    release?: string;
    /**
     * Send timeout in ms. Default 2000. Values below 100 are treated as
     * seconds (`2` → 2000 ms); the result is clamped to 100–10000 ms. Invalid,
     * zero or negative values fall back to the default.
     */
    timeout?: number;
    /** Requests taking at least this long are reported as slow (ms). Default 1000. */
    slowRequestMs?: number;
    /** Error names or classes that are never reported. */
    ignore?: Array<string | Function>;
    /** 'server' | 'ssr' */
    source?: string;
}

export interface EventContext {
    kind?: string;
    route?: string;
    method?: string;
}

/** `report()` context: `EventContext` + the response object. */
export interface ReportContext extends EventContext {
    /**
     * If given, and the error is actually going to be sent, the response is
     * marked so request measurement does not open a separate "HTTP 500" for
     * the same request. Never sent to the hub. `Reporter.recordException`
     * does not accept it — the mark is only set through `report()`.
     */
    res?: object;
}

/**
 * Send result. Only the diagnostic command reads it; the monitoring path
 * ignores it — there is nothing to do if a send fails.
 */
export interface SendResult {
    sent: boolean;
    status?: number;
    error?: string;
}

export declare class Reporter {
    constructor(options?: VitalWatchOptions);
    configured(): boolean;
    /** Whether `recordException` would send this error — synchronous, never throws. */
    willRecord(error: unknown): boolean;
    recordException(error: unknown, context?: EventContext): Promise<SendResult>;
    recordRequest(measurement: {
        route: string;
        method: string;
        status: number;
        durationMs: number;
    }): Promise<void>;
}

/** Sets up the reporter. If not called, it is configured from the environment on first use. */
export declare function init(options?: VitalWatchOptions): Reporter;

/** Reports an error. Never throws. */
export declare function report(error: unknown, context?: ReportContext): Promise<SendResult>;

/** Listens to uncaughtException and unhandledRejection; process behaviour is unchanged. */
export declare function hookProcess(): Reporter;

export declare function reporter(): Reporter;

/**
 * Periodic "I'm alive" request for the lifetime of the process; the first one
 * is sent immediately. Default interval 8 hours. The timer is `unref`ed and
 * does not keep the process alive. `hookProcess()` already calls this; apps
 * that write their own process listeners can use it on its own.
 */
export declare function startHeartbeat(intervalMs?: number): ReturnType<typeof setInterval>;

export declare function stopHeartbeat(): void;

/** Express/Connect middleware. Register it before your routes. */
export declare function express(options?: VitalWatchOptions): (
    req: any,
    res: any,
    next: (error?: unknown) => void,
) => void;

export declare namespace express {
    /** Express error middleware. Does not swallow the error; passes it down the chain. */
    function errors(): (
        error: unknown,
        req: any,
        res: any,
        next: (error?: unknown) => void,
    ) => void;
}

/** Export it from Next 15+ `instrumentation.js`. */
export declare function nextOnRequestError(
    error: unknown,
    request?: { path?: string; method?: string },
    context?: unknown,
): Promise<SendResult> | void;

/** Fastify plugin: `app.register(fastify)`. Breaks encapsulation so it applies app-wide. */
export declare function fastify(app: any, options?: unknown, done?: () => void): void;

/** Koa: `koa(app)`. Koa's own error logging is preserved. */
export declare function koa<T>(app: T): T;

/** Hono middleware: `app.use(hono())`. */
export declare function hono(): (c: any, next: () => Promise<void>) => Promise<void>;

/** NestJS global interceptor: `app.useGlobalInterceptors(nest())`. */
export declare function nest(): { intercept(context: any, next: { handle(): any }): any };

/** SvelteKit `handleError`. If an existing handler is given, it is wrapped and its return value preserved. */
export declare function sveltekit<R = unknown>(
    handler?: (input: { error: unknown; event: any; status?: number; message?: string }) => R,
): (input: { error: unknown; event: any; status?: number; message?: string }) => R | undefined;

/** React Router 7 / Remix `handleError`. Aborted requests are not reported. */
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
