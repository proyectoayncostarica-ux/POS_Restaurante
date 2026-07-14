const express = require('express');
const database = require('../db/database');

const router = express.Router();

function normalizeSlug(value, fallback = 'mesa') {
    const rawValue = String(value || fallback).trim().toLowerCase();
    const normalized = rawValue
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ñ/g, 'n')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    return normalized || fallback;
}

function legacyZoneSlugForSeat({ zona, tipo_asiento } = {}) {
    const zonaSlug = normalizeSlug(zona || 'salon', 'salon');
    const tipoSlug = normalizeSlug(tipo_asiento || 'mesa', 'mesa');

    if (zonaSlug === 'bar' && tipoSlug === 'banco') return 'barra';
    if (zonaSlug === 'barra') return 'barra';
    return zonaSlug;
}

function legacySeatTypeSlug({ tipo_asiento } = {}) {
    return normalizeSlug(tipo_asiento || 'mesa', 'mesa');
}

function legacySeatName(mesa = {}) {
    const zona = String(mesa.zona || '').toLowerCase();
    const tipo = String(mesa.tipo_asiento || 'mesa').toLowerCase();
    return zona === 'bar' && tipo === 'banco' ? 'banco' : 'mesa';
}

async function getDynamicZoneAndTypeIds({ zona, tipo_asiento }) {
    const zonaSlug = legacyZoneSlugForSeat({ zona, tipo_asiento });
    const tipoSlug = legacySeatTypeSlug({ tipo_asiento });

    let [zonaRow, tipoRow] = await Promise.all([
        database.get('SELECT id FROM zonas WHERE slug = ? AND activa = 1', [zonaSlug]),
        database.get('SELECT id FROM tipos_puesto WHERE slug = ? AND activo = 1', [tipoSlug])
    ]);

    if (!zonaRow?.id || !tipoRow?.id) {
        await database.ensureDynamicModelConsistency();
        [zonaRow, tipoRow] = await Promise.all([
            database.get('SELECT id FROM zonas WHERE slug = ? AND activa = 1', [zonaSlug]),
            database.get('SELECT id FROM tipos_puesto WHERE slug = ? AND activo = 1', [tipoSlug])
        ]);
    }

    return {
        zona_id: zonaRow?.id || null,
        tipo_puesto_id: tipoRow?.id || null,
        zona_slug: zonaSlug,
        tipo_puesto_slug: tipoSlug
    };
}


function requireAdmin(req, res, next) {
    if (req.session?.userType === 'administrador') {
        return next();
    }

    return res.status(403).json({ error: 'Solo un administrador puede modificar la estructura del local' });
}

function toBooleanFlag(value, defaultValue = true) {
    if (value === undefined || value === null || value === '') return defaultValue ? 1 : 0;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'number') return value ? 1 : 0;

    const normalized = String(value).trim().toLowerCase();
    return ['1', 'true', 'si', 'sí', 'on', 'yes'].includes(normalized) ? 1 : 0;
}

function toOptionalOverride(value) {
    if (value === undefined || value === null || value === '' || value === 'heredar') return null;
    return toBooleanFlag(value, false);
}

function toInteger(value, defaultValue = 0) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : defaultValue;
}

function toServicePercentage(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 10;
    return Math.min(Math.max(parsed, 0), 100);
}

function validateName(nombre, label = 'nombre') {
    const cleanName = String(nombre || '').trim().replace(/\s+/g, ' ');

    if (!cleanName) {
        return { error: `El ${label} es requerido` };
    }

    if (cleanName.length < 2) {
        return { error: `El ${label} debe tener al menos 2 caracteres` };
    }

    if (cleanName.length > 40) {
        return { error: `El ${label} no debe superar 40 caracteres` };
    }

    return { nombre: cleanName };
}

function buildLegacySeatValuesFromDynamic(zone = {}, seatType = {}) {
    const zoneSlug = normalizeSlug(zone.slug || zone.nombre || 'salon', 'salon');
    const typeSlug = normalizeSlug(seatType.slug || seatType.nombre || 'mesa', 'mesa');

    let legacyZone = zoneSlug;
    if (zoneSlug === 'barra') {
        legacyZone = 'bar';
    }

    return {
        zona: legacyZone,
        tipo_asiento: typeSlug,
        es_banco: typeSlug === 'banco'
    };
}

async function getActiveDynamicZoneAndType({ zona_id, tipo_puesto_id }) {
    const zoneId = toInteger(zona_id, 0);
    const seatTypeId = toInteger(tipo_puesto_id, 0);

    if (!zoneId || !seatTypeId) {
        return { error: 'Debe seleccionar una zona y un tipo de puesto válidos' };
    }

    const [zone, seatType] = await Promise.all([
        database.get('SELECT * FROM zonas WHERE id = ? AND activa = 1', [zoneId]),
        database.get('SELECT * FROM tipos_puesto WHERE id = ? AND activo = 1', [seatTypeId])
    ]);

    if (!zone) {
        return { error: 'La zona seleccionada no existe o está inactiva' };
    }

    if (!seatType) {
        return { error: 'El tipo de puesto seleccionado no existe o está inactivo' };
    }

    return { zone, seatType };
}

async function getWorkRolesWithZones() {
    const [roles, links] = await Promise.all([
        database.all(`
            SELECT
                rt.*,
                COUNT(rtz.zona_id) AS zonas_total,
                SUM(CASE WHEN z.activa = 1 THEN 1 ELSE 0 END) AS zonas_activas
            FROM roles_trabajo rt
            LEFT JOIN rol_trabajo_zonas rtz ON rtz.rol_trabajo_id = rt.id
            LEFT JOIN zonas z ON z.id = rtz.zona_id
            GROUP BY rt.id
            ORDER BY rt.activo DESC, rt.nombre ASC
        `),
        database.all(`
            SELECT
                rtz.rol_trabajo_id,
                z.id,
                z.nombre,
                z.slug,
                z.icono,
                z.color,
                z.activa
            FROM rol_trabajo_zonas rtz
            INNER JOIN zonas z ON z.id = rtz.zona_id
            ORDER BY z.orden ASC, z.nombre ASC
        `)
    ]);

    const zonesByRole = links.reduce((acc, zone) => {
        if (!acc.has(zone.rol_trabajo_id)) acc.set(zone.rol_trabajo_id, []);
        acc.get(zone.rol_trabajo_id).push(zone);
        return acc;
    }, new Map());

    return roles.map(role => ({
        ...role,
        zonas: zonesByRole.get(role.id) || []
    }));
}

function normalizeZoneIds(value) {
    const rawList = Array.isArray(value) ? value : [value];
    const ids = rawList
        .flatMap(item => String(item ?? '').split(','))
        .map(item => toInteger(item, 0))
        .filter(id => id > 0);

    return [...new Set(ids)];
}

async function validateActiveZoneIds(zoneIds = []) {
    if (!zoneIds.length) {
        return { error: 'Debe seleccionar al menos una zona activa para este rol de trabajo' };
    }

    const placeholders = zoneIds.map(() => '?').join(',');
    const zones = await database.all(`
        SELECT id, nombre, activa
        FROM zonas
        WHERE id IN (${placeholders})
    `, zoneIds);

    const foundIds = new Set(zones.map(zone => Number(zone.id)));
    const missingIds = zoneIds.filter(id => !foundIds.has(id));

    if (missingIds.length) {
        return { error: 'El rol de trabajo contiene zonas inexistentes. Seleccione zonas creadas en el sistema.' };
    }

    const inactiveZones = zones.filter(zone => Number(zone.activa) !== 1);
    if (inactiveZones.length) {
        return { error: `No se pueden asignar zonas inactivas: ${inactiveZones.map(zone => zone.nombre).join(', ')}` };
    }

    return { zones };
}

