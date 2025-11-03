const express = require('express');
const bcrypt = require('bcryptjs');
const database = require('../db/database');

const router = express.Router();

// Login
router.post('/login', async (req, res) => {
    try {
        const { nombre, password } = req.body;

        if (!nombre || !password) {
            return res.status(400).json({ error: 'Nombre y contraseña son requeridos' });
        }

        // Buscar usuario
        const user = await database.get(
            'SELECT * FROM usuarios WHERE nombre = ? AND activo = 1',
            [nombre]
        );

        if (!user) {
            return res.status(401).json({ error: 'Usuario no encontrado o inactivo' });
        }

        // Verificar contraseña
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Contraseña incorrecta' });
        }

        // Crear sesión
        req.session.userId = user.id;
        req.session.userName = user.nombre;
        req.session.userType = user.tipo;

        // Registrar en historial
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
            // Registrar en historial
            await database.run(
                'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
                ['logout', req.session.userId, `Usuario ${req.session.userName} cerró sesión`, new Date().toISOString()]
            );
        }

        req.session.destroy((err) => {
            if (err) {
                return res.status(500).json({ error: 'Error al cerrar sesión' });
            }
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
router.post('/verify-admin', async (req, res) => {
    try {
        const { password } = req.body;

        if (!password) {
            return res.status(400).json({ error: 'Contraseña requerida' });
        }

        // Buscar cualquier usuario administrador activo
        const admin = await database.get(
            'SELECT * FROM usuarios WHERE tipo = ? AND activo = 1 LIMIT 1',
            ['administrador']
        );

        if (!admin) {
            return res.status(404).json({ error: 'No hay administradores activos' });
        }

        // Verificar contraseña
        const isValidPassword = await bcrypt.compare(password, admin.password);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Contraseña de administrador incorrecta' });
        }

        res.json({ success: true, message: 'Contraseña de administrador verificada' });
    } catch (error) {
        console.error('Error verificando contraseña de administrador:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

module.exports = router;

