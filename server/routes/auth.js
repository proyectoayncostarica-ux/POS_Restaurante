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

function normalizeBooleanNumber(value) {
    return Number(value) === 1 ? 1 : 0;
}

function mapRoleRow(row = {}) {
    return {
        id: Number(row.id),
        nombre: row.nombre,
        slug: row.slug,
        descripcion: row.descripcion,
        activo: normalizeBooleanNumber(row.activo),
        zonas_total: Number(row.zonas_total || 0),
        zonas_activas: Number(row.zonas_activas || 0),
        zonas: []
    };
}

function isSelectableWorkRole(role = {}) {
    return Number(role.activo) === 1 && Number(role.zonas_activas || 0) > 0;
}

function getSelectableWorkRoles(roles = []) {
    return roles.filter(isSelectableWorkRole);
}


function getActiveZoneIdsForRole(role = {}) {
    const zones = Array.isArray(role.zonas) ? role.zonas : [];
    return zones
        .filter(zone => Number(zone.activa) === 1 && Number(zone.id) > 0)
        .map(zone => Number(zone.id));
}

async function getRoleChangeBlockStatus(activeRole = null) {
    if (!activeRole || !Number(activeRole.id)) {
        return {
            bloqueado: false,
            cuentas_pendientes: 0,
            puestos_ocupados: 0,
            mensaje: null
        };
    }

    const zoneIds = getActiveZoneIdsForRole(activeRole);
    if (!zoneIds.length) {
        return {
            bloqueado: false,
            cuentas_pendientes: 0,
            puestos_ocupados: 0,
            mensaje: null
        };
    }

    const placeholders = zoneIds.map(() => '?').join(',');
    const [pendingOrders, occupiedSeats] = await Promise.all([
        database.get(`
            SELECT COUNT(DISTINCT p.id) AS count
            FROM pedidos p
            INNER JOIN mesas m ON m.id = p.mesa_id
            WHERE p.estado = 'pendiente'
              AND m.zona_id IN (${placeholders})
        `, zoneIds),
        database.get(`
            SELECT COUNT(*) AS count
            FROM mesas
            WHERE activo = 1
              AND estado = 'ocupada'
              AND zona_id IN (${placeholders})
        `, zoneIds)
    ]);

    const cuentasPendientes = Number(pendingOrders?.count || 0);
    const puestosOcupados = Number(occupiedSeats?.count || 0);
    const bloqueado = cuentasPendientes > 0 || puestosOcupados > 0;

    return {
        bloqueado,
        cuentas_pendientes: cuentasPendientes,
        puestos_ocupados: puestosOcupados,
        mensaje: bloqueado
            ? `No se puede cambiar de rol porque el rol actual tiene ${cuentasPendientes} cuenta(s) pendiente(s) y ${puestosOcupados} puesto(s) con consumo activo.`
            : null
    };
}

async function getUserWorkRoles(userId) {
    if (!userId) return [];

    const roles = await database.all(`
        SELECT
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
        WHERE urt.usuario_id = ?
        GROUP BY rt.id
        ORDER BY rt.activo DESC, rt.nombre ASC
    `, [userId]);

    if (!roles.length) return [];

    const mappedRoles = roles.map(mapRoleRow);
    const roleIds = mappedRoles.map(role => role.id).filter(Boolean);
    const placeholders = roleIds.map(() => '?').join(',');

    if (placeholders) {
        const zones = await database.all(`
            SELECT
                rtz.rol_trabajo_id,
                z.id,
                z.nombre,
                z.slug,
                z.icono,
                z.color,
                z.orden,
                z.activa,
                z.visible_dashboard
            FROM rol_trabajo_zonas rtz
            INNER JOIN zonas z ON z.id = rtz.zona_id
            WHERE rtz.rol_trabajo_id IN (${placeholders})
            ORDER BY z.orden ASC, z.nombre ASC
        `, roleIds);

        const zonesByRole = zones.reduce((acc, zone) => {
            const roleId = Number(zone.rol_trabajo_id);
            if (!acc.has(roleId)) acc.set(roleId, []);
            acc.get(roleId).push({
                id: Number(zone.id),
                nombre: zone.nombre,
                slug: zone.slug,
                icono: zone.icono,
                color: zone.color,
                orden: Number(zone.orden || 0),
                activa: normalizeBooleanNumber(zone.activa),
                visible_dashboard: normalizeBooleanNumber(zone.visible_dashboard)
            });
            return acc;
        }, new Map());

        mappedRoles.forEach(role => {
            role.zonas = zonesByRole.get(role.id) || [];
        });
    }

    return mappedRoles;
}

