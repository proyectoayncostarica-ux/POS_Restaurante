const express = require('express');
const bcrypt = require('bcryptjs');
const database = require('../db/database');

const router = express.Router();

// Middleware para verificar permisos de administrador
const requireAdmin = (req, res, next) => {
    if (req.session.userType !== 'administrador') {
        return res.status(403).json({ error: 'Solo los administradores pueden gestionar usuarios' });
    }
    next();
};

// Obtener todos los usuarios (solo administradores)
router.get('/', requireAdmin, async (req, res) => {
    try {
        const usuarios = await database.all(`
            SELECT id, nombre, tipo, activo, fecha_creacion
            FROM usuarios
            ORDER BY fecha_creacion DESC
        `);
        
        res.json({ success: true, data: usuarios });
    } catch (error) {
        console.error('Error obteniendo usuarios:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener un usuario específico (solo administradores)
router.get('/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const usuario = await database.get(`
            SELECT id, nombre, tipo, activo, fecha_creacion
            FROM usuarios
            WHERE id = ?
        `, [id]);
        
        if (!usuario) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        res.json({ success: true, data: usuario });
    } catch (error) {
        console.error('Error obteniendo usuario:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Crear nuevo usuario (solo administradores)
router.post('/', requireAdmin, async (req, res) => {
    try {
        const { nombre, password, tipo } = req.body;

        if (!nombre || !password || !tipo) {
            return res.status(400).json({ error: 'Nombre, contraseña y tipo son requeridos' });
        }

        if (!['basico', 'administrador'].includes(tipo)) {
            return res.status(400).json({ error: 'Tipo de usuario inválido' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
        }

        // Verificar que no exista un usuario con el mismo nombre
        const existingUser = await database.get('SELECT id FROM usuarios WHERE nombre = ?', [nombre]);
        if (existingUser) {
            return res.status(400).json({ error: 'Ya existe un usuario con ese nombre' });
        }

        // Encriptar contraseña
        const hashedPassword = await bcrypt.hash(password, 10);

        const result = await database.run(
            'INSERT INTO usuarios (nombre, password, tipo, fecha_creacion) VALUES (?, ?, ?, ?)',
            [nombre, hashedPassword, tipo, new Date().toISOString()]
        );

        // Registrar en historial
        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['crear_usuario', req.session.userId, `Usuario ${nombre} (${tipo}) creado`, new Date().toISOString()]
        );

        res.json({ 
            success: true, 
            data: { 
                id: result.id, 
                nombre, 
                tipo, 
                activo: 1,
                fecha_creacion: new Date().toISOString()
            } 
        });
    } catch (error) {
        console.error('Error creando usuario:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Actualizar usuario (solo administradores)
router.put('/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre, password, tipo, activo } = req.body;

        if (!nombre || !tipo) {
            return res.status(400).json({ error: 'Nombre y tipo son requeridos' });
        }

        if (!['basico', 'administrador'].includes(tipo)) {
            return res.status(400).json({ error: 'Tipo de usuario inválido' });
        }

        // Verificar que el usuario existe
        const usuario = await database.get('SELECT * FROM usuarios WHERE id = ?', [id]);
        if (!usuario) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        // No permitir que el usuario se desactive a sí mismo
        if (id == req.session.userId && activo === 0) {
            return res.status(400).json({ error: 'No puedes desactivar tu propia cuenta' });
        }

        // Verificar que no exista otro usuario con el mismo nombre
        const existingUser = await database.get('SELECT id FROM usuarios WHERE nombre = ? AND id != ?', [nombre, id]);
        if (existingUser) {
            return res.status(400).json({ error: 'Ya existe otro usuario con ese nombre' });
        }

        let updateQuery = 'UPDATE usuarios SET nombre = ?, tipo = ?, activo = ? WHERE id = ?';
        let params = [nombre, tipo, activo !== undefined ? activo : 1, id];

        // Si se proporciona nueva contraseña, actualizarla
        if (password) {
            if (password.length < 6) {
                return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
            }
            const hashedPassword = await bcrypt.hash(password, 10);
            updateQuery = 'UPDATE usuarios SET nombre = ?, password = ?, tipo = ?, activo = ? WHERE id = ?';
            params = [nombre, hashedPassword, tipo, activo !== undefined ? activo : 1, id];
        }

        await database.run(updateQuery, params);

        // Registrar en historial
        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['actualizar_usuario', req.session.userId, `Usuario ${nombre} actualizado`, new Date().toISOString()]
        );

        res.json({ success: true, message: 'Usuario actualizado exitosamente' });
    } catch (error) {
        console.error('Error actualizando usuario:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Eliminar usuario (solo administradores)
router.delete('/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        // Verificar que el usuario existe
        const usuario = await database.get('SELECT * FROM usuarios WHERE id = ?', [id]);
        if (!usuario) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        // No permitir que el usuario se elimine a sí mismo
        if (id == req.session.userId) {
            return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
        }

        // Verificar que no sea el último administrador
        if (usuario.tipo === 'administrador') {
            const adminCount = await database.get('SELECT COUNT(*) as count FROM usuarios WHERE tipo = ? AND activo = 1', ['administrador']);
            if (adminCount.count <= 1) {
                return res.status(400).json({ error: 'No se puede eliminar el último administrador activo' });
            }
        }

        // Verificar que no tenga pedidos asociados
        const pedidosAsociados = await database.get('SELECT COUNT(*) as count FROM pedidos WHERE usuario_id = ?', [id]);
        if (pedidosAsociados.count > 0) {
            return res.status(400).json({ error: 'No se puede eliminar un usuario que tiene pedidos asociados' });
        }

        await database.run('DELETE FROM usuarios WHERE id = ?', [id]);

        // Registrar en historial
        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['eliminar_usuario', req.session.userId, `Usuario ${usuario.nombre} eliminado`, new Date().toISOString()]
        );

        res.json({ success: true, message: 'Usuario eliminado exitosamente' });
    } catch (error) {
        console.error('Error eliminando usuario:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Cambiar contraseña del usuario actual
router.put('/change-password', async (req, res) => {
    try {
        const { current_password, new_password } = req.body;

        if (!current_password || !new_password) {
            return res.status(400).json({ error: 'Contraseña actual y nueva contraseña son requeridas' });
        }

        if (new_password.length < 6) {
            return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
        }

        // Obtener usuario actual
        const usuario = await database.get('SELECT * FROM usuarios WHERE id = ?', [req.session.userId]);
        if (!usuario) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        // Verificar contraseña actual
        const isValidPassword = await bcrypt.compare(current_password, usuario.password);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Contraseña actual incorrecta' });
        }

        // Encriptar nueva contraseña
        const hashedPassword = await bcrypt.hash(new_password, 10);

        await database.run('UPDATE usuarios SET password = ? WHERE id = ?', [hashedPassword, req.session.userId]);

        // Registrar en historial
        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['cambiar_password', req.session.userId, `${usuario.nombre} cambió su contraseña`, new Date().toISOString()]
        );

        res.json({ success: true, message: 'Contraseña cambiada exitosamente' });
    } catch (error) {
        console.error('Error cambiando contraseña:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener estadísticas de usuarios
router.get('/stats/summary', requireAdmin, async (req, res) => {
    try {
        const totalUsuarios = await database.get('SELECT COUNT(*) as count FROM usuarios WHERE activo = 1');
        const usuariosBasicos = await database.get('SELECT COUNT(*) as count FROM usuarios WHERE tipo = ? AND activo = 1', ['basico']);
        const administradores = await database.get('SELECT COUNT(*) as count FROM usuarios WHERE tipo = ? AND activo = 1', ['administrador']);
        
        const ultimosUsuarios = await database.all(`
            SELECT nombre, tipo, fecha_creacion
            FROM usuarios
            WHERE activo = 1
            ORDER BY fecha_creacion DESC
            LIMIT 5
        `);

        res.json({ 
            success: true, 
            data: {
                total_usuarios: totalUsuarios.count,
                usuarios_basicos: usuariosBasicos.count,
                administradores: administradores.count,
                ultimos_usuarios: ultimosUsuarios
            }
        });
    } catch (error) {
        console.error('Error obteniendo estadísticas de usuarios:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

module.exports = router;