async function replaceWorkRoleZones(roleId, zoneIds) {
    await database.run('DELETE FROM rol_trabajo_zonas WHERE rol_trabajo_id = ?', [roleId]);

    for (const zoneId of zoneIds) {
        await database.run(
            'INSERT INTO rol_trabajo_zonas (rol_trabajo_id, zona_id, creado_en) VALUES (?, ?, ?)',
            [roleId, zoneId, new Date().toISOString()]
        );
    }
}

function isAdminSession(req) {
    return req.session?.userType === 'administrador';
}

function getSessionUserId(req) {
    return Number(req.session?.userId || 0);
}

function getSessionActiveWorkRoleIds(req) {
    const multiIds = Array.isArray(req.session?.activeWorkRoleIds) ? req.session.activeWorkRoleIds : [];
    const ids = multiIds.map(id => Number(id)).filter(id => Number.isFinite(id) && id > 0);
    if (ids.length) return [...new Set(ids)];
    const legacyId = Number(req.session?.activeWorkRoleId || 0);
    return legacyId > 0 ? [legacyId] : [];
}

async function getSessionActiveWorkRoleIdForMesa(req, mesaId) {
    const roleIds = getSessionActiveWorkRoleIds(req);
    if (!roleIds.length) return null;

    const mesa = await database.get('SELECT zona_id FROM mesas WHERE id = ?', [mesaId]);
    const zonaId = Number(mesa?.zona_id || 0);
    if (!zonaId) return roleIds[0];

    const placeholders = roleIds.map(() => '?').join(',');
    const role = await database.get(`
        SELECT rtz.rol_trabajo_id
        FROM rol_trabajo_zonas rtz
        WHERE rtz.zona_id = ?
          AND rtz.rol_trabajo_id IN (${placeholders})
        ORDER BY rtz.rol_trabajo_id ASC
        LIMIT 1
    `, [zonaId, ...roleIds]);

    return Number(role?.rol_trabajo_id || roleIds[0]) || null;
}


async function getSessionPermittedZoneIds(req) {
    if (isAdminSession(req)) return null;

    const roleIds = getSessionActiveWorkRoleIds(req);
    if (!roleIds.length) return [];

    const placeholders = roleIds.map(() => '?').join(',');
    const rows = await database.all(`
        SELECT DISTINCT z.id
        FROM rol_trabajo_zonas rtz
        INNER JOIN roles_trabajo rt ON rt.id = rtz.rol_trabajo_id AND rt.activo = 1
        INNER JOIN zonas z ON z.id = rtz.zona_id AND z.activa = 1
        INNER JOIN usuario_roles_trabajo urt ON urt.rol_trabajo_id = rt.id AND urt.usuario_id = ?
        WHERE rtz.rol_trabajo_id IN (${placeholders})
    `, [getSessionUserId(req), ...roleIds]);

    return rows.map(row => Number(row.id)).filter(id => id > 0);
}

async function canAccessMesaZone(req, mesa = {}) {
    if (isAdminSession(req)) return true;

    const zonaId = Number(mesa.zona_id || mesa.zona_dinamica_id || 0);
    if (!getSessionUserId(req) || !zonaId) return false;

    const zoneIds = await getSessionPermittedZoneIds(req);
    return Array.isArray(zoneIds) && zoneIds.includes(zonaId);
}

async function requireMesaZoneAccess(req, res, mesa = {}) {
    if (await canAccessMesaZone(req, mesa)) return true;

    res.status(403).json({
        error: 'No tienes un rol de trabajo activo para operar esta zona.',
        code: 'ZONE_NOT_ALLOWED'
    });
    return false;
}

async function buildTablesAccessFilter(req, baseWhere = 'WHERE COALESCE(m.activo, 1) = 1', baseParams = []) {
    const params = [...baseParams];
    const clauses = [baseWhere.replace(/^WHERE\s+/i, '').trim()].filter(Boolean);

    if (!isAdminSession(req)) {
        const zoneIds = await getSessionPermittedZoneIds(req);
        if (!zoneIds.length) {
            clauses.push('1 = 0');
        } else {
            clauses.push(`m.zona_id IN (${zoneIds.map(() => '?').join(',')})`);
            params.push(...zoneIds);
        }
    }

    return {
        where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
        params
    };
}


function normalizeSessionRoleIds(value) {
    if (Array.isArray(value)) {
        return [...new Set(value.map(id => Number(id)).filter(id => Number.isFinite(id) && id > 0))];
    }

    if (typeof value === 'number') {
        return value > 0 ? [value] : [];
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return [];
        if (trimmed.startsWith('[')) {
            try {
                return normalizeSessionRoleIds(JSON.parse(trimmed));
            } catch (error) {
                return [];
            }
        }
        return [...new Set(trimmed.split(',').map(id => Number(id.trim())).filter(id => Number.isFinite(id) && id > 0))];
    }

    return [];
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

        const roleIds = normalizeSessionRoleIds(session.activeWorkRoleIds);
        const legacyRoleIds = normalizeSessionRoleIds(session.activeWorkRoleId);
        const activeRoleIds = [...new Set([...roleIds, ...legacyRoleIds])];
        if (!activeRoleIds.length) return;

        if (!activeByUser.has(userId)) {
            activeByUser.set(userId, { userId, activeRoleIds: new Set() });
        }

        const target = activeByUser.get(userId);
        activeRoleIds.forEach(roleId => target.activeRoleIds.add(Number(roleId)));
    });

    return activeByUser;
}

function parseRoleIdList(value) {
    return String(value || '')
        .split(',')
        .map(id => Number(id.trim()))
        .filter(id => Number.isFinite(id) && id > 0);
}

function getSeatDisplayName(mesa = {}) {
    const tipo = String(mesa.tipo_puesto_nombre || '').trim()
        || (String(mesa.tipo_asiento || '').toLowerCase() === 'banco' ? 'Banco' : 'Mesa');
    const zona = String(mesa.zona_nombre || '').trim()
        || (String(mesa.zona || '').toLowerCase() === 'bar' ? 'Bar' : 'Salón');
    return `${tipo} ${mesa.numero} (${zona})`;
}

async function logHistory(tipoAccion, usuarioId, descripcion) {
    await database.run(
        'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
        [tipoAccion, usuarioId || null, descripcion, new Date().toISOString()]
    );
}

async function getMesaWithDynamicData(mesaId) {
    return database.get(`
        SELECT
            m.*,
            z.nombre AS zona_nombre,
            z.slug AS zona_slug,
            tp.nombre AS tipo_puesto_nombre,
            tp.slug AS tipo_puesto_slug
        FROM mesas m
        LEFT JOIN zonas z ON z.id = m.zona_id
        LEFT JOIN tipos_puesto tp ON tp.id = m.tipo_puesto_id
        WHERE m.id = ?
    `, [mesaId]);
}

async function getMesaResponsibilitySummary(mesaId, currentUserId = 0) {
    const summary = await database.get(`
        SELECT
            COUNT(DISTINCT mr.usuario_id) AS responsables_total,
            SUM(CASE WHEN mr.usuario_id = ? THEN 1 ELSE 0 END) AS soy_responsable
        FROM mesa_responsables mr
        INNER JOIN usuarios u ON u.id = mr.usuario_id AND u.activo = 1
        WHERE mr.mesa_id = ?
    `, [Number(currentUserId || 0), mesaId]);

    return {
        responsables_total: Number(summary?.responsables_total || 0),
        soy_responsable: Number(summary?.soy_responsable || 0) > 0
    };
}

async function canOperateAssignedMesa(req, mesa) {
    if (!mesa) return false;
    if (isAdminSession(req)) return true;
    if (!(await canAccessMesaZone(req, mesa))) return false;

    const estado = String(mesa.estado || 'libre').toLowerCase();
    if (estado === 'libre') return true;

    const summary = await getMesaResponsibilitySummary(mesa.id, getSessionUserId(req));
    return summary.soy_responsable;
}

