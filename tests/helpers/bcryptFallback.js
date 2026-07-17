const crypto = require('crypto');

function digest(value) {
    return `test$${crypto.createHash('sha256').update(String(value)).digest('hex')}`;
}

async function hash(value) {
    return digest(value);
}

async function compare(value, encoded) {
    return encoded === digest(value) || encoded === value;
}

module.exports = { hash, compare };
