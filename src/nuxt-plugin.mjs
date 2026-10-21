/*
 * Nuxt uygulama eklentileri ESM olmak zorunda: CommonJS dosya verildiğinde
 * Nuxt `export default` bulamıyor ve eklentiyi boş bir fonksiyonla
 * değiştiriyor — derleme uyarısız geçiyor, kanca hiç kurulmuyor. Gerçek bir
 * Nuxt 3.21 derlemesinde görüldü. Mantık CommonJS dosyada, burası yalnızca
 * kapı.
 *
 * `#app` Nuxt derlemesinin kendi takma adı; bu dosya yalnızca orada
 * yüklenir, düz Node'da içe aktarılmaz.
 */
import { defineNuxtPlugin } from '#app';
import plugin from './nuxt-plugin.js';

export default defineNuxtPlugin({ name: 'vitalwatch', setup: plugin });
