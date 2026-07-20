const database = require('../db/database');
const { TransactionService } = require('./transactionService');
const { BrowserPdfAdapter } = require('./printingAdapters/browserPdfAdapter');
const printerConfigurationServiceModule = require('./printerConfigurationService');
const {
    ValidationError,
    NotFoundError,
    ConflictError,
    IdempotencyConflictError
} = require('../errors/domainError');
const { createRequestFingerprint } = require('../utils/idempotency');

const PRINT_JOB_STATES = Object.freeze({
    PENDING: 'pendiente',
    PROCESSING: 'procesando',
    COMPLETED: 'completado',
    FAILED: 'fallido',
    CANCELLED: 'cancelado'
});

const PRINT_ATTEMPT_STATES = Object.freeze({
    PROCESSING: 'procesando',
    COMPLETED: 'completado',
    FAILED: 'fallido'
});

const PRINT_ADAPTERS = Object.freeze({
    BROWSER_PDF: 'navegador_pdf'
});

function normalizeText(value, field, maxLength = 160) {
    const normalized = String(value ?? '').trim();
    if (!normalized) throw new ValidationError(`${field} es requerido`);
    if (normalized.length > maxLength) {
        throw new ValidationError(`${field} supera la longitud permitida`, { maxLength });
    }
    return normalized;
}

function normalizeOptionalText(value, maxLength = 500) {
    const normalized = String(value ?? '').trim();
    if (!normalized) return null;
    if (normalized.length > maxLength) {
        throw new ValidationError('El texto supera la longitud permitida', { maxLength });
    }
    return normalized;
}

function normalizePositiveInteger(value, field, fallback = null) {
    if ((value === null || typeof value === 'undefined' || value === '') && fallback !== null) return fallback;
    const normalized = Number(value);
    if (!Number.isSafeInteger(normalized) || normalized <= 0) {
        throw new ValidationError(`${field} debe ser un entero positivo`);
    }
    return normalized;
}

function normalizePayload(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new ValidationError('El payload canónico del documento es requerido');
    }
    return value;
}

function safeJsonParse(value, fallback = null) {
    if (value === null || typeof value === 'undefined' || value === '') return fallback;
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch (_error) {
        return fallback;
    }
}

class PrintingService {
    constructor(options = {}) {
        this.db = options.db || database;
        this.transactions = options.transactions || new TransactionService(this.db);
        this.printerConfigurationService = options.printerConfigurationService || new printerConfigurationServiceModule.PrinterConfigurationService({ db: this.db });
        this.adapters = new Map();
        this.registerAdapter(options.browserPdfAdapter || new BrowserPdfAdapter());
        for (const adapter of options.adapters || []) this.registerAdapter(adapter);
    }

    registerAdapter(adapter) {
        if (!adapter || typeof adapter.code !== 'string' || typeof adapter.render !== 'function') {
            throw new TypeError('El adaptador de Printing debe exponer code y render()');
        }
        this.adapters.set(adapter.code, adapter);
        return this;
    }

    getAdapter(code) {
        const normalized = normalizeText(code || PRINT_ADAPTERS.BROWSER_PDF, 'adaptador', 80);
        const adapter = this.adapters.get(normalized);
        if (!adapter) {
            throw new ValidationError('Adaptador de Printing no soportado', { adaptador: normalized });
        }
        return adapter;
    }

    serializeJob(row) {
        if (!row) return null;
        return {
            ...row,
            id: Number(row.id),
            copia: Number(row.copia),
            intentos: Number(row.intentos || 0),
            max_intentos: Number(row.max_intentos || 0),
            copias_fisicas: Number(row.copias_fisicas || 1),
            autoimpresion: Number(row.autoimpresion ?? 1) === 1,
            creado_por_usuario_id: row.creado_por_usuario_id ? Number(row.creado_por_usuario_id) : null,
            configuracion_impresion: safeJsonParse(row.configuracion_impresion_json, null),
            payload: safeJsonParse(row.payload_json, {}),
            resultado: safeJsonParse(row.resultado_json, null)
        };
    }

