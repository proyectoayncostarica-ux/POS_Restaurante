// Créditos · v3.2.4
// Vista canónica de deudas formalizadas desde prefacturas. Los abonos pasan por Payments.
const Accounts = {
    accounts: [],
    summary: null,
    selected: null,
    loading: false,

    has(capability) {
        return typeof Access !== 'undefined' && Access.has(capability);
    },

    async load() {
        const section = document.getElementById('accounts-section');
        if (!section) return;
        if (!this.has('cash.access')) {
            section.innerHTML = '<div class="cash-foundation-notice is-warning"><i class="fas fa-lock"></i><div><strong>Acceso restringido</strong><p>Se requiere la capacidad cash.access para consultar créditos.</p></div></div>';
            return;
        }
        this.loading = true;
        this.render();
        try {
            const [accountsResponse, summaryResponse] = await Promise.all([
                Utils.request('/accounts?estado=activos'),
                Utils.request('/accounts/summary/stats')
            ]);
            this.accounts = Array.isArray(accountsResponse.data) ? accountsResponse.data : [];
            this.summary = summaryResponse.data || null;
        } catch (error) {
            Utils.showNotification(error.message || 'No se pudieron cargar los créditos.', 'error');
        } finally {
            this.loading = false;
            this.render();
        }
    },

    render() {
        const section = document.getElementById('accounts-section');
        if (!section) return;
        section.innerHTML = `
            <div class="section-header accounts-header">
                <div>
                    <span class="cash-eyebrow">Cartera vinculada a cuentas globales</span>
                    <h2><i class="fas fa-file-invoice-dollar"></i> Créditos</h2>
                    <p>Los créditos se crean únicamente desde prefacturas autorizadas en Caja. Esta vista registra abonos sin duplicar la venta.</p>
                </div>
                <button class="btn btn-light" onclick="Accounts.load()" ${this.loading ? 'disabled' : ''}>
                    <i class="fas fa-rotate ${this.loading ? 'fa-spin' : ''}"></i> Actualizar
                </button>
            </div>
            ${this.renderSummary()}
            <div class="accounts-content">${this.renderAccountsTable()}</div>
            ${this.renderClientSummary()}
            <div class="cash-foundation-notice">
                <i class="fas fa-scale-balanced"></i>
                <div><strong>Una sola fuente financiera</strong><p>CR-######## representa una deuda derivada de una prefactura. La venta continúa perteneciendo únicamente a CTA-########.</p></div>
            </div>
        `;
    },

    renderSummary() {
        const summary = this.summary || { total_cuentas: 0, monto_total_pendiente: 0 };
        return `
            <div class="cash-summary-grid accounts-credit-summary">
                <article><span>Créditos activos</span><strong>${Number(summary.total_cuentas || 0)}</strong></article>
                <article><span>Saldo por cobrar</span><strong>${Utils.formatCurrency(Number(summary.monto_total_pendiente || 0))}</strong></article>
                <article><span>Origen</span><strong>Prefacturas</strong></article>
            </div>
        `;
    },

    renderAccountsTable() {
        if (this.loading && !this.accounts.length) {
            return '<div class="cash-panel-loading"><i class="fas fa-spinner fa-spin"></i><span>Cargando créditos…</span></div>';
        }
        if (!this.accounts.length) {
            return '<div class="cash-detail-empty"><i class="fas fa-circle-check"></i><strong>No hay créditos pendientes</strong><span>Los créditos autorizados desde Caja aparecerán aquí.</span></div>';
        }
        return `
            <div class="table-responsive">
                <table class="table credit-table">
                    <thead><tr><th>Crédito</th><th>Cuenta / documento</th><th>Deudor</th><th>Original</th><th>Abonado</th><th>Saldo</th><th>Estado</th><th>Acciones</th></tr></thead>
                    <tbody>${this.accounts.map(account => `
                        <tr>
                            <td><strong>${this.escape(account.numero_credito || `CR-${account.id}`)}</strong><small>${Utils.formatDate(account.fecha)}</small></td>
                            <td><strong>${this.escape(account.numero_cuenta_snapshot || '')}</strong><small>${this.escape(account.numero_documento_snapshot || '')}</small></td>
                            <td><strong>${this.escape(account.cliente_nombre || '')}</strong><small>${this.escape(account.cliente_principal_snapshot || '')}</small></td>
                            <td>${Utils.formatCurrency(Number(account.monto_original || 0))}</td>
                            <td>${Utils.formatCurrency(Number(account.total_abonado || 0))}</td>
                            <td><strong>${Utils.formatCurrency(Number(account.saldo_pendiente || 0))}</strong></td>
                            <td><span class="cash-document-status ${account.estado === 'parcial' ? 'is-partial' : 'is-issued'}">${this.escape(account.estado || '')}</span></td>
                            <td><div class="d-flex gap-1">
                                <button class="btn btn-light btn-sm" onclick="Accounts.showDetail(${Number(account.id)})"><i class="fas fa-eye"></i> Ver</button>
                                ${this.has('cash.collect') ? `<button class="btn btn-success btn-sm" onclick="Accounts.showPaymentModal(${Number(account.id)})"><i class="fas fa-money-bill-transfer"></i> Abonar</button>` : ''}
                            </div></td>
                        </tr>
                    `).join('')}</tbody>
                </table>
            </div>
        `;
    },

    renderClientSummary() {
        const rows = this.summary?.cuentas_por_cliente;
        if (!Array.isArray(rows) || !rows.length) return '';
        return `
            <section class="client-summary mt-4">
                <h3>Saldo por cliente pagador</h3>
                <div class="table-responsive"><table class="table">
                    <thead><tr><th>Cliente</th><th>Créditos</th><th>Saldo</th></tr></thead>
                    <tbody>${rows.map(row => `<tr><td>${this.escape(row.cliente_nombre)}</td><td>${Number(row.num_cuentas || 0)}</td><td>${Utils.formatCurrency(Number(row.monto_total || 0))}</td></tr>`).join('')}</tbody>
                </table></div>
            </section>
        `;
    },

    async showDetail(id) {
        try {
            const response = await Utils.request(`/accounts/credit/${Number(id)}`);
            const credit = response.data;
            this.selected = credit;
            const payments = Array.isArray(credit.abonos) ? credit.abonos : [];
            Utils.showModal(`Crédito ${this.escape(credit.numero_credito)}`, `
                <div class="credit-detail-grid">
                    <div><small>Cuenta global</small><strong>${this.escape(credit.numero_cuenta_snapshot || '')}</strong></div>
                    <div><small>Prefactura</small><strong>${this.escape(credit.numero_documento_snapshot || '')}</strong></div>
                    <div><small>Deudor</small><strong>${this.escape(credit.cliente_nombre || '')}</strong></div>
                    <div><small>Autorizado por</small><strong>${this.escape(credit.autorizado_por || '')}</strong></div>
                    <div><small>Monto original</small><strong>${Utils.formatCurrency(Number(credit.monto_original || 0))}</strong></div>
                    <div><small>Saldo</small><strong>${Utils.formatCurrency(Number(credit.saldo_pendiente || 0))}</strong></div>
                </div>
                <h4>Abonos</h4>
                ${payments.length ? `<div class="cash-payment-history">${payments.map(payment => `
                    <article class="cash-payment-history-row ${payment.estado === 'anulado' ? 'is-voided' : ''}">
                        <div><strong>${this.escape(payment.numero_pago || '')}</strong><small>${Utils.formatDateTime(payment.fecha)}</small></div>
                        <span>${this.escape(payment.metodo_pago || '')}</span>
                        <strong>${Utils.formatCurrency(Number(payment.monto || 0))}</strong>
                    </article>`).join('')}</div>` : '<p class="text-muted">Todavía no hay abonos.</p>'}
            `, [{ text: 'Cerrar', class: 'btn-light', onclick: () => Utils.hideModal() }], 'modal-credit-detail');
        } catch (error) {
            Utils.showNotification(error.message || 'No se pudo abrir el crédito.', 'error');
        }
    },

    showPaymentModal(id) {
        if (!this.has('cash.collect')) return;
        const account = this.accounts.find(item => Number(item.id) === Number(id));
        if (!account) return;
        const balance = Number(account.saldo_pendiente || 0);
        Utils.showModal(`Abonar ${this.escape(account.numero_credito)}`, `
            <div class="cash-payment-modal credit-payment-modal" data-balance="${balance}">
                <div class="cash-payment-context">
                    <div><small>Deudor</small><strong>${this.escape(account.cliente_nombre || '')}</strong></div>
                    <div><small>Cuenta global</small><strong>${this.escape(account.numero_cuenta_snapshot || '')}</strong></div>
                    <div><small>Saldo</small><strong>${Utils.formatCurrency(balance)}</strong></div>
                </div>
                <form id="credit-payment-form" onsubmit="Accounts.processPayment(event)">
                    <input type="hidden" id="credit-payment-id" value="${Number(account.id)}">
                    <input type="hidden" id="credit-payment-key" value="${this.key('credit-payment')}">
                    <div class="form-group"><label>Modalidad *</label><select id="credit-payment-method" onchange="Accounts.paymentMethodChanged(this.value)"><option value="efectivo">Efectivo</option><option value="tarjeta">Tarjeta</option><option value="mixto">Mixto</option></select></div>
                    <div id="credit-simple-fields">
                        <div class="form-group"><label>Monto aplicado *</label><input id="credit-payment-amount" type="number" min="0.01" max="${balance}" step="0.01" value="${balance}" required></div>
                        <div class="form-group" id="credit-cash-group"><label>Efectivo recibido *</label><input id="credit-cash-received" type="number" min="0.01" step="0.01" value="${balance}"></div>
                        <div class="form-group" id="credit-reference-group" hidden><label>Referencia de tarjeta *</label><input id="credit-reference" maxlength="180"></div>
                    </div>
                    <div id="credit-mixed-fields" hidden>
                        <div class="cash-mixed-grid">
                            <div class="form-group"><label>Efectivo aplicado *</label><input id="credit-mixed-cash" type="number" min="0.01" step="0.01"></div>
                            <div class="form-group"><label>Efectivo recibido *</label><input id="credit-mixed-received" type="number" min="0.01" step="0.01"></div>
                            <div class="form-group"><label>Tarjeta aplicada *</label><input id="credit-mixed-card" type="number" min="0.01" step="0.01"></div>
                            <div class="form-group"><label>Referencia *</label><input id="credit-mixed-reference" maxlength="180"></div>
                        </div>
                    </div>
                    <p class="cash-form-help">El abono genera PG-######## y un movimiento de Caja; no crea otra venta.</p>
                </form>
            </div>
        `, [
            { text: 'Cancelar', class: 'btn-light', onclick: () => Utils.hideModal() },
            { text: '<i class="fas fa-check"></i> Registrar abono', class: 'btn-success credit-payment-submit', align: 'right', onclick: () => Accounts.processPayment() }
        ], 'modal-credit-payment');
    },

    paymentMethodChanged(method) {
        const mixed = method === 'mixto';
        const card = method === 'tarjeta';
        document.getElementById('credit-simple-fields').hidden = mixed;
        document.getElementById('credit-mixed-fields').hidden = !mixed;
        document.getElementById('credit-cash-group').hidden = card;
        document.getElementById('credit-reference-group').hidden = !card;
    },

    number(id) {
        const value = Number(document.getElementById(id)?.value || 0);
        return Number.isFinite(value) ? value : 0;
    },

    buildPaymentPayload() {
        const method = document.getElementById('credit-payment-method')?.value;
        if (method === 'mixto') {
            const cash = this.number('credit-mixed-cash');
            const received = this.number('credit-mixed-received');
            const card = this.number('credit-mixed-card');
            const reference = String(document.getElementById('credit-mixed-reference')?.value || '').trim();
            if (cash <= 0 || card <= 0 || received < cash || !reference) throw new Error('Completa correctamente ambos medios del pago mixto.');
            return { metodo_pago: 'mixto', medios_pago: [
                { tipo: 'efectivo', monto_aplicado: cash, monto_recibido: received },
                { tipo: 'tarjeta', monto_aplicado: card, referencia: reference }
            ] };
        }
        const amount = this.number('credit-payment-amount');
        if (amount <= 0) throw new Error('El monto debe ser mayor que cero.');
        if (method === 'tarjeta') {
            const reference = String(document.getElementById('credit-reference')?.value || '').trim();
            if (!reference) throw new Error('La referencia de tarjeta es obligatoria.');
            return { monto: amount, metodo_pago: 'tarjeta', referencia: reference };
        }
        const received = this.number('credit-cash-received');
        if (received < amount) throw new Error('El efectivo recibido no puede ser menor que el monto aplicado.');
        return { monto: amount, metodo_pago: 'efectivo', monto_recibido: received };
    },

    async processPayment(event) {
        event?.preventDefault();
        const id = Number(document.getElementById('credit-payment-id')?.value || 0);
        const key = document.getElementById('credit-payment-key')?.value;
        let payload;
        try { payload = this.buildPaymentPayload(); }
        catch (error) { Utils.showNotification(error.message, 'warning'); return; }
        const button = document.querySelector('.modal-credit-payment .credit-payment-submit');
        if (button) { button.disabled = true; button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Procesando…'; }
        try {
            const response = await Utils.request(`/accounts/${id}/payment`, {
                method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(payload)
            });
            Utils.hideModal();
            const credit = response.data?.credito;
            Utils.showNotification(credit?.estado === 'saldado' ? 'Crédito saldado. La mesa permanece activa.' : `Abono registrado. Saldo: ${Utils.formatCurrency(Number(credit?.saldo_pendiente || 0))}`, 'success');
            await this.load();
        } catch (error) {
            Utils.showNotification(error.message || 'No se pudo registrar el abono.', 'error');
            if (button) { button.disabled = false; button.innerHTML = '<i class="fas fa-check"></i> Registrar abono'; }
        }
    },

    key(scope) {
        const uuid = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        return `${scope}:${uuid}`;
    },

    escape(value) {
        return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[character]));
    }
};
