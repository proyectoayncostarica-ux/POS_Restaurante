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

function normalizeString(value = '') {
    return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeRoleIds(value) {
    const rawList = Array.isArray(value) ? value : [value];
    const ids = rawList
        .flatMap(item => String(item ?? '').split(','))
        .map(item => parseInt(item, 10))
        .filter(id => Number.isFinite(id) && id > 0);

    return [...new Set(ids)];
}

function normalizeUserType(tipo) {
    const value = String(tipo || '').trim().toLowerCase();
    return value;
}

function mapWorkRolesToUsers(users = [], links = []) {
    const rolesByUser = links.reduce((acc, role) => {
        if (!acc.has(role.usuario_id)) acc.set(role.usuario_id, []);
        acc.get(role.usuario_id).push({
            id: role.id,
            nombre: role.nombre,
            slug: role.slug,
            descripcion: role.descripcion,
            activo: role.activo,
            zonas_total: role.zonas_total,
            zonas_activas: role.zonas_activas
        });
        return acc;
    }, new Map());

    return users.map(user => ({
        ...user,
        roles_trabajo: rolesByUser.get(user.id) || []
    }));
}

async function getUsersWithWorkRoles(whereSql = '', params = []) {
    const users = await database.all(`
        SELECT id, nombre, tipo, activo, fecha_creacion
        FROM usuarios
        ${whereSql}
        ORDER BY fecha_creacion DESC
    `, params);

    if (!users.length) return [];

    const userIds = users.map(user => user.id);
    const placeholders = userIds.map(() => '?').join(',');
    const links = await database.all(`
        SELECT
            urt.usuario_id,
            rt.id,
            rt.nombre,
            rt.slug,
            rt.descripcion,
            rt.activo,
            COUNT(rtz.zona_id) AS zonas_total,
            SUM(CASE WHEN z.activa = 1 THEN 1 ELSE 0 END) AS zonas_activas
        FROM usuario_roles_trabajo urt
        INNER JOIN roles_trabajo rt ON rt.id = urt.rol_trabajo_id
        LEFT JOIN rol_trabajo_zonas rtz ON rtz.rol_trabajo_id = rt.id
        LEFT JOIN zonas z ON z.id = rtz.zona_id
        WHERE urt.usuario_id IN (${placeholders})
        GROUP BY urt.usuario_id, rt.id
        ORDER BY rt.activo DESC, rt.nombre ASC
    `, userIds);

    return mapWorkRolesToUsers(users, links);
}

async function getAvailableWorkRoles() {
    return database.all(`
        SELECT
            rt.id,
            rt.nombre,
            rt.slug,
            rt.descripcion,
            rt.activo,
            COUNT(rtz.zona_id) AS zonas_total,
            SUM(CASE WHEN z.activa = 1 THEN 1 ELSE 0 END) AS zonas_activas,
            GROUP_CONCAT(z.nombre, ' · ') AS zonas_nombre
        FROM roles_trabajo rt
        LEFT JOIN rol_trabajo_zonas rtz ON rtz.rol_trabajo_id = rt.id
        LEFT JOIN zonas z ON z.id = rtz.zona_id
        GROUP BY rt.id
        ORDER BY rt.activo DESC, rt.nombre ASC
    `);
}

async function validateUserWorkRoles(tipo, rawRoleIds = []) {
    const roleIds = normalizeRoleIds(rawRoleIds);
    const isAdmin = tipo === 'administrador';

    if (!roleIds.length) {
        if (isAdmin) return { roleIds: [] };

        const activeRoles = await database.get(`
            SELECT COUNT(*) AS count
            FROM roles_trabajo rt
            WHERE rt.activo = 1
              AND EXISTS (
                  SELECT 1
                  FROM rol_trabajo_zonas rtz
                  INNER JOIN zonas z ON z.id = rtz.zona_id
                  WHERE rtz.rol_trabajo_id = rt.id
                    AND z.activa = 1
              )
        `);

        if (Number(activeRoles?.count || 0) === 0) {
            return { error: 'Antes de crear usuarios estándar debe existir al menos un rol de trabajo activo con zonas activas' };
        }

        return { error: 'Los usuarios estándar deben tener al menos un rol de trabajo asignado' };
    }

    const placeholders = roleIds.map(() => '?').join(',');
    const roles = await database.all(`
        SELECT
            rt.id,
            rt.nombre,
            rt.activo,
            COUNT(CASE WHEN z.activa = 1 THEN z.id END) AS zonas_activas
        FROM roles_trabajo rt
        LEFT JOIN rol_trabajo_zonas rtz ON rtz.rol_trabajo_id = rt.id
        LEFT JOIN zonas z ON z.id = rtz.zona_id
        WHERE rt.id IN (${placeholders})
        GROUP BY rt.id
    `, roleIds);

    if (roles.length !== roleIds.length) {
        return { error: 'Uno o más roles de trabajo seleccionados no existen' };
    }

    const invalidRole = roles.find(role => Number(role.activo) !== 1 || Number(role.zonas_activas || 0) === 0);
    if (invalidRole) {
        return { error: `El rol de trabajo "${invalidRole.nombre}" está inactivo o no tiene zonas activas` };
    }

    return { roleIds };
}

async function replaceUserWorkRoles(userId, roleIds = []) {
    await database.run('DELETE FROM usuario_roles_trabajo WHERE usuario_id = ?', [userId]);

    for (const roleId of roleIds) {
        await database.run(
            'INSERT INTO usuario_roles_trabajo (usuario_id, rol_trabajo_id, creado_en) VALUES (?, ?, ?)',
            [userId, roleId, new Date().toISOString()]
        );
    }
}

// Obtener todos los usuarios (solo administradores)
router.get('/', requireAdmin, async (req, res) => {
    try {
        const usuarios = await getUsersWithWorkRoles();
        res.json({ success: true, data: usuarios });
    } catch (error) {
        console.error('Error obteniendo usuarios:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener roles de trabajo disponibles para asignación de usuarios.
router.get('/work-roles', requireAdmin, async (req, res) => {
    try {
        const roles = await getAvailableWorkRoles();
        res.json({ success: true, data: roles });
    } catch (error) {
        console.error('Error obteniendo roles de trabajo para usuarios:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener estadísticas de usuarios
router.get('/stats/summary', requireAdmin, async (req, res) => {
    try {
        const totalUsuarios = await database.get('SELECT COUNT(*) as count FROM usuarios WHERE activo = 1');
        const usuariosBasicos = await database.get('SELECT COUNT(*) as count FROM usuarios WHERE tipo = ? AND activo = 1', ['basico']);
        const administradores = await database.get('SELECT COUNT(*) as count FROM usuarios WHERE tipo = ? AND activo = 1', ['administrador']);
        const usuariosConRoles = await database.get(`
            SELECT COUNT(DISTINCT u.id) AS count
            FROM usuarios u
            INNER JOIN usuario_roles_trabajo urt ON urt.usuario_id = u.id
            INNER JOIN roles_trabajo rt ON rt.id = urt.rol_trabajo_id AND rt.activo = 1
            WHERE u.activo = 1
        `);
        const usuariosEstandarSinRoles = await database.get(`
            SELECT COUNT(*) AS count
            FROM usuarios u
            WHERE u.tipo = 'basico'
              AND u.activo = 1
              AND NOT EXISTS (
                  SELECT 1
                  FROM usuario_roles_trabajo urt
                  INNER JOIN roles_trabajo rt ON rt.id = urt.rol_trabajo_id AND rt.activo = 1
                  WHERE urt.usuario_id = u.id
              )
        `);

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
                usuarios_con_roles: usuariosConRoles.count,
                usuarios_estandar_sin_roles: usuariosEstandarSinRoles.count,
                ultimos_usuarios: ultimosUsuarios
            }
        });
    } catch (error) {
        console.error('Error obteniendo estadísticas de usuarios:', error);
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

// Obtener un usuario específico (solo administradores)
router.get('/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const usuarios = await getUsersWithWorkRoles('WHERE id = ?', [id]);
        const usuario = usuarios[0];

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
        const nombre = normalizeString(req.body?.nombre);
        const password = String(req.body?.password || '');
        const tipo = normalizeUserType(req.body?.tipo);

        if (!nombre || !password || !tipo) {
            return res.status(400).json({ error: 'Nombre, contraseña y rol de sistema son requeridos' });
        }

        if (!['basico', 'administrador'].includes(tipo)) {
            return res.status(400).json({ error: 'Rol de sistema inválido' });
        }

        const rolValidation = await validateUserWorkRoles(tipo, req.body?.roles_trabajo_ids || req.body?.role_ids || req.body?.rol_trabajo_ids);
        if (rolValidation.error) {
            return res.status(400).json({ error: rolValidation.error });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
        }

        // Verificar que no exista un usuario con el mismo nombre
        const existingUser = await database.get('SELECT id FROM usuarios WHERE LOWER(nombre) = LOWER(?)', [nombre]);
        if (existingUser) {
            return res.status(400).json({ error: 'Ya existe un usuario con ese nombre' });
        }

        // Encriptar contraseña
        const hashedPassword = await bcrypt.hash(password, 10);
        const createdAt = new Date().toISOString();

        const result = await database.run(
            'INSERT INTO usuarios (nombre, password, tipo, fecha_creacion) VALUES (?, ?, ?, ?)',
            [nombre, hashedPassword, tipo, createdAt]
        );

        await replaceUserWorkRoles(result.id, rolValidation.roleIds || []);

        // Registrar en historial
        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['crear_usuario', req.session.userId, `Usuario ${nombre} (${tipo}) creado`, new Date().toISOString()]
        );

        const [createdUser] = await getUsersWithWorkRoles('WHERE id = ?', [result.id]);
        res.status(201).json({
            success: true,
            data: createdUser || {
                id: result.id,
                nombre,
                tipo,
                activo: 1,
                fecha_creacion: createdAt,
                roles_trabajo: []
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
        const nombre = normalizeString(req.body?.nombre);
        const password = String(req.body?.password || '');
        const tipo = normalizeUserType(req.body?.tipo);
        const activo = req.body?.activo !== undefined ? Number(req.body.activo) : 1;

        if (!nombre || !tipo) {
            return res.status(400).json({ error: 'Nombre y rol de sistema son requeridos' });
        }

        if (!['basico', 'administrador'].includes(tipo)) {
            return res.status(400).json({ error: 'Rol de sistema inválido' });
        }

        const rolValidation = await validateUserWorkRoles(tipo, req.body?.roles_trabajo_ids || req.body?.role_ids || req.body?.rol_trabajo_ids);
        if (rolValidation.error) {
            return res.status(400).json({ error: rolValidation.error });
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
        const existingUser = await database.get('SELECT id FROM usuarios WHERE LOWER(nombre) = LOWER(?) AND id != ?', [nombre, id]);
        if (existingUser) {
            return res.status(400).json({ error: 'Ya existe otro usuario con ese nombre' });
        }

        // Evitar degradar/desactivar el último administrador activo.
        if (usuario.tipo === 'administrador' && (tipo !== 'administrador' || activo === 0)) {
            const adminCount = await database.get('SELECT COUNT(*) as count FROM usuarios WHERE tipo = ? AND activo = 1', ['administrador']);
            if (Number(adminCount?.count || 0) <= 1) {
                return res.status(400).json({ error: 'No se puede modificar el último administrador activo' });
            }
        }

        let updateQuery = 'UPDATE usuarios SET nombre = ?, tipo = ?, activo = ? WHERE id = ?';
        let params = [nombre, tipo, activo, id];

        // Si se proporciona nueva contraseña, actualizarla
        if (password) {
            if (password.length < 6) {
                return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
            }
            const hashedPassword = await bcrypt.hash(password, 10);
            updateQuery = 'UPDATE usuarios SET nombre = ?, password = ?, tipo = ?, activo = ? WHERE id = ?';
            params = [nombre, hashedPassword, tipo, activo, id];
        }

        await database.run(updateQuery, params);
        await replaceUserWorkRoles(id, rolValidation.roleIds || []);

        // Si el usuario actual cambió su propio nombre/tipo, mantener sesión coherente.
        if (id == req.session.userId) {
            req.session.userName = nombre;
            req.session.userNombre = nombre;
            req.session.userType = tipo;
        }

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

        await database.run('DELETE FROM usuario_roles_trabajo WHERE usuario_id = ?', [id]);
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

module.exports = router;
