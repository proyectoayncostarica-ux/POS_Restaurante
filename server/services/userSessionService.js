const crypto = require('crypto');
const database = require('../db/database');

const USER_SESSION_STATUSES = Object.freeze([
    'activa',
    'cerrada',
    'revocada',
    'reemplazada',
    'expirada'
]);

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

class UserSessionService {
    constructor(options = {}) {
        this.db = options.db || database;
        this.uuidFactory = options.uuidFactory || (() => crypto.randomUUID());
        this.clock = options.clock || (() => new Date().toISOString());
    }

    async create(input = {}) {
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

        await this.db.run(`
            INSERT INTO sesiones_usuario (
                session_uuid, usuario_id, express_session_id, client_id,
                estado, iniciada_en, ultima_actividad_en,
                finalizada_en, motivo_finalizacion, actualizado_en
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
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
        ]);

        return this.findByUuid(sessionUuid);
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
}

const userSessionService = new UserSessionService();

module.exports = userSessionService;
module.exports.UserSessionService = UserSessionService;
module.exports.USER_SESSION_STATUSES = USER_SESSION_STATUSES;
