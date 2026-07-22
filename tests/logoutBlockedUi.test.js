const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const main = read('public/js/main.js');
const index = read('public/index.html');
const css = read('public/css/style.css');
const serviceWorker = read('public/service-worker.js');

function sourceBetween(startMarker, endMarker) {
    const start = main.indexOf(startMarker);
    const end = main.indexOf(endMarker, start);
    assert.notEqual(start, -1, `Debe existir ${startMarker}`);
    assert.notEqual(end, -1, `Debe existir el límite ${endMarker}`);
    return main.slice(start, end);
}

function compileMethod(startMarker, endMarker, methodName) {
    const source = sourceBetween(startMarker, endMarker)
        .trim()
        .replace(new RegExp(`^${methodName}`), 'function')
        .replace(/,\s*$/, '');
    return Function(`"use strict"; return (${source});`)();
}

class FakeElement {
    constructor(tagName) {
        this.tagName = tagName;
        this.children = [];
        this.attributes = {};
        this.className = '';
        this.textContent = '';
        this.hidden = false;
        this.nodeType = 1;
    }

    appendChild(child) {
        this.children.push(child);
        return child;
    }

    setAttribute(name, value) {
        this.attributes[name] = String(value);
    }

    get childElementCount() {
        return this.children.length;
    }
}

function walk(element) {
    return [element, ...element.children.flatMap(walk)];
}

const requestSource = () => sourceBetween('    async request(url, options = {}) {', '    async requestIdempotent');
const logoutSource = () => sourceBetween('    async logout() {', '    // Mostrar pantalla de login');
const logoutErrorSource = () => sourceBetween('    handleLogoutError(error) {', '    // Cerrar sesión');
const blockedModalSource = () => sourceBetween('    showOperationalResponsibilityModal(payload = {}) {', '    handleLogoutError(error)');
const builderSource = () => sourceBetween('    buildOperationalResponsibilitiesContent(payload = {}) {', '    showOperationalResponsibilityModal(payload = {})');

