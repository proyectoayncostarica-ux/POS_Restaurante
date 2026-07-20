const printingServiceSingleton = require('./printingService');
const preinvoiceServiceSingleton = require('./preinvoiceService');
const paymentServiceSingleton = require('./paymentService');
const creditServiceSingleton = require('./creditService');
const kitchenServiceSingleton = require('./kitchenService');
const financialReadServiceSingleton = require('./financialReadService');
const { ValidationError } = require('../errors/domainError');

const PRINT_DOCUMENT_TYPES = Object.freeze({
    PREINVOICE: 'prefactura',
    PARTIAL_PREINVOICE: 'prefactura_parcial',
    PAYMENT_RECEIPT: 'recibo_cobro',
    CREDIT_VOUCHER: 'comprobante_credito',
    CREDIT_PAYMENT: 'abono_credito',
    KITCHEN_COMMAND: 'comanda',
    DAILY_CLOSE: 'cierre_diario'
});

function normalizePositiveId(value, field) {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw new ValidationError(`${field} inválido`, { value });
    }
    return id;
}

function normalizeText(value, field, maxLength = 160) {
    const text = String(value ?? '').trim();
    if (!text) throw new ValidationError(`${field} es requerido`);
    if (text.length > maxLength) throw new ValidationError(`${field} supera la longitud permitida`);
    return text;
}

function stripInternalFields(value) {
    if (Array.isArray(value)) return value.map(stripInternalFields);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
        Object.entries(value)
            .filter(([key]) => !['payload_json', 'payload_fingerprint', 'solicitud_fingerprint', 'clave_idempotencia'].includes(key))
            .map(([key, item]) => [key, stripInternalFields(item)])
    );
}

class DocumentPrintingService {
    constructor(options = {}) {
        this.printingService = options.printingService || printingServiceSingleton;
        this.preinvoiceService = options.preinvoiceService || preinvoiceServiceSingleton;
        this.paymentService = options.paymentService || paymentServiceSingleton;
        this.creditService = options.creditService || creditServiceSingleton;
        this.kitchenService = options.kitchenService || kitchenServiceSingleton;
        this.financialReadService = options.financialReadService || financialReadServiceSingleton;
    }

    buildPreinvoiceDescriptor(document) {
        const partial = String(document.tipo || '').toLowerCase() === 'dividida';
        return {
            documentType: partial ? PRINT_DOCUMENT_TYPES.PARTIAL_PREINVOICE : PRINT_DOCUMENT_TYPES.PREINVOICE,
            documentId: String(document.id),
            documentNumber: document.numero_documento,
            payload: {
                documento: partial ? 'prefactura_parcial' : 'prefactura',
                numero_documento: document.numero_documento,
                fecha_emision: document.fecha_emision,
                tipo: document.tipo,
                estado: document.estado,
                pagador: document.pagador_nombre,
                cliente_principal: document.cliente_principal_snapshot,
                cuenta: document.numero_cuenta_snapshot,
                mesa: {
                    id: document.mesa_id_snapshot,
                    numero: document.mesa_numero_snapshot,
                    tipo: document.mesa_tipo_snapshot,
                    zona: document.zona_nombre_snapshot
                },
                responsables: stripInternalFields(document.responsables || []),
                items: stripInternalFields(document.items || []),
                subtotal: Number(document.subtotal || 0),
                servicio: Number(document.servicio || 0),
                total: Number(document.total || 0),
                observacion: document.observacion || null,
                emitida_por: document.emitida_por_nombre_snapshot || null
            }
        };
    }

    buildPaymentDescriptor(payment) {
        const isCreditPayment = String(payment.naturaleza || '').toLowerCase() === 'cobro_credito';
        return {
            documentType: isCreditPayment ? PRINT_DOCUMENT_TYPES.CREDIT_PAYMENT : PRINT_DOCUMENT_TYPES.PAYMENT_RECEIPT,
            documentId: String(payment.id),
            documentNumber: payment.numero_pago,
            payload: {
                documento: isCreditPayment ? 'abono_credito' : 'recibo_cobro',
                numero_documento: payment.numero_pago,
                fecha: payment.fecha,
                estado: payment.estado,
                naturaleza: payment.naturaleza,
                numero_cuenta: payment.numero_cuenta,
                numero_prefactura: payment.numero_documento || null,
                numero_credito: payment.numero_credito || null,
                pagador: payment.pagador_nombre_snapshot || payment.pagador_nombre || null,
                cajero: payment.cajero_nombre_snapshot || null,
                metodo_pago: payment.metodo_pago,
                medios_pago: stripInternalFields(payment.medios_pago || []),
                monto: Number(payment.monto || 0),
                monto_recibido: Number(payment.monto_recibido || 0),
                vuelto: Number(payment.vuelto || 0),
                subtotal: Number(payment.subtotal || 0),
                servicio: Number(payment.servicio || 0),
                referencia: payment.referencia || null
            }
        };
    }

