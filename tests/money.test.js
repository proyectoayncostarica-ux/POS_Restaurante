const test = require('node:test');
const assert = require('node:assert/strict');
const {
    toMinorUnits,
    fromMinorUnits,
    roundMoney,
    addMoney,
    subtractMoney,
    multiplyMoney,
    percentageOf
} = require('../server/utils/money');

test('las operaciones monetarias evitan acumulación binaria visible', () => {
    assert.equal(addMoney(0.1, 0.2), 0.3);
    assert.equal(subtractMoney(10, 3.33), 6.67);
    assert.equal(multiplyMoney(1.25, 3), 3.75);
});

test('porcentajes y redondeos son deterministas a dos decimales', () => {
    assert.equal(percentageOf(123.45, 10), 12.35);
    assert.equal(roundMoney(10.005), 10.01);
    assert.equal(toMinorUnits('1500,50'), 150050);
    assert.equal(fromMinorUnits(150050), 1500.5);
});
