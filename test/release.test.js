'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolveRelease, ENV_NAMES } = require('../src/release');

/*
| Sürüm etiketi kendiliğinden bulunuyor. VITALWATCH_RELEASE neredeyse hiçbir
| projede dolu değildi ve hub "bu hata X deploy'undan sonra başladı"
| diyemiyordu. Kural Laravel ve Python paketleriyle aynı; buradaki
| cases üçünde de aynı sonucu vermeli.
*/

const SHA = 'A1B2C3D4E5F60718293A4B5C6D7E8F9012345678';
const SHORT = 'a1b2c3d4e5f6';
const OTHER = '0123456789abcdef0123456789abcdef01234567';

const temps = [];

function tempRoot() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vitalwatch-release-'));
    temps.push(dir);

    return dir;
}

afterEach(() => {
    while (temps.length) fs.rmSync(temps.pop(), { recursive: true, force: true });
});

function write(file, content) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
}

// --- .git -----------------------------------------------------------------

test('.git: dal ref dosyasından sha okunur, küçük harf ilk 12', () => {
    const root = tempRoot();
    write(path.join(root, '.git/HEAD'), 'ref: refs/heads/main\n');
    write(path.join(root, '.git/refs/heads/main'), `${SHA}\n`);

    assert.deepStrictEqual(resolveRelease({}, root), { value: SHORT, source: '.git' });
});

test('.git: dal ref dosyası yoksa packed-refs okunur (# ve ^ satırları atlanır)', () => {
    const root = tempRoot();
    write(path.join(root, '.git/HEAD'), 'ref: refs/heads/release/2026\n');
    write(
        path.join(root, '.git/packed-refs'),
        [
            '# pack-refs with: peeled fully-peeled sorted',
            `${OTHER} refs/heads/main`,
            `${SHA} refs/heads/release/2026`,
            `^${OTHER}`,
            `${OTHER} refs/tags/v1`,
            '',
        ].join('\n'),
    );

    assert.deepStrictEqual(resolveRelease({}, root), { value: SHORT, source: '.git' });
});

test('.git: packed-refs te dal yoksa etiket yok', () => {
    const root = tempRoot();
    write(path.join(root, '.git/HEAD'), 'ref: refs/heads/yok\n');
    write(path.join(root, '.git/packed-refs'), `${OTHER} refs/heads/main\n`);

    assert.deepStrictEqual(resolveRelease({}, root), { value: null, source: null });
});

test('.git: ayrık HEAD doğrudan sha', () => {
    const root = tempRoot();
    write(path.join(root, '.git/HEAD'), `${SHA}\n`);

    assert.deepStrictEqual(resolveRelease({}, root), { value: SHORT, source: '.git' });
});

