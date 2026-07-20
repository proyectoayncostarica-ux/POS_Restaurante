/**
 * @deprecated v3.6.0
 *
 * La API pública duplicada /api/credits fue retirada. El dominio canónico de
 * créditos vive en /api/accounts y delega en creditService/Payments. Este
 * archivo se conserva únicamente como shim de importación para código externo
 * que todavía resuelva la ruta física; server/app.js no lo monta.
 */
module.exports = require('./accounts');