function buildOperationalSession(req, user, rolesTrabajo = [], options = {}) {
    const userType = user?.tipo || req.session?.userType;
    const isAdmin = userType === 'administrador';
    const selectableRoles = getSelectableWorkRoles(rolesTrabajo);
    const resetSelection = Boolean(options.resetSelection);

    if (resetSelection) {
        req.session.activeWorkRoleId = null;
        req.session.activeWorkRoleName = null;
    }

    let activeRole = null;
    const currentRoleId = Number(req.session?.activeWorkRoleId || 0);
    if (currentRoleId) {
        activeRole = selectableRoles.find(role => Number(role.id) === currentRoleId) || null;
        if (!activeRole) {
            req.session.activeWorkRoleId = null;
            req.session.activeWorkRoleName = null;
        }
    }

    if (!activeRole && selectableRoles.length === 1) {
        activeRole = selectableRoles[0];
        req.session.activeWorkRoleId = activeRole.id;
        req.session.activeWorkRoleName = activeRole.nombre;
    }

    const requiresSelection = !activeRole && selectableRoles.length > 1;
    const blockedWithoutRole = !isAdmin && !activeRole && selectableRoles.length === 0;
    const canOperate = Boolean(activeRole || isAdmin) && !requiresSelection && !blockedWithoutRole;
    const mode = activeRole
        ? 'rol_trabajo'
        : (blockedWithoutRole ? 'bloqueado_sin_rol' : (isAdmin ? 'administrador_sin_rol' : 'pendiente'));

    return {
        activa: canOperate,
        puede_operar: canOperate,
        requiere_seleccion: requiresSelection,
        modo: mode,
        rol_trabajo: activeRole,
        roles_disponibles: selectableRoles,
        mensaje: blockedWithoutRole
            ? 'Este usuario no tiene un rol de trabajo activo con zonas activas. Un administrador debe asignarlo antes de operar.'
            : null
    };
}

