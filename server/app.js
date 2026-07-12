const fs = require('fs');
const path = require('path');

loadEnvFile(path.join(__dirname, '../.env'));

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const session = require('express-session');
const database = require('./db/database');

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

// Servir archivos estáticos
app.use('/POS', express.static(path.join(__dirname, '../public')));
app.use('/uploads', express.static(path.join(__dirname, '../public/uploads')));

// Middleware de autenticación
const requireAuth = (req, res, next) => {
    if (req.session && req.session.userId) {
        return next();
    }
    return res.status(401).json({ error: 'No autorizado' });
};

// Rutas de la API
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', requireAuth, dashboardRoutes);
app.use('/api/tables', requireAuth, tablesRoutes);
app.use('/api/menu', requireAuth, menuRoutes);
app.use('/api/orders', requireAuth, ordersRoutes);
app.use('/api/accounts', requireAuth, accountsRoutes);
app.use('/api/credits', requireAuth, creditsRoutes);
app.use('/api/users', requireAuth, usersRoutes);
app.use('/api/settings', requireAuth, settingsRoutes);

// Ruta principal - servir index.html
app.get('/POS', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/POS/*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Redirección útil para entorno local
app.get('/', (req, res) => {
    res.redirect('/POS');
});

// Manejo global de errores
app.use((err, req, res, next) => {
    console.error('Error global:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
});

// Inicializar la base de datos y arrancar el servidor
if (require.main === module) {
    database.initializeDatabase().then(() => {
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`Servidor POS ejecutándose en http://0.0.0.0:${PORT}`);
            console.log(`Frontend disponible en http://localhost:${PORT}/POS`);
        });
    }).catch(err => {
        console.error('Error al inicializar la base de datos:', err);
        process.exit(1);
    });
}

module.exports = app;
