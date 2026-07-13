const fs = require('fs');
const path = require('path');
const https = require('https');

loadEnvFile(path.join(__dirname, '../.env'));

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const session = require('express-session');
const database = require('./db/database');
const { APP_NAME, APP_VERSION } = require('./config/appInfo');
const realtime = require('./utils/realtime');

// Importar rutas
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const tablesRoutes = require('./routes/tables');
const menuRoutes = require('./routes/menu');
const ordersRoutes = require('./routes/orders');
const accountsRoutes = require('./routes/accounts');
const creditsRoutes = require('./routes/credits');
const usersRoutes = require('./routes/users');
const settingsRoutes = require('./routes/settings');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-this-secret-in-env';
const NODE_ENV = process.env.NODE_ENV || 'development';
const HOST = process.env.HOST || '0.0.0.0';
const HTTPS_ENABLED = ['true', '1', 'yes', 'on'].includes(String(process.env.HTTPS_ENABLED || '').toLowerCase());
const HTTPS_KEY_PATH = process.env.HTTPS_KEY_PATH || '';
const HTTPS_CERT_PATH = process.env.HTTPS_CERT_PATH || '';

function loadEnvFile(envPath) {
    if (!fs.existsSync(envPath)) return;

    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;

        const [key, ...valueParts] = trimmed.split('=');
        const value = valueParts.join('=').trim().replace(/^['"]|['"]$/g, '');
        if (!process.env[key.trim()]) {
            process.env[key.trim()] = value;
        }
    }
}

function resolveProjectPath(filePath) {
    if (!filePath) return '';
    return path.isAbsolute(filePath)
        ? filePath
        : path.join(__dirname, '..', filePath);
}

function createHttpServer() {
    if (!HTTPS_ENABLED) return { server: app, protocol: 'http' };

    const keyPath = resolveProjectPath(HTTPS_KEY_PATH);
    const certPath = resolveProjectPath(HTTPS_CERT_PATH);

    if (!keyPath || !certPath || !fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
        throw new Error('HTTPS_ENABLED=true requiere HTTPS_KEY_PATH y HTTPS_CERT_PATH válidos.');
    }

    return {
        server: https.createServer({
            key: fs.readFileSync(keyPath),
            cert: fs.readFileSync(certPath)
        }, app),
        protocol: 'https'
    };
}

const publicPath = path.join(__dirname, '../public');
const indexHtmlPath = path.join(publicPath, 'index.html');

function sendAppIndex(req, res) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(indexHtmlPath);
}

function sendLegacyRootServiceWorkerCleanup(req, res) {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Service-Worker-Allowed', '/');
    res.send(`
const MUNDIPOS_LEGACY_SW_CLEANUP = 'v2.1.5-fix2-root-cleanup';
self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter(cacheName => cacheName.startsWith('mundipos-'))
        .map(cacheName => caches.delete(cacheName))
    );
    await self.clients.claim();
    await self.registration.unregister();
  })());
});
self.addEventListener('fetch', () => {
  // Service worker temporal: no intercepta respuestas. Solo limpia un registro PWA antiguo en scope raíz.
});
`);
}

// Middleware
const allowedOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        return callback(new Error('Origen no permitido por CORS'));
    },
    credentials: true
}));

app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Configuración de sesiones
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    name: 'pos.sid',
    cookie: {
        secure: NODE_ENV === 'production' && process.env.COOKIE_SECURE === 'true',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000 // 24 horas
    }
}));

// Archivos PWA con headers explícitos para evitar caché agresivo del service worker/manifest.
// También se exponen rutas raíz de limpieza para desactivar registros antiguos creados durante pruebas PWA.
app.get('/POS/service-worker.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Service-Worker-Allowed', '/POS/');
    res.sendFile(path.join(publicPath, 'service-worker.js'));
});

app.get('/service-worker.js', sendLegacyRootServiceWorkerCleanup);

app.get(['/POS/manifest.webmanifest', '/manifest.webmanifest'], (req, res) => {
    res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(publicPath, 'manifest.webmanifest'));
});