    serializeAttempt(row) {
        if (!row) return null;
        return {
            ...row,
            id: Number(row.id),
            trabajo_impresion_id: Number(row.trabajo_impresion_id),
            numero_intento: Number(row.numero_intento),
            resultado: safeJsonParse(row.resultado_json, null)
        };
    }

    async getTemplate(code, client = this.db) {
        if (!code) return null;
        const normalized = normalizeText(code, 'plantilla', 120);
        const row = await client.get(`
            SELECT *
            FROM plantillas_documento
            WHERE codigo = ? AND activa = 1
        `, [normalized]);
        if (!row) throw new NotFoundError('Plantilla de documento no encontrada', { codigo: normalized });
        return row;
    }

    async listTemplates(options = {}) {
        const clauses = ['activa = 1'];
        const params = [];
        if (options.documentType ?? options.tipo_documento) {
            clauses.push('tipo_documento = ?');
            params.push(normalizeText(options.documentType ?? options.tipo_documento, 'tipo_documento', 120));
        }
        return this.db.all(`
            SELECT codigo, nombre, tipo_documento, formato, version, activa, actualizado_en
            FROM plantillas_documento
            WHERE ${clauses.join(' AND ')}
            ORDER BY tipo_documento ASC, nombre ASC, codigo ASC
        `, params);
    }

    async upsertTemplate(input = {}) {
        const code = normalizeText(input.code ?? input.codigo, 'codigo', 120);
        const name = normalizeText(input.name ?? input.nombre, 'nombre', 160);
        const documentType = normalizeText(input.documentType ?? input.tipo_documento, 'tipo_documento', 120);
        const format = normalizeText(input.format ?? input.formato ?? 'html', 'formato', 40);
        const content = String(input.content ?? input.contenido ?? '');
        if (!content.trim()) throw new ValidationError('El contenido de la plantilla es requerido');
        const now = input.now || new Date().toISOString();

        await this.db.run(`
            INSERT INTO plantillas_documento (
                codigo, nombre, tipo_documento, formato, contenido,
                version, activa, creado_en, actualizado_en
            ) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)
            ON CONFLICT(codigo) DO UPDATE SET
                nombre = excluded.nombre,
                tipo_documento = excluded.tipo_documento,
                formato = excluded.formato,
                contenido = excluded.contenido,
                version = plantillas_documento.version + 1,
                activa = 1,
                actualizado_en = excluded.actualizado_en
        `, [code, name, documentType, format, content, now, now]);

        return this.db.get('SELECT * FROM plantillas_documento WHERE codigo = ?', [code]);
    }

    async resolveJobConfiguration(input, documentType, payload) {
        const configured = await this.printerConfigurationService.resolveForDocument({
            ...input,
            documentType,
            payload
        });
        const destination = configured.destino;
        const adapterCode = normalizeText(
            input.adapter ?? input.adaptador ?? configured.adaptador ?? PRINT_ADAPTERS.BROWSER_PDF,
            'adaptador',
            80
        );
        this.getAdapter(adapterCode);
        const templateCode = normalizeOptionalText(
            input.templateCode ?? input.plantilla_codigo ?? configured.plantilla_codigo,
            120
        );
        const physicalCopies = normalizePositiveInteger(
            input.physicalCopies ?? input.copias_fisicas ?? configured.copias,
            'copias_fisicas',
            1
        );
        if (physicalCopies > 10) throw new ValidationError('copias_fisicas no puede superar 10');
        const autoPrintInput = input.autoPrint ?? input.autoimpresion;
        const autoPrint = typeof autoPrintInput === 'undefined'
            ? Boolean(configured.autoimpresion && configured.activa)
            : Boolean(autoPrintInput);
        const snapshot = {
            ...configured,
            adaptador: adapterCode,
            plantilla_codigo: templateCode,
            copias: physicalCopies,
            autoimpresion: autoPrint
        };
        return {
            destination,
            adapterCode,
            templateCode,
            physicalCopies,
            autoPrint,
            printerName: normalizeOptionalText(configured.nombre, 180),
            paperSize: normalizeOptionalText(configured.tamano_papel, 40),
            snapshot
        };
    }