async function requireMesaOperationAccess(req, res, mesa) {
    if (!mesa) return false;

    if (!isAdminSession(req) && !(await canAccessMesaZone(req, mesa))) {
        return requireMesaZoneAccess(req, res, mesa);
    }

    const canOperate = await canOperateAssignedMesa(req, mesa);
    if (canOperate) return true;

    res.status(403).json({
        error: 'Responsable asignado. No puedes operar esta mesa/cuenta con tu usuario actual.',
        code: 'MESA_ASSIGNED_TO_OTHER_USER'
    });
    return false;
}

async function ensureMesaResponsibility(mesaId, req, actionLabel = 'asignar_responsable_mesa') {
    const userId = getSessionUserId(req);
    if (!userId) return;

    const summary = await getMesaResponsibilitySummary(mesaId, userId);
    if (summary.soy_responsable || summary.responsables_total > 0) return;

    await database.run(`
        INSERT OR IGNORE INTO mesa_responsables (
            mesa_id, usuario_id, rol_trabajo_id, asignado_por_usuario_id, fecha_asignacion
        ) VALUES (?, ?, ?, ?, ?)
    `, [mesaId, userId, await getSessionActiveWorkRoleIdForMesa(req, mesaId), userId, new Date().toISOString()]);

    await logHistory(
        actionLabel,
        userId,
        `Usuario asignado como responsable operativo de mesa/puesto #${mesaId}`
    );
}

async function clearMesaResponsibilities(mesaId) {
    await database.run('DELETE FROM mesa_responsables WHERE mesa_id = ?', [mesaId]);
}

async function getAssignableUsersForMesa(req, mesaId) {
    const mesa = await getMesaWithDynamicData(mesaId);
    if (!mesa) return { error: 'Mesa no encontrada' };

    const zonaId = Number(mesa.zona_id || 0);
    if (!zonaId) return { error: 'La mesa no tiene una zona dinámica válida para asignar responsables' };

    const activeSessionsByUser = await getActiveOperationalSessionsByUser(req);
    if (!activeSessionsByUser.size) {
        return {
            mesa,
            usuarios: [],
            warning: 'No hay usuarios con sesión operativa activa para esta zona'
        };
    }

    const users = await database.all(`
        SELECT
            u.id,
            u.nombre,
            u.tipo,
            CASE WHEN mr.usuario_id IS NULL THEN 0 ELSE 1 END AS asignado,
            GROUP_CONCAT(DISTINCT rt.id) AS roles_zona_ids
        FROM usuarios u
        INNER JOIN usuario_roles_trabajo urt ON urt.usuario_id = u.id
        INNER JOIN roles_trabajo rt ON rt.id = urt.rol_trabajo_id AND rt.activo = 1
        INNER JOIN rol_trabajo_zonas rtz ON rtz.rol_trabajo_id = rt.id AND rtz.zona_id = ?
        INNER JOIN zonas z ON z.id = rtz.zona_id AND z.activa = 1
        LEFT JOIN mesa_responsables mr ON mr.usuario_id = u.id AND mr.mesa_id = ?
        WHERE u.activo = 1
        GROUP BY u.id, u.nombre, u.tipo, mr.usuario_id
        ORDER BY u.tipo = 'administrador' DESC, u.nombre ASC
    `, [zonaId, mesaId]);

    const filteredUsers = users.filter(user => {
        const activeSession = activeSessionsByUser.get(Number(user.id));
        if (!activeSession) return false;

        const rolesForZone = parseRoleIdList(user.roles_zona_ids);
        return rolesForZone.some(roleId => activeSession.activeRoleIds.has(Number(roleId)));
    });

    return {
        mesa,
        usuarios: filteredUsers.map(user => ({
            id: Number(user.id),
            nombre: user.nombre,
            tipo: user.tipo,
            asignado: Number(user.asignado) === 1
        }))
    };
}

async function replaceMesaResponsibles(req, mesaId, userIds = [], adminUserId = null) {
    const normalizedIds = [...new Set(userIds.map(id => Number(id)).filter(id => id > 0))];
    if (!normalizedIds.length) {
        return { error: 'Debe quedar al menos un responsable asignado para una mesa/cuenta activa' };
    }

    const assignable = await getAssignableUsersForMesa(req, mesaId);
    if (assignable.error) return assignable;

    const validIds = new Set(assignable.usuarios.map(user => Number(user.id)));
    const invalidIds = normalizedIds.filter(id => !validIds.has(id));
    if (invalidIds.length) {
        return { error: 'Uno o más usuarios seleccionados no pueden ser responsables de esta zona' };
    }

    await database.run('DELETE FROM mesa_responsables WHERE mesa_id = ?', [mesaId]);
    for (const userId of normalizedIds) {
        await database.run(`
            INSERT INTO mesa_responsables (
                mesa_id, usuario_id, rol_trabajo_id, asignado_por_usuario_id, fecha_asignacion
            ) VALUES (?, ?, NULL, ?, ?)
        `, [mesaId, userId, adminUserId || null, new Date().toISOString()]);
    }

    return { usuarios_ids: normalizedIds, mesa: assignable.mesa };
}

function buildTablesSelect(whereClause = '', options = {}) {
    const currentUserId = Number(options.currentUserId || 0);
    const isAdmin = Boolean(options.isAdmin);

    return `
        SELECT
            m.*,
            z.id AS zona_dinamica_id,
            z.nombre AS zona_nombre,
            z.slug AS zona_slug,
            z.icono AS zona_icono,
            z.orden AS zona_orden,
            z.acepta_reservas AS zona_acepta_reservas,
            z.aplica_servicio AS zona_aplica_servicio,
            z.porcentaje_servicio AS zona_porcentaje_servicio,
            z.visible_dashboard AS zona_visible_dashboard,
            tp.id AS tipo_puesto_dinamico_id,
            tp.nombre AS tipo_puesto_nombre,
            tp.slug AS tipo_puesto_slug,
            tp.icono AS tipo_puesto_icono,
            CASE
                WHEN m.acepta_reservas_override IS NOT NULL THEN m.acepta_reservas_override
                ELSE COALESCE(z.acepta_reservas, 1)
            END AS acepta_reservas,
            CASE
                WHEN m.aplica_servicio_override IS NOT NULL THEN m.aplica_servicio_override
                ELSE COALESCE(z.aplica_servicio, 0)
            END AS aplica_servicio,
            COALESCE(z.porcentaje_servicio, 10) AS porcentaje_servicio,
            (
                SELECT COUNT(DISTINCT mr.usuario_id)
                FROM mesa_responsables mr
                INNER JOIN usuarios uresp ON uresp.id = mr.usuario_id AND uresp.activo = 1
                WHERE mr.mesa_id = m.id
            ) AS responsables_total,
            CASE WHEN ${currentUserId} > 0 AND EXISTS (
                SELECT 1 FROM mesa_responsables mr_user
                WHERE mr_user.mesa_id = m.id AND mr_user.usuario_id = ${currentUserId}
            ) THEN 1 ELSE 0 END AS soy_responsable,
            CASE
                WHEN m.estado = 'libre' THEN 1
                WHEN ${isAdmin ? 1 : 0} = 1 THEN 1
                WHEN ${currentUserId} > 0 AND EXISTS (
                    SELECT 1 FROM mesa_responsables mr_user
                    WHERE mr_user.mesa_id = m.id AND mr_user.usuario_id = ${currentUserId}
                ) THEN 1
                ELSE 0
            END AS puede_operar,
            CASE WHEN EXISTS (
                SELECT 1 FROM mesa_responsables mr_any WHERE mr_any.mesa_id = m.id
            ) THEN 1 ELSE 0 END AS responsable_asignado
        FROM mesas m
        LEFT JOIN zonas z ON z.id = m.zona_id
        LEFT JOIN tipos_puesto tp ON tp.id = m.tipo_puesto_id
        ${whereClause}
        ORDER BY
            COALESCE(z.orden, CASE LOWER(COALESCE(m.zona, 'salon')) WHEN 'salon' THEN 1 WHEN 'bar' THEN 2 ELSE 99 END),
            CASE LOWER(COALESCE(tp.slug, m.tipo_asiento, 'mesa')) WHEN 'mesa' THEN 1 WHEN 'banco' THEN 2 ELSE 50 END,
            m.numero ASC
    `;
}

