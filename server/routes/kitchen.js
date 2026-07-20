const express = require('express');
const requireCapability = require('../middleware/requireCapability');
const { CAPABILITIES } = require('../security/capabilities');
const {
    resolveAccessContext,
    evaluateMesaAccess,
    canViewZone,
    normalizeKitchenDestinations
} = require('../services/operationalAccessService');
const accountService = require('../services/accountService');
const kitchenService = require('../services/kitchenService');
const documentPrintingService = require('../services/documentPrintingService');
const { DomainError } = require('../errors/domainError');

const router = express.Router();

async function enqueuePrintingSafely(factory, context) {
    try {
        return await factory();
    } catch (error) {
        console.error(`Printing no pudo encolar ${context}; la comanda ya permanece persistida:`, error);
        return { estado: 'encolado_fallido', error: error?.message || 'No fue posible crear el trabajo de impresión' };
    }
}

function sendRouteError(res, error, fallbackMessage) {
    if (error instanceof DomainError || (error && Number.isInteger(error.status) && error.code)) {
        const payload = {
            error: error.expose === false ? fallbackMessage : error.message,
            code: error.code || 'DOMAIN_ERROR'
        };
        if (error.details) Object.assign(payload, error.details);
        return res.status(error.status || 400).json(payload);
    }
    console.error(fallbackMessage, error);
    return res.status(500).json({ error: fallbackMessage });
}

async function assertComandaVisible(req, comanda) {
    const access = await resolveAccessContext(req);
    if (access.isAdmin) return access;
    const zoneId = Number(comanda.zona_id_snapshot || comanda.zona_id || 0);
    if (!zoneId || !canViewZone(access, zoneId)) {
        const error = new Error('No tienes acceso operativo a la zona de esta comanda.');
        error.status = 403;
        error.code = 'ZONE_NOT_ALLOWED';
        throw error;
    }
    const allowedDestinations = normalizeKitchenDestinations(access.kitchenDestinations || []);
    const commandDestination = String(comanda.destino || 'cocina').trim().toLowerCase();
    if (allowedDestinations.length && !allowedDestinations.includes(commandDestination)) {
        const error = new Error('No tienes acceso operativo a este destino de preparación.');
        error.status = 403;
        error.code = 'KITCHEN_DESTINATION_NOT_ALLOWED';
        throw error;
    }
    return access;
}

router.get('/pending', requireCapability(CAPABILITIES.KITCHEN_OPERATE), async (req, res) => {
    try {
        const access = await resolveAccessContext(req);
        const commands = await kitchenService.getPending({
            destination: req.query.destino || req.query.destination,
            zoneIds: access.isAdmin ? null : access.zoneIds
        });
        return res.json({ success: true, data: commands });
    } catch (error) {
        return sendRouteError(res, error, 'No fue posible consultar las órdenes de preparación');
    }
});

router.get('/board', requireCapability(CAPABILITIES.KITCHEN_OPERATE), async (req, res) => {
    try {
        const access = await resolveAccessContext(req);
        const requestedDestination = req.query.destino || req.query.destination || null;
        const allowedDestinations = normalizeKitchenDestinations(access.kitchenDestinations || []);
        if (requestedDestination && allowedDestinations.length
            && !allowedDestinations.includes(String(requestedDestination).trim().toLowerCase())) {
            return res.status(403).json({
                error: 'No tienes acceso operativo a este destino de preparación.',
                code: 'KITCHEN_DESTINATION_NOT_ALLOWED'
            });
        }
        const board = await kitchenService.getBoard({
            destination: requestedDestination,
            zoneIds: access.isAdmin ? null : access.zoneIds
        });
        return res.json({ success: true, data: board });
    } catch (error) {
        return sendRouteError(res, error, 'No fue posible consultar el tablero de preparación');
    }
});

router.get('/comandas/:id', requireCapability(CAPABILITIES.KITCHEN_OPERATE), async (req, res) => {
    try {
        const command = await kitchenService.getComanda(req.params.id);
        await assertComandaVisible(req, command);
        return res.json({ success: true, data: command });
    } catch (error) {
        return sendRouteError(res, error, 'No fue posible consultar la comanda');
    }
});

router.get('/comandas/:id/history', requireCapability(CAPABILITIES.KITCHEN_OPERATE), async (req, res) => {
    try {
        const command = await kitchenService.getComanda(req.params.id);
        await assertComandaVisible(req, command);
        const history = await kitchenService.getHistory(command.id);
        return res.json({ success: true, data: history });
    } catch (error) {
        return sendRouteError(res, error, 'No fue posible consultar la trazabilidad de la comanda');
    }
});

