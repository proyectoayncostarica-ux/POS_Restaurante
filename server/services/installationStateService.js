const crypto = require('crypto');

const INSTALLATION_TABLE = 'installation_metadata';
const FORMAT_VERSION = 1;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEGACY_TABLES = {
    usuarios: ['id', 'nombre', 'password', 'tipo'],
    mesas: ['id', 'numero', 'capacidad', 'estado'],
    configuracion: ['clave', 'valor']
};

function metadataError(message, code = 'INSTALLATION_METADATA_INVALID') {
    const error = new Error(`Metadata de instalación: ${message}`);
    error.code = code;
    return error;
}

function validateMetadata(rows) {
    if (rows.length !== 1 || rows[0].singleton_id !== 1) {
        throw metadataError('debe existir exactamente una cabecera singleton válida.');
    }
    const row = rows[0];
    if (row.format_version !== FORMAT_VERSION) {
        throw metadataError('formato ausente o no soportado.', 'INSTALLATION_FORMAT_UNSUPPORTED');
    }
    if (!['created_empty', 'adopted_legacy'].includes(row.origin)
        || !['PREPARING', 'AWAITING_INITIAL_ADMIN', 'IDENTIFIED'].includes(row.state)) {
        throw metadataError('procedencia o estado desconocido.');
    }
    const identified = row.state === 'IDENTIFIED';
    if ((identified && (typeof row.installation_id !== 'string' || !UUID_V4.test(row.installation_id)))
        || (!identified && row.installation_id !== null)
        || (row.state === 'AWAITING_INITIAL_ADMIN' && row.origin !== 'created_empty')) {
        throw metadataError('combinación de procedencia, estado e identidad inconsistente.');
    }
    const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
    if (!validDate(row.created_at) || !validDate(row.updated_at)
        || Date.parse(row.updated_at) < Date.parse(row.created_at)
        || (identified && (!validDate(row.confirmed_at)
            || Date.parse(row.confirmed_at) < Date.parse(row.created_at)
            || Date.parse(row.confirmed_at) > Date.parse(row.updated_at)))
        || (!identified && row.confirmed_at !== null)) {
        throw metadataError('fechas de preparación/confirmación inconsistentes.');
    }
    return row;
}

class InstallationStateService {
    constructor({ db, clock = () => new Date().toISOString() } = {}) {
        if (!db || typeof db.withTransaction !== 'function') {
            throw new TypeError('InstallationStateService requiere DB con transacciones.');
        }
        this.db = db;
        this.clock = clock;
    }

    async loadInstallationState(db = this.db) {
        const object = await db.get(
            'SELECT type FROM sqlite_master WHERE lower(name) = ?',
            [INSTALLATION_TABLE]
        );
        if (!object) return null;
        if (object.type !== 'table') throw metadataError('la cabecera no es una tabla.');
        return validateMetadata(await db.all(`SELECT * FROM ${INSTALLATION_TABLE}`));
    }

    async inspectOrigin(db) {
        const objects = await db.all('SELECT type, name FROM sqlite_master');
        if (objects.length === 0) return 'created_empty';

        // Huella estructural anterior a seeds; no exige las tablas modernas de v3/v4.
        for (const [table, requiredColumns] of Object.entries(LEGACY_TABLES)) {
            const exists = objects.some(object => object.type === 'table'
                && object.name.toLowerCase() === table);
            const columns = exists ? await db.all(`PRAGMA table_info('${table}')`) : [];
            const names = new Set(columns.map(column => column.name.toLowerCase()));
            if (!exists || !requiredColumns.every(column => names.has(column))) {
                throw metadataError(
                    'base con objetos persistentes sin una estructura MundiPOS reconocible.',
                    'INSTALLATION_DATABASE_UNRECOGNIZED'
                );
            }
        }
        return 'adopted_legacy';
    }

    async prepareInstallationState() {
        return this.db.withTransaction(async db => {
            const existing = await this.loadInstallationState(db);
            if (existing) return existing;
            const origin = await this.inspectOrigin(db);
            await db.run(`CREATE TABLE ${INSTALLATION_TABLE} (
                singleton_id INTEGER PRIMARY KEY CHECK(singleton_id = 1),
                format_version INTEGER NOT NULL CHECK(format_version >= 1),
                origin TEXT NOT NULL CHECK(origin IN ('created_empty', 'adopted_legacy')),
                state TEXT NOT NULL CHECK(state IN ('PREPARING', 'AWAITING_INITIAL_ADMIN', 'IDENTIFIED')),
                installation_id TEXT UNIQUE CHECK(installation_id IS NULL OR length(installation_id) = 36),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                confirmed_at TEXT,
                CHECK(state != 'AWAITING_INITIAL_ADMIN' OR origin = 'created_empty'),
                CHECK((state = 'IDENTIFIED' AND installation_id IS NOT NULL AND confirmed_at IS NOT NULL)
                    OR (state != 'IDENTIFIED' AND installation_id IS NULL AND confirmed_at IS NULL))
            )`);
            const now = this.clock();
            await db.run(`INSERT INTO ${INSTALLATION_TABLE}
                (singleton_id, format_version, origin, state, installation_id, created_at, updated_at, confirmed_at)
                VALUES (1, ?, ?, 'PREPARING', NULL, ?, ?, NULL)`,
            [FORMAT_VERSION, origin, now, now]);
            return this.loadInstallationState(db);
        }, { mode: 'IMMEDIATE' });
    }

