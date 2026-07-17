const CAPABILITIES = Object.freeze({
    ORDERS_OPERATE: 'orders.operate',
    ORDERS_SPLIT: 'orders.split',
    ORDERS_ISSUE_PREINVOICE: 'orders.issue_preinvoice',
    ORDERS_FINALIZE_SERVICE: 'orders.finalize_service',
    CASH_ACCESS: 'cash.access',
    CASH_COLLECT: 'cash.collect',
    CASH_REPRINT: 'cash.reprint',
    CASH_REVERSE: 'cash.reverse',
    KITCHEN_OPERATE: 'kitchen.operate',
    PRINTING_CONFIGURE: 'printing.configure',
    PRINTING_RETRY: 'printing.retry'
});

const CAPABILITY_DEFINITIONS = Object.freeze([
    { code: CAPABILITIES.ORDERS_OPERATE, name: 'Operar cuentas', description: 'Crear pedidos, agregar productos y consultar consumo activo.', category: 'Cuentas' },
    { code: CAPABILITIES.ORDERS_SPLIT, name: 'Dividir cuentas', description: 'Asignar ítems y cantidades a prefacturas parciales.', category: 'Cuentas' },
    { code: CAPABILITIES.ORDERS_ISSUE_PREINVOICE, name: 'Emitir prefacturas', description: 'Emitir prefacturas globales o parciales.', category: 'Cuentas' },
    { code: CAPABILITIES.ORDERS_FINALIZE_SERVICE, name: 'Finalizar servicio', description: 'Solicitar el cierre operativo definitivo de una mesa o banco.', category: 'Cuentas' },
    { code: CAPABILITIES.CASH_ACCESS, name: 'Acceder a Caja', description: 'Ver la sección Caja y consultar documentos pendientes de cobro.', category: 'Caja' },
    { code: CAPABILITIES.CASH_COLLECT, name: 'Registrar cobros', description: 'Registrar pagos de prefacturas desde Caja.', category: 'Caja' },
    { code: CAPABILITIES.CASH_REPRINT, name: 'Reimprimir comprobantes', description: 'Solicitar reimpresiones autorizadas desde Caja.', category: 'Caja' },
    { code: CAPABILITIES.CASH_REVERSE, name: 'Reversar cobros', description: 'Anular o reversar cobros con trazabilidad.', category: 'Caja' },
    { code: CAPABILITIES.KITCHEN_OPERATE, name: 'Operar comandas', description: 'Enviar y gestionar comandas de preparación.', category: 'Cocina' },
    { code: CAPABILITIES.PRINTING_CONFIGURE, name: 'Configurar impresión', description: 'Administrar impresoras y formatos.', category: 'Impresión' },
    { code: CAPABILITIES.PRINTING_RETRY, name: 'Reintentar impresión', description: 'Reintentar trabajos de impresión fallidos.', category: 'Impresión' }
]);

const CASHIER_CAPABILITIES = Object.freeze([
    CAPABILITIES.CASH_ACCESS,
    CAPABILITIES.CASH_COLLECT,
    CAPABILITIES.CASH_REPRINT
]);

const OPERATIONAL_ROLE_DEFAULTS = Object.freeze([
    CAPABILITIES.ORDERS_OPERATE,
    CAPABILITIES.ORDERS_SPLIT,
    CAPABILITIES.ORDERS_ISSUE_PREINVOICE,
    CAPABILITIES.ORDERS_FINALIZE_SERVICE,
    CAPABILITIES.KITCHEN_OPERATE
]);

// Compatibilidad temporal: roles existentes conservan la posibilidad de cobrar hasta que
// el administrador revise y retire estas capacidades de forma explícita.
const LEGACY_ROLE_BACKFILL = Object.freeze([
    ...OPERATIONAL_ROLE_DEFAULTS,
    CAPABILITIES.CASH_ACCESS,
    CAPABILITIES.CASH_COLLECT,
    CAPABILITIES.CASH_REPRINT
]);

module.exports = {
    CAPABILITIES,
    CAPABILITY_DEFINITIONS,
    CASHIER_CAPABILITIES,
    OPERATIONAL_ROLE_DEFAULTS,
    LEGACY_ROLE_BACKFILL
};