// Obtener todas las mesas/puestos con metadata dinámica compatible
router.get('/', async (req, res) => {
    try {
        const accessFilter = await buildTablesAccessFilter(req);
        const mesas = await database.all(
            buildTablesSelect(accessFilter.where, { currentUserId: getSessionUserId(req), isAdmin: isAdminSession(req) }),
            accessFilter.params
        );
        res.json({ success: true, data: mesas });
    } catch (error) {
        console.error('Error obteniendo Zonas:', error);
        res.status(500).json({ error: 'Error interno del servidor1' });
    }
});

// Obtener estructura dinámica base: zonas y tipos de puesto.
// Esta lectura no cambia la operación actual; prepara futuras fases de Zonas dinámicas.
router.get('/structure', async (req, res) => {
    try {
        const permittedZoneIds = await getSessionPermittedZoneIds(req);
        const restrictStructure = !isAdminSession(req);
        const zoneFilterClause = restrictStructure
            ? (permittedZoneIds.length ? `WHERE z.id IN (${permittedZoneIds.map(() => '?').join(',')})` : 'WHERE 1 = 0')
            : '';
        const zoneFilterParams = restrictStructure ? permittedZoneIds : [];

        const zonas = await database.all(`
            SELECT
                z.*,
                COUNT(m.id) AS puestos_total,
                SUM(CASE WHEN m.estado = 'libre' THEN 1 ELSE 0 END) AS puestos_libres,
                SUM(CASE WHEN m.estado = 'ocupada' THEN 1 ELSE 0 END) AS puestos_ocupados,
                SUM(CASE WHEN m.estado = 'reservada' THEN 1 ELSE 0 END) AS puestos_reservados
            FROM zonas z
            LEFT JOIN mesas m ON m.zona_id = z.id AND COALESCE(m.activo, 1) = 1
            ${zoneFilterClause}
            GROUP BY z.id
            ORDER BY z.orden ASC, z.nombre ASC
        `, zoneFilterParams);

        const typeFilterClause = restrictStructure
            ? (permittedZoneIds.length ? `WHERE EXISTS (SELECT 1 FROM mesas m2 WHERE m2.tipo_puesto_id = tp.id AND m2.zona_id IN (${permittedZoneIds.map(() => '?').join(',')}) AND COALESCE(m2.activo, 1) = 1)` : 'WHERE 1 = 0')
            : '';
        const typeFilterParams = restrictStructure ? permittedZoneIds : [];

        const tiposPuesto = await database.all(`
            SELECT
                tp.*,
                COUNT(m.id) AS puestos_total
            FROM tipos_puesto tp
            LEFT JOIN mesas m ON m.tipo_puesto_id = tp.id AND COALESCE(m.activo, 1) = 1
            ${typeFilterClause}
            GROUP BY tp.id
            ORDER BY tp.orden ASC, tp.nombre ASC
        `, typeFilterParams);

        const [compatibilidad, rolesTrabajo] = await Promise.all([
            database.getDynamicModelCompatibilityReport(),
            restrictStructure ? Promise.resolve([]) : getWorkRolesWithZones()
        ]);

        res.json({
            success: true,
            data: {
                zonas,
                tipos_puesto: tiposPuesto,
                roles_trabajo: rolesTrabajo,
                compatibilidad
            }
        });
    } catch (error) {
        console.error('Error obteniendo estructura dinámica de zonas:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Validar compatibilidad entre datos legacy y modelo dinámico.
// No escribe datos: sirve para auditoría operativa antes de activar zonas 100% dinámicas.
router.get('/structure/compatibility', async (req, res) => {
    try {
        const report = await database.getDynamicModelCompatibilityReport();
        res.json({ success: true, data: report });
    } catch (error) {
        console.error('Error validando compatibilidad dinámica de zonas:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});


// Crear zona dinámica del local.
// v2.2.4.5: administración base de estructura, sin activar aún filtros/permisos avanzados por zona.
router.post('/zones', requireAdmin, async (req, res) => {
    try {
        const payload = validateName(req.body?.nombre, 'nombre de la zona');
        if (payload.error) return res.status(400).json({ error: payload.error });

        const slug = normalizeSlug(payload.nombre, 'zona');
        const existing = await database.get('SELECT id FROM zonas WHERE slug = ? OR LOWER(nombre) = LOWER(?)', [slug, payload.nombre]);
        if (existing) {
            return res.status(409).json({ error: 'Ya existe una zona con ese nombre' });
        }

        const result = await database.run(`
            INSERT INTO zonas (
                nombre, slug, icono, color, orden, acepta_reservas,
                aplica_servicio, porcentaje_servicio, visible_dashboard,
                activa, creado_en, actualizado_en
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            payload.nombre,
            slug,
            String(req.body?.icono || 'fa-location-dot').trim() || 'fa-location-dot',
            String(req.body?.color || '#3498db').trim() || '#3498db',
            toInteger(req.body?.orden, 0),
            toBooleanFlag(req.body?.acepta_reservas, true),
            toBooleanFlag(req.body?.aplica_servicio, true),
            toServicePercentage(req.body?.porcentaje_servicio),
            toBooleanFlag(req.body?.visible_dashboard, true),
            toBooleanFlag(req.body?.activa, true),
            new Date().toISOString(),
            new Date().toISOString()
        ]);

        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['crear_zona_dinamica', req.session.userId, `Zona dinámica ${payload.nombre} creada`, new Date().toISOString()]
        );

        res.status(201).json({ success: true, data: { id: result.lastID, nombre: payload.nombre, slug } });
    } catch (error) {
        console.error('Error creando zona dinámica:', error);
        res.status(500).json({ error: 'Error interno creando zona' });
    }
});

// Actualizar zona dinámica. No elimina datos ni cambia puestos existentes.
router.put('/zones/:id', requireAdmin, async (req, res) => {
    try {
        const id = toInteger(req.params.id, 0);
        if (!id) return res.status(400).json({ error: 'Zona inválida' });

        const zone = await database.get('SELECT * FROM zonas WHERE id = ?', [id]);
        if (!zone) return res.status(404).json({ error: 'Zona no encontrada' });

        const payload = validateName(req.body?.nombre, 'nombre de la zona');
        if (payload.error) return res.status(400).json({ error: payload.error });

        const duplicate = await database.get('SELECT id FROM zonas WHERE LOWER(nombre) = LOWER(?) AND id != ?', [payload.nombre, id]);
        if (duplicate) {
            return res.status(409).json({ error: 'Ya existe otra zona con ese nombre' });
        }

        const nextActive = toBooleanFlag(req.body?.activa, true);
        if (!nextActive) {
            const activeUse = await database.get(`
                SELECT COUNT(*) AS count
                FROM mesas
                WHERE zona_id = ?
                  AND COALESCE(activo, 1) = 1
                  AND estado IN ('ocupada', 'reservada')
            `, [id]);

            if (Number(activeUse?.count || 0) > 0) {
                return res.status(409).json({ error: 'No se puede desactivar una zona con puestos ocupados o reservados' });
            }

            const linkedRoles = await database.get(`
                SELECT COUNT(*) AS count
                FROM rol_trabajo_zonas rtz
                INNER JOIN roles_trabajo rt ON rt.id = rtz.rol_trabajo_id
                WHERE rtz.zona_id = ?
                  AND rt.activo = 1
            `, [id]);

            if (Number(linkedRoles?.count || 0) > 0) {
                return res.status(409).json({ error: 'No se puede desactivar una zona asignada a roles de trabajo activos' });
            }
        }

        await database.run(`
            UPDATE zonas
            SET nombre = ?,
                icono = ?,
                color = ?,
                orden = ?,
                acepta_reservas = ?,
                aplica_servicio = ?,
                porcentaje_servicio = ?,
                visible_dashboard = ?,
                activa = ?,
                actualizado_en = ?
            WHERE id = ?
        `, [
            payload.nombre,
            String(req.body?.icono || zone.icono || 'fa-location-dot').trim() || 'fa-location-dot',
            String(req.body?.color || zone.color || '#3498db').trim() || '#3498db',
            toInteger(req.body?.orden, zone.orden || 0),
            toBooleanFlag(req.body?.acepta_reservas, zone.acepta_reservas === 1),
            toBooleanFlag(req.body?.aplica_servicio, zone.aplica_servicio === 1),
            toServicePercentage(req.body?.porcentaje_servicio ?? zone.porcentaje_servicio),
            toBooleanFlag(req.body?.visible_dashboard, zone.visible_dashboard === 1),
            nextActive,
            new Date().toISOString(),
            id
        ]);

        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['actualizar_zona_dinamica', req.session.userId, `Zona dinámica ${payload.nombre} actualizada`, new Date().toISOString()]
        );

        res.json({ success: true, message: 'Zona actualizada correctamente' });
    } catch (error) {
        console.error('Error actualizando zona dinámica:', error);
        res.status(500).json({ error: 'Error interno actualizando zona' });
    }
});

// Crear tipo de puesto dinámico.
router.post('/seat-types', requireAdmin, async (req, res) => {
    try {
        const payload = validateName(req.body?.nombre, 'nombre del tipo de puesto');
        if (payload.error) return res.status(400).json({ error: payload.error });

        const slug = normalizeSlug(payload.nombre, 'puesto');
        const existing = await database.get('SELECT id FROM tipos_puesto WHERE slug = ? OR LOWER(nombre) = LOWER(?)', [slug, payload.nombre]);
        if (existing) {
            return res.status(409).json({ error: 'Ya existe un tipo de puesto con ese nombre' });
        }

        const result = await database.run(`
            INSERT INTO tipos_puesto (nombre, slug, icono, orden, activo, creado_en, actualizado_en)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            payload.nombre,
            slug,
            String(req.body?.icono || 'fa-chair').trim() || 'fa-chair',
            toInteger(req.body?.orden, 0),
            toBooleanFlag(req.body?.activo, true),
            new Date().toISOString(),
            new Date().toISOString()
        ]);

        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['crear_tipo_puesto', req.session.userId, `Tipo de puesto ${payload.nombre} creado`, new Date().toISOString()]
        );

        res.status(201).json({ success: true, data: { id: result.lastID, nombre: payload.nombre, slug } });
    } catch (error) {
        console.error('Error creando tipo de puesto:', error);
        res.status(500).json({ error: 'Error interno creando tipo de puesto' });
    }
});

// Actualizar tipo de puesto dinámico.
router.put('/seat-types/:id', requireAdmin, async (req, res) => {
    try {
        const id = toInteger(req.params.id, 0);
        if (!id) return res.status(400).json({ error: 'Tipo de puesto inválido' });

        const seatType = await database.get('SELECT * FROM tipos_puesto WHERE id = ?', [id]);
        if (!seatType) return res.status(404).json({ error: 'Tipo de puesto no encontrado' });

        const payload = validateName(req.body?.nombre, 'nombre del tipo de puesto');
        if (payload.error) return res.status(400).json({ error: payload.error });

        const duplicate = await database.get('SELECT id FROM tipos_puesto WHERE LOWER(nombre) = LOWER(?) AND id != ?', [payload.nombre, id]);
        if (duplicate) {
            return res.status(409).json({ error: 'Ya existe otro tipo de puesto con ese nombre' });
        }

        const nextActive = toBooleanFlag(req.body?.activo, true);
        if (!nextActive) {
            const linkedSeats = await database.get('SELECT COUNT(*) AS count FROM mesas WHERE tipo_puesto_id = ? AND COALESCE(activo, 1) = 1', [id]);
            if (Number(linkedSeats?.count || 0) > 0) {
                return res.status(409).json({ error: 'No se puede desactivar un tipo de puesto que tiene puestos activos' });
            }
        }

        await database.run(`
            UPDATE tipos_puesto
            SET nombre = ?,
                icono = ?,
                orden = ?,
                activo = ?,
                actualizado_en = ?
            WHERE id = ?
        `, [
            payload.nombre,
            String(req.body?.icono || seatType.icono || 'fa-chair').trim() || 'fa-chair',
            toInteger(req.body?.orden, seatType.orden || 0),
            nextActive,
            new Date().toISOString(),
            id
        ]);

        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['actualizar_tipo_puesto', req.session.userId, `Tipo de puesto ${payload.nombre} actualizado`, new Date().toISOString()]
        );

        res.json({ success: true, message: 'Tipo de puesto actualizado correctamente' });
    } catch (error) {
        console.error('Error actualizando tipo de puesto:', error);
        res.status(500).json({ error: 'Error interno actualizando tipo de puesto' });
    }
});

// Obtener roles de trabajo vinculados a zonas existentes.
router.get('/work-roles', requireAdmin, async (req, res) => {
    try {
        const rolesTrabajo = await getWorkRolesWithZones();
        res.json({ success: true, data: rolesTrabajo });
    } catch (error) {
        console.error('Error obteniendo roles de trabajo:', error);
        res.status(500).json({ error: 'Error interno obteniendo roles de trabajo' });
    }
});

// Crear rol de trabajo usando únicamente zonas activas existentes.
router.post('/work-roles', requireAdmin, async (req, res) => {
    try {
        const activeZones = await database.get('SELECT COUNT(*) AS count FROM zonas WHERE activa = 1');
        if (Number(activeZones?.count || 0) === 0) {
            return res.status(409).json({ error: 'Antes de crear roles de trabajo debe crear zonas activas del local' });
        }

        const payload = validateName(req.body?.nombre, 'nombre del rol de trabajo');
        if (payload.error) return res.status(400).json({ error: payload.error });

        const zoneIds = normalizeZoneIds(req.body?.zona_ids);
        const zoneValidation = await validateActiveZoneIds(zoneIds);
        if (zoneValidation.error) return res.status(400).json({ error: zoneValidation.error });

        const slug = normalizeSlug(payload.nombre, 'rol-trabajo');
        const existing = await database.get('SELECT id FROM roles_trabajo WHERE slug = ? OR LOWER(nombre) = LOWER(?)', [slug, payload.nombre]);
        if (existing) {
            return res.status(409).json({ error: 'Ya existe un rol de trabajo con ese nombre' });
        }

        const result = await database.run(`
            INSERT INTO roles_trabajo (nombre, slug, descripcion, activo, creado_en, actualizado_en)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [
            payload.nombre,
            slug,
            String(req.body?.descripcion || '').trim() || null,
            toBooleanFlag(req.body?.activo, true),
            new Date().toISOString(),
            new Date().toISOString()
        ]);

        await replaceWorkRoleZones(result.lastID, zoneIds);

        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['crear_rol_trabajo', req.session.userId, `Rol de trabajo ${payload.nombre} creado`, new Date().toISOString()]
        );

        res.status(201).json({ success: true, data: { id: result.lastID, nombre: payload.nombre, slug } });
    } catch (error) {
        console.error('Error creando rol de trabajo:', error);
        res.status(500).json({ error: 'Error interno creando rol de trabajo' });
    }
});

// Actualizar rol de trabajo y sus zonas vinculadas.
router.put('/work-roles/:id', requireAdmin, async (req, res) => {
    try {
        const id = toInteger(req.params.id, 0);
        if (!id) return res.status(400).json({ error: 'Rol de trabajo inválido' });

        const role = await database.get('SELECT * FROM roles_trabajo WHERE id = ?', [id]);
        if (!role) return res.status(404).json({ error: 'Rol de trabajo no encontrado' });

        const payload = validateName(req.body?.nombre, 'nombre del rol de trabajo');
        if (payload.error) return res.status(400).json({ error: payload.error });

        const zoneIds = normalizeZoneIds(req.body?.zona_ids);
        const zoneValidation = await validateActiveZoneIds(zoneIds);
        if (zoneValidation.error) return res.status(400).json({ error: zoneValidation.error });

        const duplicate = await database.get('SELECT id FROM roles_trabajo WHERE LOWER(nombre) = LOWER(?) AND id != ?', [payload.nombre, id]);
        if (duplicate) {
            return res.status(409).json({ error: 'Ya existe otro rol de trabajo con ese nombre' });
        }

        await database.run(`
            UPDATE roles_trabajo
            SET nombre = ?,
                descripcion = ?,
                activo = ?,
                actualizado_en = ?
            WHERE id = ?
        `, [
            payload.nombre,
            String(req.body?.descripcion || '').trim() || null,
            toBooleanFlag(req.body?.activo, role.activo === 1),
            new Date().toISOString(),
            id
        ]);

        await replaceWorkRoleZones(id, zoneIds);

        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['actualizar_rol_trabajo', req.session.userId, `Rol de trabajo ${payload.nombre} actualizado`, new Date().toISOString()]
        );

        res.json({ success: true, message: 'Rol de trabajo actualizado correctamente' });
    } catch (error) {
        console.error('Error actualizando rol de trabajo:', error);
        res.status(500).json({ error: 'Error interno actualizando rol de trabajo' });
    }
});

// Crear nuevo puesto compatible con el modelo dinámico.
// Mantiene compatibilidad con payload legacy: tipo_zona/tipo_asiento.
router.post('/', requireAdmin, async (req, res) => {
    try {
        let {
            tipo_zona,
            tipo_asiento,
            zona_id,
            tipo_puesto_id,
            numero,
            capacidad,
            nombre_visible,
            acepta_reservas_override,
            aplica_servicio_override
        } = req.body;

        numero = toInteger(numero, 0);
        capacidad = toInteger(capacidad, 0);

        let dynamicLinks;
        let zone;
        let seatType;
        let legacyValues;

        if (zona_id || tipo_puesto_id) {
            dynamicLinks = await getActiveDynamicZoneAndType({ zona_id, tipo_puesto_id });
            if (dynamicLinks.error) {
                return res.status(400).json({ error: dynamicLinks.error });
            }

            zone = dynamicLinks.zone;
            seatType = dynamicLinks.seatType;
            legacyValues = buildLegacySeatValuesFromDynamic(zone, seatType);
            tipo_zona = legacyValues.zona;
            tipo_asiento = legacyValues.tipo_asiento;
            zona_id = zone.id;
            tipo_puesto_id = seatType.id;
        } else {
            if (!tipo_zona || !numero || !capacidad) {
                return res.status(400).json({ error: 'Faltan datos obligatorios (tipo_zona, numero o capacidad)' });
            }

            tipo_zona = String(tipo_zona).toLowerCase();

            if (!['salon', 'bar'].includes(tipo_zona)) {
                return res.status(400).json({ error: 'Zona inválida' });
            }

            if (tipo_zona === 'salon') {
                tipo_asiento = 'mesa';
            }

            if (tipo_zona === 'bar') {
                if (!tipo_asiento || !['mesa', 'banco'].includes(String(tipo_asiento).toLowerCase())) {
                    return res.status(400).json({ error: 'Tipo de asiento inválido para zona bar' });
                }
                tipo_asiento = String(tipo_asiento).toLowerCase();
            }

            dynamicLinks = await getDynamicZoneAndTypeIds({ zona: tipo_zona, tipo_asiento });
            zona_id = dynamicLinks.zona_id;
            tipo_puesto_id = dynamicLinks.tipo_puesto_id;
        }

        if (!numero || numero < 1) {
            return res.status(400).json({ error: 'El número del puesto debe ser mayor a 0' });
        }

        if (String(tipo_asiento).toLowerCase() === 'banco') {
            capacidad = 1;
        }

        if (!capacidad || capacidad < 1 || capacidad > 99) {
            return res.status(400).json({ error: 'La capacidad debe estar entre 1 y 99 personas' });
        }

        if (!zona_id || !tipo_puesto_id) {
            return res.status(409).json({
                error: 'La estructura dinámica de zonas/puestos no está lista. Reinicie la app o revise la compatibilidad del modelo.'
            });
        }

        const existenteDinamico = await database.get(
            'SELECT id FROM mesas WHERE numero = ? AND zona_id = ? AND tipo_puesto_id = ? AND COALESCE(activo, 1) = 1',
            [numero, zona_id, tipo_puesto_id]
        );

        if (existenteDinamico) {
            return res.status(400).json({ error: 'Ya existe un puesto con ese número en esa zona y tipo' });
        }

        const existenteLegacy = await database.get(
            'SELECT id FROM mesas WHERE numero = ? AND zona = ? AND tipo_asiento = ? AND COALESCE(activo, 1) = 1',
            [numero, tipo_zona, tipo_asiento]
        );

        if (existenteLegacy) {
            return res.status(400).json({ error: 'Ya existe una mesa/banco con ese número en esa zona' });
        }

        const result = await database.run(
            `INSERT INTO mesas (
                numero, capacidad, estado, zona, tipo_asiento,
                zona_id, tipo_puesto_id, nombre_visible,
                acepta_reservas_override, aplica_servicio_override, activo
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                numero,
                capacidad,
                'libre',
                tipo_zona,
                tipo_asiento,
                zona_id,
                tipo_puesto_id,
                String(nombre_visible || '').trim() || null,
                toOptionalOverride(acepta_reservas_override),
                toOptionalOverride(aplica_servicio_override),
                1
            ]
        );

        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['crear_puesto', req.session.userId, `Puesto ${tipo_asiento} ${numero} creado`, new Date().toISOString()]
        );

        return res.status(201).json({
            success: true,
            data: {
                id: result.lastID,
                numero,
                capacidad,
                zona: tipo_zona,
                tipo_asiento,
                zona_id,
                tipo_puesto_id,
                estado: 'libre'
            }
        });
    } catch (error) {
        console.error('❌ Error al crear puesto:', error.message, error.stack);
        return res.status(500).json({ error: 'Error interno del servidor2' });
    }
});



// Actualizar mesa
router.put('/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        let { capacidad } = req.body;

        if (!capacidad) {
            return res.status(400).json({ error: 'La capacidad es requerida' });
        }

        capacidad = parseInt(capacidad);

        // Verificar que la mesa existe
        const mesa = await database.get('SELECT * FROM mesas WHERE id = ?', [id]);
        if (!mesa) {
            return res.status(404).json({ error: 'Mesa no encontrada' });
        }

        if (!(await requireMesaZoneAccess(req, res, mesa))) return;

        const esBanco = mesa.zona?.toLowerCase() === 'bar' && mesa.tipo_asiento?.toLowerCase() === 'banco';
        const tipoNombre = esBanco ? 'banco' : 'mesa';
        const tipoCapitalizado = tipoNombre.charAt(0).toUpperCase() + tipoNombre.slice(1);
        const verbo = tipoNombre === 'banco' ? 'actualizado' : 'actualizada';

        // Proteger banco: capacidad fija en 1
        if (esBanco && capacidad !== 1) {
            return res.status(400).json({ error: 'La capacidad de un banco no puede modificarse' });
        }

        // Actualizar capacidad
        await database.run(
            'UPDATE mesas SET capacidad = ? WHERE id = ?',
            [capacidad, id]
        );

        // Registrar en historial
        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            [
                `actualizar_${tipoNombre}`,
                req.session.userId,
                `Capacidad de ${tipoNombre} ${mesa.numero} actualizada`,
                new Date().toISOString()
            ]
        );

        res.json({ success: true, message: `${tipoCapitalizado} ${verbo} exitosamente` });

    } catch (error) {
        console.error('Error actualizando capacidad:', error);
        res.status(500).json({ error: 'Error actualizando capacidad' });
    }
});

// Eliminar mesa
router.delete('/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        // Obtener la mesa
        const mesa = await database.get('SELECT * FROM mesas WHERE id = ?', [id]);
        if (!mesa) {
            return res.status(404).json({ error: 'Zona no encontrada' });
        }

        const tipoNombre = mesa.zona?.toLowerCase() === 'bar' && mesa.tipo_asiento?.toLowerCase() === 'banco'
            ? 'banco'
            : 'mesa';

        // Verificar que no esté ocupada
        if (mesa.estado === 'ocupada') {
            return res.status(400).json({ error: `No se puede eliminar un ${tipoNombre} ocupado` });
        }

        // Verificar que no tenga pedidos pendientes
        const pedidosPendientes = await database.get(
            'SELECT COUNT(*) as count FROM pedidos WHERE mesa_id = ? AND estado = ?',
            [id, 'pendiente']
        );
        if (pedidosPendientes.count > 0) {
            return res.status(400).json({ error: `No se puede eliminar un ${tipoNombre} con pedidos pendientes` });
        }

        // ❗ Verificar si es el último (mayor número) dentro de su zona y tipo_asiento
        const result = await database.get(
            'SELECT MAX(numero) AS maxNumero FROM mesas WHERE zona = ? AND tipo_asiento = ?',
            [mesa.zona, mesa.tipo_asiento]
        );

        if (mesa.numero !== result.maxNumero) {
            return res.status(400).json({ error: `Solo se puede eliminar el ${tipoNombre} con el número más alto (${result.maxNumero})` });
        }

        // Eliminar mesa
        await database.run('DELETE FROM mesas WHERE id = ?', [id]);

        // Registrar historial
        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['eliminar_mesa', req.session.userId, `Eliminado ${tipoNombre} ${mesa.numero}`, new Date().toISOString()]
        );

        res.json({
            success: true,
            message: `${tipoNombre.charAt(0).toUpperCase() + tipoNombre.slice(1)} eliminado correctamente`
        });

    } catch (error) {
        console.error('Error eliminando mesa:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Abrir mesa (asignar cliente o reservar)
router.post('/:id/open', async (req, res) => {
    try {
        const { id } = req.params;
        const { cliente_nombre, estado, cantidad_personas, hora_estimada } = req.body;

        if (!cliente_nombre || !estado || !cantidad_personas) {
            return res.status(400).json({ error: 'Nombre del cliente, estado y cantidad de personas son requeridos' });
        }

        // Verificar que la mesa existe y está libre
        const mesa = await database.get('SELECT * FROM mesas WHERE id = ?', [id]);
        if (!mesa) {
            return res.status(404).json({ error: 'Mesa no encontrada' });
        }

        if (!(await requireMesaZoneAccess(req, res, mesa))) return;

        const esBanco = mesa.zona?.toLowerCase() === 'bar' && mesa.tipo_asiento?.toLowerCase() === 'banco';
        const tipoNombre = esBanco ? 'banco' : 'mesa';

        if (mesa.estado !== 'libre') {
            return res.status(400).json({ error: `El ${tipoNombre} no está disponible` });
        }

        let query;
        let params;
        let descripcionAccion;

        if (estado === 'reservada') {
            if (esBanco) {
                return res.status(400).json({ error: 'No se puede reservar un banco' });
            }

            query = `
                UPDATE mesas 
                SET estado = ?, cliente_nombre = ?, cantidad_personas = ?, hora_estimada = ? 
                WHERE id = ?
            `;
            params = [estado, cliente_nombre, cantidad_personas, hora_estimada, id];
            descripcionAccion = `${tipoNombre.charAt(0).toUpperCase() + tipoNombre.slice(1)} ${mesa.numero} reservada por ${cliente_nombre} para ${cantidad_personas} personas a las ${hora_estimada}`;
        } else if (estado === 'ocupada') {
            const personas = esBanco ? 1 : cantidad_personas;
            query = `
                UPDATE mesas 
                SET estado = ?, cliente_nombre = ?, fecha_apertura = ?, cantidad_personas = ? 
                WHERE id = ?
            `;
            params = [estado, cliente_nombre, new Date().toISOString(), personas, id];
            descripcionAccion = `${tipoNombre.charAt(0).toUpperCase() + tipoNombre.slice(1)} ${mesa.numero} abierta para ${cliente_nombre} con ${personas} personas`;
        } else {
            return res.status(400).json({ error: `Estado de ${tipoNombre} no válido` });
        }

        await database.run(query, params);
        await ensureMesaResponsibility(id, req, estado === 'reservada' ? 'responsable_reserva_asignado' : 'responsable_mesa_asignado');

        // Registrar en historial
        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            [
                estado === 'reservada' ? `reservar_${tipoNombre}` : `abrir_${tipoNombre}`,
                req.session.userId,
                descripcionAccion,
                new Date().toISOString()
            ]
        );

        res.json({
            success: true,
            message: `${tipoNombre.charAt(0).toUpperCase() + tipoNombre.slice(1)} ${estado === 'reservada' ? 'reservado' : 'abierto'} exitosamente`
        });

    } catch (error) {
        console.error('Error abriendo/reservando zona:', error);
        res.status(500).json({ error: 'Error interno del servidor4' });
    }
});

// Cerrar mesa (liberar)
router.post('/:id/close', async (req, res) => {
    try {
        const { id } = req.params;

        // Verificar que la mesa existe
        const mesa = await database.get('SELECT * FROM mesas WHERE id = ?', [id]);
        if (!mesa) {
            return res.status(404).json({ error: 'Mesa no encontrada' });
        }

        const esBanco = mesa.zona?.toLowerCase() === 'bar' && mesa.tipo_asiento?.toLowerCase() === 'banco';
        const tipoNombre = esBanco ? 'banco' : 'mesa';
        const tipoCapitalizado = tipoNombre.charAt(0).toUpperCase() + tipoNombre.slice(1);

        if (!(await requireMesaOperationAccess(req, res, mesa))) return;

        // Verificar pedidos pendientes solo si está ocupada
        if (mesa.estado === 'ocupada') {
            const pedidosPendientes = await database.get(
                'SELECT COUNT(*) as count FROM pedidos WHERE mesa_id = ? AND estado = ?',
                [id, 'pendiente']
            );

            if (pedidosPendientes.count > 0) {
                return res.status(400).json({ error: `No se puede cerrar un ${tipoNombre} con pedidos pendientes` });
            }
        }

        // Liberar mesa
        await database.run(
            `UPDATE mesas 
             SET estado = ?, cliente_nombre = NULL, fecha_apertura = NULL, 
                 cantidad_personas = NULL, hora_estimada = NULL 
             WHERE id = ?`,
            ['libre', id]
        );
        await clearMesaResponsibilities(id);

        // Registrar en historial
        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            [
                `cerrar_${tipoNombre}`,
                req.session.userId,
                `${tipoCapitalizado} ${mesa.numero} cerrada`,
                new Date().toISOString()
            ]
        );

        res.json({
            success: true,
            message: `${tipoCapitalizado} cerrada exitosamente`
        });

    } catch (error) {
        console.error('Error cerrando zona:', error);
        res.status(500).json({ error: 'Error interno del servidor5' });
    }
});

