'use strict';

/**
 * Ortam adı normalleştirme — Laravel ve Python paketleriyle aynı tablo.
 *
 * Hub yalnızca production, staging ve local kabul ediyor; küme dışındaki
 * olayı — canlılık dahil — 204 dönüp atıyor. `NODE_ENV=development` ya da
 * `VITALWATCH_ENV=prod` ile kurulan proje hiçbir şey göndermiyormuş gibi
 * görünüyordu. Yaygın takma adlar karşılığına çevrilir; tanınmayan değer
 * olduğu gibi gider (hub onu panelde "ortam" reddi olarak sayar) ve
 * `vitalwatch-status` hata verir. Bilinmeyeni production saymak test verisini
 * canlı verinin arasına karıştırırdı.
 */
const ENVIRONMENTS = ['production', 'staging', 'local'];

const ALIASES = {
    production: 'production', prod: 'production', live: 'production',
    staging: 'staging', stage: 'staging', stg: 'staging', preprod: 'staging', uat: 'staging',
    local: 'local', dev: 'local', development: 'local', test: 'local', testing: 'local',
};

function normalizeEnv(value) {
    if (value === null || value === undefined || value === '') return 'production';

    const key = String(value).trim().toLowerCase();

    return Object.prototype.hasOwnProperty.call(ALIASES, key) ? ALIASES[key] : String(value).trim();
}

function acceptedEnv(value) {
    return ENVIRONMENTS.includes(value);
}

module.exports = { normalizeEnv, acceptedEnv, ENVIRONMENTS };
