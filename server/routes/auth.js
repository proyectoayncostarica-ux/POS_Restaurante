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

function normalizeRoleIds(value) {
    if (value === null || value === undefined || value === '') return [];

    let normalizedValue = value;
    if (typeof normalizedValue === 'string') {
        const trimmed = normalizedValue.trim();
        if (!trimmed) return [];

        if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || trimmed.includes(',')) {
            try {
                normalizedValue = trimmed.startsWith('[')
                    ? JSON.parse(trimmed)
                    : trimmed.split(',');
            } catch (error) {
                normalizedValue = trimmed.split(',');
            }
        }
    }

    const raw = Array.isArray(normalizedValue) ? normalizedValue : [normalizedValue];
    const ids = raw
        .flatMap(item => Array.isArray(item) ? item : [item])
        .map(item => Number(item))
        .filter(id => Number.isFinite(id) && id > 0);

    return [...new Set(ids)];
}

function getSessionActiveWorkRoleIds(req) {
    const multiIds = normalizeRoleIds(req.session?.activeWorkRoleIds);
    if (multiIds.length) return multiIds;

    const legacyId = Number(req.session?.activeWorkRoleId || 0);
    return legacyId > 0 ? [legacyId] : [];
}

function setSessionActiveWorkRoles(req, roles = []) {
    const normalizedRoles = Array.isArray(roles) ? roles.filter(role => Number(role?.id) > 0) : [];
    const ids = normalizedRoles.map(role => Number(role.id));
    const names = normalizedRoles.map(role => role.nombre).filter(Boolean);

    req.session.activeWorkRoleIds = ids;
    req.session.activeWorkRoleId = ids[0] || null;
    req.session.activeWorkRoleName = names.join(' + ') || null;
}

function clearSessionActiveWorkRoles(req) {
    req.session.activeWorkRoleIds = [];
    req.session.activeWorkRoleId = null;
    req.session.activeWorkRoleName = null;
}

function sameRoleSet(left = [], right = []) {
    const a = normalizeRoleIds(left).sort((x, y) => x - y);
    const b = normalizeRoleIds(right).sort((x, y) => x - y);
    return a.length === b.length && a.every((id, index) => id === b[index]);
}

function getActiveZoneIdsForRoles(roles = []) {
    const ids = new Set();
    roles.forEach(role => {
        getActiveZoneIdsForRole(role).forEach(zoneId => ids.add(zoneId));
    });
    return [...ids];
}


function getActiveZoneIdsForRole(role = {}) {
    const zones = Array.isArray(role.zonas) ? role.zonas : [];
    return zones
        .filter(zone => Number(zone.activa) === 1 && Number(zone.id) > 0)
        .map(zone => Number(zone.id));
}


function unwrapStoredSession(rawSession) {
    if (!rawSession) return null;

    let session = rawSession;
    if (typeof session === 'string') {
        try {
            session = JSON.parse(session);
        } catch (error) {
            return null;
        }
    }

    if (session?.sess) return unwrapStoredSession(session.sess);
    if (session?.session) return unwrapStoredSession(session.session);
    return session;
}

function isStoredSessionExpired(session = {}) {
    const expires = session?.cookie?.expires;
    if (!expires) return false;
    const timestamp = Date.parse(expires);
    return Number.isFinite(timestamp) && timestamp <= Date.now();
}

function getSessionsFromStoreAll(req) {
    return new Promise(resolve => {
        const store = req?.sessionStore;
        if (!store || typeof store.all !== 'function') {
            return resolve([]);
        }

        store.all((error, sessions) => {
            if (error || !sessions) return resolve([]);
            if (Array.isArray(sessions)) return resolve(sessions);
            if (typeof sessions === 'object') return resolve(Object.values(sessions));
            return resolve([]);
        });
    });
}