function buildUserPayload(req, user, rolesTrabajo = [], operationalSession = null) {
    const sessionPayload = operationalSession || buildOperationalSession(req, user, rolesTrabajo);

    return {
        id: Number(user.id || req.session.userId),
        nombre: user.nombre || req.session.userName,
        tipo: user.tipo || req.session.userType,
        roles_trabajo: rolesTrabajo,
        sesion_operativa: sessionPayload
    };
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
        req.session.activeWorkRoleId = null;
        req.session.activeWorkRoleName = null;

        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['bootstrap_admin', req.session.userId, `Administrador inicial ${payload.nombre} creado`, createdAt]
        );

        const user = { id: req.session.userId, nombre: payload.nombre, tipo: 'administrador' };
        const rolesTrabajo = [];
        const sesionOperativa = buildOperationalSession(req, user, rolesTrabajo);

        res.status(201).json({
            success: true,
            message: 'Administrador inicial creado correctamente',
            user: buildUserPayload(req, user, rolesTrabajo, sesionOperativa)
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

        const rolesTrabajo = await getUserWorkRoles(user.id);
        const sesionOperativa = buildOperationalSession(req, user, rolesTrabajo, { resetSelection: true });

        if (sesionOperativa.modo === 'bloqueado_sin_rol') {
            return req.session.destroy(() => {
                res.clearCookie('pos.sid');
                res.status(403).json({ error: sesionOperativa.mensaje });
            });
        }

        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['login', user.id, `Usuario ${user.nombre} inició sesión`, new Date().toISOString()]
        );

        res.json({
            success: true,
            user: buildUserPayload(req, user, rolesTrabajo, sesionOperativa)
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
router.get('/verify', async (req, res) => {
    try {
        if (req.session && req.session.userId) {
            const user = {
                id: req.session.userId,
                nombre: req.session.userName,
                tipo: req.session.userType
            };
            const rolesTrabajo = await getUserWorkRoles(req.session.userId);
            const sesionOperativa = buildOperationalSession(req, user, rolesTrabajo);

            res.json({
                authenticated: true,
                user: buildUserPayload(req, user, rolesTrabajo, sesionOperativa)
            });
        } else {
            res.json({ authenticated: false });
        }
    } catch (error) {
        console.error('Error verificando sesión:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Consultar el estado de sesión operativa del usuario autenticado.
router.get('/operational-session', requireSession, async (req, res) => {
    try {
        const user = {
            id: req.session.userId,
            nombre: req.session.userName,
            tipo: req.session.userType
        };
        const rolesTrabajo = await getUserWorkRoles(req.session.userId);
        const sesionOperativa = buildOperationalSession(req, user, rolesTrabajo);

        res.json({
            success: true,
            data: sesionOperativa,
            user: buildUserPayload(req, user, rolesTrabajo, sesionOperativa)
        });
    } catch (error) {
        console.error('Error obteniendo sesión operativa:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});


// Consultar si es posible cambiar el rol de trabajo activo sin cerrar sesión.
router.get('/operational-session/change-status', requireSession, async (req, res) => {
    try {
        const user = {
            id: req.session.userId,
            nombre: req.session.userName,
            tipo: req.session.userType
        };
        const rolesTrabajo = await getUserWorkRoles(req.session.userId);
        const sesionOperativa = buildOperationalSession(req, user, rolesTrabajo);
        const activeRole = sesionOperativa.rol_trabajo || null;
        const bloqueo = await getRoleChangeBlockStatus(activeRole);

        res.json({
            success: true,
            data: {
                puede_cambiar: !bloqueo.bloqueado,
                bloqueo,
                rol_trabajo_actual: activeRole,
                roles_disponibles: getSelectableWorkRoles(rolesTrabajo),
                sesion_operativa: sesionOperativa
            },
            user: buildUserPayload(req, user, rolesTrabajo, sesionOperativa)
        });
    } catch (error) {
        console.error('Error consultando cambio de rol operativo:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Seleccionar el rol de trabajo activo para la sesión actual.
router.post('/operational-session', requireSession, async (req, res) => {
    try {
        const roleId = Number(req.body?.rol_trabajo_id || req.body?.roleId || 0);
        if (!Number.isFinite(roleId) || roleId <= 0) {
            return res.status(400).json({ error: 'Debe seleccionar un rol de trabajo válido' });
        }

        const user = {
            id: req.session.userId,
            nombre: req.session.userName,
            tipo: req.session.userType
        };
        const rolesTrabajo = await getUserWorkRoles(req.session.userId);
        const selectableRoles = getSelectableWorkRoles(rolesTrabajo);
        const selectedRole = selectableRoles.find(role => Number(role.id) === roleId);

        if (!selectedRole) {
            return res.status(403).json({ error: 'El rol seleccionado no está disponible para este usuario o no tiene zonas activas' });
        }

        const currentRoleId = Number(req.session.activeWorkRoleId || 0);
        const currentRole = currentRoleId
            ? selectableRoles.find(role => Number(role.id) === currentRoleId) || null
            : null;

        if (currentRole && Number(currentRole.id) !== Number(selectedRole.id)) {
            const bloqueo = await getRoleChangeBlockStatus(currentRole);
            if (bloqueo.bloqueado) {
                return res.status(409).json({
                    error: bloqueo.mensaje || 'No se puede cambiar de rol mientras existan cuentas pendientes o consumos activos en el rol actual.',
                    code: 'ROLE_CHANGE_BLOCKED_ACTIVE_CONSUMPTION',
                    bloqueo
                });
            }
        }

        req.session.activeWorkRoleId = selectedRole.id;
        req.session.activeWorkRoleName = selectedRole.nombre;

        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['seleccion_rol_trabajo', req.session.userId, `Rol de trabajo activo: ${selectedRole.nombre}`, new Date().toISOString()]
        );

        const sesionOperativa = buildOperationalSession(req, user, rolesTrabajo);
        res.json({
            success: true,
            message: 'Rol de trabajo activo seleccionado',
            data: sesionOperativa,
            user: buildUserPayload(req, user, rolesTrabajo, sesionOperativa)
        });
    } catch (error) {
        console.error('Error seleccionando rol de trabajo activo:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
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
