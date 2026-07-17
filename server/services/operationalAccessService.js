const database = require('../db/database');
const {
    allCapabilityCodes,
    getCapabilitiesForUser,
    normalizeRoleIds,
    isAdminType
} = require('./capabilityService');
const { CAPABILITIES } = require('../security/capabilities');

const SECTION_REQUIREMENTS = Object.freeze({
    dashboard: CAPABILITIES.ORDERS_OPERATE,
    tables: CAPABILITIES.ORDERS_OPERATE,
    menu: CAPABILITIES.ORDERS_OPERATE,
    orders: CAPABILITIES.ORDERS_OPERATE,
    accounts: CAPABILITIES.ORDERS_OPERATE,
    cash: CAPABILITIES.CASH_ACCESS,
    users: '__admin__',
    settings: '__admin__'
});

const REALTIME_SCOPE_RULES = Object.freeze({
    sesion: { targetedOnly: true },
    usuarios: { adminOnly: true, allowTarget: true },
    sistema: { adminOnly: true, allowTarget: true },
    estructura: { anyCapabilities: [CAPABILITIES.ORDERS_OPERATE], zoneAware: false },
    menu: { anyCapabilities: [CAPABILITIES.ORDERS_OPERATE], zoneAware: false },
    zonas: { anyCapabilities: [CAPABILITIES.ORDERS_OPERATE], zoneAware: true },
    responsabilidad: { anyCapabilities: [CAPABILITIES.ORDERS_OPERATE], zoneAware: true },
    pedidos: { anyCapabilities: [CAPABILITIES.ORDERS_OPERATE], zoneAware: true },
    comandas: { anyCapabilities: [CAPABILITIES.KITCHEN_OPERATE, CAPABILITIES.ORDERS_OPERATE], zoneAware: true },
    caja: { anyCapabilities: [CAPABILITIES.CASH_ACCESS], zoneAware: false },
    pagos: { anyCapabilities: [CAPABILITIES.CASH_ACCESS, CAPABILITIES.ORDERS_OPERATE], zoneAware: true, cashGlobal: true },
    cuentas: { anyCapabilities: [CAPABILITIES.CASH_ACCESS, CAPABILITIES.ORDERS_OPERATE], zoneAware: true, cashGlobal: true },
    creditos: { anyCapabilities: [CAPABILITIES.CASH_ACCESS, CAPABILITIES.ORDERS_OPERATE], zoneAware: false },
    operacion: { anyCapabilities: [CAPABILITIES.ORDERS_OPERATE, CAPABILITIES.CASH_ACCESS], zoneAware: true }
});

function normalizeNumericList(value) {
    if (value === null || value === undefined || value === '') return [];

    let normalized = value;
    if (typeof normalized === 'string') {
        const trimmed = normalized.trim();
        if (!trimmed) return [];
        if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || trimmed.includes(',')) {
            try {
                normalized = trimmed.startsWith('[') ? JSON.parse(trimmed) : trimmed.split(',');
            } catch (error) {
                normalized = trimmed.split(',');
            }
        }
    }

    const raw = Array.isArray(normalized) ? normalized : [normalized];
    return [...new Set(raw
        .flatMap(item => Array.isArray(item) ? item : [item])
        .map(item => Number(item))
        .filter(item => Number.isInteger(item) && item > 0))];
}

function normalizeCodes(values = []) {
    const raw = Array.isArray(values) ? values : [values];
    return [...new Set(raw.map(value => String(value || '').trim()).filter(Boolean))];
}

function getSessionRoleIds(session = {}) {
    return normalizeRoleIds([
        ...(Array.isArray(session.activeWorkRoleIds) ? session.activeWorkRoleIds : []),
        ...normalizeNumericList(session.activeWorkRoleId)
    ]);
}

function hasCapability(context = {}, capabilityCode = '') {
    if (context.isAdmin) return true;
    return normalizeCodes(context.capabilities).includes(String(capabilityCode || '').trim());
}

function hasAnyCapability(context = {}, capabilityCodes = []) {
    if (context.isAdmin) return true;
    const available = new Set(normalizeCodes(context.capabilities));
    return normalizeCodes(capabilityCodes).some(code => available.has(code));
}

function hasAllCapabilities(context = {}, capabilityCodes = []) {
    if (context.isAdmin) return true;
    const available = new Set(normalizeCodes(context.capabilities));
    return normalizeCodes(capabilityCodes).every(code => available.has(code));
}

