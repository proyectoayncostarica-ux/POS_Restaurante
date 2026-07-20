const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const indexSource = read('public/index.html');
const mainSource = read('public/js/main.js');
const accessSource = read('public/js/services/operational-access.js');
const kitchenSource = read('public/js/components/kitchen.js');
const cssSource = read('public/css/style.css');
const usersRouteSource = read('server/routes/users.js');

test('Kitchen tiene sección, componente y navegación autorizada', () => {
    assert.match(indexSource, /id="kitchen-section"/);
    assert.match(indexSource, /data-section="kitchen"/);
    assert.match(indexSource, /components\/kitchen\.js\?v=3\.4\.1-printing-documents/);
    assert.match(accessSource, /kitchen:\s*'kitchen\.operate'/);
    assert.match(mainSource, /case 'kitchen'/);
    assert.match(mainSource, /Kitchen\.load/);
});

test('la cuenta Cocina activa modo exclusivo sin header ni sidebar normales', () => {
    assert.match(mainSource, /kitchen-department-mode/);
    assert.match(cssSource, /body\.kitchen-department-mode \.app-header/);
    assert.match(cssSource, /body\.kitchen-department-mode \.sidebar/);
    assert.match(cssSource, /content-section:not\(#kitchen-section\)/);
    assert.match(kitchenSource, /Cerrar sesión/);
    assert.match(kitchenSource, /Estación Cocina/);
});

test('el tablero muestra datos operativos y evita información financiera', () => {
    assert.match(kitchenSource, /Solicitó:/);
    assert.match(kitchenSource, /Adicionales:/);
    assert.match(kitchenSource, /Indicaciones:/);
    assert.match(kitchenSource, /Pendientes/);
    assert.match(kitchenSource, /En preparación/);
    assert.match(kitchenSource, /Listas/);
    assert.match(kitchenSource, /expectedVersion/);
    assert.doesNotMatch(kitchenSource, /formatCurrency|precio|saldo|cobro/i);
});

test('Kitchen actualiza por realtime y muestra estado de reconexión', () => {
    assert.match(mainSource, /Kitchen\.updateConnectionStatus\(true\)/);
    assert.match(mainSource, /Kitchen\.updateConnectionStatus\(false\)/);
    assert.match(mainSource, /currentSection === 'kitchen'/);
    assert.match(kitchenSource, /Reconectando/);
    assert.match(kitchenSource, /setInterval/);
});

test('la cuenta departamental se administra sin poder eliminarla ni cambiar su rol', () => {
    assert.match(usersRouteSource, /Las cuentas departamentales no se eliminan/);
    assert.match(usersRouteSource, /getKitchenSystemRoleId/);
    assert.match(usersRouteSource, /rolValidation = \{ roleIds: \[kitchenRoleId\] \}/);
});
