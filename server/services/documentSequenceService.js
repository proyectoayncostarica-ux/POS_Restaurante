const database = require('../db/database');
const { TransactionService } = require('./transactionService');
const { ValidationError, NotFoundError } = require('../errors/domainError');

const DOCUMENT_SEQUENCE_TYPES = Object.freeze({
    PREINVOICE: 'prefactura',
    PAYMENT: 'pago',
    CREDIT: 'credito'
});

const DOCUMENT_SEQUENCE_DEFINITIONS = Object.freeze({
    [DOCUMENT_SEQUENCE_TYPES.PREINVOICE]: Object.freeze({
        prefix: 'PF',
        padding: 8
    }),
    [DOCUMENT_SEQUENCE_TYPES.PAYMENT]: Object.freeze({
        prefix: 'PG',
        padding: 8
    }),
    [DOCUMENT_SEQUENCE_TYPES.CREDIT]: Object.freeze({
        prefix: 'CR',
        padding: 8
    })
});

function getSequenceDefinition(type) {
    const normalized = String(type || '').trim().toLowerCase();
    const definition = DOCUMENT_SEQUENCE_DEFINITIONS[normalized];
    if (!definition) {
        throw new ValidationError('Tipo de secuencia documental no soportado', { type });
    }
    return { type: normalized, ...definition };
}

function formatDocumentNumber(type, sequence, options = {}) {
    const definition = getSequenceDefinition(type);
    const value = Number(sequence);
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new ValidationError('La secuencia documental debe ser un entero positivo', {
            type: definition.type,
            sequence
        });
    }

    const prefix = String(options.prefix || definition.prefix).trim().toUpperCase();
    const padding = Number.isSafeInteger(Number(options.padding))
        ? Math.max(1, Number(options.padding))
        : definition.padding;
    return `${prefix}-${String(value).padStart(padding, '0')}`;
}

class DocumentSequenceService {
    constructor(options = {}) {
        this.db = options.db || database;
        this.transactions = options.transactions || new TransactionService(this.db);
    }

    async nextInTransaction(type, client, options = {}) {
        if (!client?.run || !client?.get) {
            throw new ValidationError('Se requiere una conexión transaccional para generar el documento');
        }

        const definition = getSequenceDefinition(type);
        const now = options.now || new Date().toISOString();

        await client.run(`
            INSERT OR IGNORE INTO secuencias_documentales (
                tipo_documento, prefijo, longitud, ultimo_numero,
                version, creado_en, actualizado_en
            ) VALUES (?, ?, ?, 0, 1, ?, ?)
        `, [definition.type, definition.prefix, definition.padding, now, now]);

        const updated = await client.run(`
            UPDATE secuencias_documentales
            SET ultimo_numero = ultimo_numero + 1,
                version = COALESCE(version, 1) + 1,
                actualizado_en = ?
            WHERE tipo_documento = ?
        `, [now, definition.type]);

        if (updated.changes !== 1) {
            throw new NotFoundError('No se pudo actualizar la secuencia documental', {
                type: definition.type
            });
        }

        const row = await client.get(`
            SELECT tipo_documento, prefijo, longitud, ultimo_numero, version
            FROM secuencias_documentales
            WHERE tipo_documento = ?
        `, [definition.type]);

        if (!row) {
            throw new NotFoundError('Secuencia documental no encontrada después de actualizarla', {
                type: definition.type
            });
        }

        return {
            type: row.tipo_documento,
            sequence: Number(row.ultimo_numero),
            prefix: row.prefijo,
            padding: Number(row.longitud),
            version: Number(row.version),
            documentNumber: formatDocumentNumber(row.tipo_documento, row.ultimo_numero, {
                prefix: row.prefijo,
                padding: row.longitud
            })
        };
    }

    async next(type, options = {}) {
        if (options.client) {
            return this.nextInTransaction(type, options.client, options);
        }
        return this.transactions.immediate(tx => this.nextInTransaction(type, tx, options));
    }

    async current(type, client = this.db) {
        const definition = getSequenceDefinition(type);
        const row = await client.get(`
            SELECT tipo_documento, prefijo, longitud, ultimo_numero, version
            FROM secuencias_documentales
            WHERE tipo_documento = ?
        `, [definition.type]);
        if (!row) return null;
        return {
            type: row.tipo_documento,
            sequence: Number(row.ultimo_numero),
            prefix: row.prefijo,
            padding: Number(row.longitud),
            version: Number(row.version),
            documentNumber: Number(row.ultimo_numero) > 0
                ? formatDocumentNumber(row.tipo_documento, row.ultimo_numero, {
                    prefix: row.prefijo,
                    padding: row.longitud
                })
                : null
        };
    }
}

const documentSequenceService = new DocumentSequenceService();

module.exports = documentSequenceService;
module.exports.DocumentSequenceService = DocumentSequenceService;
module.exports.DOCUMENT_SEQUENCE_TYPES = DOCUMENT_SEQUENCE_TYPES;
module.exports.DOCUMENT_SEQUENCE_DEFINITIONS = DOCUMENT_SEQUENCE_DEFINITIONS;
module.exports.formatDocumentNumber = formatDocumentNumber;