// Cambiar mesa de reservada a ocupada
router.post('/:id/change-to-occupied', async (req, res) => {
    try {
        const { id } = req.params;

        // Verificar que la mesa existe y está reservada
        const mesa = await database.get('SELECT * FROM mesas WHERE id = ?', [id]);
        if (!mesa) {
            return res.status(404).json({ error: 'Mesa no encontrada' });
        }

        const esBanco = mesa.zona?.toLowerCase() === 'bar' && mesa.tipo_asiento?.toLowerCase() === 'banco';
        const tipoNombre = esBanco ? 'banco' : 'mesa';
        const tipoCapitalizado = tipoNombre.charAt(0).toUpperCase() + tipoNombre.slice(1);

        if (!(await requireMesaOperationAccess(req, res, mesa))) return;

        if (esBanco) {
            return res.status(400).json({ error: 'Un banco no puede estar reservado ni cambiar a ocupada desde una reserva' });
        }

        if (mesa.estado !== 'reservada') {
            return res.status(400).json({ error: `El ${tipoNombre} no está reservado` });
        }

        await database.run(
            'UPDATE mesas SET estado = ?, fecha_apertura = ? WHERE id = ?',
            ['ocupada', new Date().toISOString(), id]
        );
        await ensureMesaResponsibility(id, req, 'responsable_mesa_confirmado');

        // Registrar en historial
        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            [
                'cambiar_estado_mesa',
                req.session.userId,
                `${tipoCapitalizado} ${mesa.numero} cambió de reservada a ocupada`,
                new Date().toISOString()
            ]
        );

        res.json({ success: true, message: `${tipoCapitalizado} cambiada a ocupada exitosamente` });

    } catch (error) {
        console.error('Error cambiando estado de mesa:', error);
        res.status(500).json({ error: 'Error interno del servidor6' });
    }
});


