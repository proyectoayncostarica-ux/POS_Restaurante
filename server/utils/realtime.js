const crypto = require('crypto');

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

function createClientId() {
    if (typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }

    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function shouldBroadcast(req) {
    if (!MUTATION_METHODS.has(req.method)) return false;

    const path = req.originalUrl.split('?')[0];
    return OPERATIONAL_PREFIXES.some(prefix => path.startsWith(prefix));
}

function getScope(req) {
    const path = req.originalUrl.split('?')[0];

    if (path.startsWith('/api/tables')) return 'zonas';
    if (path.startsWith('/api/orders')) return 'pedidos';
    if (path.startsWith('/api/accounts')) return 'cuentas';
    if (path.startsWith('/api/credits')) return 'creditos';
    if (path.startsWith('/api/settings/reset-database')) return 'sistema';

    return 'operacion';
}

function sendEvent(res, eventName, payload) {
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function broadcast(eventName, payload) {
    const event = {
        id: ++eventCounter,
        at: new Date().toISOString(),
        ...payload
    };

    for (const [clientId, client] of clients.entries()) {
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

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const heartbeat = setInterval(() => {
        sendEvent(res, 'heartbeat', {
            id: ++eventCounter,
            at: new Date().toISOString(),
            clientId
        });
    }, 25000);

    clients.set(clientId, {
        res,
        heartbeat,
        userId: req.session?.userId || null,
        createdAt: Date.now()
    });

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

function operationMutationNotifier(req, res, next) {
    if (!shouldBroadcast(req)) {
        return next();
    }

    const startedAt = Date.now();
    const sourceClientId = String(req.get('X-MundiPOS-Client') || '').trim();

    res.on('finish', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return;

        broadcast('operation-change', {
            type: 'operation-change',
            scope: getScope(req),
            method: req.method,
            path: req.originalUrl.split('?')[0],
            statusCode: res.statusCode,
            userId: req.session?.userId || null,
            sourceClientId,
            durationMs: Date.now() - startedAt
        });
    });

    return next();
}

module.exports = {
    eventsHandler,
    operationMutationNotifier,
    broadcast
};
