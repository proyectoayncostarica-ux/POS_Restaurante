const test = require('node:test');
const assert = require('node:assert/strict');
require('./helpers/testDatabase');
const {
    buildPolicyFromOperationalSession,
    canViewZone,
    canReceiveRealtimeEvent
} = require('../server/services/operationalAccessService');

test('la cuenta departamental Cocina obtiene navegación exclusiva y alcance global de zonas', () => {
    const user = {
        id: 90,
        nombre: 'Cocina',
        tipo: 'basico',
        clase_cuenta: 'departamental',
        cuenta_departamental_codigo: 'cocina'
    };
    const operationalSession = {
        capacidades: ['kitchen.operate'],
        destino_inicial: 'kitchen',
        destinos_kitchen: ['cocina'],
        rol_trabajo_ids: [7],
        roles_trabajo_activos: [{ id: 7, slug: 'cocina', zonas: [] }]
    };

    const policy = buildPolicyFromOperationalSession(user, operationalSession);

    assert.equal(policy.isDepartmental, true);
    assert.equal(policy.departmentCode, 'cocina');
    assert.deepEqual(policy.allowedSections, ['kitchen']);
    assert.equal(policy.initialSection, 'kitchen');
    assert.equal(policy.zoneIds, null);
    assert.equal(canViewZone(policy, 999), true);
});

test('realtime departamental recibe Cocina y no órdenes exclusivas de Bar', () => {
    const context = {
        userId: 90,
        isAdmin: false,
        isDepartmental: true,
        capabilities: ['kitchen.operate'],
        zoneIds: null,
        kitchenDestinations: ['cocina']
    };
    const base = {
        scope: 'comandas',
        requiredAnyCapabilities: ['kitchen.operate'],
        zoneIds: [44]
    };

    assert.equal(canReceiveRealtimeEvent(context, { ...base, destinations: ['cocina'] }), true);
    assert.equal(canReceiveRealtimeEvent(context, { ...base, destinations: ['bar'] }), false);
});