test('.git dosyası: gitdir göreli yolu köke göre izlenir', () => {
    const base = tempRoot();
    const root = path.join(base, 'app');
    const gitDir = path.join(base, 'main/.git/worktrees/app');

    write(path.join(root, '.git'), 'gitdir: ../main/.git/worktrees/app\n');
    write(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
    write(path.join(gitDir, 'refs/heads/main'), SHA);

    assert.deepStrictEqual(resolveRelease({}, root), { value: SHORT, source: '.git' });
});

test('.git dosyası: mutlak gitdir ve ayrık HEAD', () => {
    const base = tempRoot();
    const root = path.join(base, 'app');
    const gitDir = path.join(base, 'module-git');

    write(path.join(root, '.git'), `gitdir: ${gitDir}`);
    write(path.join(gitDir, 'HEAD'), SHA);

    assert.deepStrictEqual(resolveRelease({}, root), { value: SHORT, source: '.git' });
});

test('.git: bozuk içerikte etiket yok, fırlatmaz', () => {
    const cases = [
        { HEAD: 'ne olduğu belirsiz' },
        { HEAD: SHA.slice(0, 39) },
        { HEAD: `${SHA}ff` },
        { HEAD: 'ref: refs/heads/main', 'refs/heads/main': 'broken' },
        { HEAD: 'ref: ../../disari' },
        { HEAD: 'ref: refs/heads/../../../disari' },
        { HEAD: '' },
    ];

    for (const files of cases) {
        const root = tempRoot();
        for (const [name, content] of Object.entries(files)) {
            write(path.join(root, '.git', name), content);
        }

        assert.deepStrictEqual(resolveRelease({}, root), { value: null, source: null }, JSON.stringify(files));
    }
});

test('.git: HEAD ref i git dizininin dışına çıkamaz', () => {
    const root = tempRoot();
    // Hedef dosya gerçekten var ve geçerli sha taşıyor: engel olmasa okunurdu.
    write(path.join(root, 'outside'), SHA);
    write(path.join(root, '.git/refs/outside'), SHA);

    for (const ref of ['../outside', 'refs/../../outside']) {
        write(path.join(root, '.git/HEAD'), `ref: ${ref}`);
        assert.deepStrictEqual(resolveRelease({}, root), { value: null, source: null }, ref);
    }
});

test('.git yok, gitdir satırı yok ya da kök yok: etiket yok', () => {
    const empty = tempRoot();
    const badFile = tempRoot();
    write(path.join(badFile, '.git'), 'gitdir yazmıyor');

    for (const root of [empty, badFile, path.join(empty, 'missing'), null, 42]) {
        assert.deepStrictEqual(resolveRelease({}, root), { value: null, source: null }, String(root));
    }
});

// --- Ortam değişkenleri -----------------------------------------------------

function gitRoot() {
    const root = tempRoot();
    write(path.join(root, '.git/HEAD'), OTHER);

    return root;
}

test('VITALWATCH_RELEASE her şeyi yener, kırpılır ve 64 karakterle sınırlanır', () => {
    const root = gitRoot();

    assert.deepStrictEqual(resolveRelease({ VITALWATCH_RELEASE: '  v2.4.0  ', GIT_SHA: SHA }, root), {
        value: 'v2.4.0',
        source: 'VITALWATCH_RELEASE',
    });
    // Sha olsa da VITALWATCH_RELEASE olduğu gibi kalır.
    assert.strictEqual(resolveRelease({ VITALWATCH_RELEASE: SHA }, root).value, SHA);
    assert.strictEqual(resolveRelease({ VITALWATCH_RELEASE: 'x'.repeat(100) }, root).value, 'x'.repeat(64));
});

test('boş ya da yalnızca boşluk VITALWATCH_RELEASE atlanır', () => {
    assert.deepStrictEqual(resolveRelease({ VITALWATCH_RELEASE: '   ', GIT_SHA: SHA }, tempRoot()), {
        value: SHORT,
        source: 'GIT_SHA',
    });
});

test('ortam değişkenleri belirlenen sırayla okunur, ilk dolu kazanır', () => {
    assert.deepStrictEqual(ENV_NAMES, [
        'GIT_COMMIT',
        'GIT_SHA',
        'COMMIT_SHA',
        'SOURCE_VERSION',
        'VERCEL_GIT_COMMIT_SHA',
        'RENDER_GIT_COMMIT',
        'HEROKU_SLUG_COMMIT',
        'CI_COMMIT_SHA',
    ]);

    const root = gitRoot();

    // Her değişken kendisinden sonrakileri yener.
    for (let i = 0; i < ENV_NAMES.length; i++) {
        const env = {};
        for (let j = ENV_NAMES.length - 1; j >= i; j--) env[ENV_NAMES[j]] = `deger-${j}`;

        assert.deepStrictEqual(resolveRelease(env, root), { value: `deger-${i}`, source: ENV_NAMES[i] });
    }

    // Boş olan atlanır.
    assert.strictEqual(resolveRelease({ GIT_COMMIT: '  ', CI_COMMIT_SHA: 'last' }, root).source, 'CI_COMMIT_SHA');
});

test('ortam değişkeni .git ten önce gelir', () => {
    assert.deepStrictEqual(resolveRelease({ HEROKU_SLUG_COMMIT: SHA }, gitRoot()), {
        value: SHORT,
        source: 'HEROKU_SLUG_COMMIT',
    });
    assert.deepStrictEqual(resolveRelease({}, gitRoot()), { value: OTHER.slice(0, 12), source: '.git' });
});

test('ortamdaki sha kısaltılır, sha olmayan değer kırpılıp 64 le sınırlanır', () => {
    const cases = [
        [`  ${SHA}  `, SHORT],
        ['ABCDEF1', 'abcdef1'],
        ['abcdef', 'abcdef'], // 7'den kısa: sha sayılmaz, olduğu gibi
        [`${SHA}0`, `${SHA}0`], // 41 hane: sha sayılmaz
        [' v1.2.3 ', 'v1.2.3'],
        ['y'.repeat(80), 'y'.repeat(64)],
    ];

    for (const [input, expected] of cases) {
        assert.strictEqual(resolveRelease({ GIT_COMMIT: input }, tempRoot()).value, expected, input);
    }
});

test('bozuk girdide fırlatmaz', () => {
    assert.doesNotThrow(() => resolveRelease(null, null));
    assert.doesNotThrow(() => resolveRelease({ VITALWATCH_RELEASE: 42, GIT_SHA: {} }, tempRoot()));
    assert.strictEqual(resolveRelease({ VITALWATCH_RELEASE: 42 }, tempRoot()).value, null);
});

// --- init ------------------------------------------------------------------

test('init etiketi ortamdan bulur; verilen release seçeneği kazanır', () => {
    const saved = { ...process.env };
    const cwd = process.cwd();

    try {
        for (const name of ['VITALWATCH_RELEASE', ...ENV_NAMES]) delete process.env[name];
        process.env.GIT_SHA = SHA;
        process.chdir(tempRoot());

        const vitalwatch = require('../src/index');

        assert.strictEqual(vitalwatch.init({}).release, SHORT);
        assert.strictEqual(vitalwatch.init({ release: 'manual' }).release, 'manual');

        delete process.env.GIT_SHA;
        const root = gitRoot();
        process.chdir(root);
        assert.strictEqual(vitalwatch.init({}).release, OTHER.slice(0, 12));
    } finally {
        process.chdir(cwd);
        for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
        Object.assign(process.env, saved);
    }
});
