/**
 * Nuxt modülü: `modules: ['vitalwatch-node/nuxt']`.
 *
 * Çalışma zamanı CommonJS (`module.exports = fn`, `.default` = fn); neden
 * `export =` olduğu için bkz. nitro.d.ts.
 */
declare function vitalwatchNuxtModule(options: unknown, nuxt: unknown): void;

declare namespace vitalwatchNuxtModule {
    export function getMeta(): Promise<{ name: string; configKey: string }>;
    export { vitalwatchNuxtModule as default };
}

export = vitalwatchNuxtModule;