async function getPermittedZoneIds({ userId, userType, activeRoleIds = [] }, db = database) {
    if (isAdminType(userType)) return null;

    const numericUserId = Number(userId || 0);
    const roleIds = normalizeRoleIds(activeRoleIds);
    if (!numericUserId || !roleIds.length) return [];

    const placeholders = roleIds.map(() => '?').join(',');
    const rows = await db.all(`
        SELECT DISTINCT z.id
        FROM rol_trabajo_zonas rtz
        INNER JOIN roles_trabajo rt ON rt.id = rtz.rol_trabajo_id AND rt.activo = 1
        INNER JOIN zonas z ON z.id = rtz.zona_id AND z.activa = 1
        INNER JOIN usuario_roles_trabajo urt
            ON urt.rol_trabajo_id = rt.id
           AND urt.usuario_id = ?
        WHERE rtz.rol_trabajo_id IN (${placeholders})
        ORDER BY z.id ASC
    `, [numericUserId, ...roleIds]);

    return rows.map(row => Number(row.id)).filter(id => Number.isInteger(id) && id > 0);
}

async function resolveAccessContext(source = {}, db = database, options = {}) {
    if (!options.force && source?.operationalAccess && source.operationalAccess.userId) {
        return source.operationalAccess;
    }

    const session = source.session || source;
    const userId = Number(session.userId || source.userId || 0) || null;
    const userType = String(session.userType || source.userType || '').trim().toLowerCase();
    const isAdmin = isAdminType(userType);
    const activeRoleIds = getSessionRoleIds(session);
    const capabilities = isAdmin
        ? allCapabilityCodes()
        : await getCapabilitiesForUser({ userId, userType, activeRoleIds }, db);
    const zoneIds = await getPermittedZoneIds({ userId, userType, activeRoleIds }, db);

    const context = {
        userId,
        userType,
        isAdmin,
        activeRoleIds,
        capabilities: normalizeCodes(capabilities),
        zoneIds,
        resolvedAt: new Date().toISOString()
    };

    if (source && source.session) {
        source.operationalAccess = context;
    }

    return context;
}

function buildPolicyFromOperationalSession(user = {}, operationalSession = {}) {
    const userType = String(user.tipo || user.userType || '').trim().toLowerCase();
    const isAdmin = isAdminType(userType);
    const activeRoles = Array.isArray(operationalSession.roles_trabajo_activos)
        ? operationalSession.roles_trabajo_activos
        : [];
    const capabilities = isAdmin
        ? allCapabilityCodes()
        : normalizeCodes(operationalSession.capacidades || user.capacidades || []);
    const zoneIds = isAdmin ? null : [...new Set(activeRoles.flatMap(role =>
        (Array.isArray(role.zonas) ? role.zonas : [])
            .filter(zone => Number(zone?.activa ?? 1) === 1)
            .map(zone => Number(zone.id))
            .filter(id => Number.isInteger(id) && id > 0)
    ))];

    const context = {
        userId: Number(user.id || 0) || null,
        userType,
        isAdmin,
        activeRoleIds: normalizeRoleIds(operationalSession.rol_trabajo_ids || activeRoles.map(role => role.id)),
        capabilities,
        zoneIds
    };

    const allowedSections = Object.keys(SECTION_REQUIREMENTS).filter(section => canOpenSection(context, section));
    const requestedDestination = operationalSession.destino_inicial || user.destino_inicial;
    const initialSection = requestedDestination && allowedSections.includes(requestedDestination)
        ? requestedDestination
        : (allowedSections.includes('dashboard') ? 'dashboard' : (allowedSections.includes('cash') ? 'cash' : allowedSections[0] || 'dashboard'));

    return {
        ...context,
        allowedSections,
        initialSection
    };
}

function canOpenSection(context = {}, sectionName = '') {
    const requirement = SECTION_REQUIREMENTS[String(sectionName || '').trim()];
    if (!requirement) return false;
    if (requirement === '__admin__') return Boolean(context.isAdmin);
    return hasCapability(context, requirement);
}

function canViewZone(context = {}, zoneId) {
    if (context.isAdmin) return true;
    const numericZoneId = Number(zoneId || 0);
    if (!numericZoneId) return false;
    return Array.isArray(context.zoneIds) && context.zoneIds.includes(numericZoneId);
}

function buildZoneFilter(context = {}, options = {}) {
    const alias = String(options.alias || 'm').replace(/[^a-zA-Z0-9_]/g, '') || 'm';
    const column = String(options.column || 'zona_id').replace(/[^a-zA-Z0-9_]/g, '') || 'zona_id';

    if (context.isAdmin) return { clause: '', params: [] };
    const zoneIds = normalizeNumericList(context.zoneIds);
    if (!zoneIds.length) return { clause: '1 = 0', params: [] };

    return {
        clause: `${alias}.${column} IN (${zoneIds.map(() => '?').join(',')})`,
        params: zoneIds
    };
}

