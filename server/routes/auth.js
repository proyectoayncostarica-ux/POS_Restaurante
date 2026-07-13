const express = require('express');
const bcrypt = require('bcryptjs');
const database = require('../db/database');

const router = express.Router();
const adminVerificationAttempts = new Map();

function requireSession(req, res, next) {
    if (req.session && req.session.userId) {
        return next();
    }
    return res.status(401).json({ error: 'No autorizado' });
}

function getAttemptKey(req) {
    return `${req.session?.userId || 'anon'}:${req.ip}`;
}

function isAdminVerificationBlocked(req) {
    const attempt = adminVerificationAttempts.get(getAttemptKey(req));
    if (!attempt) return false;

    if (Date.now() > attempt.blockedUntil) {
        adminVerificationAttempts.delete(getAttemptKey(req));
        return false;
    }

    return attempt.count >= 5;
}

function registerAdminVerificationFailure(req) {
    const key = getAttemptKey(req);
    const current = adminVerificationAttempts.get(key) || { count: 0, blockedUntil: 0 };
    current.count += 1;
    current.blockedUntil = current.count >= 5 ? Date.now() + (5 * 60 * 1000) : 0;
    adminVerificationAttempts.set(key, current);
}

function clearAdminVerificationFailures(req) {
    adminVerificationAttempts.delete(getAttemptKey(req));
}

function sanitizeUserName(nombre = '') {
    return String(nombre).trim();
}

async function getActiveAdminCount() {
    const result = await database.get(
        "SELECT COUNT(*) as count FROM usuarios WHERE tipo = ? AND activo = 1",
        ['administrador']
    );

    return Number(result?.count || 0);
}

function validateBootstrapAdminPayload({ nombre, password, confirmPassword }) {
    const cleanName = sanitizeUserName(nombre);
    const cleanPassword = String(password || '');
    const cleanConfirmPassword = String(confirmPassword || '');

    if (!cleanName || !cleanPassword) {
        return { error: 'Nombre y contraseña son requeridos' };
    }

    if (cleanName.length < 3) {
        return { error: 'El nombre de usuario debe tener al menos 3 caracteres' };
    }

    if (cleanName.length > 40) {
        return { error: 'El nombre de usuario no debe superar 40 caracteres' };
    }

    if (!/^[a-zA-Z0-9._-]+$/.test(cleanName)) {
        return { error: 'El nombre de usuario solo puede usar letras, números, punto, guion y guion bajo' };
    }

    if (cleanPassword.length < 8) {
        return { error: 'La contraseña debe tener al menos 8 caracteres' };
    }

    if (cleanConfirmPassword && cleanPassword !== cleanConfirmPassword) {
        return { error: 'Las contraseñas no coinciden' };
    }

    return { nombre: cleanName, password: cleanPassword };
}

// Registro inicial del primer administrador.
// Solo se permite cuando no existe ningún administrador activo.
router.post('/bootstrap-admin', async (req, res) => {
    try {
        const activeAdmins = await getActiveAdminCount();
        if (activeAdmins > 0) {
            return res.status(409).json({
                error: 'El sistema ya fue inicializado. Inicie sesión con un administrador existente.'
            });
        }

        const payload = validateBootstrapAdminPayload(req.body || {});
        if (payload.error) {
            return res.status(400).json({ error: payload.error });
        }

        const existingUser = await database.get(
            'SELECT id FROM usuarios WHERE nombre = ?',
            [payload.nombre]
        );

        if (existingUser) {
            return res.status(409).json({ error: 'Ya existe un usuario con ese nombre' });
        }

        const hashedPassword = await bcrypt.hash(payload.password, 10);
        const createdAt = new Date().toISOString();
        const result = await database.run(
            'INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion) VALUES (?, ?, ?, ?, ?)',
            [payload.nombre, hashedPassword, 'administrador', 1, createdAt]
        );

        req.session.userId = result.lastID || result.id;
        req.session.userName = payload.nombre;
        req.session.userNombre = payload.nombre;
        req.session.userType = 'administrador';

        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['bootstrap_admin', req.session.userId, `Administrador inicial ${payload.nombre} creado`, createdAt]
        );

        res.status(201).json({
            success: true,
            message: 'Administrador inicial creado correctamente',
            user: {
                id: req.session.userId,
                nombre: payload.nombre,
                tipo: 'administrador'
            }
        });
    } catch (error) {
        console.error('Error creando administrador inicial:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Login
router.post('/login', async (req, res) => {
    try {
        const { nombre, password } = req.body;

        if (!nombre || !password) {
            return res.status(400).json({ error: 'Nombre y contraseña son requeridos' });
        }

        const user = await database.get(
            'SELECT * FROM usuarios WHERE nombre = ? AND activo = 1',
            [nombre]
        );

        if (!user) {
            return res.status(401).json({ error: 'Usuario no encontrado o inactivo' });
        }

        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Contraseña incorrecta' });
        }

        req.session.userId = user.id;
        req.session.userName = user.nombre;
        req.session.userNombre = user.nombre; // compatibilidad con código viejo
        req.session.userType = user.tipo;

        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['login', user.id, `Usuario ${user.nombre} inició sesión`, new Date().toISOString()]
        );

        res.json({
            success: true,
            user: {
                id: user.id,
                nombre: user.nombre,
                tipo: user.tipo
            }
        });
    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Logout
router.post('/logout', async (req, res) => {
    try {
        if (req.session.userId) {
            await database.run(
                'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
                ['logout', req.session.userId, `Usuario ${req.session.userName} cerró sesión`, new Date().toISOString()]
            );
        }

        req.session.destroy((err) => {
            if (err) {
                return res.status(500).json({ error: 'Error al cerrar sesión' });
            }
            res.clearCookie('pos.sid');
            res.json({ success: true, message: 'Sesión cerrada exitosamente' });
        });
    } catch (error) {
        console.error('Error en logout:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Verificar sesión
router.get('/verify', (req, res) => {
    if (req.session && req.session.userId) {
        res.json({
            authenticated: true,
            user: {
                id: req.session.userId,
                nombre: req.session.userName,
                tipo: req.session.userType
            }
        });
    } else {
        res.json({ authenticated: false });
    }
});

// Verificar contraseña de administrador (para operaciones críticas)
router.post('/verify-admin', requireSession, async (req, res) => {
    try {
        const { password } = req.body;

        if (!password) {
            return res.status(400).json({ error: 'Contraseña requerida' });
        }

        if (isAdminVerificationBlocked(req)) {
            return res.status(429).json({ error: 'Demasiados intentos. Intente de nuevo en unos minutos.' });
        }

        const admins = await database.all(
            'SELECT * FROM usuarios WHERE tipo = ? AND activo = 1',
            ['administrador']
        );

        if (!admins || admins.length === 0) {
            return res.status(404).json({ error: 'No hay administradores activos' });
        }

        let adminValidado = null;
        for (const admin of admins) {
            const isValidPassword = await bcrypt.compare(password, admin.password);
            if (isValidPassword) {
                adminValidado = admin;
                break;
            }
        }

        if (!adminValidado) {
            registerAdminVerificationFailure(req);
            return res.status(401).json({ error: 'Contraseña de administrador incorrecta' });
        }

        clearAdminVerificationFailures(req);
        res.json({
            success: true,
            message: 'Contraseña de administrador verificada',
            admin: {
                id: adminValidado.id,
                nombre: adminValidado.nombre
            }
        });
    } catch (error) {
        console.error('Error verificando contraseña de administrador:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

module.exports = router;
