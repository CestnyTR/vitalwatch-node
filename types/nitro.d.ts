/**
 * Nitro server plugin: `export default defineNitroPlugin(vitalwatch)`.
 *
 * The runtime is CommonJS (`module.exports = fn`, `.default` = fn). Hence
 * `export =` + a namespace instead of `export default`: with `export default`,
 * under `moduleResolution: node16/nodenext` a default ESM import was typed as
 * `{ default: fn }` and `defineNitroPlugin(vitalwatch)` failed to type-check.
 * `bundler` resolution accepts both.
 */
declare function vitalwatchNitro(nitroApp: unknown): void;

declare namespace vitalwatchNitro {
    export { vitalwatchNitro as default };
}

export = vitalwatchNitro;
