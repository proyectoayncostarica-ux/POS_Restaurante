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

const authRecovery = () => sourceBetween('    async checkSession() {', '    async checkBootstrapStatus()');
const loginMode = () => sourceBetween("function setLoginMode(mode = 'login'", '// Navegación');

test('A · el HTML inicia en VERIFYING sin credenciales disponibles', () => {
    assert.match(index, /<body data-session-state="VERIFYING">/);
    assert.match(index, /id="session-recovery-status"[\s\S]*Verificando sesión/);
    assert.match(index, /<form id="login-form" hidden aria-hidden="true">/);
    assert.match(index, /id="username"[^>]*disabled/);
    assert.match(index, /id="password"[^>]*disabled/);
    assert.match(index, /login-submit-btn" disabled/);
    assert.match(main, /DOMContentLoaded[\s\S]*Auth\.showSessionVerifying\(\)[\s\S]*await Auth\.checkSession\(\)/);
});

test('B · verify válido reconstruye currentUser y muestra la aplicación autenticada', () => {
    const recovery = authRecovery();
    assert.match(recovery, /await Utils\.request\('\/auth\/verify'\)/);
    assert.match(recovery, /if \(response\.authenticated\)[\s\S]*currentUser = response\.user/);
    assert.match(recovery, /continueAuthenticatedSession\(\{ animated: false \}\)/);
    assert.match(main, /showApp\(\)[\s\S]*SESSION_STATES\.AUTHENTICATED_ONLINE[\s\S]*loginScreen\.style\.display = 'none'[\s\S]*mainApp\.style\.display = 'grid'/);
});

test('C · authenticated false cancela recuperación, limpia usuario y habilita solo entonces el login', () => {
    const recovery = authRecovery();
    const mode = loginMode();
    assert.match(recovery, /this\.cancelSessionRecovery\(\);\s*currentUser = null;\s*this\.showLogin\(\);\s*return false;/);
    assert.match(main, /showLogin\(\)[\s\S]*SESSION_STATES\.UNAUTHENTICATED[\s\S]*setLoginMode\('login'\)/);
    assert.match(mode, /loginForm\.hidden = isBootstrap \|\| isSessionPending/);
    assert.match(mode, /control\.disabled = isBootstrap \|\| isSessionPending/);
});

test('D · un fallo temporal mantiene credenciales ocultas y programa reintento', () => {
    const recovery = authRecovery();
    const mode = loginMode();
    assert.match(recovery, /error\?\.isNetworkError === true \|\| Number\(error\?\.status \|\| 0\) >= 500/);
    assert.match(recovery, /if \(this\.isTemporarySessionRecoveryError\(error\)\)[\s\S]*showSessionRecoveryPending\(\)[\s\S]*scheduleSessionRecovery\(\)[\s\S]*return false/);
    assert.match(recovery, /Math\.min\(15000, 1500 \* \(2 \*\* Math\.min\(this\.sessionRecoveryAttempt, 4\)\)\)/);
    assert.match(mode, /const isSessionPending = isRecovery \|\| isVerifying/);
    assert.match(mode, /recoveryStatus\.hidden = !isSessionPending/);
    assert.match(main, /window\.addEventListener\('online', \(\) => Auth\.retrySessionRecoveryNow\(\)\)/);
});

test('E · una desconexión autenticada conserva la vista y sustituye el header bloqueando acciones', () => {
    assert.match(index, /id="connection-status-header"[\s\S]*Sin conexión al servidor[\s\S]*Esperando recuperación de la red/);
    assert.match(main, /handleTemporaryConnectionFailure\(\)[\s\S]*showAuthenticatedReconnecting\(\)[\s\S]*scheduleSessionRecovery\(\)/);
    assert.match(main, /SESSION_STATES\.AUTHENTICATED_RECONNECTING/);
    assert.match(main, /if \(this\.isMainAppVisible\(\)\)[\s\S]*setAuthenticatedReconnectingUi\(true\)/);
    assert.match(main, /element\.inert = active/);
    assert.match(css, /body\.auth-reconnecting \.app-header\s*\{\s*display: none !important/);
    assert.match(css, /session-interaction-blocked \.main-content[\s\S]*pointer-events: none !important/);
});

test('F · verify recuperado restaura header, interacción, sesión y datos sin reiniciar la sección válida', () => {
    const recovery = authRecovery();
    assert.match(recovery, /const resumeExistingView = Boolean\(currentUser\)[\s\S]*isMainAppVisible\(\)/);
    assert.match(recovery, /resumeExistingView[\s\S]*this\.resumeAuthenticatedSession\(\)/);
    assert.match(recovery, /resumeAuthenticatedSession\(\)[\s\S]*AUTHENTICATED_ONLINE[\s\S]*setAuthenticatedReconnectingUi\(false\)/);
    assert.match(recovery, /if \(!Access\.canOpen\(currentSection\)\)[\s\S]*Navigation\.showSection\(Access\.getInitialSection\(\)\)/);
    assert.match(recovery, /Realtime\.reconnectForSession\(\)[\s\S]*Realtime\.scheduleRecovery\('session-recovered'\)/);
});

test('G · el service worker conserva APIs network-only y usa el shell cacheado en navegaciones caídas', () => {
    assert.match(serviceWorker, /if \(url\.pathname\.startsWith\('\/api\/'\)\) \{\s*response = await networkOnly\(request\)/);
    assert.match(serviceWorker, /async function networkOnly\(request\)[\s\S]*return await fetch\(request\)[\s\S]*jsonUnavailableResponse\(\)/);
    assert.match(serviceWorker, /if \(!response\.ok && response\.status >= 500\) \{\s*return navigationFallback\(request\)/);
    assert.match(serviceWorker, /caches\.match\('\/POS\/'\)[\s\S]*caches\.match\('\/POS\/index\.html'\)/);
    assert.match(serviceWorker, /'\/POS\/'[\s\S]*'\/POS\/index\.html'[\s\S]*'\/POS\/offline\.html'/);
});