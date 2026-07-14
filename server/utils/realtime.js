const crypto = require('crypto');
const database = require('../db/database');

const clients = new Map();
let eventCounter = 0;

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const OPERATIONAL_PREFIXES = [
    '/api/tables',
    '/api/orders',
    '/api/accounts',
    '/api/credits',
    '/api/settings/reset-database'
];

const GLOBAL_SCOPES = new Set(['estructura', 'sistema', 'cuentas', 'creditos']);

function createClientId() {
    if (typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }

    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function shouldBroadcast(req) {
    if (!MUTATION_METHODS.has(req.method)) return false;

    const path = getCleanPath(req);
    return OPERATIONAL_PREFIXES.some(prefix => path.startsWith(prefix));
}

function getCleanPath(req) {
    return String(req?.originalUrl || req?.url || '').split('?')[0];
}

function getApiSegments(req) {
    return getCleanPath(req)
        .replace(/^\/api\/?/, '')
        .split('/')
        .map(segment => segment.trim())
        .filter(Boolean);
}

function getScope(req) {
    const segments = getApiSegments(req);
    const resource = segments[0] || '';
    const second = segments[1] || '';

    if (resource === 'tables') {
        if (['zones', 'seat-types', 'work-roles'].includes(second) || (req.method === 'POST' && segments.length === 1)) {
            return 'estructura';
        }
        if (segments.includes('responsibles')) return 'responsabilidad';
        return 'zonas';
    }

    if (resource === 'orders') return 'pedidos';
    if (resource === 'accounts') return 'cuentas';
    if (resource === 'credits') return 'creditos';
    if (resource === 'settings' && second === 'reset-database') return 'sistema';

    return 'operacion';
}

function normalizeNumericList(value) {
    if (value === null || value === undefined || value === '') return [];

    let normalizedValue = value;
    if (typeof normalizedValue === 'string') {
        const trimmed = normalizedValue.trim();
        if (!trimmed) return [];
        if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || trimmed.includes(',')) {
            try {
                normalizedValue = trimmed.startsWith('[') ? JSON.parse(trimmed) : trimmed.split(',');
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

function sessionRoleIds(session = {}) {
    return [...new Set([
        ...normalizeNumericList(session.activeWorkRoleIds),
        ...normalizeNumericList(session.activeWorkRoleId)
    ])];
}

function isAdminType(value = '') {
    const type = String(value || '').trim().toLowerCase();
    return type === 'administrador' || type === 'admin';
}

function buildBaseClientContext(session = {}) {
    const userType = String(session.userType || '').trim().toLowerCase();
    const isAdmin = isAdminType(userType);

    return {
        userId: Number(session.userId || 0) || null,
        userType,
        isAdmin,
        activeWorkRoleIds: sessionRoleIds(session),
        permittedZoneIds: isAdmin ? null : [],
        updatedAt: Date.now()
    };
}

async function resolvePermittedZoneIds(context = {}) {
    if (!context.userId || context.isAdmin) return null;
    if (!Array.isArray(context.activeWorkRoleIds) || !context.activeWorkRoleIds.length) return [];

    const placeholders = context.activeWorkRoleIds.map(() => '?').join(',');
    const rows = await database.all(`
        SELECT DISTINCT z.id
        FROM rol_trabajo_zonas rtz
        INNER JOIN roles_trabajo rt ON rt.id = rtz.rol_trabajo_id AND rt.activo = 1
        INNER JOIN zonas z ON z.id = rtz.zona_id AND z.activa = 1
        INNER JOIN usuario_roles_trabajo urt ON urt.rol_trabajo_id = rt.id AND urt.usuario_id = ?
        WHERE rtz.rol_trabajo_id IN (${placeholders})
    `, [context.userId, ...context.activeWorkRoleIds]);

    return rows.map(row => Number(row.id)).filter(id => Number.isFinite(id) && id > 0);
}

async function buildClientContext(session = {}) {
    const context = buildBaseClientContext(session);
    context.permittedZoneIds = await resolvePermittedZoneIds(context);
    context.updatedAt = Date.now();
    return context;
}

async function refreshClientContext(clientId, session = null) {
    const client = clients.get(clientId);
    if (!client) return;

    try {
        const sourceSession = session || client.sessionSnapshot || {};
        client.context = await buildClientContext(sourceSession);
    } catch (error) {
        console.warn('MundiPOS realtime: no se pudo actualizar contexto del cliente.', error);
    }
}

function sendEvent(res, eventName, payload) {
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function shouldSendToClient(client = {}, payload = {}) {
    const context = client.context || {};
    const userId = Number(context.userId || 0);

    if (!userId) return false;
    if (payload.global === true || GLOBAL_SCOPES.has(payload.scope)) return true;
    if (context.isAdmin) return true;

    const targetUserIds = normalizeNumericList(payload.targetUserIds || payload.affectedUserIds || []);
    if (targetUserIds.length && targetUserIds.includes(userId)) return true;

    const zoneIds = normalizeNumericList(payload.zoneIds || payload.zonaIds || payload.zonaId || []);
    if (!zoneIds.length) return true;

    const permittedZoneIds = Array.isArray(context.permittedZoneIds) ? context.permittedZoneIds : [];
    return zoneIds.some(zoneId => permittedZoneIds.includes(Number(zoneId)));
}

function broadcast(eventName, payload = {}) {
    const event = {
        id: ++eventCounter,
        at: new Date().toISOString(),
        ...payload
    };

    for (const [clientId, client] of clients.entries()) {
        if (!shouldSendToClient(client, event)) continue;

        try {
            sendEvent(client.res, eventName, event);
        } catch (error) {
            clearInterval(client.heartbeat);
            clients.delete(clientId);
        }
    }
}

function eventsHandler(req, res) {
    const requestedId = String(req.query.clientId || '').trim();
    const clientId = requestedId || createClientId();
    const sessionSnapshot = {
        userId: req.session?.userId || null,
        userName: req.session?.userName || null,
        userType: req.session?.userType || null,
        activeWorkRoleIds: req.session?.activeWorkRoleIds || [],
        activeWorkRoleId: req.session?.activeWorkRoleId || null
    };

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const heartbeat = setInterval(() => {
        refreshClientContext(clientId).catch(() => null);
        sendEvent(res, 'heartbeat', {
            id: ++eventCounter,
            at: new Date().toISOString(),
            clientId
        });
    }, 25000);

    clients.set(clientId, {
        res,
        heartbeat,
        sessionSnapshot,
        context: buildBaseClientContext(sessionSnapshot),
        createdAt: Date.now()
    });

    refreshClientContext(clientId, sessionSnapshot).catch(() => null);

    sendEvent(res, 'connected', {
        id: ++eventCounter,
        at: new Date().toISOString(),
        clientId,
        connected: true
    });

    req.on('close', () => {
        clearInterval(heartbeat);
        clients.delete(clientId);
    });
}

async function getMesaRealtimeContext(mesaId) {
    const id = Number(mesaId || 0);
    if (!id) return {};

    const mesa = await database.get(`
        SELECT
            m.id,
            m.numero,
            m.zona_id,
            COALESCE(z.nombre, m.zona) AS zona_nombre,
            COALESCE(tp.nombre, m.tipo_asiento) AS tipo_puesto_nombre
        FROM mesas m
        LEFT JOIN zonas z ON z.id = m.zona_id
        LEFT JOIN tipos_puesto tp ON tp.id = m.tipo_puesto_id
        WHERE m.id = ?
    `, [id]);

    if (!mesa) return { mesaIds: [id] };

    const responsables = await database.all(`
        SELECT DISTINCT usuario_id
        FROM mesa_responsables
        WHERE mesa_id = ?
    `, [id]);

    return {
        mesaIds: [id],
        zoneIds: mesa.zona_id ? [Number(mesa.zona_id)] : [],
        affectedUserIds: responsables.map(row => Number(row.usuario_id)).filter(userId => userId > 0),
        mesa: {
            id,
            numero: mesa.numero,
            zona_id: mesa.zona_id ? Number(mesa.zona_id) : null,
            zona_nombre: mesa.zona_nombre,
            tipo_puesto_nombre: mesa.tipo_puesto_nombre
        }
    };
}

async function getOrderRealtimeContext(orderId) {
    const id = Number(orderId || 0);
    if (!id) return {};

    const order = await database.get(`
        SELECT p.id, p.mesa_id, p.usuario_id, m.zona_id
        FROM pedidos p
        LEFT JOIN mesas m ON m.id = p.mesa_id
        WHERE p.id = ?
    `, [id]);

    if (!order) return { orderIds: [id] };

    const mesaContext = await getMesaRealtimeContext(order.mesa_id);
    const affected = new Set(normalizeNumericList(mesaContext.affectedUserIds));
    if (Number(order.usuario_id || 0)) affected.add(Number(order.usuario_id));

    return {
        ...mesaContext,
        orderIds: [id],
        affectedUserIds: [...affected]
    };
}

function getNumericSegment(segments = [], index = 1) {
    const value = Number(segments[index] || 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
}

async function inferMutationContext(req, scope) {
    const segments = getApiSegments(req);
    const resource = segments[0] || '';
    const context = {};

    if (GLOBAL_SCOPES.has(scope) || scope === 'estructura') {
        return { global: true };
    }

    if (resource === 'tables') {
        const mesaId = getNumericSegment(segments, 1);
        if (mesaId) return getMesaRealtimeContext(mesaId);

        const bodyZoneId = Number(req.body?.zona_id || req.body?.zonaId || 0);
        if (bodyZoneId > 0) context.zoneIds = [bodyZoneId];
        return context;
    }

    if (resource === 'orders') {
        if (req.method === 'POST' && segments.length === 1) {
            const mesaId = Number(req.body?.mesa_id || req.body?.mesaId || 0);
            if (mesaId) return getMesaRealtimeContext(mesaId);
        }

        const orderId = getNumericSegment(segments, 1);
        if (orderId) return getOrderRealtimeContext(orderId);
    }

    return context;
}

function mergeRealtimePayload(base = {}, inferred = {}, explicit = {}) {
    const zoneIds = [...new Set([
        ...normalizeNumericList(inferred.zoneIds),
        ...normalizeNumericList(explicit.zoneIds)
    ])];
    const affectedUserIds = [...new Set([
        ...normalizeNumericList(inferred.affectedUserIds),
        ...normalizeNumericList(explicit.affectedUserIds),
        ...normalizeNumericList(explicit.targetUserIds)
    ])];
    const mesaIds = [...new Set([
        ...normalizeNumericList(inferred.mesaIds),
        ...normalizeNumericList(explicit.mesaIds)
    ])];
    const orderIds = [...new Set([
        ...normalizeNumericList(inferred.orderIds),
        ...normalizeNumericList(explicit.orderIds)
    ])];

    return {
        ...base,
        ...inferred,
        ...explicit,
        zoneIds,
        affectedUserIds,
        targetUserIds: [...new Set([
            ...normalizeNumericList(explicit.targetUserIds),
            ...affectedUserIds
        ])],
        mesaIds,
        orderIds,
        global: Boolean(base.global || inferred.global || explicit.global)
    };
}

function operationMutationNotifier(req, res, next) {
    if (!shouldBroadcast(req)) {
        return next();
    }

    const startedAt = Date.now();
    const sourceClientId = String(req.get('X-MundiPOS-Client') || '').trim();

    res.on('finish', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return;

        const scope = getScope(req);
        const basePayload = {
            type: 'operation-change',
            scope,
            method: req.method,
            path: getCleanPath(req),
            statusCode: res.statusCode,
            userId: req.session?.userId || null,
            sourceClientId,
            durationMs: Date.now() - startedAt
        };

        const explicitPayload = res.locals?.realtime || {};

        inferMutationContext(req, scope)
            .then(inferred => {
                broadcast('operation-change', mergeRealtimePayload(basePayload, inferred, explicitPayload));
            })
            .catch(error => {
                console.warn('MundiPOS realtime: no se pudo inferir contexto del cambio.', error);
                broadcast('operation-change', mergeRealtimePayload(basePayload, { global: true }, explicitPayload));
            });
    });

    return next();
}

function getClientCount() {
    return clients.size;
}

module.exports = {
    eventsHandler,
    operationMutationNotifier,
    broadcast,
    getClientCount
};
