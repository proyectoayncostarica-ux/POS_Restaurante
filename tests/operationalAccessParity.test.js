const test = require('node:test');
const assert = require('node:assert/strict');

try {
    require('sqlite3').verbose();
} catch (error) {
    const sqlite3Path = require.resolve('sqlite3');
    require.cache[sqlite3Path] = {
        id: sqlite3Path,
        filename: sqlite3Path,
        loaded: true,
        exports: require('./helpers/sqlite3Fallback')
    };
}
const frontendAccess = require('../public/js/services/operational-access.js');
const {
    canOpenSection,
    canReceiveRealtimeEvent
} = require('../server/services/operationalAccessService');

function frontendUserFromContext(context) {
    return {
        id: context.userId,
        tipo: context.userType,
        acceso_operativo: {
            userId: context.userId,
            isAdmin: context.isAdmin,
            capabilities: context.capabilities,
            zoneIds: context.zoneIds,
            allowedSections: ['dashboard', 'tables', 'menu', 'orders', 'accounts', 'cash']
                .filter(section => canOpenSection(context, section)),
            initialSection: canOpenSection(context, 'dashboard') ? 'dashboard' : 'cash'
        }
    };
}

test('frontend y backend coinciden al autorizar secciones', () => {
    const contexts = [
        {
            userId: 1,
            userType: 'basico',
            isAdmin: false,
            capabilities: ['orders.operate'],
            zoneIds: [10]
        },
        {
            userId: 2,
            userType: 'basico',
            isAdmin: false,
            capabilities: ['cash.access', 'cash.collect'],
            zoneIds: []
        },
        {
            userId: 3,
            userType: 'administrador',
            isAdmin: true,
            capabilities: [],
            zoneIds: null
        }
    ];

    for (const context of contexts) {
        const user = frontendUserFromContext(context);
        for (const section of ['dashboard', 'tables', 'menu', 'orders', 'accounts', 'cash', 'users', 'settings']) {
            assert.equal(
                frontendAccess.canOpen(user, section),
                canOpenSection(context, section),
                `Diferencia en ${section} para usuario ${context.userId}`
            );
        }
    }
});

test('frontend y backend coinciden al filtrar eventos realtime', () => {
    const contexts = [
        {
            userId: 1,
            userType: 'basico',
            isAdmin: false,
            capabilities: ['orders.operate', 'kitchen.operate'],
            zoneIds: [10]
        },
        {
            userId: 2,
            userType: 'basico',
            isAdmin: false,
            capabilities: ['cash.access'],
            zoneIds: []
        }
    ];
    const events = [
        { scope: 'pedidos', zoneIds: [10] },
        { scope: 'pedidos', zoneIds: [11] },
        { scope: 'pedidos' },
        { scope: 'caja', global: true },
        { scope: 'pagos', zoneIds: [10] },
        { scope: 'pedidos', zoneIds: [10], targetUserIds: [2] },
        { scope: 'sesion', targetUserIds: [1] },
        { scope: 'usuarios', targetUserIds: [2] }
    ];

    for (const context of contexts) {
        const user = frontendUserFromContext(context);
        for (const event of events) {
            assert.equal(
                frontendAccess.canReceiveRealtime(user, event),
                canReceiveRealtimeEvent(context, event),
                `Diferencia en scope ${event.scope} para usuario ${context.userId}`
            );
        }
    }
});
