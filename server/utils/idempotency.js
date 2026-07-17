const crypto = require('crypto');
const { ValidationError } = require('../errors/domainError');

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

function createIdempotencyKey(prefix = 'req') {
    const safePrefix = String(prefix || 'req').replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 24) || 'req';
    return `${safePrefix}:${crypto.randomUUID()}`;
}

function normalizeIdempotencyKey(value) {
    const key = String(value || '').trim();
    if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
        throw new ValidationError('Clave de idempotencia inválida', {
            minLength: 8,
            maxLength: 128
        });
    }
    return key;
}

function stableSerialize(value) {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
        return `[${value.map(stableSerialize).join(',')}]`;
    }

    const keys = Object.keys(value).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
}

function createRequestFingerprint(payload) {
    return crypto
        .createHash('sha256')
        .update(stableSerialize(payload))
        .digest('hex');
}

module.exports = {
    IDEMPOTENCY_KEY_PATTERN,
    createIdempotencyKey,
    normalizeIdempotencyKey,
    stableSerialize,
    createRequestFingerprint
};
