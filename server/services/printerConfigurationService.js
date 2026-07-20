const database = require('../db/database');
const { ValidationError } = require('../errors/domainError');

const PRINTER_DESTINATIONS = Object.freeze({
    CASH: 'caja',
    KITCHEN: 'cocina',
    BAR: 'bar'
});

const SUPPORTED_PAPER_SIZES = Object.freeze(['58mm', '80mm', 'a4', 'carta']);
const CONFIG_PREFIX = 'printing.printer.';

const DEFAULT_CONFIGS = Object.freeze({
    [PRINTER_DESTINATIONS.CASH]: Object.freeze({
        destino: PRINTER_DESTINATIONS.CASH,
        nombre: 'Navegador / PDF · Caja',
        adaptador: 'navegador_pdf',
        tamano_papel: '80mm',
        copias: 1,
        autoimpresion: true,
        plantilla_codigo: null,
        activa: true,
        estado_dispositivo: 'disponible',
        ultimo_test_en: null,
        ultimo_error: null
    }),
    [PRINTER_DESTINATIONS.KITCHEN]: Object.freeze({
        destino: PRINTER_DESTINATIONS.KITCHEN,
        nombre: 'Navegador / PDF · Cocina',
        adaptador: 'navegador_pdf',
        tamano_papel: '80mm',
        copias: 1,
        autoimpresion: true,
        plantilla_codigo: null,
        activa: true,
        estado_dispositivo: 'disponible',
        ultimo_test_en: null,
        ultimo_error: null
    }),
    [PRINTER_DESTINATIONS.BAR]: Object.freeze({
        destino: PRINTER_DESTINATIONS.BAR,
        nombre: 'Navegador / PDF · Bar',
        adaptador: 'navegador_pdf',
        tamano_papel: '80mm',
        copias: 1,
        autoimpresion: true,
        plantilla_codigo: null,
        activa: true,
        estado_dispositivo: 'disponible',
        ultimo_test_en: null,
        ultimo_error: null
    })
});

function normalizeDestination(value) {
    const destination = String(value || '').trim().toLowerCase();
    if (!Object.values(PRINTER_DESTINATIONS).includes(destination)) {
        throw new ValidationError('Destino de impresora inválido', { destino: value });
    }
    return destination;
}

function normalizeText(value, field, maxLength = 180, allowNull = false) {
    const text = String(value ?? '').trim();
    if (!text) {
        if (allowNull) return null;
        throw new ValidationError(`${field} es requerido`);
    }
    if (text.length > maxLength) throw new ValidationError(`${field} supera la longitud permitida`);
    return text;
}

function normalizeBoolean(value, fallback) {
    if (value === null || typeof value === 'undefined' || value === '') return Boolean(fallback);
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'si', 'sí', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return Boolean(fallback);
}

function normalizeCopies(value, fallback = 1) {
    const copies = Number(value ?? fallback);
    if (!Number.isSafeInteger(copies) || copies < 1 || copies > 10) {
        throw new ValidationError('copias debe estar entre 1 y 10');
    }
    return copies;
}

function safeJsonParse(value) {
    if (!value) return null;
    try {
        return JSON.parse(value);
    } catch (_error) {
        return null;
    }
}

class PrinterConfigurationService {
    constructor(options = {}) {
        this.db = options.db || database;
    }

    configKey(destination) {
        return `${CONFIG_PREFIX}${normalizeDestination(destination)}`;
    }

    getDefault(destination) {
        const normalized = normalizeDestination(destination);
        return { ...DEFAULT_CONFIGS[normalized] };
    }

    normalizeConfig(destination, input = {}, base = null) {
        const normalizedDestination = normalizeDestination(destination);
        const defaults = base || this.getDefault(normalizedDestination);
        const paper = String(input.tamano_papel ?? input.paperSize ?? defaults.tamano_papel).trim().toLowerCase();
        if (!SUPPORTED_PAPER_SIZES.includes(paper)) {
            throw new ValidationError('Tamaño de papel no soportado', {
                tamano_papel: paper,
                permitidos: SUPPORTED_PAPER_SIZES
            });
        }

        return {
            destino: normalizedDestination,
            nombre: normalizeText(input.nombre ?? input.printerName ?? defaults.nombre, 'nombre', 180),
            adaptador: normalizeText(input.adaptador ?? input.adapter ?? defaults.adaptador, 'adaptador', 80),
            tamano_papel: paper,
            copias: normalizeCopies(input.copias ?? input.copies, defaults.copias),
            autoimpresion: normalizeBoolean(input.autoimpresion ?? input.autoPrint, defaults.autoimpresion),
            plantilla_codigo: normalizeText(
                input.plantilla_codigo ?? input.templateCode ?? defaults.plantilla_codigo,
                'plantilla_codigo',
                120,
                true
            ),
            activa: normalizeBoolean(input.activa ?? input.active, defaults.activa),
            estado_dispositivo: normalizeText(
                input.estado_dispositivo ?? defaults.estado_dispositivo ?? 'desconocido',
                'estado_dispositivo',
                40
            ),
            ultimo_test_en: input.ultimo_test_en ?? defaults.ultimo_test_en ?? null,
            ultimo_error: input.ultimo_error ?? defaults.ultimo_error ?? null
        };
    }

