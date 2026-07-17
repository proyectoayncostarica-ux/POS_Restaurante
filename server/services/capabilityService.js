const database = require('../db/database');
const { CAPABILITY_DEFINITIONS } = require('../security/capabilities');

function normalizeCodes(values = []) {
    const raw = Array.isArray(values) ? values : [values];
    return [...new Set(raw.map(value => String(value || '').trim()).filter(Boolean))];
}

function normalizeRoleIds(values = []) {
    const raw = Array.isArray(values) ? values : [values];
    return [...new Set(raw.map(value => Number(value)).filter(value => Number.isInteger(value) && value > 0))];
}

function isAdminType(value = '') {
    const type = String(value || '').trim().toLowerCase();
    return type === 'administrador' || type === 'admin';
}

function allCapabilityCodes() {
    return CAPABILITY_DEFINITIONS.map(item => item.code);
}

async function getRoleCapabilities(roleIds = [], db = database) {
    const ids = normalizeRoleIds(roleIds);
    if (!ids.length) return [];

    const placeholders = ids.map(() => '?').join(',');
    const rows = await db.all(`
        SELECT DISTINCT c.codigo
        FROM rol_trabajo_capacidades rtc
        INNER JOIN capacidades c ON c.id = rtc.capacidad_id AND c.activa = 1
        INNER JOIN roles_trabajo rt ON rt.id = rtc.rol_trabajo_id AND rt.activo = 1
        WHERE rtc.rol_trabajo_id IN (${placeholders})
        ORDER BY c.codigo ASC
    `, ids);

    return rows.map(row => row.codigo);
}

async function getCapabilitiesForUser({ userId, userType, activeRoleIds = [] }, db = database) {
    if (isAdminType(userType)) return allCapabilityCodes();
    if (!Number(userId)) return [];

    const ids = normalizeRoleIds(activeRoleIds);
    if (!ids.length) return [];

    const placeholders = ids.map(() => '?').join(',');
    const rows = await db.all(`
        SELECT DISTINCT c.codigo
        FROM usuario_roles_trabajo urt
        INNER JOIN roles_trabajo rt ON rt.id = urt.rol_trabajo_id AND rt.activo = 1
        INNER JOIN rol_trabajo_capacidades rtc ON rtc.rol_trabajo_id = rt.id
        INNER JOIN capacidades c ON c.id = rtc.capacidad_id AND c.activa = 1
        WHERE urt.usuario_id = ?
          AND rt.id IN (${placeholders})
        ORDER BY c.codigo ASC
    `, [Number(userId), ...ids]);

    return rows.map(row => row.codigo);
}

function syncSessionCapabilities(req, codes = []) {
    const normalized = normalizeCodes(codes);
    if (req?.session) req.session.capabilities = normalized;
    return normalized;
}

function hasCapability(codes = [], requiredCode = '') {
    return normalizeCodes(codes).includes(String(requiredCode || '').trim());
}

async function resolveRequestCapabilities(req, db = database) {
    if (!req?.session?.userId) return [];
    const activeRoleIds = normalizeRoleIds([
        ...(Array.isArray(req.session.activeWorkRoleIds) ? req.session.activeWorkRoleIds : []),
        req.session.activeWorkRoleId
    ]);
    const codes = await getCapabilitiesForUser({
        userId: req.session.userId,
        userType: req.session.userType,
        activeRoleIds
    }, db);
    return syncSessionCapabilities(req, codes);
}

module.exports = {
    normalizeCodes,
    normalizeRoleIds,
    isAdminType,
    allCapabilityCodes,
    getRoleCapabilities,
    getCapabilitiesForUser,
    syncSessionCapabilities,
    hasCapability,
    resolveRequestCapabilities
};