    buildCreditDescriptor(credit) {
        return {
            documentType: PRINT_DOCUMENT_TYPES.CREDIT_VOUCHER,
            documentId: String(credit.id),
            documentNumber: credit.numero_credito,
            payload: {
                documento: 'comprobante_credito',
                numero_documento: credit.numero_credito,
                fecha: credit.fecha,
                estado: credit.estado,
                cliente: credit.cliente_nombre,
                pagador: credit.pagador_nombre_snapshot,
                cliente_principal: credit.cliente_principal_snapshot,
                numero_cuenta: credit.numero_cuenta_snapshot,
                numero_prefactura: credit.numero_documento_snapshot,
                mesa: credit.mesa,
                zona: credit.zona_nombre_snapshot,
                responsables: stripInternalFields(credit.responsables || []),
                monto_original: Number(credit.monto_original || 0),
                total_abonado: Number(credit.total_abonado || 0),
                saldo_pendiente: Number(credit.saldo_pendiente || 0),
                creado_por: credit.creado_por_nombre_snapshot || credit.usuario_origen || null,
                autorizado_por: credit.autorizado_por || null,
                observacion: credit.observacion || null
            }
        };
    }

    buildKitchenDescriptor(command) {
        return {
            documentType: PRINT_DOCUMENT_TYPES.KITCHEN_COMMAND,
            documentId: String(command.id),
            documentNumber: command.numero_comanda,
            payload: {
                documento: 'comanda',
                numero_documento: command.numero_comanda,
                destino: command.destino || 'cocina',
                estado_operativo: command.estado_operativo,
                solicitada_en: command.solicitada_en,
                cuenta: command.numero_cuenta_snapshot,
                mesa: {
                    id: command.mesa_id,
                    numero: command.mesa_numero_snapshot || command.mesa_numero,
                    tipo: command.mesa_tipo_snapshot,
                    zona: command.zona_nombre_snapshot
                },
                solicitante: command.usuario_solicitante_nombre_snapshot,
                items: stripInternalFields(command.items || []),
                motivo: command.motivo || null,
                comanda_origen_id: command.comanda_origen_id ? Number(command.comanda_origen_id) : null
            }
        };
    }

    async resolveBrowserOutput(job, options = {}) {
        if (!job || options.process === false || job.autoimpresion === false || job.adaptador !== 'navegador_pdf') return job;
        if (job.estado === 'pendiente') {
            try {
                return await this.printingService.processJob(job.id, { now: options.now });
            } catch (_error) {
                return this.printingService.getJob(job.id, { includeAttempts: true });
            }
        }
        return this.printingService.getJob(job.id, { includeAttempts: true });
    }

    async enqueueDescriptor(descriptor, options = {}) {
        const job = await this.printingService.enqueue({
            ...descriptor,
            copy: options.copy || 1,
            userId: options.userId || null,
            maxAttempts: options.maxAttempts || 3,
            now: options.now
        });
        return this.resolveBrowserOutput(job, options);
    }

    async enqueueReprintDescriptor(descriptor, options = {}) {
        const job = await this.printingService.enqueueNextCopy({
            ...descriptor,
            userId: options.userId || null,
            maxAttempts: options.maxAttempts || 3,
            now: options.now
        });
        return this.resolveBrowserOutput(job, options);
    }

    async enqueuePreinvoice(preinvoiceOrId, options = {}) {
        const document = typeof preinvoiceOrId === 'object'
            ? preinvoiceOrId
            : await this.preinvoiceService.getPreinvoice(normalizePositiveId(preinvoiceOrId, 'prefactura_id'));
        return this.enqueueDescriptor(this.buildPreinvoiceDescriptor(document), options);
    }

    async reprintPreinvoice(preinvoiceId, options = {}) {
        const document = await this.preinvoiceService.getPreinvoice(normalizePositiveId(preinvoiceId, 'prefactura_id'));
        return this.enqueueReprintDescriptor(this.buildPreinvoiceDescriptor(document), options);
    }

