const express = require('express');
const requireCapability = require('../middleware/requireCapability');
const { CAPABILITIES } = require('../security/capabilities');
const printingService = require('../services/printingService');
const { DomainError } = require('../errors/domainError');

const router = express.Router();

function sendError(res, error, fallback) {
    if (error instanceof DomainError || (error && Number.isInteger(error.status) && error.code)) {
        const payload = {
            error: error.expose === false ? fallback : error.message,
            code: error.code || 'DOMAIN_ERROR'
        };
        if (error.details) Object.assign(payload, error.details);
        return res.status(error.status || 400).json(payload);
    }
    console.error(fallback, error);
    return res.status(500).json({ error: fallback });
}

router.get('/jobs', requireCapability(CAPABILITIES.PRINTING_RETRY), async (req, res) => {
    try {
        const jobs = await printingService.listJobs({
            state: req.query.estado || req.query.state,
            documentType: req.query.documento_tipo || req.query.documentType,
            limit: req.query.limite || req.query.limit
        });
        res.json({ success: true, data: jobs });
    } catch (error) {
        sendError(res, error, 'No fue posible consultar la cola de impresión');
    }
});

router.get('/jobs/:id', requireCapability(CAPABILITIES.PRINTING_RETRY), async (req, res) => {
    try {
        const job = await printingService.getJob(req.params.id, { includeAttempts: true });
        res.json({ success: true, data: job });
    } catch (error) {
        sendError(res, error, 'No fue posible consultar el trabajo de impresión');
    }
});

router.post('/jobs/:id/process', requireCapability(CAPABILITIES.PRINTING_RETRY), async (req, res) => {
    try {
        const job = await printingService.processJob(req.params.id);
        res.json({ success: true, data: job });
    } catch (error) {
        sendError(res, error, 'No fue posible procesar el trabajo de impresión');
    }
});

router.post('/jobs/:id/retry', requireCapability(CAPABILITIES.PRINTING_RETRY), async (req, res) => {
    try {
        const job = await printingService.retry(req.params.id);
        res.json({ success: true, data: job });
    } catch (error) {
        sendError(res, error, 'No fue posible reintentar el trabajo de impresión');
    }
});

router.post('/preview', requireCapability(CAPABILITIES.PRINTING_CONFIGURE), async (req, res) => {
    try {
        const output = await printingService.preview({
            payload: req.body?.payload,
            templateCode: req.body?.plantilla_codigo || req.body?.templateCode,
            adapter: req.body?.adaptador || req.body?.adapter
        });
        res.json({ success: true, data: output });
    } catch (error) {
        sendError(res, error, 'No fue posible generar la vista previa');
    }
});

router.put('/templates/:code', requireCapability(CAPABILITIES.PRINTING_CONFIGURE), async (req, res) => {
    try {
        const template = await printingService.upsertTemplate({
            code: req.params.code,
            name: req.body?.nombre || req.body?.name,
            documentType: req.body?.tipo_documento || req.body?.documentType,
            format: req.body?.formato || req.body?.format,
            content: req.body?.contenido || req.body?.content
        });
        res.json({ success: true, data: template });
    } catch (error) {
        sendError(res, error, 'No fue posible guardar la plantilla');
    }
});

module.exports = router;