async function getActiveOperationalSessionsByUser(req) {
    const storeSessions = await getSessionsFromStoreAll(req);
    const memoryStoreSessions = req?.sessionStore?.sessions && typeof req.sessionStore.sessions === 'object'
        ? Object.values(req.sessionStore.sessions)
        : [];
    const currentSession = req?.session ? [req.session] : [];
    const sessions = [...storeSessions, ...memoryStoreSessions, ...currentSession];
    const activeByUser = new Map();

    sessions.forEach(rawSession => {
        const session = unwrapStoredSession(rawSession);
        const userId = Number(session?.userId || 0);
        if (!userId || isStoredSessionExpired(session)) return;

        const activeRoleIds = [...new Set([
            ...normalizeRoleIds(session.activeWorkRoleIds),
            ...normalizeRoleIds(session.activeWorkRoleId)
        ])];
        if (!activeRoleIds.length) return;

        if (!activeByUser.has(userId)) {
            activeByUser.set(userId, { userId, activeRoleIds: new Set() });
        }

        const target = activeByUser.get(userId);
        activeRoleIds.forEach(roleId => target.activeRoleIds.add(Number(roleId)));
    });

    return activeByUser;
}

async function getActiveOperationalZoneAccessByUser(req) {
    const activeSessionsByUser = await getActiveOperationalSessionsByUser(req);
    const allRoleIds = [...new Set(
        [...activeSessionsByUser.values()]
            .flatMap(session => [...session.activeRoleIds])
            .map(id => Number(id))
            .filter(id => id > 0)
    )];

    if (!allRoleIds.length) return new Map();

    const placeholders = allRoleIds.map(() => '?').join(',');
    const roleZones = await database.all(`
        SELECT DISTINCT rtz.rol_trabajo_id, rtz.zona_id
        FROM rol_trabajo_zonas rtz
        INNER JOIN roles_trabajo rt ON rt.id = rtz.rol_trabajo_id AND rt.activo = 1
        INNER JOIN zonas z ON z.id = rtz.zona_id AND z.activa = 1
        WHERE rtz.rol_trabajo_id IN (${placeholders})
    `, allRoleIds);

    const zonesByRole = roleZones.reduce((acc, row) => {
        const roleId = Number(row.rol_trabajo_id || 0);
        if (!acc.has(roleId)) acc.set(roleId, new Set());
        acc.get(roleId).add(Number(row.zona_id || 0));
        return acc;
    }, new Map());

    const accessByUser = new Map();
    activeSessionsByUser.forEach((session, userId) => {
        const activeZoneIds = new Set();
        session.activeRoleIds.forEach(roleId => {
            const zones = zonesByRole.get(Number(roleId));
            if (zones) zones.forEach(zoneId => activeZoneIds.add(Number(zoneId)));
        });
        if (activeZoneIds.size) {
            accessByUser.set(Number(userId), {
                userId: Number(userId),
                activeRoleIds: session.activeRoleIds,
                activeZoneIds
            });
        }
    });

    return accessByUser;
}

async function getActiveResponsibleCountsByMesa(req, rows = [], excludingUserId = 0) {
    const mesaIds = [...new Set(rows.map(row => Number(row.mesa_id || 0)).filter(id => id > 0))];
    if (!mesaIds.length) return new Map();

    const accessByUser = await getActiveOperationalZoneAccessByUser(req);
    if (!accessByUser.size) return new Map();

    const placeholders = mesaIds.map(() => '?').join(',');
    const responsibles = await database.all(`
        SELECT mesa_id, usuario_id
        FROM mesa_responsables
        WHERE mesa_id IN (${placeholders})
    `, mesaIds);

    const zoneByMesa = rows.reduce((acc, row) => {
        acc.set(Number(row.mesa_id), Number(row.zona_id || 0));
        return acc;
    }, new Map());
    const counts = new Map();
    const counted = new Set();
    const excludeId = Number(excludingUserId || 0);

    responsibles.forEach(row => {
        const mesaId = Number(row.mesa_id || 0);
        const userId = Number(row.usuario_id || 0);
        const zonaId = Number(zoneByMesa.get(mesaId) || 0);
        if (!mesaId || !userId || userId === excludeId || !zonaId) return;

        const userAccess = accessByUser.get(userId);
        if (!userAccess || !userAccess.activeZoneIds.has(zonaId)) return;

        const key = `${mesaId}:${userId}`;
        if (counted.has(key)) return;
        counted.add(key);
        counts.set(mesaId, Number(counts.get(mesaId) || 0) + 1);
    });

    return counts;
}