    async enqueue(input = {}) {
        const documentType = normalizeText(input.documentType ?? input.documento_tipo, 'documento_tipo', 120);
        const documentId = normalizeText(input.documentId ?? input.documento_id, 'documento_id', 128);
        const documentNumber = normalizeOptionalText(input.documentNumber ?? input.documento_numero, 160);
        const copy = normalizePositiveInteger(input.copy ?? input.copia, 'copia', 1);
        const payload = normalizePayload(input.payload);
        const jobConfig = await this.resolveJobConfiguration(input, documentType, payload);
        const {
            destination,
            adapterCode,
            templateCode,
            physicalCopies,
            autoPrint,
            printerName,
            paperSize,
            snapshot
        } = jobConfig;
        const maxAttempts = normalizePositiveInteger(input.maxAttempts ?? input.max_intentos, 'max_intentos', 3);
        if (maxAttempts > 20) throw new ValidationError('max_intentos no puede superar 20');
        const userId = input.userId ?? input.creado_por_usuario_id ?? null;
        const now = input.now || new Date().toISOString();
        const payloadJson = JSON.stringify(payload);
        const payloadFingerprint = createRequestFingerprint({
            documentType,
            documentId,
            documentNumber,
            copy,
            payload
        });

        return this.transactions.immediate(async tx => {
            if (templateCode) await this.getTemplate(templateCode, tx);
            const existing = await tx.get(`
                SELECT * FROM trabajos_impresion
                WHERE documento_tipo = ? AND documento_id = ? AND copia = ?
            `, [documentType, documentId, copy]);

            if (existing) {
                const existingPayload = safeJsonParse(existing.payload_json, {});
                const canonicalExistingFingerprint = createRequestFingerprint({
                    documentType: existing.documento_tipo,
                    documentId: existing.documento_id,
                    documentNumber: existing.documento_numero,
                    copy: Number(existing.copia),
                    payload: existingPayload
                });
                if (canonicalExistingFingerprint !== payloadFingerprint) {
                    throw new IdempotencyConflictError(
                        'Ya existe un trabajo para este documento/tipo/copia con datos diferentes',
                        {
                            trabajo_impresion_id: Number(existing.id),
                            documento_tipo: documentType,
                            documento_id: documentId,
                            copia: copy
                        }
                    );
                }
                return { ...this.serializeJob(existing), idempotency_replay: true };
            }

            const result = await tx.run(`
                INSERT INTO trabajos_impresion (
                    documento_tipo, documento_id, documento_numero, copia,
                    plantilla_codigo, adaptador, destino_impresion, impresora_nombre,
                    tamano_papel, copias_fisicas, autoimpresion, configuracion_impresion_json,
                    payload_json, payload_fingerprint,
                    estado, intentos, max_intentos, disponible_desde,
                    creado_por_usuario_id, creado_en, actualizado_en
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', 0, ?, ?, ?, ?, ?)
            `, [
                documentType,
                documentId,
                documentNumber,
                copy,
                templateCode,
                adapterCode,
                destination,
                printerName,
                paperSize,
                physicalCopies,
                autoPrint ? 1 : 0,
                JSON.stringify(snapshot),
                payloadJson,
                payloadFingerprint,
                maxAttempts,
                now,
                userId || null,
                now,
                now
            ]);
            const row = await tx.get('SELECT * FROM trabajos_impresion WHERE id = ?', [result.id]);
            return { ...this.serializeJob(row), idempotency_replay: false };
        });
    }

