// Caja Component · v3.1.5
// Caja distingue la venta financiera global de los movimientos individuales.
// El cobro transaccional por prefactura llegará en v3.2.x.
const Cash = {
    summary: null,
    movements: [],

    async load() {
        if (typeof Access !== 'undefined' && !Access.has('cash.access')) {
            this.renderNoAccess();
            return;
        }

        try {
            const [summaryResponse, movementsResponse] = await Promise.all([
                Utils.request('/cash/summary'),
                Utils.request('/cash/movements')
            ]);
            this.summary = summaryResponse.data || {};
            this.movements = Array.isArray(movementsResponse.data) ? movementsResponse.data : [];
            this.render();
        } catch (error) {
            console.error('Error cargando Caja:', error);
            this.renderError(error.message || 'No se pudo cargar Caja');
        }
    },

    escapeHTML(value) {
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    },

    renderMovements() {
        if (!this.movements.length) {
            return `
                <div class="dashboard-empty-state">
                    <i class="fas fa-money-bill-transfer"></i>
                    <strong>Sin movimientos de Caja hoy</strong>
                    <span>Los pagos individuales aparecerán aquí sin convertirse en ventas adicionales.</span>
                </div>
            `;
        }

        return `
            <div class="table-responsive">
                <table class="table ventas-detalle-table">
                    <thead>
                        <tr>
                            <th>Cuenta global</th>
                            <th>Cliente principal</th>
                            <th>Método</th>
                            <th>Fecha</th>
                            <th>Monto</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${this.movements.slice(0, 10).map(movement => `
                            <tr>
                                <td>${this.escapeHTML(movement.numero_cuenta || '')}</td>
                                <td>${this.escapeHTML(movement.cliente_principal || 'Cliente anónimo')}</td>
                                <td>${this.escapeHTML(movement.metodo_pago || '')}</td>
                                <td>${Utils.formatDateTime(movement.fecha)}</td>
                                <td>${Utils.formatCurrency(Number(movement.monto || 0))}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    },

    render() {
        const section = document.getElementById('cash-section');
        if (!section) return;
        const pending = Number(this.summary?.cuentas_pendientes || 0);
        const pendingBalance = Number(this.summary?.consumo_pendiente || 0);
        const globalSales = Number(this.summary?.ventas_globales_hoy || 0);
        const globalSalesCount = Number(this.summary?.cuentas_conciliadas_hoy || 0);
        const movementTotal = Number(this.summary?.movimientos_caja_hoy || 0);
        const movementCount = Number(this.summary?.cantidad_movimientos_caja_hoy || 0);

        section.innerHTML = `
            <div class="section-header cash-section-header">
                <div>
                    <span class="cash-eyebrow">Operación autorizada</span>
                    <h2><i class="fas fa-cash-register"></i> Caja</h2>
                    <p>Las ventas se consolidan por cuenta global; cada pago permanece como movimiento trazable.</p>
                </div>
            </div>
            <div class="cash-foundation-grid">
                <article class="cash-foundation-card">
                    <span class="cash-foundation-icon"><i class="fas fa-receipt"></i></span>
                    <div><small>Cuentas pendientes</small><strong>${pending}</strong></div>
                </article>
                <article class="cash-foundation-card">
                    <span class="cash-foundation-icon"><i class="fas fa-coins"></i></span>
                    <div><small>Saldo pendiente</small><strong>${Utils.formatCurrency(pendingBalance)}</strong></div>
                </article>
                <article class="cash-foundation-card">
                    <span class="cash-foundation-icon"><i class="fas fa-chart-line"></i></span>
                    <div><small>Ventas globales hoy · ${globalSalesCount}</small><strong>${Utils.formatCurrency(globalSales)}</strong></div>
                </article>
                <article class="cash-foundation-card">
                    <span class="cash-foundation-icon"><i class="fas fa-money-bill-transfer"></i></span>
                    <div><small>Movimientos hoy · ${movementCount}</small><strong>${Utils.formatCurrency(movementTotal)}</strong></div>
                </article>
            </div>
            <div class="cash-foundation-notice">
                <i class="fas fa-scale-balanced"></i>
                <div>
                    <strong>Una sola fuente financiera</strong>
                    <p>Una cuenta dividida puede producir varias prefacturas y pagos, pero Dashboard y reportes registran una única venta por el total de la cuenta global. Los totales diarios pueden diferir cuando los pagos y la conciliación final ocurren en fechas distintas.</p>
                </div>
            </div>
            <div class="cash-foundation-notice">
                <i class="fas fa-list-check"></i>
                <div style="width: 100%;">
                    <strong>Movimientos de Caja del día</strong>
                    ${this.renderMovements()}
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
        section.innerHTML = `<div class="cash-foundation-notice is-warning"><i class="fas fa-triangle-exclamation"></i><div><strong>Error cargando Caja</strong><p>${this.escapeHTML(message)}</p></div></div>`;
    }
};
