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

function defaultDocumentHtml(payload) {
    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Documento MundiPOS</title>
<style>
body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:24px;color:#172033}
pre{white-space:pre-wrap;word-break:break-word;font:14px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace}
</style>
</head>
<body><pre>${escapeHtml(JSON.stringify(payload, null, 2))}</pre></body>
</html>`;
}

class BrowserPdfAdapter {
    constructor() {
        this.code = 'navegador_pdf';
    }

    async render({ payload, template = null, job = null } = {}) {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            throw new ValidationError('Printing requiere un payload canónico de documento');
        }

        const content = template?.contenido
            ? interpolate(template.contenido, payload)
            : defaultDocumentHtml(payload);
        const documentNumber = job?.documento_numero || payload.numero_documento || payload.numero || 'documento';
        const safeName = String(documentNumber).replace(/[^A-Za-z0-9._-]+/g, '-');

        return {
            adaptador: this.code,
            mime_type: 'text/html; charset=utf-8',
            contenido: content,
            nombre_archivo_sugerido: `${safeName}.html`,
            modo_salida: 'vista_previa_navegador_pdf'
        };
    }
}

module.exports = {
    BrowserPdfAdapter,
    escapeHtml,
    interpolate
};