    async enqueueNextCopy(input = {}) {
        const documentType = normalizeText(input.documentType ?? input.documento_tipo, 'documento_tipo', 120);
        const documentId = normalizeText(input.documentId ?? input.documento_id, 'documento_id', 128);
        const documentNumber = normalizeOptionalText(input.documentNumber ?? input.documento_numero, 160);
        const payload = normalizePayload(input.payload);
        const jobConfig = await this.resolveJobConfiguration(input, documentType, payload);
        const {
            destination,
            adapterCode,
            templateCode,
            physicalCopies,
            autoPrint,
            printerName,
            paperSize,
            snapshot
        } = jobConfig;
        const maxAttempts = normalizePositiveInteger(input.maxAttempts ?? input.max_intentos, 'max_intentos', 3);
        if (maxAttempts > 20) throw new ValidationError('max_intentos no puede superar 20');
        const userId = input.userId ?? input.creado_por_usuario_id ?? null;
        const now = input.now || new Date().toISOString();
        const payloadJson = JSON.stringify(payload);

        return this.transactions.immediate(async tx => {
            if (templateCode) await this.getTemplate(templateCode, tx);
            const row = await tx.get(`
                SELECT COALESCE(MAX(copia), 0) AS ultima_copia
                FROM trabajos_impresion
                WHERE documento_tipo = ? AND documento_id = ?
            `, [documentType, documentId]);
            const copy = Number(row?.ultima_copia || 0) + 1;
            const payloadFingerprint = createRequestFingerprint({
                documentType,
                documentId,
                documentNumber,
                copy,
                payload
            });
            const result = await tx.run(`
                INSERT INTO trabajos_impresion (
                    documento_tipo, documento_id, documento_numero, copia,
                    plantilla_codigo, adaptador, destino_impresion, impresora_nombre,
                    tamano_papel, copias_fisicas, autoimpresion, configuracion_impresion_json,
                    payload_json, payload_fingerprint,
                    estado, intentos, max_intentos, disponible_desde,
                    creado_por_usuario_id, creado_en, actualizado_en
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', 0, ?, ?, ?, ?, ?)
            `, [
                documentType,
                documentId,
                documentNumber,
                copy,
                templateCode,
                adapterCode,
                destination,
                printerName,
                paperSize,
                physicalCopies,
                autoPrint ? 1 : 0,
                JSON.stringify(snapshot),
                payloadJson,
                payloadFingerprint,
                maxAttempts,
                now,
                userId || null,
                now,
                now
            ]);
            const created = await tx.get('SELECT * FROM trabajos_impresion WHERE id = ?', [result.id]);
            return { ...this.serializeJob(created), idempotency_replay: false };
        });
    }

    async getJob(jobId, options = {}) {
        const id = normalizePositiveInteger(jobId, 'trabajo_impresion_id');
        const row = await this.db.get('SELECT * FROM trabajos_impresion WHERE id = ?', [id]);
        if (!row) throw new NotFoundError('Trabajo de impresión no encontrado', { id });
        const job = this.serializeJob(row);
        if (options.includeAttempts) {
            const attempts = await this.db.all(`
                SELECT * FROM intentos_impresion
                WHERE trabajo_impresion_id = ?
                ORDER BY numero_intento ASC
            `, [id]);
            job.intentos_detalle = attempts.map(attempt => this.serializeAttempt(attempt));
        }
        return job;
    }

    async listJobs(options = {}) {
        const clauses = [];
        const params = [];
        if (options.state ?? options.estado) {
            const state = normalizeText(options.state ?? options.estado, 'estado', 40);
            if (!Object.values(PRINT_JOB_STATES).includes(state)) {
                throw new ValidationError('Estado de trabajo de impresión inválido', { estado: state });
            }
            clauses.push('estado = ?');
            params.push(state);
        }
        if (options.documentType ?? options.documento_tipo) {
            clauses.push('documento_tipo = ?');
            params.push(normalizeText(options.documentType ?? options.documento_tipo, 'documento_tipo', 120));
        }
        const limit = Math.min(normalizePositiveInteger(options.limit ?? options.limite, 'limite', 100), 500);
        const rows = await this.db.all(`
            SELECT * FROM trabajos_impresion
            ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
            ORDER BY creado_en ASC, id ASC
            LIMIT ?
        `, [...params, limit]);
        return rows.map(row => this.serializeJob(row));
    }

