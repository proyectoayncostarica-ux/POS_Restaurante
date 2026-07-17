const { ValidationError } = require('../errors/domainError');

const MONEY_SCALE = 2;
const MONEY_FACTOR = 10 ** MONEY_SCALE;

function normalizeNumericValue(value) {
    if (typeof value === 'string') {
        const normalized = value.trim().replace(',', '.');
        if (!normalized) throw new ValidationError('El monto no puede estar vacío');
        value = Number(normalized);
    }

    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new ValidationError('El monto debe ser un número finito', { value });
    }

    return value;
}

function toMinorUnits(value) {
    const numeric = normalizeNumericValue(value);
    const adjusted = numeric >= 0
        ? numeric + Number.EPSILON
        : numeric - Number.EPSILON;
    return Math.round(adjusted * MONEY_FACTOR);
}

function fromMinorUnits(value) {
    if (!Number.isSafeInteger(value)) {
        throw new ValidationError('Las unidades monetarias menores deben ser un entero seguro', { value });
    }
    return value / MONEY_FACTOR;
}

function roundMoney(value) {
    return fromMinorUnits(toMinorUnits(value));
}

function addMoney(...values) {
    return fromMinorUnits(values.reduce((total, value) => total + toMinorUnits(value), 0));
}

function subtractMoney(minuend, subtrahend) {
    return fromMinorUnits(toMinorUnits(minuend) - toMinorUnits(subtrahend));
}

function multiplyMoney(value, quantity) {
    const normalizedQuantity = normalizeNumericValue(quantity);
    if (normalizedQuantity < 0) {
        throw new ValidationError('La cantidad no puede ser negativa', { quantity });
    }
    return fromMinorUnits(Math.round(toMinorUnits(value) * normalizedQuantity));
}

function percentageOf(value, percentage) {
    const normalizedPercentage = normalizeNumericValue(percentage);
    return fromMinorUnits(Math.round((toMinorUnits(value) * normalizedPercentage) / 100));
}

function assertNonNegativeMoney(value, field = 'monto') {
    const minorUnits = toMinorUnits(value);
    if (minorUnits < 0) {
        throw new ValidationError(`${field} no puede ser negativo`, { field, value });
    }
    return fromMinorUnits(minorUnits);
}

module.exports = {
    MONEY_SCALE,
    MONEY_FACTOR,
    toMinorUnits,
    fromMinorUnits,
    roundMoney,
    addMoney,
    subtractMoney,
    multiplyMoney,
    percentageOf,
    assertNonNegativeMoney
};