// Listar responsables asignables para una mesa/puesto activo.
router.get('/:id/responsibles', requireAdmin, async (req, res) => {
    try {
        const mesaId = toInteger(req.params.id, 0);
        if (!mesaId) return res.status(400).json({ error: 'Mesa inválida' });

        const data = await getAssignableUsersForMesa(req, mesaId);
        if (data.error) return res.status(400).json({ error: data.error });

        res.json({
            success: true,
            data: {
                mesa: data.mesa,
                usuarios: data.usuarios
            }
        });
    } catch (error) {
        console.error('Error obteniendo responsables asignables:', error);
        res.status(500).json({ error: 'Error interno obteniendo responsables' });
    }
});

// Reasignar responsables compartidos de una mesa/cuenta activa desde Zonas.
router.put('/:id/responsibles', requireAdmin, async (req, res) => {
    try {
        const mesaId = toInteger(req.params.id, 0);
        if (!mesaId) return res.status(400).json({ error: 'Mesa inválida' });

        const mesa = await getMesaWithDynamicData(mesaId);
        if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });

        const estado = String(mesa.estado || 'libre').toLowerCase();
        const pending = await database.get('SELECT COUNT(*) AS count FROM pedidos WHERE mesa_id = ? AND estado = ?', [mesaId, 'pendiente']);
        if (estado === 'libre' && Number(pending?.count || 0) === 0) {
            return res.status(409).json({ error: 'Solo se reasignan responsables en mesas/cuentas activas' });
        }

        const rawIds = req.body?.usuario_ids ?? req.body?.user_ids ?? req.body?.responsables_ids ?? [];
        const userIds = (Array.isArray(rawIds) ? rawIds : String(rawIds).split(','))
            .map(id => toInteger(id, 0))
            .filter(id => id > 0);

        const result = await replaceMesaResponsibles(req, mesaId, userIds, req.session.userId);
        if (result.error) return res.status(400).json({ error: result.error });

        const users = await database.all(
            `SELECT nombre FROM usuarios WHERE id IN (${result.usuarios_ids.map(() => '?').join(',')}) ORDER BY nombre ASC`,
            result.usuarios_ids
        );
        const userNames = users.map(user => user.nombre).join(', ');

        await logHistory(
            'reasignar_responsables_mesa',
            req.session.userId,
            `Responsables de ${getSeatDisplayName(mesa)} actualizados: ${userNames || 'sin usuarios'}`
        );

        res.json({
            success: true,
            message: 'Responsables actualizados correctamente',
            data: {
                usuarios_ids: result.usuarios_ids,
                usuarios_nombres: users.map(user => user.nombre)
            }
        });
    } catch (error) {
        console.error('Error reasignando responsables:', error);
        res.status(500).json({ error: 'Error interno reasignando responsables' });
    }
});

