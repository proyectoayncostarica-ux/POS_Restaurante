const test = require('node:test');
const assert = require('node:assert/strict');
const {
    createIdempotencyKey,
    normalizeIdempotencyKey,
    createRequestFingerprint
} = require('../server/utils/idempotency');

test('genera y valida claves de idempotencia compatibles con API', () => {
    const key = createIdempotencyKey('payment');
    assert.match(key, /^payment:[A-Za-z0-9-]+$/);
    assert.equal(normalizeIdempotencyKey(key), key);
    assert.throws(() => normalizeIdempotencyKey('corta'));
});

test('el fingerprint no depende del orden de las propiedades', () => {
    const first = createRequestFingerprint({ amount: 1000, method: 'cash' });
    const second = createRequestFingerprint({ method: 'cash', amount: 1000 });
    const different = createRequestFingerprint({ method: 'card', amount: 1000 });

    assert.equal(first, second);
    assert.notEqual(first, different);
});
