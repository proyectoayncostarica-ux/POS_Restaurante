const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const main = fs.readFileSync(path.join(__dirname, '../public/js/main.js'), 'utf8');
const noticeId = 'administrative-recovery-notice';
const noticeText = 'No hay administradores activos. La recuperación administrativa debe realizarse localmente en el equipo del servidor. Los usuarios habilitados pueden continuar iniciando sesión normalmente.';

function sourceBetween(start, end) {
    const from = main.indexOf(start);
    const to = main.indexOf(end, from);
    assert.ok(from >= 0 && to > from, `Límites reales de main.js: ${start}`);
    return main.slice(from, to);
}

class Element {
    constructor(tagName, id = '') {
        this.tagName = tagName.toUpperCase();
        this.id = id;
        this.children = [];
        this.attributes = {};
        this.dataset = {};
        this.style = { setProperty(name, value) { this[name] = value; } };
        this.hidden = false;
        this.disabled = false;
        this.textContent = '';
        const classes = new Set();
        this.classList = {
            add: (...names) => names.forEach(name => classes.add(name)),
            remove: (...names) => names.forEach(name => classes.delete(name)),
            toggle(name, active) { if (active) classes.add(name); else classes.delete(name); }
        };
    }

    appendChild(child) { return this.insertBefore(child, null); }
    insertBefore(child, reference) {
        assert.equal(child.parentNode, undefined, 'No reinsertar/duplicar el nodo existente');
        const index = reference ? this.children.indexOf(reference) : this.children.length;
        assert.ok(index >= 0);
        this.children.splice(index, 0, child);
        child.parentNode = this;
        return child;
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    removeAttribute(name) { delete this.attributes[name]; }
    querySelectorAll(selector) {
        if (selector === 'input, button') return walk(this).filter(node => ['INPUT', 'BUTTON'].includes(node.tagName));
        return [];
    }
    querySelector(selector) {
        if (selector === 'button[type="submit"]') return walk(this).find(node => node.tagName === 'BUTTON') || null;
        return null;
    }
    reset() {}
    set innerHTML(value) {
        assert.equal(this.tagName, 'BUTTON', 'El aviso debe usar exclusivamente textContent');
        this.buttonMarkup = value;
    }
}

function walk(element) { return [element, ...element.children.flatMap(walk)]; }

function harness() {
    const body = new Element('body');
    const add = (tag, id, parent = body) => parent.appendChild(new Element(tag, id));
    const loginScreen = add('div', 'login-screen');
    const card = add('div', 'login-card', loginScreen);
    const branding = add('p', 'login-restaurant-name', card);
    branding.textContent = 'Restaurante de prueba';
    branding.dataset.businessName = branding.textContent;
    add('div', 'session-recovery-status', card);
    add('strong', 'session-recovery-title', card);
    add('span', 'session-recovery-message', card);
    const form = add('form', 'login-form', card);
    const controls = [add('input', 'username', form), add('input', 'password', form), add('button', 'login-submit-btn', form)];
    const bootstrap = add('form', 'bootstrap-admin-form', card);
    add('button', 'bootstrap-submit', bootstrap);
    add('div', 'login-error', card);
    const app = add('div', 'main-app');
    app.style.display = 'none';
    add('div', 'operational-session-screen');
    const document = {
        body,
        getElementById: id => walk(body).find(node => node.id === id) || null,
        createElement: tag => new Element(tag),
        querySelector: () => null,
        querySelectorAll: () => []
    };
    const requests = [];
    const timers = [];
    const effects = [];
    let storageAccesses = 0;
    const storage = new Proxy({}, { get() { storageAccesses++; throw new Error('Estado administrativo no persistente'); } });
    Object.defineProperty(document, 'cookie', {
        get() { storageAccesses++; throw new Error('No leer cookies'); },
        set() { storageAccesses++; throw new Error('No escribir cookies'); }
    });
    const status = (requiresSetup, administrativeRecoveryRequired) => ({
        success: true, data: { requiresSetup, administrativeRecoveryRequired, hasAdmin: false, adminCount: 0 }
    });
    const replies = { bootstrap: status(false, false), verify: { authenticated: false } };
    const context = vm.createContext({
        document,
        localStorage: storage, sessionStorage: storage, indexedDB: storage,
        window: {
            localStorage: storage, sessionStorage: storage, indexedDB: storage,
            setTimeout(callback, delay) { const timer = { callback, delay }; timers.push(timer); return timer; },
            clearTimeout: () => effects.push('clearTimer')
        },
        console: { error() {} },
        Utils: {
            async request(url, options) {
                requests.push({ url, options });
                const response = url === '/public/bootstrap-status' ? replies.bootstrap
                    : url === '/auth/verify' ? replies.verify : replies.login;
                if (response instanceof Error) throw response;
                assert.ok(response, `Petición inesperada: ${url}`);
                return response;
            },
            showNotification: () => effects.push('notification')
        },
        Realtime: {
            disconnect: () => effects.push('disconnect'), connect: () => effects.push('connect'),
            reconnectForSession: () => effects.push('reconnect'), scheduleRecovery: () => effects.push('realtimeRecovery')
        },
        Access: { applyNavigation: () => effects.push('navigation'), getInitialSection: () => 'tables', canOpen: () => true },
        Navigation: { showSection: section => effects.push(`section:${section}`) },
        stopHeaderClock() {}, startHeaderClock() {}, loadRestaurantName() {}, updateGreeting() {}
    });
    vm.runInContext(`
        let currentUser = null;
        let currentSection = 'tables';
        ${sourceBetween('const SESSION_STATES =', '// Utilidades')}
        ${sourceBetween('const Auth = {', 'function wait(ms)')}
        ${sourceBetween('function resetLoginForm()', '// Navegación')}
        globalThis.auth = Auth;
        globalThis.getUser = () => currentUser;
        globalThis.setUser = user => { currentUser = user; };
        globalThis.setMode = setLoginMode;
    `, context, { filename: 'main.js (Auth y helpers reales)' });
    // El resto del POS no se reproduce; se conserva el flujo real de autenticación y vistas.
    context.auth.updateUserInfo = () => effects.push('userInfo');
    context.auth.logout = () => assert.fail('No se debe cerrar sesión por recovery administrativo');
    return {
        auth: context.auth, document, card, branding, form, controls, bootstrap, app, replies, requests, timers, effects, status,
        setMode: context.setMode, getUser: context.getUser, setUser: context.setUser,
        notice: () => document.getElementById(noticeId),
        storageAccesses: () => storageAccesses
    };
}

function assertLogin(h) {
    assert.equal(h.auth.loginMode, 'login');
    assert.equal(h.form.hidden, false);
    assert.equal(h.form.getAttribute('aria-hidden'), 'false');
    assert.ok(h.controls.every(control => !control.disabled));
    assert.equal(h.bootstrap.hidden, true);
}

async function recoveryLogin(h) {
    h.replies.bootstrap = h.status(false, true);
    assert.equal(await h.auth.checkSession(), false);
    assertLogin(h);
    assert.equal(h.notice().hidden, false);
}

test('A · bootstrap inicial mantiene formulario inicial y oculta login y aviso', async () => {
    const h = harness();
    h.replies.bootstrap = h.status(true, false);
    await h.auth.checkSession();
    assert.equal(h.auth.loginMode, 'bootstrap');
    assert.equal(h.bootstrap.hidden, false);
    assert.equal(h.form.hidden, true);
    assert.ok(h.controls.every(control => control.disabled));
    assert.equal(h.notice(), null);
    assert.deepEqual(h.requests.map(request => request.url), ['/public/bootstrap-status']);
});

test('B · recovery informa con accesibilidad, conserva branding/login y sobrevive credenciales incorrectas', async () => {
    const h = harness();
    await recoveryLogin(h);
    const notice = h.notice();
    assert.equal(notice.textContent, noticeText);
    assert.equal(notice.getAttribute('role'), 'status');
    assert.equal(notice.getAttribute('aria-live'), 'polite');
    assert.equal(notice.className, 'session-recovery-status');
    assert.equal(h.card.children[h.card.children.indexOf(h.form) - 1], notice);
    assert.equal(h.branding.textContent, 'Restaurante de prueba');
    h.replies.login = new Error('Usuario o contraseña incorrectos');
    assert.equal(await h.auth.login('basico', 'incorrecta'), false);
    assert.equal(h.document.getElementById('login-error').textContent, h.replies.login.message);
    assertLogin(h);
    assert.equal(h.notice(), notice);
    assert.equal(notice.hidden, false);
    h.auth.showLogin();
    assert.equal(notice.hidden, false, 'Resetear error/formulario no elimina el aviso');
});

test('C · señal false conserva login normal aun con hasAdmin=false y adminCount=0', async () => {
    const h = harness();
    await h.auth.checkSession();
    assertLogin(h);
    assert.equal(h.auth.requiresBootstrapSetup, false);
    assert.equal(h.auth.administrativeRecoveryRequired, false);
    assert.equal(h.notice(), null);
});

test('D · Básico autenticado conserva identidad y rol, continúa a la app sin volver al login', async () => {
    const h = harness();
    await recoveryLogin(h);
    const user = { id: 7, tipo: 'basico', sesion_operativa: { puede_operar: true, requiere_seleccion: false, rol_trabajo_ids: [2] } };
    h.setUser(user);
    h.replies.verify = { authenticated: true, user };
    h.auth.showLogin = () => assert.fail('No volver al login con verify válido');
    h.effects.length = 0;
    assert.equal(await h.auth.checkSession(), true);
    assert.equal(h.getUser(), user);
    assert.deepEqual(user.sesion_operativa.rol_trabajo_ids, [2]);
    assert.equal(h.app.style.display, 'grid');
    assert.equal(h.auth.sessionState, 'AUTHENTICATED_ONLINE');
    assert.equal(h.notice().hidden, true);
    assert.ok(h.effects.includes('section:tables'));
    assert.ok(h.effects.includes('connect'));
    assert.ok(!h.effects.includes('disconnect'));
});

const statusErrors = [
    ['red', Object.assign(new Error('Failed to fetch'), { isNetworkError: true })],
    ['503 BOOTSTRAP_STATUS_UNAVAILABLE', Object.assign(new Error('No verificable'), { status: 503, code: 'BOOTSTRAP_STATUS_UNAVAILABLE' })],
    ['metadata ausente', { success: true }],
    ['señal administrativa ausente', { success: true, data: { requiresSetup: false } }],
    ['señales no booleanas', { success: true, data: { requiresSetup: 'false', administrativeRecoveryRequired: 'true' } }],
    ['respuesta no satisfactoria', { success: false, data: { requiresSetup: false, administrativeRecoveryRequired: true } }]
];
for (const [name, response] of statusErrors) {
    test(`E · ${name}: elimina señal stale y mantiene verificación/reintento`, async () => {
        const h = harness();
        await recoveryLogin(h);
        h.replies.bootstrap = response;
        assert.equal(await h.auth.checkSession(), false);
        assert.equal(h.auth.requiresBootstrapSetup, false);
        assert.equal(h.auth.administrativeRecoveryRequired, false);
        assert.equal(h.notice().hidden, true);
        assert.equal(h.auth.loginMode, 'verifying');
        assert.equal(h.form.hidden, true);
        assert.equal(h.bootstrap.hidden, true);
        assert.ok(h.controls.every(control => control.disabled));
        assert.equal(h.timers.length, 1);
        assert.equal(h.timers[0].delay, 1500);
        assert.equal(h.requests.filter(request => request.url === '/auth/verify').length, 1, 'No verificar auth tras status inválido');
        h.setMode('login');
        assert.equal(h.notice().hidden, true, 'Una señal fallida tampoco reaparece al renderizar');
    });
}

test('F · true → false → true actualiza el mismo nodo sin reload, polling ni persistencia', async () => {
    const h = harness();
    assert.equal(h.auth.administrativeRecoveryRequired, false);
    await recoveryLogin(h);
    const notice = h.notice();
    h.replies.bootstrap = h.status(false, false);
    await h.auth.checkBootstrapStatus();
    assert.equal(notice.hidden, true);
    h.replies.bootstrap = h.status(false, true);
    await h.auth.checkBootstrapStatus();
    h.setMode('login');
    h.auth.renderAdministrativeRecoveryNotice();
    assert.equal(notice.hidden, false);
    assert.equal(h.notice(), notice);
    assert.equal(walk(h.card).filter(node => node.id === noticeId).length, 1);
    assert.equal(h.storageAccesses(), 0);
    assert.equal(h.timers.length, 0);
    assert.ok(h.requests.filter(request => request.url === '/public/bootstrap-status')
        .every(request => request.options.method === 'GET' && request.options.cache === 'no-store'));
});

test('G · true/true falla cerrado sin abrir bootstrap ni confirmar recovery administrativo', async () => {
    const h = harness();
    await recoveryLogin(h);
    h.replies.bootstrap = h.status(true, true);
    h.auth.showBootstrapSetup = () => assert.fail('Nunca abrir bootstrap ante incoherencia');
    h.auth.showLogin = () => assert.fail('Nunca tratar incoherencia como login verificado');
    await h.auth.checkSession();
    assert.equal(h.auth.requiresBootstrapSetup, false);
    assert.equal(h.auth.administrativeRecoveryRequired, false);
    assert.equal(h.notice().hidden, true);
    assert.equal(h.auth.loginMode, 'verifying');
    assert.equal(h.bootstrap.hidden, true);
    assert.equal(h.form.hidden, true);
    assert.equal(h.timers.length, 1);
});

test('H · aviso exclusivamente informativo, sin controles ni peticiones de recovery', async () => {
    const h = harness();
    await recoveryLogin(h);
    const notice = h.notice();
    assert.equal(notice.children.length, 0, 'Sin botón, input, form, enlace ni spinner');
    assert.doesNotMatch(notice.textContent, /npm|installationId|operationId|PREPARED|\.db|[A-Z]:\\|\/data\//i);
    h.auth.renderAdministrativeRecoveryNotice();
    h.setMode('login');
    assert.deepEqual(h.requests.map(request => request.url), ['/public/bootstrap-status', '/auth/verify']);
});

test('Visibilidad · bootstrap, verificación, reconexión y usuario autenticado ocultan el aviso', async () => {
    const h = harness();
    await recoveryLogin(h);
    for (const mode of ['bootstrap', 'verifying', 'recovery', 'otro']) {
        h.setMode(mode);
        assert.equal(h.notice().hidden, true, mode);
        h.setMode('login');
        assert.equal(h.notice().hidden, false);
    }
    h.auth.showSessionVerifying();
    assert.equal(h.notice().hidden, true);
    h.auth.showLogin();
    assert.equal(h.notice().hidden, false);
    h.setUser({ id: 8, tipo: 'basico' });
    h.auth.showAuthenticatedReconnecting();
    assert.equal(h.notice().hidden, true);
    h.setMode('login');
    assert.equal(h.notice().hidden, true, 'No basta el modo login con usuario autenticado');
    assert.equal(h.storageAccesses(), 0);
});
