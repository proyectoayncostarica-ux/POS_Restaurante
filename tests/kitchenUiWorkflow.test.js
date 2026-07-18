const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const ordersSource = fs.readFileSync(path.join(root, 'public/js/components/orders.js'), 'utf8');
const menuSource = fs.readFileSync(path.join(root, 'public/js/components/menu.js'), 'utf8');
const menuRouteSource = fs.readFileSync(path.join(root, 'server/routes/menu.js'), 'utf8');
const ordersRouteSource = fs.readFileSync(path.join(root, 'server/routes/orders.js'), 'utf8');
const kitchenRouteSource = fs.readFileSync(path.join(root, 'server/routes/kitchen.js'), 'utf8');
const realtimeSource = fs.readFileSync(path.join(root, 'server/utils/realtime.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'server/app.js'), 'utf8');


test('Orders captura indicaciones y adicionales sin confiar en el frontend para Kitchen', () => {
    assert.match(ordersSource, /selectedInstructions/);
    assert.match(ordersSource, /Indicaciones especiales/);
    assert.match(ordersSource, /Adicionales/);
    assert.match(ordersSource, /observacion:/);
    assert.match(ordersSource, /adicionales:/);
    assert.match(ordersRouteSource, /accountService\.createAccount/);
    assert.match(ordersRouteSource, /accountService\.addProducts/);
    assert.match(ordersRouteSource, /comanda_ids/);
});


test('Menú configura un destino canónico sin usar permite_cocina para bloquear Bar', () => {
    assert.match(menuSource, /Destino de preparación/);
    assert.match(menuSource, /value="cocina"/);
    assert.match(menuSource, /value="bar"/);
    assert.match(menuSource, /destino_preparacion/);
    assert.match(menuSource, /destinoSelect\.value === 'cocina'/);
    assert.match(menuRouteSource, /normalizePreparationDestination/);
    assert.match(menuRouteSource, /destinoPreparacion === 'cocina'/);
    assert.match(menuRouteSource, /destino_preparacion/);
});


test('Kitchen tiene router propio, capacidad específica y realtime con scope comandas', () => {
    assert.match(appSource, /require\('\.\/routes\/kitchen'\)/);
    assert.match(appSource, /app\.use\('\/api\/kitchen', requireAuth, kitchenRoutes\)/);
    assert.match(kitchenRouteSource, /CAPABILITIES\.KITCHEN_OPERATE/);
    assert.match(kitchenRouteSource, /\/pending/);
    assert.match(kitchenRouteSource, /\/orders\/:pedidoId\/dispatch/);
    assert.match(kitchenRouteSource, /\/comandas\/:id\/resend/);
    assert.match(kitchenRouteSource, /\/comandas\/:id\/print-state/);
    assert.match(realtimeSource, /resource === 'kitchen'/);
    assert.match(realtimeSource, /return 'comandas'/);
});


test('la compatibilidad de impresión ya no afirma envío físico desde Orders', () => {
    assert.doesNotMatch(ordersSource, /Comanda enviada a cocina correctamente/);
    assert.match(ordersSource, /Printing se implementará en v3\.4\.x/);
    assert.match(ordersRouteSource, /markPrintState/);
    assert.match(ordersRouteSource, /canViewZone/);
    assert.match(ordersRouteSource, /No tienes acceso operativo a la zona de esta comanda/);
});


test('realtime de comandas llega a Kitchen autorizado sin requerir orders.operate', () => {
    require('./helpers/testDatabase');
    const { canReceiveRealtimeEvent } = require('../server/services/operationalAccessService');
    const { CAPABILITIES } = require('../server/security/capabilities');
    const kitchenContext = {
        userId: 40,
        isAdmin: false,
        capabilities: [CAPABILITIES.KITCHEN_OPERATE],
        zoneIds: [3]
    };
    const payload = {
        scope: 'comandas',
        requiredAnyCapabilities: [CAPABILITIES.KITCHEN_OPERATE, CAPABILITIES.ORDERS_OPERATE],
        zoneIds: [3]
    };

    assert.equal(canReceiveRealtimeEvent(kitchenContext, payload), true);
    assert.equal(canReceiveRealtimeEvent(kitchenContext, { ...payload, zoneIds: [4] }), false);
    assert.equal(canReceiveRealtimeEvent({ ...kitchenContext, capabilities: [] }, payload), false);
});

test('Kitchen v3.3.1 expone tablero, historial y transición operativa con versión', () => {
    assert.match(kitchenRouteSource, /\/board/);
    assert.match(kitchenRouteSource, /\/comandas\/:id\/history/);
    assert.match(kitchenRouteSource, /\/comandas\/:id\/state/);
    assert.match(kitchenRouteSource, /expectedVersion/);
    assert.match(kitchenRouteSource, /transitionState/);
});

test('realtime de comandas puede restringirse por destino además de zona y capacidad', () => {
    require('./helpers/testDatabase');
    const { canReceiveRealtimeEvent } = require('../server/services/operationalAccessService');
    const { CAPABILITIES } = require('../server/security/capabilities');
    const kitchenContext = {
        userId: 41,
        isAdmin: false,
        capabilities: [CAPABILITIES.KITCHEN_OPERATE],
        zoneIds: [3],
        kitchenDestinations: ['cocina']
    };
    const payload = {
        scope: 'comandas',
        requiredAnyCapabilities: [CAPABILITIES.KITCHEN_OPERATE],
        zoneIds: [3],
        destinations: ['cocina']
    };

    assert.equal(canReceiveRealtimeEvent(kitchenContext, payload), true);
    assert.equal(canReceiveRealtimeEvent(kitchenContext, { ...payload, destinations: ['bar'] }), false);
});