    async preview(input = {}) {
        const payload = normalizePayload(input.payload);
        const adapterCode = input.adapter ?? input.adaptador ?? PRINT_ADAPTERS.BROWSER_PDF;
        const adapter = this.getAdapter(adapterCode);
        const template = input.templateCode || input.plantilla_codigo
            ? await this.getTemplate(input.templateCode ?? input.plantilla_codigo)
            : null;
        return adapter.render({ payload, template, job: input.job || null });
    }

    async getPrinterStatus(destination = null) {
        const configs = destination
            ? { [destination]: await this.printerConfigurationService.get(destination) }
            : await this.printerConfigurationService.list();
        const result = {};
        for (const [key, config] of Object.entries(configs)) {
            const adapterAvailable = this.adapters.has(config.adaptador);
            result[key] = {
                ...config,
                estado_dispositivo: config.activa
                    ? (adapterAvailable ? (config.estado_dispositivo || 'disponible') : 'adaptador_no_disponible')
                    : 'inactiva',
                adaptador_disponible: adapterAvailable
            };
        }
        return destination ? result[destination] : result;
    }

    async testPrinter(destination, options = {}) {
        const config = await this.printerConfigurationService.get(destination);
        const testedAt = options.now || new Date().toISOString();
        try {
            const adapter = this.getAdapter(config.adaptador);
            const template = config.plantilla_codigo
                ? await this.getTemplate(config.plantilla_codigo)
                : null;
            const payload = {
                documento: 'prueba_impresion',
                numero_documento: `TEST-${String(config.destino).toUpperCase()}`,
                destino: config.destino,
                impresora: config.nombre,
                tamano_papel: config.tamano_papel,
                copias: config.copias,
                fecha: testedAt,
                mensaje: 'Prueba de impresión MundiPOS'
            };
            const output = await adapter.render({
                payload,
                template,
                job: {
                    documento_tipo: 'prueba_impresion',
                    documento_numero: payload.numero_documento,
                    destino_impresion: config.destino,
                    impresora_nombre: config.nombre,
                    tamano_papel: config.tamano_papel,
                    copias_fisicas: config.copias,
                    autoimpresion: true,
                    configuracion_impresion: config
                }
            });
            const status = await this.printerConfigurationService.recordDeviceStatus(config.destino, {
                estado: 'disponible',
                fecha: testedAt
            });
            return { configuracion: status, salida: output };
        } catch (error) {
            await this.printerConfigurationService.recordDeviceStatus(config.destino, {
                estado: 'error',
                fecha: testedAt,
                error: error.message
            });
            throw error;
        }
    }

    async startAttempt(jobId, options = {}) {
        const id = normalizePositiveInteger(jobId, 'trabajo_impresion_id');
        const now = options.now || new Date().toISOString();
        return this.transactions.immediate(async tx => {
            const job = await tx.get('SELECT * FROM trabajos_impresion WHERE id = ?', [id]);
            if (!job) throw new NotFoundError('Trabajo de impresión no encontrado', { id });
            if (job.estado !== PRINT_JOB_STATES.PENDING) {
                throw new ConflictError('El trabajo no está disponible para procesamiento', {
                    code: 'PRINT_JOB_NOT_PENDING',
                    estado: job.estado
                });
            }
            if (Number(job.intentos || 0) >= Number(job.max_intentos || 0)) {
                throw new ConflictError('El trabajo agotó el máximo de intentos', {
                    code: 'PRINT_JOB_MAX_ATTEMPTS_REACHED'
                });
            }
            const attemptNumber = Number(job.intentos || 0) + 1;
            const update = await tx.run(`
                UPDATE trabajos_impresion
                SET estado = 'procesando', intentos = ?, actualizado_en = ?, ultimo_error = NULL
                WHERE id = ? AND estado = 'pendiente' AND intentos = ?
            `, [attemptNumber, now, id, Number(job.intentos || 0)]);
            if (update.changes !== 1) {
                throw new ConflictError('Otro proceso tomó el trabajo de impresión', {
                    code: 'PRINT_JOB_ALREADY_CLAIMED'
                });
            }
            const attempt = await tx.run(`
                INSERT INTO intentos_impresion (
                    trabajo_impresion_id, numero_intento, estado,
                    adaptador, iniciado_en
                ) VALUES (?, ?, 'procesando', ?, ?)
            `, [id, attemptNumber, job.adaptador, now]);
            return {
                job: this.serializeJob(await tx.get('SELECT * FROM trabajos_impresion WHERE id = ?', [id])),
                attempt: this.serializeAttempt(await tx.get('SELECT * FROM intentos_impresion WHERE id = ?', [attempt.id]))
            };
        });
    }

