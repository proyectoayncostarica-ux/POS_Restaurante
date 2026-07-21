const crypto = require('crypto');
const database = require('../db/database');

const USER_SESSION_STATUSES = Object.freeze([
    'activa',
    'cerrada',
    'revocada',
    'reemplazada',
    'expirada'
]);

const USER_SESSION_END_REASONS = Object.freeze({
    LOGOUT: 'logout',
    REAUTHENTICATION: 'reauthenticacion_mismo_sid',
    TTL_EXPIRATION: 'expiracion_ttl',
    RECONCILIATION_MISSING: 'reconciliacion_sin_sesion_tecnica',
    RECONCILIATION_DUPLICATE: 'reconciliacion_duplicado_sid',
    RECONCILIATION_USER_CHANGED: 'reconciliacion_usuario_distinto',
    RECONCILIATION_NO_USER: 'reconciliacion_sin_usuario_autenticado'
});

function normalizeRequiredText(value, field, maxLength = 512) {
    const text = String(value || '').trim();
    if (!text) throw new TypeError(`${field} es requerido`);
    if (text.length > maxLength) throw new TypeError(`${field} supera la longitud permitida`);
    return text;
}

function normalizeOptionalText(value, maxLength = 512) {
    if (value === null || typeof value === 'undefined') return null;
    const text = String(value).trim();
    if (!text) return null;
    if (text.length > maxLength) throw new TypeError('El texto supera la longitud permitida');
    return text;
}

function normalizeUserId(value) {
    const userId = Number(value);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
        throw new TypeError('usuario_id debe ser un entero positivo');
    }
    return userId;
}

function normalizeStatus(value) {
    const status = String(value || '').trim().toLowerCase();
    if (!USER_SESSION_STATUSES.includes(status)) {
        throw new TypeError(`Estado de sesión inválido: ${value}`);
    }
    return status;
}

function inferStartedAt(storedSession, expiresAt, fallback) {
    const originalMaxAge = Number(storedSession?.cookie?.originalMaxAge);
    if (Number.isFinite(expiresAt) && Number.isFinite(originalMaxAge) && originalMaxAge >= 0) {
        return new Date(expiresAt - originalMaxAge).toISOString();
    }
    return fallback;
}

class UserSessionService {
    constructor(options = {}) {
        this.db = options.db || database;
        this.uuidFactory = options.uuidFactory || (() => crypto.randomUUID());
        this.clock = options.clock || (() => new Date().toISOString());
    }

    generateUuid() {
        return normalizeRequiredText(this.uuidFactory(), 'session_uuid', 120);
    }

    async create(input = {}) {
        const values = this.normalizeCreateInput(input);
        await this.insert(values);
        return this.findByUuid(values.sessionUuid);
    }

    normalizeCreateInput(input = {}) {
        const sessionUuid = normalizeRequiredText(
            input.sessionUuid || input.session_uuid || this.uuidFactory(),
            'session_uuid',
            120
        );
        const userId = normalizeUserId(input.userId ?? input.usuario_id);
        const expressSessionId = normalizeRequiredText(
            input.expressSessionId ?? input.express_session_id,
            'express_session_id'
        );
        const clientId = normalizeOptionalText(input.clientId ?? input.client_id, 255);
        const status = normalizeStatus(input.status ?? input.estado ?? 'activa');
        const startedAt = normalizeRequiredText(
            input.startedAt ?? input.iniciada_en ?? this.clock(),
            'iniciada_en',
            80
        );
        const lastActivityAt = normalizeOptionalText(
            input.lastActivityAt ?? input.ultima_actividad_en,
            80
        );
        const endedAt = normalizeOptionalText(input.endedAt ?? input.finalizada_en, 80);
        const endReason = normalizeOptionalText(
            input.endReason ?? input.motivo_finalizacion,
            120
        );
        const updatedAt = normalizeRequiredText(
            input.updatedAt ?? input.actualizado_en ?? startedAt,
            'actualizado_en',
            80
        );

        return {
            sessionUuid,
            userId,
            expressSessionId,
            clientId,
            status,
            startedAt,
            lastActivityAt,
            endedAt,
            endReason,
            updatedAt
        };
    }

