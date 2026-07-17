class DomainError extends Error {
    constructor(message, options = {}) {
        super(message);
        this.name = this.constructor.name;
        this.code = options.code || 'DOMAIN_ERROR';
        this.status = options.status || 400;
        this.details = options.details || null;
        this.expose = options.expose !== false;
        if (options.cause) this.cause = options.cause;
        Error.captureStackTrace?.(this, this.constructor);
    }
}

class ValidationError extends DomainError {
    constructor(message, details = null) {
        super(message, { code: 'VALIDATION_ERROR', status: 400, details });
    }
}

class UnauthorizedError extends DomainError {
    constructor(message = 'Autenticación requerida', details = null) {
        super(message, { code: 'UNAUTHORIZED', status: 401, details });
    }
}

class ForbiddenError extends DomainError {
    constructor(message = 'Operación no autorizada', details = null) {
        super(message, { code: 'FORBIDDEN', status: 403, details });
    }
}

class NotFoundError extends DomainError {
    constructor(message = 'Recurso no encontrado', details = null) {
        super(message, { code: 'NOT_FOUND', status: 404, details });
    }
}

class ConflictError extends DomainError {
    constructor(message, details = null) {
        super(message, { code: 'CONFLICT', status: 409, details });
    }
}

class IdempotencyConflictError extends DomainError {
    constructor(message = 'La solicitud ya fue procesada con datos diferentes', details = null) {
        super(message, { code: 'IDEMPOTENCY_CONFLICT', status: 409, details });
    }
}

class InvariantError extends DomainError {
    constructor(message, details = null) {
        super(message, { code: 'INVARIANT_VIOLATION', status: 422, details });
    }
}

module.exports = {
    DomainError,
    ValidationError,
    UnauthorizedError,
    ForbiddenError,
    NotFoundError,
    ConflictError,
    IdempotencyConflictError,
    InvariantError
};