    async completeAttempt(attemptId, result, options = {}) {
        const id = normalizePositiveInteger(attemptId, 'intento_impresion_id');
        const now = options.now || new Date().toISOString();
        return this.transactions.immediate(async tx => {
            const attempt = await tx.get('SELECT * FROM intentos_impresion WHERE id = ?', [id]);
            if (!attempt) throw new NotFoundError('Intento de impresión no encontrado', { id });
            if (attempt.estado !== PRINT_ATTEMPT_STATES.PROCESSING) {
                throw new ConflictError('El intento ya fue finalizado', { code: 'PRINT_ATTEMPT_ALREADY_FINISHED' });
            }
            const resultJson = JSON.stringify(result || {});
            await tx.run(`
                UPDATE intentos_impresion
                SET estado = 'completado', finalizado_en = ?, resultado_json = ?
                WHERE id = ?
            `, [now, resultJson, id]);
            await tx.run(`
                UPDATE trabajos_impresion
                SET estado = 'completado', resultado_json = ?, completado_en = ?, actualizado_en = ?, ultimo_error = NULL
                WHERE id = ?
            `, [resultJson, now, now, attempt.trabajo_impresion_id]);
            return this.getJobFromClient(tx, attempt.trabajo_impresion_id, true);
        });
    }

    async failAttempt(attemptId, error, options = {}) {
        const id = normalizePositiveInteger(attemptId, 'intento_impresion_id');
        const now = options.now || new Date().toISOString();
        const message = normalizeOptionalText(error?.message || error || 'Error de impresión', 1000) || 'Error de impresión';
        const code = normalizeOptionalText(error?.code, 120);
        return this.transactions.immediate(async tx => {
            const attempt = await tx.get('SELECT * FROM intentos_impresion WHERE id = ?', [id]);
            if (!attempt) throw new NotFoundError('Intento de impresión no encontrado', { id });
            if (attempt.estado !== PRINT_ATTEMPT_STATES.PROCESSING) {
                throw new ConflictError('El intento ya fue finalizado', { code: 'PRINT_ATTEMPT_ALREADY_FINISHED' });
            }
            await tx.run(`
                UPDATE intentos_impresion
                SET estado = 'fallido', finalizado_en = ?, error_codigo = ?, error_mensaje = ?
                WHERE id = ?
            `, [now, code, message, id]);
            await tx.run(`
                UPDATE trabajos_impresion
                SET estado = 'fallido', ultimo_error = ?, actualizado_en = ?
                WHERE id = ?
            `, [message, now, attempt.trabajo_impresion_id]);
            return this.getJobFromClient(tx, attempt.trabajo_impresion_id, true);
        });
    }

    async getJobFromClient(client, jobId, includeAttempts = false) {
        const row = await client.get('SELECT * FROM trabajos_impresion WHERE id = ?', [jobId]);
        const job = this.serializeJob(row);
        if (includeAttempts) {
            const attempts = await client.all(`
                SELECT * FROM intentos_impresion
                WHERE trabajo_impresion_id = ? ORDER BY numero_intento ASC
            `, [jobId]);
            job.intentos_detalle = attempts.map(attempt => this.serializeAttempt(attempt));
        }
        return job;
    }

    async processJob(jobId, options = {}) {
        const started = await this.startAttempt(jobId, options);
        try {
            const template = started.job.plantilla_codigo
                ? await this.getTemplate(started.job.plantilla_codigo)
                : null;
            const adapter = this.getAdapter(started.job.adaptador);
            const output = await adapter.render({
                payload: started.job.payload,
                template,
                job: started.job
            });
            return await this.completeAttempt(started.attempt.id, output, options);
        } catch (error) {
            try {
                await this.failAttempt(started.attempt.id, error, options);
            } catch (failureError) {
                error.printingFailurePersistenceError = failureError;
            }
            throw error;
        }
    }

