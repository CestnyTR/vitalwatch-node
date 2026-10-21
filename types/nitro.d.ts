/**
 * Nitro sunucu eklentisi: `export default defineNitroPlugin(vitalwatch)`.
 *
 * Çalışma zamanı CommonJS (`module.exports = fn`, `.default` = fn). Bu yüzden
 * `export default` değil `export =` + ad alanı: `export default` yazılınca
 * `moduleResolution: node16/nodenext` altında ESM'den varsayılan içe aktarım
 * `{ default: fn }` tipinde görünüyor ve `defineNitroPlugin(vitalwatch)` tip
 * hatası veriyordu. `bundler` çözümlemesi ikisini de kabul ediyor.
 */
declare function vitalwatchNitro(nitroApp: unknown): void;

declare namespace vitalwatchNitro {
    export { vitalwatchNitro as default };
}

export = vitalwatchNitro;
