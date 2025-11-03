const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const session = require('express-session');
const path = require('path');
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

// Middleware
app.use(cors({
    origin: true,
    credentials: true
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Configuración de sesiones
app.use(session({
    secret: 'restaurant-app-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Para desarrollo local
        maxAge: 24 * 60 * 60 * 1000 // 24 horas
    }
}));

// Servir archivos estáticos
app.use('/POS', express.static(path.join(__dirname, '../public')));

// Middleware de autenticación
const requireAuth = (req, res, next) => {
    if (req.session && req.session.userId) {
        return next();
    } else {
        return res.status(401).json({ error: 'No autorizado' });
    }
};

// Middleware para verificar si es administrador
const requireAdmin = (req, res, next) => {
    if (req.session && req.session.userId && req.session.userType === 'administrador') {
        return next();
    } else {
        return res.status(403).json({ error: 'Acceso denegado. Se requieren permisos de administrador.' });
    }
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
// Servir imágenes desde /public/uploads
app.use('/uploads', express.static(path.join(__dirname, '../public/uploads')));
console.log('Sirviendo archivos desde:', path.join(__dirname, 'public/uploads'));



// Ruta principal - servir index.html
app.get('/POS', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});
app.get('/POS/*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});
// Manejo de errores
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Error interno del servidor' });
});
// Manejo global de errores
app.use((err, req, res, next) => {
    console.error('❌ Error global no capturado:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
});

// Inicializar la base de datos y arrancar el servidor
database.initializeDatabase().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Servidor ejecutándose en http://0.0.0.0:${PORT}`);
        console.log('Base de datos inicializada correctamente');
    });
}).catch(err => {
    console.error('Error al inicializar la base de datos:', err);
    process.exit(1);
});

module.exports = app;