async function getMesaSnapshot(mesaOrId, db = database) {
    if (mesaOrId && typeof mesaOrId === 'object') return mesaOrId;
    const mesaId = Number(mesaOrId || 0);
    if (!mesaId) return null;

    return db.get(`
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

async function getMesaResponsibility(mesaId, userId, db = database) {
    const row = await db.get(`
        SELECT
            COUNT(DISTINCT mr.usuario_id) AS responsables_total,
            SUM(CASE WHEN mr.usuario_id = ? THEN 1 ELSE 0 END) AS soy_responsable
        FROM mesa_responsables mr
        INNER JOIN usuarios u ON u.id = mr.usuario_id AND u.activo = 1
        WHERE mr.mesa_id = ?
    `, [Number(userId || 0), Number(mesaId || 0)]);

    return {
        total: Number(row?.responsables_total || 0),
        isResponsible: Number(row?.soy_responsable || 0) > 0
    };
}

async function evaluateMesaAccess(context = {}, mesaOrId, db = database) {
    const mesa = await getMesaSnapshot(mesaOrId, db);
    if (!mesa) {
        return {
            exists: false,
            visible: false,
            operable: false,
            isResponsible: false,
            mesa: null
        };
    }

    const visible = context.isAdmin || (hasCapability(context, CAPABILITIES.ORDERS_OPERATE) && canViewZone(context, mesa.zona_id));
    const responsibility = await getMesaResponsibility(mesa.id, context.userId, db);
    const state = String(mesa.estado || 'libre').trim().toLowerCase();
    const operable = Boolean(context.isAdmin || (
        visible
        && hasCapability(context, CAPABILITIES.ORDERS_OPERATE)
        && (state === 'libre' || responsibility.isResponsible)
    ));

    return {
        exists: true,
        visible,
        operable,
        isResponsible: responsibility.isResponsible,
        responsiblesTotal: responsibility.total,
        canSplit: operable && hasCapability(context, CAPABILITIES.ORDERS_SPLIT),
        canIssuePreinvoice: operable && hasCapability(context, CAPABILITIES.ORDERS_ISSUE_PREINVOICE),
        canFinalizeService: operable && hasCapability(context, CAPABILITIES.ORDERS_FINALIZE_SERVICE),
        canCollect: hasCapability(context, CAPABILITIES.CASH_COLLECT),
        mesa
    };
}

function isTargetUser(context = {}, payload = {}) {
    const userId = Number(context.userId || 0);
    if (!userId) return false;
    const targetIds = normalizeNumericList([
        ...(Array.isArray(payload.targetUserIds) ? payload.targetUserIds : []),
        ...(Array.isArray(payload.affectedUserIds) ? payload.affectedUserIds : []),
        payload.targetUserId,
        payload.affectedUserId
    ]);
    return targetIds.includes(userId);
}

function canReceiveRealtimeEvent(context = {}, payload = {}) {
    if (!context.userId) return false;
    if (context.isAdmin) return true;

    const targeted = isTargetUser(context, payload);
    const scope = String(payload.scope || 'operacion').trim().toLowerCase();
    const rule = REALTIME_SCOPE_RULES[scope] || REALTIME_SCOPE_RULES.operacion;

    if (rule.targetedOnly) return targeted;
    if (rule.adminOnly) return Boolean(rule.allowTarget && targeted);

    const requiredAll = normalizeCodes(payload.requiredAllCapabilities || []);
    const requiredAny = normalizeCodes(payload.requiredAnyCapabilities || []);
    if (requiredAll.length && !hasAllCapabilities(context, requiredAll)) return false;
    if (requiredAny.length && !hasAnyCapability(context, requiredAny)) return false;

    if (rule.anyCapabilities && !hasAnyCapability(context, rule.anyCapabilities)) return false;

    if (rule.cashGlobal && hasCapability(context, CAPABILITIES.CASH_ACCESS)) {
        return true;
    }

    if (payload.global === true && !rule.zoneAware) return true;

    if (rule.zoneAware) {
        const zoneIds = normalizeNumericList(payload.zoneIds || payload.zonaIds || payload.zonaId || []);
        if (!zoneIds.length) return false;
        return zoneIds.some(zoneId => canViewZone(context, zoneId));
    }

    return true;
}

module.exports = {
    SECTION_REQUIREMENTS,
    REALTIME_SCOPE_RULES,
    normalizeNumericList,
    normalizeCodes,
    getSessionRoleIds,
    hasCapability,
    hasAnyCapability,
    hasAllCapabilities,
    getPermittedZoneIds,
    resolveAccessContext,
    buildPolicyFromOperationalSession,
    canOpenSection,
    canViewZone,
    buildZoneFilter,
    getMesaSnapshot,
    getMesaResponsibility,
    evaluateMesaAccess,
    isTargetUser,
    canReceiveRealtimeEvent
};