async function getRoleChangeBlockStatus(userId, options = {}) {
    const numericUserId = Number(userId || 0);
    const targetZoneIds = Array.isArray(options.targetZoneIds)
        ? new Set(options.targetZoneIds.map(id => Number(id)).filter(id => id > 0))
        : null;

    if (!numericUserId) {
        return {
            bloqueado: false,
            cuentas_pendientes: 0,
            puestos_ocupados: 0,
            responsabilidades_activas: 0,
            responsabilidades_compartidas: 0,
            responsabilidades_unicas: 0,
            responsabilidades_a_liberar: 0,
            mesas_bloqueantes: [],
            mensaje: null
        };
    }

    const rows = await database.all(`
        SELECT
            m.id AS mesa_id,
            m.numero,
            m.zona_id,
            COALESCE(z.nombre, CASE
                WHEN LOWER(COALESCE(m.zona, 'salon')) = 'bar' AND LOWER(COALESCE(m.tipo_asiento, 'mesa')) = 'banco' THEN 'Barra'
                WHEN LOWER(COALESCE(m.zona, 'salon')) = 'bar' THEN 'Bar'
                ELSE 'Salón'
            END) AS zona_nombre,
            COALESCE(tp.nombre, CASE
                WHEN LOWER(COALESCE(m.tipo_asiento, 'mesa')) = 'banco' THEN 'Banco'
                ELSE 'Mesa'
            END) AS tipo_puesto_nombre,
            m.estado,
            COALESCE(pendientes.cuentas_pendientes, 0) AS cuentas_pendientes,
            (
                SELECT COUNT(DISTINCT mr2.usuario_id)
                FROM mesa_responsables mr2
                INNER JOIN usuarios u2 ON u2.id = mr2.usuario_id AND u2.activo = 1
                WHERE mr2.mesa_id = m.id
            ) AS responsables_activos
        FROM mesa_responsables mr
        INNER JOIN mesas m ON m.id = mr.mesa_id
        LEFT JOIN zonas z ON z.id = m.zona_id
        LEFT JOIN tipos_puesto tp ON tp.id = m.tipo_puesto_id
        LEFT JOIN (
            SELECT mesa_id, COUNT(DISTINCT id) AS cuentas_pendientes
            FROM pedidos
            WHERE estado = 'pendiente'
            GROUP BY mesa_id
        ) pendientes ON pendientes.mesa_id = m.id
        WHERE mr.usuario_id = ?
          AND COALESCE(m.activo, 1) = 1
          AND (m.estado IN ('ocupada', 'reservada') OR COALESCE(pendientes.cuentas_pendientes, 0) > 0)
        ORDER BY z.orden ASC, m.numero ASC
    `, [numericUserId]);

    const activeRows = rows.filter(row => Number(row.cuentas_pendientes || 0) > 0 || ['ocupada', 'reservada'].includes(String(row.estado || '').toLowerCase()));
    const otherActiveResponsiblesByMesa = await getActiveResponsibleCountsByMesa(options.req, activeRows, numericUserId);
    const rowsOutsideTarget = targetZoneIds
        ? activeRows.filter(row => !targetZoneIds.has(Number(row.zona_id || 0)))
        : [];
    const rowsToEvaluate = targetZoneIds ? rowsOutsideTarget : [];
    const uniqueRows = rowsToEvaluate.filter(row => Number(otherActiveResponsiblesByMesa.get(Number(row.mesa_id)) || 0) <= 0);
    const sharedRows = rowsToEvaluate.filter(row => Number(otherActiveResponsiblesByMesa.get(Number(row.mesa_id)) || 0) > 0);
    const pendingTotal = activeRows.reduce((sum, row) => sum + Number(row.cuentas_pendientes || 0), 0);
    const occupiedTotal = activeRows.filter(row => String(row.estado || '').toLowerCase() === 'ocupada').length;
    const allUniqueRows = activeRows.filter(row => Number(otherActiveResponsiblesByMesa.get(Number(row.mesa_id)) || 0) <= 0);
    const allSharedRows = activeRows.filter(row => Number(otherActiveResponsiblesByMesa.get(Number(row.mesa_id)) || 0) > 0);

    return {
        bloqueado: uniqueRows.length > 0,
        cuentas_pendientes: pendingTotal,
        puestos_ocupados: occupiedTotal,
        responsabilidades_activas: activeRows.length,
        responsabilidades_compartidas: allSharedRows.length,
        responsabilidades_unicas: allUniqueRows.length,
        responsabilidades_a_liberar: sharedRows.length,
        mesas_bloqueantes: uniqueRows.map(row => ({
            mesa_id: Number(row.mesa_id),
            numero: Number(row.numero),
            zona_id: Number(row.zona_id || 0),
            zona_nombre: row.zona_nombre,
            tipo_puesto_nombre: row.tipo_puesto_nombre,
            estado: row.estado,
            cuentas_pendientes: Number(row.cuentas_pendientes || 0)
        })),
        mensaje: uniqueRows.length > 0
            ? 'No se puede cambiar de rol porque hay mesas/cuentas activas donde este usuario quedaría sin otro responsable con sesión operativa activa en esa zona. Un administrador debe agregar otro responsable activo desde Zonas o cerrar la cuenta.'
            : null
    };
}

