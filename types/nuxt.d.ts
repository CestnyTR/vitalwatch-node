/**
 * Nuxt module: `modules: ['vitalwatch-node/nuxt']`.
 *
 * The runtime is CommonJS (`module.exports = fn`, `.default` = fn); for why
 * it uses `export =`, see nitro.d.ts.
 */
declare function vitalwatchNuxtModule(options: unknown, nuxt: unknown): void;

declare namespace vitalwatchNuxtModule {
    export function getMeta(): Promise<{ name: string; configKey: string }>;
    export { vitalwatchNuxtModule as default };
}

export = vitalwatchNuxtModule;