    async completeInstallationPreparation() {
        return this.db.withTransaction(async db => {
            const current = await this.loadInstallationState(db);
            if (!current) throw metadataError('no existe checkpoint de preparación.');
            if (current.state !== 'PREPARING') return current;

            const legacy = current.origin === 'adopted_legacy';
            const now = this.clock();
            const next = validateMetadata([{
                ...current,
                state: legacy ? 'IDENTIFIED' : 'AWAITING_INITIAL_ADMIN',
                installation_id: legacy ? crypto.randomUUID() : null,
                updated_at: now,
                confirmed_at: legacy ? now : null
            }]);
            const result = await db.run(`UPDATE ${INSTALLATION_TABLE}
                SET state = ?, installation_id = ?, updated_at = ?, confirmed_at = ?
                WHERE singleton_id = 1 AND state = 'PREPARING'`,
            [next.state, next.installation_id, next.updated_at, next.confirmed_at]);
            if (result.changes !== 1) throw metadataError('no se pudo confirmar la preparación.');
            return this.loadInstallationState(db);
        }, { mode: 'IMMEDIATE' });
    }

    async readBootstrapStatus(db) {
        const metadata = await this.loadInstallationState(db);
        if (!metadata || metadata.state === 'PREPARING') {
            throw metadataError('la preparación no está completa.');
        }
        const admins = await db.get(
            'SELECT COUNT(*) AS count FROM usuarios WHERE tipo = ? AND activo = 1',
            ['administrador']
        );
        const adminCount = Number(admins.count);
        if (metadata.state === 'AWAITING_INITIAL_ADMIN' && adminCount > 0) {
            throw metadataError('hay Admin activo en una instalación pendiente de bootstrap.');
        }
        return {
            hasAdmin: adminCount > 0,
            adminCount,
            requiresSetup: metadata.origin === 'created_empty'
                && metadata.state === 'AWAITING_INITIAL_ADMIN'
                && metadata.installation_id === null && adminCount === 0,
            administrativeRecoveryRequired: metadata.state === 'IDENTIFIED' && adminCount === 0
        };
    }

    async getBootstrapStatus() {
        // Metadata y conteo se leen en el mismo snapshot, incluso durante un bootstrap.
        return this.db.withTransaction(db => this.readBootstrapStatus(db), { mode: 'DEFERRED' });
    }

    async completeInitialBootstrap({ nombre, passwordHash }) {
        return this.db.withTransaction(async db => {
            const status = await this.readBootstrapStatus(db);
            if (!status.requiresSetup) {
                const error = new Error(status.administrativeRecoveryRequired
                    ? 'El bootstrap inicial está cerrado. Se requiere recuperación administrativa local.'
                    : 'El sistema ya fue inicializado. Inicie sesión con un administrador existente.');
                error.code = 'INITIAL_BOOTSTRAP_CLOSED';
                throw error;
            }
            if (await db.get('SELECT id FROM usuarios WHERE nombre = ?', [nombre])) {
                const error = new Error('Ya existe un usuario con ese nombre');
                error.code = 'BOOTSTRAP_USERNAME_EXISTS';
                throw error;
            }

            const now = this.clock();
            const result = await db.run(
                'INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion) VALUES (?, ?, ?, ?, ?)',
                [nombre, passwordHash, 'administrador', 1, now]
            );
            const userId = result.lastID || result.id;
            const current = await this.loadInstallationState(db);
            const next = validateMetadata([{
                ...current,
                state: 'IDENTIFIED',
                installation_id: crypto.randomUUID(),
                updated_at: now,
                confirmed_at: now
            }]);
            const updated = await db.run(`UPDATE ${INSTALLATION_TABLE}
                SET state = 'IDENTIFIED', installation_id = ?, updated_at = ?, confirmed_at = ?
                WHERE singleton_id = 1 AND origin = 'created_empty'
                    AND state = 'AWAITING_INITIAL_ADMIN' AND installation_id IS NULL`,
            [next.installation_id, now, now]);
            if (updated.changes !== 1) throw metadataError('no se pudo confirmar el bootstrap inicial.');

            await db.run(
                'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
                ['bootstrap_admin', userId, JSON.stringify({
                    version: 1,
                    event: 'bootstrap_admin',
                    userId,
                    userName: nombre,
                    installationId: next.installation_id,
                    origin: next.origin,
                    previousState: current.state,
                    state: next.state
                }), now]
            );
            return { id: userId, nombre, tipo: 'administrador', createdAt: now };
        }, { mode: 'IMMEDIATE' });
    }
}

module.exports = { InstallationStateService };
