'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const Scrubber = require('../src/scrubber');

test('kişisel veri desenleri maskelenir', () => {
    const statuses = [
        ['Kullanıcı ahmet@ornek.com bulunamadı', 'Kullanıcı [email] bulunamadı'],
        ['TCKN 12345678901 geçersiz', 'TCKN [national_id] geçersiz'],
        ['TR330006100519786457841326 reddedildi', '[iban] reddedildi'],
        ['4111 1111 1111 1111 hatalı', '[card] hatalı'],
        ['Ara: 0555 123 45 67', 'Ara: [phone]'],
    ];

    for (const [input, expected] of statuses) {
        assert.strictEqual(Scrubber.text(input, 500), expected);
    }
});

test('query string atılır, yol kalır', () => {
    assert.strictEqual(Scrubber.path('/urunler?email=x@y.com&token=abc'), '/urunler');
    assert.strictEqual(Scrubber.path('https://sample.com/urunler?q=1'), '/urunler');
    assert.strictEqual(Scrubber.path('/search#result'), '/search');
});

test('yolun içindeki kişisel veri de maskelenir', () => {
    assert.strictEqual(
        Scrubber.path('/user/john@sample.com/profile'),
        '/user/[email]/profile',
    );
});

test('SQL literal değerleri normalize edilir', () => {
    assert.strictEqual(
        Scrubber.sql("select * from users where email = 'ahmet@ornek.com'"),
        'select * from users where email = ?',
    );
    assert.strictEqual(
        Scrubber.sql('select * from t where id in (1, 2, 3)'),
        'select * from t where id in (?)',
    );
});

/**
 * Gerçek bir sızıntıda yakalandı: veritabanı hatasının mesajı SQL'i bağlanmış
 * değerlerle taşıyor ve içinde oturum kimliği vardı.
 */
test('SQL taşıyan hata mesajından oturum kimliği sızmaz', () => {
    const message =
        'Database error (SQL: select * from "sessions" where "id" = ItLsnnji2VLJtiE1SjiyAEdzv6aZiuVqhFvcmRu1 limit 1)';

    const result = Scrubber.message(message, true);

    assert.ok(!result.includes('ItLsnnji2VLJtiE1SjiyAEdzv6aZiuVqhFvcmRu1'));
});

test('uzun rastgele diziler maskelenir', () => {
    // Fixture bilinçli olarak hiçbir sağlayıcının anahtar biçimine benzemiyor:
    // gerçekçi bir önek gizli anahtar taramalarına takılıp push'u engelliyor.
    assert.ok(
        Scrubber.text('Token: ornek_jeton_ABCDEFGHIJKLMNOPQRSTUVWXYZ', 500).includes(
            '[token]',
        ),
    );
});

test('normal kelimeler ve sınıf adları maskelenmez', () => {
    const message = 'TypeError on ProductController.show';

    assert.strictEqual(Scrubber.text(message, 500), message);
});

test('boş değerler null döner', () => {
    assert.strictEqual(Scrubber.text(null, 500), null);
    assert.strictEqual(Scrubber.path(''), null);
    assert.strictEqual(Scrubber.sql(null), null);
});

test('stack trace 2000 karakterde kesilir', () => {
    const reveal = '    at Foo.bar (/app/src/foo.js:42:13)\n'.repeat(200);

    assert.strictEqual(Scrubber.stack(reveal).length, 2000);
});

/*
| Yükleme dosya adları (`<ad>-<zaman damgası>-<rastgele>.<uzantı>`) okunur
| kalmalı. Zaman damgası kart, uzun ad jeton sanılıyordu ve panelde
| `/uploads/discount/[token][card]-752066249.jpeg` çıkıyordu.
| Beklenenler hub Scrubber'ıyla ortak vektörlerden (bkz. CHANGELOG 0.5.0).
*/
test('yükleme dosya adı okunur kalır', () => {
    for (const path of [
        '/uploads/discount/kampanya-gorseli-yaz-indirimi-1726571234567-752066249.jpeg',
        '/uploads/sliders/slider-slider-1726571234567-249230604-1726571239999-875783343.png',
        // Son on hanesi 5 ile başlayan damga telefon sanılıyordu.
        '/uploads/products/urun-1795123456789-123456789.png',
    ]) {
        assert.strictEqual(Scrubber.path(path), path);
    }
});

test('kart yalnızca gerçek kart numarasıysa maskelenir', () => {
    assert.strictEqual(Scrubber.text('kart 4111111111111111 red', 500), 'kart [card] red');
    assert.strictEqual(Scrubber.text('378282246310005 red', 500), '[card] red');
    assert.strictEqual(Scrubber.text('saat 1726571234567 geçti', 500), 'saat 1726571234567 geçti');
    assert.strictEqual(Scrubber.text('no 4111111111111112', 500), 'no 4111111111111112');
    // Luhn'u tutan damga: yalnızca ilk hane kuralı ayırıyor.
    assert.strictEqual(Scrubber.text('saat 1726571234573 geçti', 500), 'saat 1726571234573 geçti');
});

/* Sol sınır eklenince + olmadan 90 ön eki sızıyordu (önceden `9[phone]`). */
test('90 ön ekli telefon maskelenir', () => {
    assert.strictEqual(Scrubber.text('tel 905321234567', 500), 'tel [phone]');
    assert.strictEqual(Scrubber.text('tel 90 532 123 45 67', 500), 'tel [phone]');
});

test('rastgele diziler yeni kuralla da maskelenir', () => {
    for (const input of [
        'x 3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b y',
        'x ghp_16C7e42F292c6912E7710c838347Ae178B4a y',
        'x a1b2c3d4-e5f6a7b8-c9d0e1f2-a3b4c5d6 y',
    ]) {
        assert.strictEqual(Scrubber.text(input, 500), 'x [token] y');
    }
});

/*
| .NET yığın izlerindeki uzun sınıf/metot adları `[token]` oluyordu (22 Ekim
| 2026). Düz CamelCase ad jeton sayılmıyor; rakam, ardışık büyük harf ya da
| tümü büyük harf taşıyan diziler eski kurala düşüyor.
*/
test('düz CamelCase adlar jeton sanılmaz', () => {
    for (const input of [
        'InvalidOperationException',
        'HandleNonSuccessAndDebuggerNotification',
        'System.InvalidOperationException: boom',
    ]) {
        assert.strictEqual(Scrubber.text(input, 500), input);
    }
});

test('CamelCase istisnası rastgele dizileri kaçırmaz', () => {
    for (const input of [
        'x aB3dE5fG7hJ9kL1mN3pQ5rS7 y',
        'x ABCDEFGHIJKLMNOPQRSTUVWXYZ y',
        'x 5d41402abc4b2a76b9719d91 y',
        'x abcDEfghIJklmnOPqrsTUvwxYZab y',
    ]) {
        assert.strictEqual(Scrubber.text(input, 500), 'x [token] y');
    }
});
