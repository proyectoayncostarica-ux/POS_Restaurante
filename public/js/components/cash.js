// Caja Component · v3.0.3
// Esta sección visible es una fachada autorizada. La lógica de cobro se implementará
// internamente en Payments durante v3.2.x sin cambiar el acceso del usuario.
const Cash = {
    summary: null,

    async load() {
        if (typeof Access !== 'undefined' && !Access.has('cash.access')) {
            this.renderNoAccess();
            return;
        }

        try {
            const response = await Utils.request('/cash/summary');
            this.summary = response.data || {};
            this.render();
        } catch (error) {
            console.error('Error cargando Caja:', error);
            this.renderError(error.message || 'No se pudo cargar Caja');
        }
    },

    render() {
        const section = document.getElementById('cash-section');
        if (!section) return;
        const pending = Number(this.summary?.cuentas_pendientes || 0);
        const total = Number(this.summary?.consumo_pendiente || 0);

        section.innerHTML = `
            <div class="section-header cash-section-header">
                <div>
                    <span class="cash-eyebrow">Operación autorizada</span>
                    <h2><i class="fas fa-cash-register"></i> Caja</h2>
                    <p>Consulta de cuentas pendientes para usuarios con capacidad de Caja.</p>
                </div>
            </div>
            <div class="cash-foundation-grid">
                <article class="cash-foundation-card">
                    <span class="cash-foundation-icon"><i class="fas fa-receipt"></i></span>
                    <div><small>Cuentas pendientes</small><strong>${pending}</strong></div>
                </article>
                <article class="cash-foundation-card">
                    <span class="cash-foundation-icon"><i class="fas fa-coins"></i></span>
                    <div><small>Consumo pendiente</small><strong>${Utils.formatCurrency(total)}</strong></div>
                </article>
            </div>
            <div class="cash-foundation-notice">
                <i class="fas fa-shield-halved"></i>
                <div>
                    <strong>Caja autorizada y separada por capacidades</strong>
                    <p>La captura transaccional de prefacturas, efectivo, tarjeta, vuelto y pagos mixtos se incorporará en v3.2.x. Esta fase valida acceso, navegación y perfil Cajero sin alterar los cobros existentes.</p>
                </div>
            </div>
        `;
    },

    renderNoAccess() {
        const section = document.getElementById('cash-section');
        if (!section) return;
        section.innerHTML = '<div class="cash-foundation-notice is-warning"><i class="fas fa-lock"></i><div><strong>Acceso restringido</strong><p>Tu sesión no tiene la capacidad cash.access.</p></div></div>';
    },

    renderError(message) {
        const section = document.getElementById('cash-section');
        if (!section) return;
        section.innerHTML = `<div class="cash-foundation-notice is-warning"><i class="fas fa-triangle-exclamation"></i><div><strong>Error cargando Caja</strong><p>${String(message || '')}</p></div></div>`;
    }
};
