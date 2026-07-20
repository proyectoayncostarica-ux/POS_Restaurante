const { ValidationError } = require('../../errors/domainError');

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function readPath(source, path) {
    return String(path || '')
        .split('.')
        .filter(Boolean)
        .reduce((current, key) => (current === null || typeof current === 'undefined') ? undefined : current[key], source);
}

function interpolate(template, payload) {
    return String(template || '').replace(/{{\s*([A-Za-z0-9_.-]+)\s*}}/g, (_match, path) => {
        const value = readPath(payload, path);
        if (value === null || typeof value === 'undefined') return '';
        if (typeof value === 'object') return escapeHtml(JSON.stringify(value));
        return escapeHtml(value);
    });
}

function formatMoney(value) {
    const numeric = Number(value || 0);
    try {
        return new Intl.NumberFormat('es-CR', {
            style: 'currency',
            currency: 'CRC',
            maximumFractionDigits: 2
        }).format(numeric);
    } catch (_error) {
        return `₡${numeric.toFixed(2)}`;
    }
}

function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return escapeHtml(value);
    return escapeHtml(new Intl.DateTimeFormat('es-CR', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'America/Costa_Rica'
    }).format(date));
}

function layout({ title, subtitle = '', body, footer = 'MundiPOS' }) {
    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:24px;line-height:1.35;background:#fff}
h1{font-size:22px;margin:0 0 4px}.subtitle{color:#555;margin-bottom:18px}.meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 18px;margin:14px 0;padding:12px;border:1px solid #bbb;border-radius:8px}
table{width:100%;border-collapse:collapse;margin-top:14px}th,td{padding:7px 6px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}th{font-size:12px;text-transform:uppercase;color:#555}th.num,td.num{text-align:right}.totals{margin:18px 0 0 auto;max-width:340px}.totals p{display:flex;justify-content:space-between;gap:24px;margin:6px 0}.grand{font-size:18px;border-top:2px solid #111;padding-top:8px}.note{margin-top:14px;padding:10px;border-left:4px solid #777;background:#f5f5f5}.footer{margin-top:28px;font-size:12px;color:#666;text-align:center}.ticket h1{font-size:26px}.ticket .meta{grid-template-columns:1fr}.ticket table{font-size:16px}.ticket td:first-child{font-weight:700}.badge{display:inline-block;padding:3px 7px;border:1px solid #777;border-radius:999px;font-size:12px;text-transform:uppercase}
@media(max-width:600px){body{margin:14px}.meta{grid-template-columns:1fr}}@media print{body{margin:8mm}.footer{page-break-inside:avoid}}
</style>
</head>
<body>${body}<div class="footer">${escapeHtml(footer)}</div></body>
</html>`;
}

function itemLabel(item = {}) {
    const name = item.producto_nombre_snapshot || item.producto_nombre || item.nombre || 'Producto';
    const presentation = item.presentacion_nombre_snapshot || item.presentacion_nombre;
    const quantity = item.presentacion_cantidad_snapshot || item.presentacion_cantidad;
    return [name, presentation, quantity].filter(Boolean).map(escapeHtml).join(' · ');
}

function renderPreinvoice(payload) {
    const rows = (payload.items || []).map(item => `
<tr><td>${itemLabel(item)}</td><td class="num">${escapeHtml(item.cantidad)}</td><td class="num">${formatMoney(item.precio_unitario)}</td><td class="num">${formatMoney(item.total_linea)}</td></tr>`).join('');
    const seatLabel = String(payload.mesa?.tipo || '').toLowerCase() === 'banco' ? 'Banco' : 'Mesa';
    return layout({
        title: `${payload.documento === 'prefactura_parcial' ? 'Prefactura parcial' : 'Prefactura'} ${payload.numero_documento || ''}`,
        subtitle: `Documento operativo · Cuenta ${escapeHtml(payload.cuenta || '')}`,
        body: `
<h1>${payload.documento === 'prefactura_parcial' ? 'Prefactura parcial' : 'Prefactura'} ${escapeHtml(payload.numero_documento || '')}</h1>
<div class="subtitle">Documento operativo vinculado a la cuenta global; no constituye una venta independiente.</div>
<div class="meta">
<div><strong>Pagador:</strong> ${escapeHtml(payload.pagador || '')}</div><div><strong>Cliente principal:</strong> ${escapeHtml(payload.cliente_principal || '')}</div>
<div><strong>${seatLabel}:</strong> ${escapeHtml(payload.mesa?.numero || '')}</div><div><strong>Zona:</strong> ${escapeHtml(payload.mesa?.zona || '')}</div>
<div><strong>Fecha:</strong> ${formatDate(payload.fecha_emision)}</div><div><strong>Tipo:</strong> ${escapeHtml(payload.tipo || '')}</div>
</div>
<table><thead><tr><th>Producto</th><th class="num">Cant.</th><th class="num">Precio</th><th class="num">Total</th></tr></thead><tbody>${rows}</tbody></table>
<div class="totals"><p><span>Subtotal</span><strong>${formatMoney(payload.subtotal)}</strong></p><p><span>Servicio</span><strong>${formatMoney(payload.servicio)}</strong></p><p class="grand"><span>Total</span><strong>${formatMoney(payload.total)}</strong></p></div>
${payload.observacion ? `<div class="note"><strong>Observación:</strong> ${escapeHtml(payload.observacion)}</div>` : ''}`
    });
}

function renderPayment(payload) {
    const tenders = (payload.medios_pago || []).map(item => `
<tr><td>${escapeHtml(item.tipo || '')}</td><td class="num">${formatMoney(item.monto_aplicado)}</td><td>${escapeHtml(item.referencia || '')}</td></tr>`).join('');
    const isCredit = payload.documento === 'abono_credito';
    return layout({
        title: `${isCredit ? 'Abono de crédito' : 'Recibo de cobro'} ${payload.numero_documento || ''}`,
        body: `
<h1>${isCredit ? 'Abono de crédito' : 'Recibo de cobro'} ${escapeHtml(payload.numero_documento || '')}</h1>
<div class="meta">
<div><strong>Fecha:</strong> ${formatDate(payload.fecha)}</div><div><strong>Cuenta:</strong> ${escapeHtml(payload.numero_cuenta || '')}</div>
<div><strong>Prefactura:</strong> ${escapeHtml(payload.numero_prefactura || '')}</div><div><strong>Crédito:</strong> ${escapeHtml(payload.numero_credito || '')}</div>
<div><strong>Pagador:</strong> ${escapeHtml(payload.pagador || '')}</div><div><strong>Cajero:</strong> ${escapeHtml(payload.cajero || '')}</div>
<div><strong>Método:</strong> ${escapeHtml(payload.metodo_pago || '')}</div><div><strong>Referencia:</strong> ${escapeHtml(payload.referencia || '')}</div>
</div>
${tenders ? `<table><thead><tr><th>Medio</th><th class="num">Aplicado</th><th>Referencia</th></tr></thead><tbody>${tenders}</tbody></table>` : ''}
<div class="totals"><p><span>Monto aplicado</span><strong>${formatMoney(payload.monto)}</strong></p><p><span>Recibido</span><strong>${formatMoney(payload.monto_recibido)}</strong></p><p class="grand"><span>Vuelto</span><strong>${formatMoney(payload.vuelto)}</strong></p></div>`
    });
}

function renderCredit(payload) {
    return layout({
        title: `Comprobante de crédito ${payload.numero_documento || ''}`,
        body: `
<h1>Comprobante de crédito ${escapeHtml(payload.numero_documento || '')}</h1>
<div class="meta">
<div><strong>Fecha:</strong> ${formatDate(payload.fecha)}</div><div><strong>Estado:</strong> ${escapeHtml(payload.estado || '')}</div>
<div><strong>Cliente:</strong> ${escapeHtml(payload.cliente || '')}</div><div><strong>Pagador:</strong> ${escapeHtml(payload.pagador || '')}</div>
<div><strong>Cuenta:</strong> ${escapeHtml(payload.numero_cuenta || '')}</div><div><strong>Prefactura:</strong> ${escapeHtml(payload.numero_prefactura || '')}</div>
<div><strong>Mesa/Banco:</strong> ${escapeHtml(payload.mesa || '')}</div><div><strong>Zona:</strong> ${escapeHtml(payload.zona || '')}</div>
<div><strong>Creado por:</strong> ${escapeHtml(payload.creado_por || '')}</div><div><strong>Autorizado por:</strong> ${escapeHtml(payload.autorizado_por || '')}</div>
</div>
<div class="totals"><p><span>Monto original</span><strong>${formatMoney(payload.monto_original)}</strong></p><p><span>Total abonado</span><strong>${formatMoney(payload.total_abonado)}</strong></p><p class="grand"><span>Saldo pendiente</span><strong>${formatMoney(payload.saldo_pendiente)}</strong></p></div>
${payload.observacion ? `<div class="note"><strong>Observación:</strong> ${escapeHtml(payload.observacion)}</div>` : ''}`
    });
}

function renderKitchen(payload) {
    const rows = (payload.items || []).map(item => {
        const additions = Array.isArray(item.adicionales_snapshot) ? item.adicionales_snapshot : [];
        const additionsText = additions.map(add => add.nombre || add.producto_nombre || String(add)).filter(Boolean).join(', ');
        return `<tr><td>${itemLabel(item)}</td><td class="num">${escapeHtml(item.cantidad_delta || item.cantidad || 0)}</td><td>${escapeHtml(item.observacion_snapshot || '')}${additionsText ? `<br><small>Adicionales: ${escapeHtml(additionsText)}</small>` : ''}</td></tr>`;
    }).join('');
    return layout({
        title: `Comanda ${payload.numero_documento || ''}`,
        footer: 'MundiPOS · Documento operativo de preparación',
        body: `<div class="ticket"><h1>Comanda ${escapeHtml(payload.numero_documento || '')}</h1><div class="subtitle"><span class="badge">${escapeHtml(payload.destino || 'cocina')}</span></div>
<div class="meta"><div><strong>Cuenta:</strong> ${escapeHtml(payload.cuenta || '')}</div><div><strong>${String(payload.mesa?.tipo || '').toLowerCase() === 'banco' ? 'Banco' : 'Mesa'}:</strong> ${escapeHtml(payload.mesa?.numero || '')}</div><div><strong>Zona:</strong> ${escapeHtml(payload.mesa?.zona || '')}</div><div><strong>Solicitante:</strong> ${escapeHtml(payload.solicitante || '')}</div><div><strong>Hora:</strong> ${formatDate(payload.solicitada_en)}</div></div>
<table><thead><tr><th>Producto</th><th class="num">Cant.</th><th>Indicaciones</th></tr></thead><tbody>${rows}</tbody></table>${payload.motivo ? `<div class="note"><strong>Motivo:</strong> ${escapeHtml(payload.motivo)}</div>` : ''}</div>`
    });
}

function renderDailyClose(payload) {
    const summary = payload.resumen || {};
    return layout({
        title: `Cierre diario ${payload.numero_documento || ''}`,
        body: `<h1>Cierre diario ${escapeHtml(payload.numero_documento || '')}</h1>
<div class="meta"><div><strong>Desde:</strong> ${formatDate(payload.desde)}</div><div><strong>Hasta:</strong> ${formatDate(payload.hasta)}</div><div><strong>Cuentas conciliadas:</strong> ${escapeHtml(summary.cuentas_conciliadas || 0)}</div><div><strong>Movimientos de Caja:</strong> ${escapeHtml(summary.cantidad_movimientos_caja || 0)}</div></div>
<div class="totals"><p><span>Ventas globales</span><strong>${formatMoney(summary.total_ventas_globales)}</strong></p><p><span>Movimientos de Caja</span><strong>${formatMoney(summary.total_movimientos_caja)}</strong></p><p class="grand"><span>Diferencia contextual</span><strong>${formatMoney(summary.diferencia_periodo)}</strong></p></div>`
    });
}


function applyPrintSettings(html, job = {}) {
    const paperSize = String(job?.tamano_papel || '80mm').toLowerCase();
    const pageSize = paperSize === '58mm'
        ? '58mm auto'
        : paperSize === '80mm'
            ? '80mm auto'
            : paperSize === 'carta'
                ? 'letter'
                : 'A4';
    const pageMargin = ['58mm', '80mm'].includes(paperSize) ? '4mm' : '10mm';
    let configured = String(html || '').replace(
        '</style>',
        `@page{size:${pageSize};margin:${pageMargin}}.print-copy{page-break-after:always}.print-copy:last-child{page-break-after:auto}</style>`
    );

    const copies = Math.max(1, Math.min(10, Number(job?.copias_fisicas || 1)));
    if (copies <= 1) return configured;
    const match = configured.match(/<body>([\s\S]*)<\/body>/i);
    if (!match) return configured;
    const repeated = Array.from({ length: copies }, (_value, index) =>
        `<section class="print-copy" data-copy="${index + 1}">${match[1]}</section>`
    ).join('');
    return configured.replace(match[0], `<body>${repeated}</body>`);
}

function renderPrinterTest(payload) {
    return layout({
        title: `Prueba de impresión ${payload.destino || ''}`,
        footer: 'MundiPOS · Configuración de impresoras',
        body: `<h1>Prueba de impresión</h1>
<div class="subtitle">La configuración fue ejecutada por Printing.</div>
<div class="meta"><div><strong>Destino:</strong> ${escapeHtml(payload.destino || '')}</div><div><strong>Impresora:</strong> ${escapeHtml(payload.impresora || '')}</div><div><strong>Papel:</strong> ${escapeHtml(payload.tamano_papel || '')}</div><div><strong>Copias:</strong> ${escapeHtml(payload.copias || 1)}</div><div><strong>Fecha:</strong> ${formatDate(payload.fecha)}</div></div>
<div class="note">${escapeHtml(payload.mensaje || 'Prueba de impresión MundiPOS')}</div>`
    });
}
function defaultDocumentHtml(payload) {
    return layout({
        title: payload.numero_documento || payload.numero || 'Documento MundiPOS',
        body: `<pre style="white-space:pre-wrap;word-break:break-word;font:14px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace">${escapeHtml(JSON.stringify(payload, null, 2))}</pre>`
    });
}

function renderCanonicalDocument(payload) {
    switch (String(payload.documento || '').toLowerCase()) {
        case 'prefactura':
        case 'prefactura_parcial':
            return renderPreinvoice(payload);
        case 'recibo_cobro':
        case 'abono_credito':
            return renderPayment(payload);
        case 'comprobante_credito':
            return renderCredit(payload);
        case 'comanda':
            return renderKitchen(payload);
        case 'cierre_diario':
            return renderDailyClose(payload);
        case 'prueba_impresion':
            return renderPrinterTest(payload);
        default:
            return defaultDocumentHtml(payload);
    }
}

class BrowserPdfAdapter {
    constructor() {
        this.code = 'navegador_pdf';
    }

    async render({ payload, template = null, job = null } = {}) {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            throw new ValidationError('Printing requiere un payload canónico de documento');
        }

        const baseContent = template?.contenido
            ? interpolate(template.contenido, payload)
            : renderCanonicalDocument(payload);
        const content = applyPrintSettings(baseContent, job);
        const documentNumber = job?.documento_numero || payload.numero_documento || payload.numero || 'documento';
        const safeName = String(documentNumber).replace(/[^A-Za-z0-9._-]+/g, '-');

        return {
            adaptador: this.code,
            mime_type: 'text/html; charset=utf-8',
            contenido: content,
            nombre_archivo_sugerido: `${safeName}.html`,
            modo_salida: 'vista_previa_navegador_pdf',
            destino_impresion: job?.destino_impresion || payload.destino || 'caja',
            impresora_nombre: job?.impresora_nombre || null,
            tamano_papel: job?.tamano_papel || '80mm',
            copias_fisicas: Math.max(1, Number(job?.copias_fisicas || 1))
        };
    }
}

module.exports = {
    BrowserPdfAdapter,
    escapeHtml,
    interpolate,
    renderCanonicalDocument
};