// Obtener el siguiente número disponible por zona/tipo dinámico o por compatibilidad legacy.
router.get('/next-numero', async (req, res) => {
    try {
        let { zona, tipo_asiento, zona_id, tipo_puesto_id } = req.query;

        if (zona_id || tipo_puesto_id) {
            const dynamicLinks = await getActiveDynamicZoneAndType({ zona_id, tipo_puesto_id });
            if (dynamicLinks.error) {
                return res.status(400).json({ error: dynamicLinks.error });
            }

            const result = await database.get(
                'SELECT MAX(numero) AS maxNumero FROM mesas WHERE zona_id = ? AND tipo_puesto_id = ? AND COALESCE(activo, 1) = 1',
                [dynamicLinks.zone.id, dynamicLinks.seatType.id]
            );

            return res.json({ numero: (result?.maxNumero || 0) + 1 });
        }

        if (!zona) {
            return res.status(400).json({ error: 'Zona requerida' });
        }

        zona = zona.toLowerCase();

        // Asignar tipo_asiento según zona
        if (zona === 'salon') {
            tipo_asiento = 'mesa';
        } else if (zona === 'bar') {
            if (!tipo_asiento) {
                return res.status(400).json({ error: 'Tipo de asiento requerido para zona bar' });
            }
            tipo_asiento = tipo_asiento.toLowerCase();
            if (!['mesa', 'banco'].includes(tipo_asiento)) {
                return res.status(400).json({ error: 'Tipo de asiento inválido' });
            }
        } else {
            return res.status(400).json({ error: 'Zona inválida' });
        }

        const result = await database.get(
            'SELECT MAX(numero) AS maxNumero FROM mesas WHERE zona = ? AND tipo_asiento = ? AND COALESCE(activo, 1) = 1',
            [zona, tipo_asiento]
        );

        const siguienteNumero = (result?.maxNumero || 0) + 1;

        res.json({ numero: siguienteNumero });

    } catch (error) {
        console.error('❌ Error en /next-numero:', error);
        res.status(500).json({ error: 'Error interno del servidor7' });
    }
});

// Obtener una mesa específica
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const mesa = await database.get(buildTablesSelect('WHERE m.id = ?', { currentUserId: getSessionUserId(req), isAdmin: isAdminSession(req) }), [id]);
        
        if (!mesa) {
            return res.status(404).json({ error: 'Zona no encontrada' });
        }

        if (!(await requireMesaZoneAccess(req, res, mesa))) return;

        res.json({ success: true, data: mesa });
    } catch (error) {
        console.error('Error obteniendo Zona:', error);
        res.status(500).json({ error: 'Error interno del servidor8' });
    }
});

module.exports = router;