app.get(['/POS/offline.html', '/offline.html'], (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(publicPath, 'offline.html'));
});

// Evitar redirecciones permanentes en móvil. Se sirve el shell directamente en rutas de entrada.
app.get(['/', '/POS', '/POS/', '/PC', '/pc'], sendAppIndex);

// Servir archivos estáticos sin redirección automática para impedir ciclos con cachés viejas del navegador.
app.use('/POS', express.static(publicPath, { redirect: false }));
app.use('/uploads', express.static(path.join(publicPath, 'uploads'), { redirect: false }));

// Endpoint público de identidad visual de la app.
// Expone únicamente datos no sensibles para poder mostrar el nombre del negocio antes del login.
app.get('/api/public/bootstrap-status', async (req, res) => {
    try {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

        const activeAdmins = await database.get(
            "SELECT COUNT(*) as count FROM usuarios WHERE tipo = ? AND activo = 1",
            ['administrador']
        );

        const adminCount = Number(activeAdmins?.count || 0);
        res.json({
            success: true,
            data: {
                hasAdmin: adminCount > 0,
                requiresSetup: adminCount === 0,
                adminCount
            }
        });
    } catch (error) {
        console.error('Error obteniendo estado de bootstrap:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

app.get('/api/public/branding', async (req, res) => {
    try {
        const rows = await database.all(
            "SELECT clave, valor FROM configuracion WHERE clave IN ('nombre_restaurante', 'version_app', 'logo')"
        );

        const data = rows.reduce((acc, row) => {
            acc[row.clave] = row.valor;
            return acc;
        }, {
            nombre_restaurante: 'Tu negocio',
            version_app: APP_VERSION,
            logo: ''
        });

        res.json({
            success: true,
            data: {
                app_name: APP_NAME,
                nombre_restaurante: data.nombre_restaurante || 'Tu negocio',
                version_app: data.version_app || APP_VERSION,
                logo: data.logo || ''
            }
        });
    } catch (error) {
        console.error('Error obteniendo branding público:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Middleware de autenticación
const requireAuth = (req, res, next) => {
    if (req.session && req.session.userId) {
        return next();
    }
    return res.status(401).json({ error: 'No autorizado' });
};

// Rutas de la API
app.use('/api/auth', authRoutes);
app.get('/api/realtime/events', requireAuth, realtime.eventsHandler);
app.use('/api', requireAuth, realtime.operationMutationNotifier);
app.use('/api/dashboard', requireAuth, dashboardRoutes);
app.use('/api/tables', requireAuth, tablesRoutes);
app.use('/api/menu', requireAuth, menuRoutes);
app.use('/api/orders', requireAuth, ordersRoutes);
app.use('/api/accounts', requireAuth, accountsRoutes);
app.use('/api/credits', requireAuth, creditsRoutes);
app.use('/api/users', requireAuth, usersRoutes);
app.use('/api/settings', requireAuth, settingsRoutes);

// Ruta principal - servir index.html sin redirecciones para evitar bucles en navegadores móviles con caché PWA vieja.
app.get('/POS/*', sendAppIndex);

// Manejo global de errores
app.use((err, req, res, next) => {
    console.error('Error global:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
});

// Inicializar la base de datos y arrancar el servidor
if (require.main === module) {
    database.initializeDatabase().then(() => {
        const { server, protocol } = createHttpServer();

        server.listen(PORT, HOST, () => {
            console.log(`Servidor POS ejecutándose en ${protocol}://${HOST}:${PORT}`);
            console.log(`Frontend disponible en ${protocol}://localhost:${PORT}/POS/`);

            if (protocol === 'http') {
                console.log('PWA: instalable en PC usando localhost/127.0.0.1. Para instalar desde móvil por IP local se requiere HTTPS con certificado confiable.');
            } else {
                console.log('PWA: modo HTTPS activo. Verifica que el certificado sea confiable en PC y móvil para permitir instalación.');
            }
        });
    }).catch(err => {
        console.error('Error al inicializar la base de datos:', err);
        process.exit(1);
    });
}

module.exports = app;
