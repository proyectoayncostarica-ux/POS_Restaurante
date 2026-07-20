const PrintingClient = {
    openJob(job, targetWindow = null, options = {}) {
        const autoPrint = options.autoPrint !== false;
        const popup = targetWindow || window.open('', '_blank', 'width=760,height=900');
        if (!popup) {
            if (typeof Utils !== 'undefined') {
                Utils.showNotification('El navegador bloqueó la ventana de impresión.', 'warning');
            }
            return false;
        }

        const html = job?.resultado?.contenido;
        if (!html) {
            popup.document.open();
            popup.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Printing</title></head><body style="font-family:Arial,sans-serif;padding:24px"><h2>Documento enviado a Printing</h2><p>Trabajo #${Number(job?.id || 0)} · Estado: ${String(job?.estado || 'pendiente')}</p><p>La salida aún no está disponible. El trabajo permanece auditado en la cola.</p></body></html>`);
            popup.document.close();
            return true;
        }

        popup.document.open();
        popup.document.write(html);
        popup.document.close();
        popup.focus();
        if (autoPrint) {
            setTimeout(() => {
                try { popup.print(); } catch (_error) { /* El usuario puede imprimir manualmente. */ }
            }, 120);
        }
        return true;
    },

    openResponse(response, targetWindow = null, options = {}) {
        return this.openJob(response?.printing || response?.data?.printing || null, targetWindow, options);
    }
};

window.PrintingClient = PrintingClient;