router.put('/comandas/:id/state', requireCapability(CAPABILITIES.KITCHEN_OPERATE), async (req, res) => {
    try {
        const source = await kitchenService.getComanda(req.params.id);
        await assertComandaVisible(req, source);
        const command = await kitchenService.transitionState({
            comandaId: source.id,
            userId: req.session?.userId,
            state: req.body?.estado_operativo || req.body?.state,
            expectedVersion: req.body?.expectedVersion ?? req.body?.version,
            reason: req.body?.motivo || req.body?.reason
        });
        res.locals.realtime = {
            scope: 'comandas',
            requiredAnyCapabilities: [CAPABILITIES.KITCHEN_OPERATE, CAPABILITIES.ORDERS_OPERATE],
            orderIds: [Number(command.pedido_id)].filter(Boolean),
            mesaIds: [Number(command.mesa_id)].filter(Boolean),
            zoneIds: [Number(command.zona_id_snapshot || command.zona_id)].filter(Boolean),
            comandaIds: [Number(command.id)],
            destinations: [command.destino || 'cocina']
        };
        return res.json({ success: true, data: command });
    } catch (error) {
        return sendRouteError(res, error, 'No fue posible actualizar el estado operativo de la comanda');
    }
});

router.post('/orders/:pedidoId/dispatch', requireCapability(CAPABILITIES.ORDERS_OPERATE), async (req, res) => {
    try {
        const account = await accountService.getAccount(req.params.pedidoId);
        const access = await resolveAccessContext(req);
        const mesaAccess = await evaluateMesaAccess(access, {
            id: account.mesa_id,
            zona_id: account.zona_id,
            estado: account.estado_operativo === 'abierta' ? 'ocupada' : 'libre'
        });
        if (!mesaAccess.operable) {
            return res.status(403).json({
                error: mesaAccess.visible
                    ? 'Solo un responsable asignado puede solicitar la preparación.'
                    : 'No tienes acceso operativo a esta zona.',
                code: mesaAccess.visible ? 'MESA_RESPONSIBILITY_REQUIRED' : 'ZONE_NOT_ALLOWED'
            });
        }

        const result = await kitchenService.requestDispatch({
            accountId: account.id,
            userId: req.session?.userId,
            idempotencyKey: req.get('Idempotency-Key')
                || req.body?.clave_idempotencia
                || req.body?.idempotencyKey
        });
        const printJobs = result.requiere_comanda
            ? await enqueuePrintingSafely(
                () => documentPrintingService.enqueueKitchenCommands(result.comandas || [], { userId: req.session?.userId }),
                `comandas de cuenta ${result.numero_cuenta || account.id}`
            )
            : [];
        res.locals.realtime = {
            scope: 'comandas',
            requiredAnyCapabilities: [CAPABILITIES.KITCHEN_OPERATE, CAPABILITIES.ORDERS_OPERATE],
            orderIds: [Number(account.id)],
            mesaIds: [Number(account.mesa_id)],
            zoneIds: [Number(account.zona_id)].filter(Boolean),
            comandaIds: result.comanda_ids || [],
            destinations: (result.comandas || []).map(command => command.destino).filter(Boolean)
        };
        return res.json({ success: true, data: result, printing: printJobs });
    } catch (error) {
        return sendRouteError(res, error, 'No fue posible solicitar la preparación');
    }
});

router.post('/comandas/:id/resend', requireCapability(CAPABILITIES.KITCHEN_OPERATE), async (req, res) => {
    try {
        const source = await kitchenService.getComanda(req.params.id);
        await assertComandaVisible(req, source);
        const command = await kitchenService.resend({
            comandaId: source.id,
            userId: req.session?.userId,
            reason: req.body?.motivo || req.body?.reason
        });
        const printJob = await enqueuePrintingSafely(
            () => documentPrintingService.enqueueKitchenCommand(command, { userId: req.session?.userId }),
            `comanda reenviada ${command.numero_comanda || command.id}`
        );
        res.locals.realtime = {
            scope: 'comandas',
            requiredAnyCapabilities: [CAPABILITIES.KITCHEN_OPERATE, CAPABILITIES.ORDERS_OPERATE],
            orderIds: [Number(command.pedido_id)].filter(Boolean),
            mesaIds: [Number(command.mesa_id)].filter(Boolean),
            zoneIds: [Number(command.zona_id_snapshot)].filter(Boolean),
            comandaIds: [Number(command.id)],
            destinations: [command.destino || 'cocina']
        };
        return res.json({ success: true, data: command, printing: printJob });
    } catch (error) {
        return sendRouteError(res, error, 'No fue posible reenviar la comanda');
    }
});

router.put('/comandas/:id/print-state', requireCapability(CAPABILITIES.KITCHEN_OPERATE), async (req, res) => {
    try {
        const source = await kitchenService.getComanda(req.params.id);
        await assertComandaVisible(req, source);
        const command = await kitchenService.markPrintState({
            comandaId: source.id,
            userId: req.session?.userId,
            state: req.body?.estado_impresion || req.body?.state
        });
        res.locals.realtime = {
            scope: 'comandas',
            requiredAnyCapabilities: [CAPABILITIES.KITCHEN_OPERATE, CAPABILITIES.ORDERS_OPERATE],
            orderIds: [Number(command.pedido_id)].filter(Boolean),
            mesaIds: [Number(command.mesa_id)].filter(Boolean),
            zoneIds: [Number(command.zona_id_snapshot)].filter(Boolean),
            comandaIds: [Number(command.id)],
            destinations: [command.destino || 'cocina']
        };
        return res.json({ success: true, data: command });
    } catch (error) {
        return sendRouteError(res, error, 'No fue posible actualizar el estado de impresión');
    }
});

module.exports = router;
