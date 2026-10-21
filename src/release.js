'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Sürüm etiketini (`release`) kendiliğinden bulur.
 *
 * `VITALWATCH_RELEASE` neredeyse hiçbir projede dolu değildi; hub "bu hata X
 * deploy'undan sonra başladı" diyemiyordu. Sunucularımızda deploy `git pull`
 * olduğu için `.git` uygulama kökünde duruyor — sha oradan okunuyor.
 *
 * Deploy sonrası süreç yeniden başlatılınca yeni sha okunur. Başlatılmazsa
 * bellekte hâlâ eski kod çalışıyordur; eski sha o durumda doğru etikettir.
 * Bu yüzden yalnızca kurulumda bir kez okunuyor.
 *
 * Kural Laravel ve Python paketleriyle birebir aynı:
 *
 * 1. `VITALWATCH_RELEASE` — kırpılır, en çok 64 karakter, olduğu gibi.
 * 2. CI/PaaS değişkenleri (aşağıdaki sırayla ilk dolu olan). Sha biçimindeyse
 *    küçük harf ilk 12 karakter, değilse kırpılmış en çok 64 karakter.
 * 3. Uygulama kökündeki `.git` (HEAD → dal ref'i → packed-refs; ayrık HEAD).
 *    Yalnızca geçerli 40 hanelik hex sha kabul edilir; ilk 12 karakter.
 * 4. Hiçbiri yoksa etiket yok.
 *
 * `git` programı çalıştırılmaz (alt süreç yok), yalnızca senkron dosya
 * okuması. Hiçbir koşulda fırlatmaz.
 */

const ENV_NAMES = [
    'GIT_COMMIT',
    'GIT_SHA',
    'COMMIT_SHA',
    'SOURCE_VERSION',
    'VERCEL_GIT_COMMIT_SHA',
    'RENDER_GIT_COMMIT',
    'HEROKU_SLUG_COMMIT',
    'CI_COMMIT_SHA',
];

const MAX_LENGTH = 64;
const SHORT_SHA = 12;

/**
 * @param {Record<string, string|undefined>} env
 * @param {string} [root] Uygulama kökü; varsayılan `process.cwd()`.
 * @returns {{value: string|null, source: string|null}}
 */
function resolveRelease(env = process.env, root) {
    try {
        const explicit = clean(env && env.VITALWATCH_RELEASE);
        if (explicit) {
            return { value: explicit.slice(0, MAX_LENGTH), source: 'VITALWATCH_RELEASE' };
        }

        for (const name of ENV_NAMES) {
            const value = clean(env && env[name]);
            if (!value) continue;

            return {
                value: /^[0-9a-f]{7,40}$/i.test(value)
                    ? value.slice(0, SHORT_SHA).toLowerCase()
                    : value.slice(0, MAX_LENGTH),
                source: name,
            };
        }

        const sha = gitSha(root === undefined ? process.cwd() : root);
        if (sha) return { value: sha, source: '.git' };
    } catch {
        // Etiket bulunamadı — raporlama etiketsiz sürer.
    }

    return { value: null, source: null };
}

function clean(value) {
    return typeof value === 'string' ? value.trim() : '';
}

/** `.git`ten 12 karakterlik sha; bulunamazsa null. */
function gitSha(root) {
    try {
        const gitDir = resolveGitDir(root);
        if (!gitDir) return null;

        const head = read(path.join(gitDir, 'HEAD'));
        if (head === null) return null;

        const symbolic = /^ref:\s*(\S+)/.exec(head);
        const sha = symbolic ? readRef(gitDir, symbolic[1]) : head;

        return validSha(sha);
    } catch {
        return null;
    }
}

/**
 * `.git` dizinse kendisi. Dosyaysa (worktree, alt modül) içindeki
 * `gitdir: <yol>` izlenir; göreli yol köke göre çözülür.
 */
function resolveGitDir(root) {
    const dotGit = path.join(root, '.git');
    const stat = fs.statSync(dotGit, { throwIfNoEntry: false });

    if (!stat) return null;
    if (stat.isDirectory()) return dotGit;
    if (!stat.isFile()) return null;

    const match = /^gitdir:\s*(.+?)\s*$/m.exec(read(dotGit) || '');

    return match ? path.resolve(root, match[1]) : null;
}

/** Dal ref'i: önce gevşek dosya, yoksa packed-refs. */
function readRef(gitDir, ref) {
    // `ref: ../../bir/dosya` gibi bir HEAD git dizininin dışına çıkamaz.
    if (!ref.startsWith('refs/') || ref.split('/').includes('..')) return null;

    const loose = read(path.join(gitDir, ref));
    if (loose !== null) return loose;

    const packed = read(path.join(gitDir, 'packed-refs'));
    if (packed === null) return null;

    for (const line of packed.split('\n')) {
        const trimmed = line.trim();
        if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('^')) continue;

        const [sha, name] = trimmed.split(/\s+/);
        if (name === ref) return sha;
    }

    return null;
}

function validSha(value) {
    const sha = clean(value);

    return /^[0-9a-f]{40}$/i.test(sha) ? sha.slice(0, SHORT_SHA).toLowerCase() : null;
}

function read(file) {
    try {
        return fs.readFileSync(file, 'utf8').trim();
    } catch {
        return null;
    }
}

module.exports = { resolveRelease, ENV_NAMES };
