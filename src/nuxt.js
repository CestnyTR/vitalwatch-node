'use strict';

const path = require('node:path');

/**
 * Nuxt modülü — tek satır kurulum:
 *
 *     // nuxt.config.ts
 *     export default defineNuxtConfig({
 *         modules: ['vitalwatch-node/nuxt'],
 *     });
 *
 * İki eklenti kaydeder: Nitro'nun sunucu hataları ve SSR render hataları.
 * Yavaş istekler ve süreç hataları için kodsuz kurulum (NODE_OPTIONS) yine
 * gerekir; modül onun yerini tutmaz, eksiğini kapatır.
 *
 * @nuxt/kit kullanılmadı: paketin bağımlılığı yok ve olmamalı. Nuxt düz
 * fonksiyon modülünü de kabul ediyor.
 */
function vitalwatchNuxtModule(options, nuxt) {
    try {
        const nitro = (nuxt.options.nitro = nuxt.options.nitro || {});
        nitro.plugins = nitro.plugins || [];
        nitro.plugins.push(path.join(__dirname, 'nitro.js'));

        nuxt.options.plugins = nuxt.options.plugins || [];
        nuxt.options.plugins.push({
            src: path.join(__dirname, 'nuxt-plugin.mjs'),
            // İstemci paketine girmez: tarayıcı hataları t.js'in işi.
            mode: 'server',
        });
    } catch {
        // Modül build'i hiçbir koşulda kırmaz.
    }
}

vitalwatchNuxtModule.getMeta = () =>
    Promise.resolve({ name: 'vitalwatch-node', configKey: 'vitalwatch' });

module.exports = vitalwatchNuxtModule;
module.exports.default = vitalwatchNuxtModule;