    async ensureDefaults() {
        for (const destination of Object.values(PRINTER_DESTINATIONS)) {
            const key = this.configKey(destination);
            const existing = await this.db.get('SELECT valor FROM configuracion WHERE clave = ?', [key]);
            if (existing) continue;

            const defaults = this.getDefault(destination);
            if (destination === PRINTER_DESTINATIONS.CASH) {
                const legacy = await this.db.get("SELECT valor FROM configuracion WHERE clave = 'impresora'");
                if (legacy?.valor && String(legacy.valor).trim()) defaults.nombre = String(legacy.valor).trim();
            }

            await this.db.run(
                'INSERT OR IGNORE INTO configuracion (clave, valor) VALUES (?, ?)',
                [key, JSON.stringify(defaults)]
            );
        }
    }

    async get(destination) {
        const normalizedDestination = normalizeDestination(destination);
        await this.ensureDefaults();
        const row = await this.db.get('SELECT valor FROM configuracion WHERE clave = ?', [this.configKey(normalizedDestination)]);
        const stored = safeJsonParse(row?.valor) || {};
        return this.normalizeConfig(normalizedDestination, stored, this.getDefault(normalizedDestination));
    }

    async list() {
        const result = {};
        for (const destination of Object.values(PRINTER_DESTINATIONS)) {
            result[destination] = await this.get(destination);
        }
        return result;
    }

    async update(destination, input = {}) {
        const normalizedDestination = normalizeDestination(destination);
        const current = await this.get(normalizedDestination);
        const next = this.normalizeConfig(normalizedDestination, input, current);
        const deviceChanged = next.nombre !== current.nombre || next.adaptador !== current.adaptador;
        next.estado_dispositivo = deviceChanged ? 'desconocido' : (current.estado_dispositivo || 'desconocido');
        next.ultimo_test_en = deviceChanged ? null : (current.ultimo_test_en || null);
        next.ultimo_error = deviceChanged ? null : (current.ultimo_error || null);

        await this.db.run(
            `INSERT INTO configuracion (clave, valor)
             VALUES (?, ?)
             ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`,
            [this.configKey(normalizedDestination), JSON.stringify(next)]
        );
        return next;
    }

    async recordDeviceStatus(destination, status = {}) {
        const normalizedDestination = normalizeDestination(destination);
        const current = await this.get(normalizedDestination);
        const next = {
            ...current,
            estado_dispositivo: normalizeText(status.estado || status.state || 'desconocido', 'estado_dispositivo', 40),
            ultimo_test_en: status.fecha || status.testedAt || new Date().toISOString(),
            ultimo_error: status.error ? String(status.error).slice(0, 500) : null
        };
        await this.db.run(
            `INSERT INTO configuracion (clave, valor)
             VALUES (?, ?)
             ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`,
            [this.configKey(normalizedDestination), JSON.stringify(next)]
        );
        return next;
    }

    inferDestination({ documentType, documento_tipo, payload = {} } = {}) {
        const type = String(documentType || documento_tipo || payload.documento || '').trim().toLowerCase();
        if (type === 'comanda') {
            return String(payload.destino || '').trim().toLowerCase() === PRINTER_DESTINATIONS.BAR
                ? PRINTER_DESTINATIONS.BAR
                : PRINTER_DESTINATIONS.KITCHEN;
        }
        return PRINTER_DESTINATIONS.CASH;
    }

    async resolveForDocument(input = {}) {
        const destination = input.destination || input.destino_impresion || this.inferDestination(input);
        return this.get(destination);
    }
}

const printerConfigurationService = new PrinterConfigurationService();

module.exports = printerConfigurationService;
module.exports.PrinterConfigurationService = PrinterConfigurationService;
module.exports.PRINTER_DESTINATIONS = PRINTER_DESTINATIONS;
module.exports.SUPPORTED_PAPER_SIZES = SUPPORTED_PAPER_SIZES;
module.exports.DEFAULT_CONFIGS = DEFAULT_CONFIGS;