async function verifyAdminPasswordForRoleChange(req, password) {
    if (!password) {
        return { error: 'Se requiere contraseña de administrador para autorizar el cambio de rol.' };
    }

    if (isAdminVerificationBlocked(req)) {
        return { error: 'Demasiados intentos. Intente de nuevo en unos minutos.', status: 429 };
    }

    const admins = await database.all(
        'SELECT id, nombre, password FROM usuarios WHERE tipo = ? AND activo = 1',
        ['administrador']
    );

    for (const admin of admins) {
        if (await bcrypt.compare(String(password || ''), admin.password)) {
            clearAdminVerificationFailures(req);
            return { admin: { id: Number(admin.id), nombre: admin.nombre } };
        }
    }

    registerAdminVerificationFailure(req);
    return { error: 'Contraseña de administrador incorrecta', status: 401 };
}

async function releaseSharedMesaResponsibilitiesForUser(userId, authorizedByAdmin = null, options = {}) {
    const numericUserId = Number(userId || 0);
    const targetZoneIds = Array.isArray(options.targetZoneIds)
        ? new Set(options.targetZoneIds.map(id => Number(id)).filter(id => id > 0))
        : new Set();
    if (!numericUserId) return { removed: [] };

    const rows = await database.all(`
        SELECT
            m.id AS mesa_id,
            m.numero,
            m.zona_id,
            COALESCE(z.nombre, CASE
                WHEN LOWER(COALESCE(m.zona, 'salon')) = 'bar' AND LOWER(COALESCE(m.tipo_asiento, 'mesa')) = 'banco' THEN 'Barra'
                WHEN LOWER(COALESCE(m.zona, 'salon')) = 'bar' THEN 'Bar'
                ELSE 'Salón'
            END) AS zona_nombre,
            COALESCE(tp.nombre, CASE
                WHEN LOWER(COALESCE(m.tipo_asiento, 'mesa')) = 'banco' THEN 'Banco'
                ELSE 'Mesa'
            END) AS tipo_puesto_nombre
        FROM mesa_responsables mr
        INNER JOIN mesas m ON m.id = mr.mesa_id
        LEFT JOIN zonas z ON z.id = m.zona_id
        LEFT JOIN tipos_puesto tp ON tp.id = m.tipo_puesto_id
        WHERE mr.usuario_id = ?
          AND COALESCE(m.activo, 1) = 1
          AND (m.estado IN ('ocupada', 'reservada') OR EXISTS (
              SELECT 1 FROM pedidos p WHERE p.mesa_id = m.id AND p.estado = 'pendiente'
          ))
          AND (
              SELECT COUNT(DISTINCT mr2.usuario_id)
              FROM mesa_responsables mr2
              INNER JOIN usuarios u2 ON u2.id = mr2.usuario_id AND u2.activo = 1
              WHERE mr2.mesa_id = m.id
          ) > 1
    `, [numericUserId]);

    const otherActiveResponsiblesByMesa = await getActiveResponsibleCountsByMesa(options.req, rows, numericUserId);
    const rowsToRelease = rows.filter(row => !targetZoneIds.has(Number(row.zona_id || 0)) && Number(otherActiveResponsiblesByMesa.get(Number(row.mesa_id)) || 0) > 0);

    for (const row of rowsToRelease) {
        await database.run(
            'DELETE FROM mesa_responsables WHERE mesa_id = ? AND usuario_id = ?',
            [row.mesa_id, numericUserId]
        );

        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            [
                'responsabilidad_mesa_liberada_por_cambio_rol',
                numericUserId,
                `Usuario liberado automáticamente de ${row.tipo_puesto_nombre} ${row.numero} (${row.zona_nombre}) por cambio de roles activos${authorizedByAdmin?.nombre ? ` autorizado por ${authorizedByAdmin.nombre}` : ''}`,
                new Date().toISOString()
            ]
        );
    }

    return { removed: rowsToRelease };
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
        clearSessionActiveWorkRoles(req);
    }

    let activeRoles = [];
    const currentRoleIds = getSessionActiveWorkRoleIds(req);
    if (currentRoleIds.length) {
        activeRoles = selectableRoles.filter(role => currentRoleIds.includes(Number(role.id)));
        if (!activeRoles.length) {
            clearSessionActiveWorkRoles(req);
        } else if (!sameRoleSet(currentRoleIds, activeRoles.map(role => role.id))) {
            setSessionActiveWorkRoles(req, activeRoles);
        }
    }

    if (!activeRoles.length && selectableRoles.length === 1) {
        activeRoles = [selectableRoles[0]];
        setSessionActiveWorkRoles(req, activeRoles);
    }

    const requiresSelection = !activeRoles.length && selectableRoles.length > 1;
    const blockedWithoutRole = !isAdmin && !activeRoles.length && selectableRoles.length === 0;
    const canOperate = Boolean(activeRoles.length || isAdmin) && !requiresSelection && !blockedWithoutRole;
    const mode = activeRoles.length
        ? 'roles_trabajo'
        : (blockedWithoutRole ? 'bloqueado_sin_rol' : (isAdmin ? 'administrador_sin_rol' : 'pendiente'));

    return {
        activa: canOperate,
        puede_operar: canOperate,
        requiere_seleccion: requiresSelection,
        modo: mode,
        rol_trabajo: activeRoles[0] || null,
        roles_trabajo_activos: activeRoles,
        rol_trabajo_ids: activeRoles.map(role => Number(role.id)),
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
        clearSessionActiveWorkRoles(req);

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
        const activeRoles = Array.isArray(sesionOperativa.roles_trabajo_activos) ? sesionOperativa.roles_trabajo_activos : [];
        const activeRole = sesionOperativa.rol_trabajo || activeRoles[0] || null;
        const bloqueo = await getRoleChangeBlockStatus(req.session.userId, { req });

        res.json({
            success: true,
            data: {
                puede_cambiar: true,
                bloqueo,
                rol_trabajo_actual: activeRole,
                roles_trabajo_actuales: activeRoles,
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
        const selectedIds = normalizeRoleIds(
            req.body?.rol_trabajo_ids
            ?? req.body?.role_ids
            ?? req.body?.roles_trabajo_ids
            ?? req.body?.rol_trabajo_id
            ?? req.body?.roleId
        );

        if (!selectedIds.length) {
            return res.status(400).json({ error: 'Debe seleccionar al menos un rol de trabajo válido' });
        }

        const user = {
            id: req.session.userId,
            nombre: req.session.userName,
            tipo: req.session.userType
        };
        const rolesTrabajo = await getUserWorkRoles(req.session.userId);
        const selectableRoles = getSelectableWorkRoles(rolesTrabajo);
        const selectedRoles = selectableRoles.filter(role => selectedIds.includes(Number(role.id)));

        if (!selectedRoles.length || selectedRoles.length !== selectedIds.length) {
            return res.status(403).json({ error: 'Uno o más roles seleccionados no están disponibles para este usuario o no tienen zonas activas' });
        }

        const currentRoleIds = getSessionActiveWorkRoleIds(req);
        const currentRoles = selectableRoles.filter(role => currentRoleIds.includes(Number(role.id)));
        const isRoleChange = currentRoleIds.length > 0 && !sameRoleSet(currentRoleIds, selectedIds);
        const targetZoneIds = getActiveZoneIdsForRoles(selectedRoles);
        let adminAutorizador = null;
        let responsabilidadesLiberadas = [];

        if (isRoleChange) {
            const bloqueo = await getRoleChangeBlockStatus(req.session.userId, { targetZoneIds, req });
            if (bloqueo.bloqueado) {
                await database.run(
                    'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
                    [
                        'cambio_rol_bloqueado_responsabilidad_unica',
                        req.session.userId,
                        bloqueo.mensaje,
                        new Date().toISOString()
                    ]
                );

                return res.status(409).json({
                    error: bloqueo.mensaje || 'No se puede cambiar de rol porque el usuario quedaría como único responsable fuera de sus nuevos roles activos.',
                    code: 'ROLE_CHANGE_BLOCKED_SINGLE_RESPONSIBLE',
                    bloqueo
                });
            }

            if (req.session.userType !== 'administrador') {
                const verification = await verifyAdminPasswordForRoleChange(req, req.body?.admin_password || req.body?.adminPassword);
                if (verification.error) {
                    await database.run(
                        'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
                        [
                            'cambio_rol_rechazado_password_admin',
                            req.session.userId,
                            `Cambio de roles de ${currentRoles.map(role => role.nombre).join(' + ') || 'Sin rol'} a ${selectedRoles.map(role => role.nombre).join(' + ')} rechazado por autorización admin inválida`,
                            new Date().toISOString()
                        ]
                    );
                    return res.status(verification.status || 403).json({ error: verification.error });
                }
                adminAutorizador = verification.admin;
            }

            const releaseResult = await releaseSharedMesaResponsibilitiesForUser(req.session.userId, adminAutorizador, { targetZoneIds, req });
            responsabilidadesLiberadas = releaseResult.removed || [];
        }

        setSessionActiveWorkRoles(req, selectedRoles);

        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            [
                isRoleChange ? 'cambio_roles_trabajo' : 'seleccion_roles_trabajo',
                req.session.userId,
                isRoleChange
                    ? `Roles de trabajo cambiados de ${currentRoles.map(role => role.nombre).join(' + ') || 'Sin rol'} a ${selectedRoles.map(role => role.nombre).join(' + ')}${adminAutorizador?.nombre ? ` con autorización admin de ${adminAutorizador.nombre}` : ''}. Responsabilidades liberadas: ${responsabilidadesLiberadas.length}`
                    : `Roles de trabajo activos: ${selectedRoles.map(role => role.nombre).join(' + ')}`,
                new Date().toISOString()
            ]
        );

        const sesionOperativa = buildOperationalSession(req, user, rolesTrabajo);
        res.json({
            success: true,
            message: 'Roles de trabajo activos seleccionados',
            data: sesionOperativa,
            user: buildUserPayload(req, user, rolesTrabajo, sesionOperativa)
        });
    } catch (error) {
        console.error('Error seleccionando roles de trabajo activos:', error);
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