    insert(values) {
        return this.db.run(`
            INSERT INTO sesiones_usuario (
                session_uuid, usuario_id, express_session_id, client_id,
                estado, iniciada_en, ultima_actividad_en,
                finalizada_en, motivo_finalizacion, actualizado_en
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            values.sessionUuid,
            values.userId,
            values.expressSessionId,
            values.clientId,
            values.status,
            values.startedAt,
            values.lastActivityAt,
            values.endedAt,
            values.endReason,
            values.updatedAt
        ]);
    }

    findByUuid(sessionUuid) {
        const normalizedUuid = normalizeRequiredText(sessionUuid, 'session_uuid', 120);
        return this.db.get(
            'SELECT * FROM sesiones_usuario WHERE session_uuid = ?',
            [normalizedUuid]
        );
    }

    findByExpressSessionId(expressSessionId) {
        const normalizedSid = normalizeRequiredText(expressSessionId, 'express_session_id');
        return this.db.all(`
            SELECT *
            FROM sesiones_usuario
            WHERE express_session_id = ?
            ORDER BY iniciada_en DESC, id DESC
        `, [normalizedSid]);
    }

    findActiveByExpressSessionId(expressSessionId) {
        const normalizedSid = normalizeRequiredText(expressSessionId, 'express_session_id');
        return this.db.all(`
            SELECT *
            FROM sesiones_usuario
            WHERE express_session_id = ? AND estado = 'activa'
            ORDER BY iniciada_en DESC, id DESC
        `, [normalizedSid]);
    }

    listActive() {
        return this.db.all(`
            SELECT *
            FROM sesiones_usuario
            WHERE estado = 'activa'
            ORDER BY iniciada_en DESC, id DESC
        `);
    }

    listByUser(userId) {
        return this.db.all(`
            SELECT *
            FROM sesiones_usuario
            WHERE usuario_id = ?
            ORDER BY iniciada_en DESC, id DESC
        `, [normalizeUserId(userId)]);
    }

    async updateStatus(sessionUuid, input = {}) {
        const normalizedUuid = normalizeRequiredText(sessionUuid, 'session_uuid', 120);
        const status = normalizeStatus(input.status ?? input.estado);
        const endedAt = normalizeOptionalText(input.endedAt ?? input.finalizada_en, 80);
        const endReason = normalizeOptionalText(
            input.endReason ?? input.motivo_finalizacion,
            120
        );
        const updatedAt = normalizeRequiredText(
            input.updatedAt ?? input.actualizado_en ?? this.clock(),
            'actualizado_en',
            80
        );

        const result = await this.db.run(`
            UPDATE sesiones_usuario
            SET estado = ?,
                finalizada_en = ?,
                motivo_finalizacion = ?,
                actualizado_en = ?
            WHERE session_uuid = ?
        `, [status, endedAt, endReason, updatedAt, normalizedUuid]);

        if (!result.changes) return null;
        return this.findByUuid(normalizedUuid);
    }

    async transitionActiveByExpressSessionId(expressSessionId, input = {}) {
        const normalizedSid = normalizeRequiredText(expressSessionId, 'express_session_id');
        const status = normalizeStatus(input.status ?? input.estado);
        if (status === 'activa') {
            throw new TypeError('La transición debe finalizar una sesión activa');
        }
        const endedAt = normalizeRequiredText(
            input.endedAt ?? input.finalizada_en ?? this.clock(),
            'finalizada_en',
            80
        );
        const endReason = normalizeRequiredText(
            input.endReason ?? input.motivo_finalizacion,
            'motivo_finalizacion',
            120
        );
        const updatedAt = normalizeRequiredText(
            input.updatedAt ?? input.actualizado_en ?? endedAt,
            'actualizado_en',
            80
        );
        const sessionUuid = normalizeOptionalText(input.sessionUuid ?? input.session_uuid, 120);
        const clauses = ["express_session_id = ?", "estado = 'activa'"];
        const params = [status, endedAt, endReason, updatedAt, normalizedSid];
        if (sessionUuid) {
            clauses.push('session_uuid = ?');
            params.push(sessionUuid);
        }

        const result = await this.db.run(`
            UPDATE sesiones_usuario
            SET estado = ?,
                finalizada_en = ?,
                motivo_finalizacion = ?,
                actualizado_en = ?
            WHERE ${clauses.join(' AND ')}
        `, params);
        return Number(result.changes || 0);
    }

    closeActiveByExpressSessionId(expressSessionId, input = {}) {
        return this.transitionActiveByExpressSessionId(expressSessionId, {
            ...input,
            status: 'cerrada',
            endReason: input.endReason || USER_SESSION_END_REASONS.LOGOUT
        });
    }

    expireActiveByExpressSessionId(expressSessionId, input = {}) {
        return this.transitionActiveByExpressSessionId(expressSessionId, {
            ...input,
            status: 'expirada',
            endReason: input.endReason || USER_SESSION_END_REASONS.TTL_EXPIRATION
        });
    }

    replaceActiveByExpressSessionId(expressSessionId, input = {}) {
        return this.transitionActiveByExpressSessionId(expressSessionId, {
            ...input,
            status: 'reemplazada',
            endReason: input.endReason || USER_SESSION_END_REASONS.REAUTHENTICATION
        });
    }

    async startAuthenticatedSession(input = {}) {
        const values = this.normalizeCreateInput({ ...input, status: 'activa' });
        const run = async db => {
            const service = db === this.db ? this : new UserSessionService({
                db,
                uuidFactory: () => values.sessionUuid,
                clock: this.clock
            });
            await service.replaceActiveByExpressSessionId(values.expressSessionId, {
                endedAt: values.startedAt,
                endReason: USER_SESSION_END_REASONS.REAUTHENTICATION
            });
            await service.insert(values);
            return service.findByUuid(values.sessionUuid);
        };

        if (typeof this.db.withTransaction === 'function') {
            return this.db.withTransaction(run);
        }
        return run(this.db);
    }

    async reconcileActiveSessions(technicalSessions = []) {
        const now = this.clock();
        const validTechnical = new Map();
        for (const entry of technicalSessions) {
            const sid = normalizeOptionalText(entry?.sid);
            if (!sid) continue;
            validTechnical.set(sid, entry);
        }

        const run = async db => {
            const service = db === this.db ? this : new UserSessionService({
                db,
                uuidFactory: this.uuidFactory,
                clock: this.clock
            });
            const activeRows = await service.listActive();
            const activeBySid = new Map();
            for (const row of activeRows) {
                const rows = activeBySid.get(row.express_session_id) || [];
                rows.push(row);
                activeBySid.set(row.express_session_id, rows);
            }

            for (const row of activeRows) {
                if (validTechnical.has(row.express_session_id)) continue;
                await service.expireActiveByExpressSessionId(row.express_session_id, {
                    sessionUuid: row.session_uuid,
                    endedAt: now,
                    endReason: USER_SESSION_END_REASONS.RECONCILIATION_MISSING
                });
            }

            for (const [sid, entry] of validTechnical) {
                const storedSession = entry.session || {};
                const userId = Number(storedSession.userId);
                const rows = activeBySid.get(sid) || [];
                if (!Number.isSafeInteger(userId) || userId <= 0) {
                    for (const row of rows) {
                        await service.expireActiveByExpressSessionId(sid, {
                            sessionUuid: row.session_uuid,
                            endedAt: now,
                            endReason: USER_SESSION_END_REASONS.RECONCILIATION_NO_USER
                        });
                    }
                    continue;
                }

                const declaredUuid = normalizeOptionalText(storedSession.userSessionUuid, 120);
                const matching = rows.find(row =>
                    declaredUuid
                    && row.session_uuid === declaredUuid
                    && Number(row.usuario_id) === userId
                ) || rows.find(row => Number(row.usuario_id) === userId) || null;
                for (const row of rows) {
                    if (matching && row.session_uuid === matching.session_uuid) continue;
                    await service.replaceActiveByExpressSessionId(sid, {
                        sessionUuid: row.session_uuid,
                        endedAt: now,
                        endReason: Number(row.usuario_id) === userId
                            ? USER_SESSION_END_REASONS.RECONCILIATION_DUPLICATE
                            : USER_SESSION_END_REASONS.RECONCILIATION_USER_CHANGED
                    });
                }

                if (matching) continue;
                const startedAt = inferStartedAt(storedSession, Number(entry.expiresAt), now);
                let reconstructedUuid = declaredUuid;
                if (reconstructedUuid && await service.findByUuid(reconstructedUuid)) {
                    reconstructedUuid = null;
                }
                await service.insert(service.normalizeCreateInput({
                    sessionUuid: reconstructedUuid || service.generateUuid(),
                    userId,
                    expressSessionId: sid,
                    clientId: storedSession.userSessionClientId,
                    status: 'activa',
                    startedAt,
                    updatedAt: now
                }));
            }
        };

        if (typeof this.db.withTransaction === 'function') {
            await this.db.withTransaction(run);
        } else {
            await run(this.db);
        }
    }
}

const userSessionService = new UserSessionService();

module.exports = userSessionService;
module.exports.UserSessionService = UserSessionService;
module.exports.USER_SESSION_STATUSES = USER_SESSION_STATUSES;
module.exports.USER_SESSION_END_REASONS = USER_SESSION_END_REASONS;