test('A · el cliente HTTP conserva status, code, message y payload estructurado', () => {
    const source = requestSource();

    assert.match(source, /error\.status = response\.status/);
    assert.match(source, /error\.code = data\.code \|\| null/);
    assert.match(source, /new Error\(data\.error \|\| data\.message/);
    assert.match(source, /error\.payload = data/);
    assert.match(source, /error\.body = data/);
});

test('B · el bloqueo requiere simultáneamente HTTP 409 y el código estable', () => {
    const recognition = sourceBetween(
        '    isOperationalResponsibilityLogoutError(error) {',
        '    isOperationalResponsibilityCheckError(error)'
    );

    assert.match(recognition, /Number\(error\?\.status\) === 409/);
    assert.match(recognition, /error\?\.code === 'OPERATIONAL_RESPONSIBILITY_ACTIVE'/);
    assert.match(logoutErrorSource(), /showOperationalResponsibilityModal\(error\.payload \|\| \{\}\)/);
});

test('C · el bloqueo preserva usuario, navegación, timers y Realtime', () => {
    const handler = logoutErrorSource();

    assert.doesNotMatch(handler, /currentUser\s*=\s*null/);
    assert.doesNotMatch(handler, /showLogin\(/);
    assert.doesNotMatch(handler, /Realtime\.disconnect\(/);
    assert.doesNotMatch(handler, /Dashboard\.stopAutoRefresh\(/);
    assert.doesNotMatch(handler, /window\.location|location\.reload/);
});

test('D · el modal muestra título, mensaje, total, lista y una única acción Entendido', () => {
    assert.match(blockedModalSource(), /'No se puede cerrar sesión'/);
    assert.match(blockedModalSource(), /text: 'Entendido'/);
    assert.match(builderSource(), /Tienes responsabilidades operativas activas/);
    assert.match(builderSource(), /logout-responsibility-summary/);
    assert.match(builderSource(), /logout-responsibility-list/);
    assert.doesNotMatch(builderSource(), /JSON\.stringify/);
});

test('E · varias responsabilidades conservan una entrada por elemento y evidencia legible', () => {
    const source = builderSource();

    assert.match(source, /responsibilities\.forEach\(\(responsibility, index\)/);
    assert.match(source, /Mesa \$\{mesaNumber\}/);
    assert.match(source, /Zona: \$\{zoneName\}/);
    assert.match(source, /cuentas operativas relacionadas/);
    assert.match(source, /getResponsibilityCauseLabels/);
});

test('F · nombres potencialmente maliciosos se asignan como texto y no como HTML', () => {
    const buildContent = compileMethod(
        '    buildOperationalResponsibilitiesContent(payload = {}) {',
        '    showOperationalResponsibilityModal(payload = {})',
        'buildOperationalResponsibilitiesContent'
    );
    const previousDocument = global.document;
    global.document = { createElement: tagName => new FakeElement(tagName) };

    try {
        const malicious = '<script>alert(1)</script>';
        const content = buildContent.call({
            getResponsibilityCauseLabels: causes => causes
        }, {
            total: 2,
            responsabilidades: [
                {
                    mesa: {
                        nombre_visible: malicious,
                        numero: 7,
                        estado: 'ocupada',
                        zona: { nombre: '<img src=x onerror=alert(1)>' }
                    },
                    causas: ['Mesa ocupada'],
                    cuentas_operativas: [{}]
                },
                {
                    mesa: {
                        numero: 8,
                        estado: 'reservada',
                        zona: { nombre: 'Terraza' }
                    },
                    causas: ['Mesa reservada'],
                    cuentas_operativas: []
                }
            ]
        });

        const nodes = walk(content);
        const headings = nodes.filter(node => node.tagName === 'h4');
        const list = nodes.find(node => node.className === 'logout-responsibility-list');

        assert.equal(headings.length, 2);
        assert.equal(headings[0].textContent, malicious);
        assert.equal(list.children.length, 2);
        assert.equal(nodes.some(node => node.tagName === 'script'), false);
    } finally {
        global.document = previousDocument;
    }

    assert.doesNotMatch(builderSource(), /innerHTML|insertAdjacentHTML/);
    assert.match(builderSource(), /heading\.textContent = title/);
    assert.match(builderSource(), /zoneLabel\.textContent/);
});

test('G · cerrar el modal no ejecuta logout y restaura el foco', () => {
    const modalSource = sourceBetween('    showModal(title, content', '    // Confirmar acción');

    assert.match(blockedModalSource(), /onclick: \(\) => Utils\.hideModal\(\)/);
    assert.doesNotMatch(blockedModalSource(), /Auth\.logout\(|this\.logout\(/);
    assert.match(modalSource, /modalReturnFocus/);
    assert.match(modalSource, /returnFocus\?\.isConnected/);
    assert.match(main, /e\.key === 'Escape'[\s\S]*Utils\.hideModal\(\)/);
    assert.match(main, /e\.key === 'Tab'[\s\S]*Utils\.trapModalFocus\(e\)/);
});

test('H · doble clic mantiene una petición activa, un modal y permite reintento', () => {
    const source = logoutSource();

    assert.match(source, /if \(this\.logoutInFlight \|\| this\.logoutBlockedModalOpen\) return false/);
    assert.match(source, /this\.logoutInFlight = true/);
    assert.match(source, /setLogoutControlsBusy\(true\)/);
    assert.match(source, /finally[\s\S]*this\.logoutInFlight = false/);
    assert.match(source, /!logoutSucceeded && currentUser[\s\S]*setLogoutControlsBusy\(false\)/);
    assert.match(blockedModalSource(), /if \(this\.logoutBlockedModalOpen\) return/);
    assert.match(blockedModalSource(), /onClose:[\s\S]*this\.logoutBlockedModalOpen = false/);
});

test('I · el fallo del evaluador conserva sesión y no muestra responsabilidades confirmadas', () => {
    const recognition = sourceBetween(
        '    isOperationalResponsibilityCheckError(error) {',
        '    getResponsibilityCauseLabels'
    );
    const handler = logoutErrorSource();

    assert.match(recognition, /Number\(error\?\.status\) === 500/);
    assert.match(recognition, /OPERATIONAL_RESPONSIBILITY_CHECK_FAILED/);
    assert.match(handler, /No fue posible verificar si puedes cerrar sesión\. Tu sesión permanece activa/);
    assert.doesNotMatch(handler, /isOperationalResponsibilityCheckError[\s\S]*showOperationalResponsibilityModal/);
    assert.doesNotMatch(handler, /currentUser\s*=\s*null|showLogin\(|Realtime\.disconnect/);
});

test('J · un error inesperado no simula un logout exitoso', () => {
    const source = logoutSource();
    const catchStart = source.indexOf('        } catch (error) {');
    const catchSource = source.slice(catchStart);

    assert.match(catchSource, /No fue posible cerrar sesión\. Tu sesión permanece activa/);
    assert.doesNotMatch(catchSource, /currentUser\s*=\s*null/);
    assert.doesNotMatch(catchSource, /showLogin\(/);
});

test('K · el logout HTTP 200 conserva limpieza, timers, Realtime y login existentes', () => {
    const source = logoutSource();
    const successEnd = source.indexOf('        } catch (error) {');
    const successSource = source.slice(0, successEnd);

    assert.match(successSource, /await Utils\.request\('\/auth\/logout'/);
    assert.match(successSource, /currentUser = null/);
    assert.match(successSource, /Dashboard\.stopAutoRefresh\(\)/);
    assert.match(successSource, /Realtime\.disconnect\(\)/);
    assert.match(successSource, /this\.showLogin\(\)/);
    assert.doesNotMatch(successSource, /showOperationalResponsibilityModal/);
});

test('L · no existe bypass de bloqueo por tipo de usuario o Admin', () => {
    const recognition = sourceBetween(
        '    isOperationalResponsibilityLogoutError(error) {',
        '    getResponsibilityCauseLabels'
    );

    assert.doesNotMatch(recognition, /currentUser|\.tipo|admin|administrador/i);
});

test('M · logout consulta una sola vez el endpoint autoritativo y no hace preflight', () => {
    const source = logoutSource();
    const logoutCalls = source.match(/Utils\.request\('\/auth\/logout'/g) || [];
    const allRequestCalls = source.match(/Utils\.request\(/g) || [];

    assert.equal(logoutCalls.length, 1);
    assert.equal(allRequestCalls.length, 1);
});

test('N · el modal responsive conserva body desplazable, footer y ancho seguro', () => {
    assert.match(css, /\.modal-content\.modal-logout-blocked[\s\S]*display: flex[\s\S]*max-height:[^;]+[\s\S]*overflow: hidden/);
    assert.match(css, /\.modal-content\.modal-logout-blocked \.modal-body[\s\S]*min-height: 0[\s\S]*overflow-x: hidden[\s\S]*overflow-y: auto/);
    assert.match(css, /\.modal-content\.modal-logout-blocked \.modal-footer[\s\S]*flex: 0 0 auto/);
    assert.match(css, /@media \(max-width: 768px\)[\s\S]*max-height: calc\(100dvh - 1\.5rem\)/);
});

test('O · los códigos esperados evitan logging técnico duplicado sin silenciar otros errores', () => {
    const request = requestSource();
    const source = logoutSource();

    assert.match(request, /expectedErrorCodes\.has\(error\?\.code\)/);
    assert.match(request, /if \(!expectedErrorCodes\.has\(error\?\.code\)\)[\s\S]*console\.error\('Error en petición:'/);
    assert.match(source, /expectedErrorCodes:[\s\S]*OPERATIONAL_RESPONSIBILITY_ACTIVE[\s\S]*OPERATIONAL_RESPONSIBILITY_CHECK_FAILED/);
    assert.doesNotMatch(source, /Error cerrando sesión/);
});

test('P · conserva el namespace técnico v3.7.0 y versiona los assets modificados de v4.3.3', () => {
    const globalVersion = 'v3.7.0-cross-domain-closure';
    const assetVersion = 'v4.3.3-logout-blocked-ui';

    assert.match(index, /id="modal-overlay"[^>]*aria-hidden="true"/);
    assert.match(serviceWorker, new RegExp(`MUNDIPOS_SW_VERSION = '${globalVersion}'`));
    assert.match(index, new RegExp(`style\\.css\\?v=${assetVersion}`));
    assert.match(index, new RegExp(`main\\.js\\?v=${assetVersion}`));
    assert.match(serviceWorker, new RegExp(`style\\.css\\?v=${assetVersion}`));
    assert.match(serviceWorker, new RegExp(`main\\.js\\?v=${assetVersion}`));
    assert.doesNotMatch(serviceWorker, new RegExp(`MUNDIPOS_SW_VERSION = '${assetVersion}'`));
});