    async processNext(options = {}) {
        const now = options.now || new Date().toISOString();
        const row = await this.db.get(`
            SELECT id
            FROM trabajos_impresion
            WHERE estado = 'pendiente'
              AND COALESCE(disponible_desde, creado_en) <= ?
            ORDER BY creado_en ASC, id ASC
            LIMIT 1
        `, [now]);
        if (!row) return null;
        return this.processJob(row.id, options);
    }

    async retry(jobId, options = {}) {
        const id = normalizePositiveInteger(jobId, 'trabajo_impresion_id');
        const now = options.now || new Date().toISOString();
        return this.transactions.immediate(async tx => {
            const job = await tx.get('SELECT * FROM trabajos_impresion WHERE id = ?', [id]);
            if (!job) throw new NotFoundError('Trabajo de impresión no encontrado', { id });
            if (job.estado !== PRINT_JOB_STATES.FAILED) {
                throw new ConflictError('Solo un trabajo fallido puede reintentarse', {
                    code: 'PRINT_JOB_NOT_FAILED',
                    estado: job.estado
                });
            }
            if (Number(job.intentos || 0) >= Number(job.max_intentos || 0)) {
                throw new ConflictError('El trabajo agotó el máximo de intentos', {
                    code: 'PRINT_JOB_MAX_ATTEMPTS_REACHED'
                });
            }
            await tx.run(`
                UPDATE trabajos_impresion
                SET estado = 'pendiente', disponible_desde = ?, actualizado_en = ?
                WHERE id = ?
            `, [now, now, id]);
            return this.getJobFromClient(tx, id, true);
        });
    }

    async recoverStale(options = {}) {
        const olderThanMinutes = normalizePositiveInteger(options.olderThanMinutes ?? options.minutos, 'minutos', 10);
        const now = options.now ? new Date(options.now) : new Date();
        if (Number.isNaN(now.getTime())) throw new ValidationError('Fecha de recuperación inválida');
        const threshold = new Date(now.getTime() - olderThanMinutes * 60000).toISOString();
        const nowIso = now.toISOString();

        return this.transactions.immediate(async tx => {
            const staleJobs = await tx.all(`
                SELECT id
                FROM trabajos_impresion
                WHERE estado = 'procesando' AND actualizado_en <= ?
            `, [threshold]);
            if (!staleJobs.length) return { recuperados: 0, umbral: threshold };

            const ids = staleJobs.map(job => Number(job.id));
            for (const id of ids) {
                await tx.run(`
                    UPDATE intentos_impresion
                    SET estado = 'fallido',
                        finalizado_en = ?,
                        error_codigo = COALESCE(error_codigo, 'PROCESS_INTERRUPTED'),
                        error_mensaje = COALESCE(error_mensaje, 'Procesamiento interrumpido; trabajo devuelto a la cola')
                    WHERE trabajo_impresion_id = ? AND estado = 'procesando'
                `, [nowIso, id]);
                await tx.run(`
                    UPDATE trabajos_impresion
                    SET estado = 'pendiente',
                        ultimo_error = COALESCE(ultimo_error, 'Trabajo recuperado después de procesamiento interrumpido'),
                        disponible_desde = ?,
                        actualizado_en = ?
                    WHERE id = ? AND estado = 'procesando'
                `, [nowIso, nowIso, id]);
            }
            return { recuperados: ids.length, umbral: threshold };
        });
    }
}

const printingService = new PrintingService();

module.exports = printingService;
module.exports.PrintingService = PrintingService;
module.exports.PRINT_JOB_STATES = PRINT_JOB_STATES;
module.exports.PRINT_ATTEMPT_STATES = PRINT_ATTEMPT_STATES;
module.exports.PRINT_ADAPTERS = PRINT_ADAPTERS;