    async enqueuePayment(paymentOrId, options = {}) {
        const payment = typeof paymentOrId === 'object'
            ? paymentOrId
            : await this.paymentService.getPayment(normalizePositiveId(paymentOrId, 'pago_id'));
        return this.enqueueDescriptor(this.buildPaymentDescriptor(payment), options);
    }

    async reprintPayment(paymentId, options = {}) {
        const payment = await this.paymentService.getPayment(normalizePositiveId(paymentId, 'pago_id'));
        return this.enqueueReprintDescriptor(this.buildPaymentDescriptor(payment), options);
    }

    async enqueueCredit(creditOrId, options = {}) {
        const credit = typeof creditOrId === 'object'
            ? creditOrId
            : await this.creditService.getCredit(normalizePositiveId(creditOrId, 'credito_id'));
        return this.enqueueDescriptor(this.buildCreditDescriptor(credit), options);
    }

    async reprintCredit(creditId, options = {}) {
        const credit = await this.creditService.getCredit(normalizePositiveId(creditId, 'credito_id'));
        return this.enqueueReprintDescriptor(this.buildCreditDescriptor(credit), options);
    }

    async enqueueKitchenCommand(commandOrId, options = {}) {
        const command = typeof commandOrId === 'object'
            ? commandOrId
            : await this.kitchenService.getComanda(normalizePositiveId(commandOrId, 'comanda_id'));
        return this.enqueueDescriptor(this.buildKitchenDescriptor(command), options);
    }

    async enqueueKitchenCommands(commands = [], options = {}) {
        const jobs = [];
        for (const command of commands || []) {
            jobs.push(await this.enqueueKitchenCommand(command, options));
        }
        return jobs;
    }

    async reprintKitchenCommand(commandId, options = {}) {
        const command = await this.kitchenService.getComanda(normalizePositiveId(commandId, 'comanda_id'));
        return this.enqueueReprintDescriptor(this.buildKitchenDescriptor(command), options);
    }

    async reprintLatestAccountDocument(accountId, options = {}) {
        const id = normalizePositiveId(accountId, 'cuenta_id');
        const read = await this.financialReadService.getAccountFinancialRead(id);

        const movements = [...(read.movimientos_caja || [])]
            .filter(item => String(item.estado || 'confirmado').toLowerCase() === 'confirmado')
            .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')) || Number(b.id || 0) - Number(a.id || 0));
        if (movements[0]?.id) return this.reprintPayment(movements[0].id, options);

        const credits = [...(read.creditos || [])]
            .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')) || Number(b.id || 0) - Number(a.id || 0));
        if (credits[0]?.id) return this.reprintCredit(credits[0].id, options);

        const documents = [...(read.documentos_operativos || [])]
            .filter(item => String(item.estado || '').toLowerCase() !== 'anulada')
            .sort((a, b) => String(b.fecha_emision || '').localeCompare(String(a.fecha_emision || '')) || Number(b.id || 0) - Number(a.id || 0));
        if (documents[0]?.id) return this.reprintPreinvoice(documents[0].id, options);

        throw new ValidationError('La cuenta no tiene un documento financiero imprimible', { cuenta_id: id });
    }

    async enqueueDailyClose(input = {}) {
        const startIso = normalizeText(input.startIso ?? input.desde, 'desde', 80);
        const endIso = normalizeText(input.endIso ?? input.hasta, 'hasta', 80);
        const summary = await this.financialReadService.getPeriodSummary({ startIso, endIso });
        const periodKey = `${startIso}__${endIso}`;
        const documentNumber = input.documentNumber
            || `CIERRE-${String(startIso).slice(0, 10).replaceAll('-', '')}`;
        return this.enqueueDescriptor({
            documentType: PRINT_DOCUMENT_TYPES.DAILY_CLOSE,
            documentId: periodKey,
            documentNumber,
            payload: {
                documento: 'cierre_diario',
                numero_documento: documentNumber,
                desde: startIso,
                hasta: endIso,
                resumen: stripInternalFields(summary)
            }
        }, input);
    }
}

const documentPrintingService = new DocumentPrintingService();

module.exports = documentPrintingService;
module.exports.DocumentPrintingService = DocumentPrintingService;
module.exports.PRINT_DOCUMENT_TYPES = PRINT_DOCUMENT_TYPES;
