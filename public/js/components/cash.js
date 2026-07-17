// Caja Component · v3.2.2
// Interfaz operativa de cobro por prefactura. La cuenta global continúa siendo
// la única fuente financiera y pagar un documento no finaliza el servicio.
const Cash = {
    summary: null,
    queue: { cuentas: [], documentos: [], resumen: {} },
    movements: [],
    selectedPreinvoiceId: null,
    selectedRead: null,
    filters: {
        estado: 'pendiente',
        buscar: ''
    },
    loading: false,
    queueLoading: false,
    detailLoading: false,
    paymentSubmitting: false,

    has(capability) {
        return typeof Access !== 'undefined' && Access.has(capability);
    },

    async load(options = {}) {
        if (!this.has('cash.access')) {
            this.renderNoAccess();
            return;
        }

        const preserveSelection = options.preserveSelection !== false;
        if (!preserveSelection) {
            this.selectedPreinvoiceId = null;
            this.selectedRead = null;
        }

        this.loading = true;
        this.render();
        try {
            const [summaryResponse, queueResponse, movementsResponse] = await Promise.all([
                Utils.request('/cash/summary'),
                this.fetchQueue(),
                Utils.request('/cash/movements')
            ]);

            this.summary = summaryResponse.data || {};
            this.queue = queueResponse.data || { cuentas: [], documentos: [], resumen: {} };
            this.movements = Array.isArray(movementsResponse.data) ? movementsResponse.data : [];

            if (preserveSelection && this.selectedPreinvoiceId) {
                try {
                    await this.loadDetail(this.selectedPreinvoiceId, { render: false });
                } catch (_) {
                    this.selectedPreinvoiceId = null;
                    this.selectedRead = null;
                }
            }
        } catch (error) {
            console.error('Error cargando Caja:', error);
            this.renderError(error.message || 'No se pudo cargar Caja');
            return;
        } finally {
            this.loading = false;
        }

        this.render();
    },

    async fetchQueue() {
        const params = new URLSearchParams();
        params.set('estado', this.filters.estado || 'pendiente');
        if (this.filters.buscar) params.set('buscar', this.filters.buscar);
        params.set('limite', '200');
        return Utils.request(`/cash/queue?${params.toString()}`);
    },

    async refreshQueue(options = {}) {
        if (this.queueLoading) return;
        this.queueLoading = true;
        this.render();
        try {
            const response = await this.fetchQueue();
            this.queue = response.data || { cuentas: [], documentos: [], resumen: {} };
            if (options.keepDetail !== true) {
                const visible = this.queue.documentos.some(document => Number(document.id) === Number(this.selectedPreinvoiceId));
                if (!visible) {
                    this.selectedPreinvoiceId = null;
                    this.selectedRead = null;
                }
            }
        } catch (error) {
            Utils.showNotification(error.message || 'No se pudo actualizar la cola de Caja.', 'error');
        } finally {
            this.queueLoading = false;
            this.render();
        }
    },

    async submitSearch(event) {
        event?.preventDefault();
        this.filters.buscar = String(document.getElementById('cash-search-input')?.value || '')
            .trim()
            .replace(/\s+/g, ' ');
        this.filters.estado = document.getElementById('cash-state-filter')?.value || 'pendiente';
        await this.refreshQueue();
    },

    async clearSearch() {
        this.filters.buscar = '';
        this.filters.estado = 'pendiente';
        await this.refreshQueue();
    },

    async changeState(value) {
        this.filters.estado = String(value || 'pendiente');
        await this.refreshQueue();
    },

    async openDocument(preinvoiceId) {
        await this.loadDetail(preinvoiceId, { render: true });
        if (window.matchMedia('(max-width: 900px)').matches) {
            setTimeout(() => {
                document.getElementById('cash-detail-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 0);
        }
    },

    async loadDetail(preinvoiceId, options = {}) {
        const id = Number(preinvoiceId);
        if (!Number.isSafeInteger(id) || id <= 0) return;
        this.selectedPreinvoiceId = id;
        this.detailLoading = true;
        if (options.render !== false) this.render();
        try {
            const response = await Utils.request(`/cash/preinvoices/${id}`);
            this.selectedRead = response.data || null;
        } catch (error) {
            this.selectedRead = null;
            if (options.render !== false) {
                Utils.showNotification(error.message || 'No se pudo abrir la prefactura.', 'error');
            }
            throw error;
        } finally {
            this.detailLoading = false;
            if (options.render !== false) this.render();
        }
    },

    async focusAccount(accountId) {
        if (!this.has('cash.access')) {
            Utils.showNotification('Tu sesión no tiene acceso a Caja.', 'warning');
            return;
        }
        const id = Number(accountId);
        if (!Number.isSafeInteger(id) || id <= 0) return;

        try {
            const response = await Utils.request(`/cash/accounts/${id}/collection-read`);
            const documents = Array.isArray(response.data?.prefacturas) ? response.data.prefacturas : [];
            const pending = documents.find(document => ['emitida', 'parcial'].includes(document.estado));
            if (!pending) {
                Utils.showNotification('La cuenta no tiene prefacturas pendientes de cobro. Emite una prefactura desde Ver pedido.', 'info');
                return;
            }
            this.filters.buscar = response.data?.cuenta_global?.numero_cuenta || '';
            this.filters.estado = 'pendiente';
            await this.refreshQueue({ keepDetail: true });
            await this.openDocument(pending.id);
        } catch (error) {
            Utils.showNotification(error.message || 'No se pudo localizar la cuenta en Caja.', 'error');
        }
    },

    openPaymentModal(preinvoiceId = this.selectedPreinvoiceId) {
        if (!this.has('cash.collect')) {
            Utils.showNotification('Tu sesión puede consultar Caja, pero no tiene autorización para cobrar.', 'warning');
            return;
        }
        const read = this.selectedRead;
        if (!read || Number(read.prefactura?.id) !== Number(preinvoiceId)) {
            this.openDocument(preinvoiceId).then(() => this.openPaymentModal(preinvoiceId));
            return;
        }
        if (!read.acciones?.puede_cobrar) {
            Utils.showNotification('Esta prefactura ya no admite cobros.', 'warning');
            return;
        }

        const document = read.prefactura;
        const account = read.cuenta_global;
        const balance = Number(document.saldo_pendiente_calculado ?? document.saldo_pendiente ?? 0);
        const idempotencyKey = this.buildIdempotencyKey('payment');

        Utils.showModal(`Cobrar ${this.escapeHTML(document.numero_documento)}`, `
            <div class="cash-payment-modal">
                <div class="cash-payment-context">
                    <div>
                        <small>Cuenta global</small>
                        <strong>${this.escapeHTML(account.numero_cuenta)}</strong>
                    </div>
                    <div>
                        <small>Pagador</small>
                        <strong>${this.escapeHTML(document.pagador_nombre || 'Sin nombre')}</strong>
                    </div>
                    <div>
                        <small>${this.seatLabel(account)}</small>
                        <strong>${this.escapeHTML(account.mesa_numero ?? '-')}</strong>
                    </div>
                </div>
                <div class="cash-payment-balance">
                    <span>Saldo pendiente del documento</span>
                    <strong>${Utils.formatCurrency(balance)}</strong>
                </div>
                <form id="cash-payment-form" onsubmit="Cash.submitPayment(event)">
                    <input type="hidden" id="cash-payment-preinvoice-id" value="${Number(document.id)}">
                    <input type="hidden" id="cash-payment-idempotency" value="${this.escapeAttribute(idempotencyKey)}">
                    <div class="form-group">
                        <label for="cash-payment-amount">Monto a cobrar *</label>
                        <input id="cash-payment-amount" type="number" min="0.01" max="${balance}" step="0.01"
                               value="${balance}" inputmode="decimal" required autocomplete="off">
                        <small class="cash-form-help">Puede registrar un abono o liquidar el saldo completo.</small>
                    </div>
                    <div class="form-group">
                        <label for="cash-payment-method">Método de pago *</label>
                        <select id="cash-payment-method" required onchange="Cash.onPaymentMethodChange(this.value)">
                            <option value="efectivo">Efectivo</option>
                            <option value="tarjeta">Tarjeta</option>
                        </select>
                    </div>
                    <div class="form-group" id="cash-payment-reference-group" hidden>
                        <label for="cash-payment-reference">Referencia / autorización *</label>
                        <input id="cash-payment-reference" type="text" maxlength="180" autocomplete="off"
                               placeholder="Ej. AUTH-123456">
                    </div>
                    <div class="cash-payment-scope-note">
                        <i class="fas fa-circle-info"></i>
                        <span>Este cobro afecta únicamente a ${this.escapeHTML(document.numero_documento)}. La mesa continúa abierta hasta finalizar el servicio.</span>
                    </div>
                </form>
            </div>
        `, [
            {
                text: 'Cancelar',
                class: 'btn-light',
                onclick: () => Utils.hideModal()
            },
            {
                text: '<i class="fas fa-check"></i> Confirmar cobro',
                class: 'btn-success cash-payment-submit',
                align: 'right',
                onclick: () => Cash.submitPayment()
            }
        ], 'modal-cash-payment');

        setTimeout(() => document.getElementById('cash-payment-amount')?.select(), 0);
    },

    onPaymentMethodChange(method) {
        const group = document.getElementById('cash-payment-reference-group');
        const input = document.getElementById('cash-payment-reference');
        const card = method === 'tarjeta';
        if (group) group.hidden = !card;
        if (input) input.required = card;
    },

    async submitPayment(event) {
        event?.preventDefault();
        if (this.paymentSubmitting) return;

        const preinvoiceId = Number(document.getElementById('cash-payment-preinvoice-id')?.value || 0);
        const amount = Number(document.getElementById('cash-payment-amount')?.value || 0);
        const method = String(document.getElementById('cash-payment-method')?.value || '');
        const referenceInput = document.getElementById('cash-payment-reference');
        const reference = String(referenceInput?.value || '').trim();
        const idempotencyKey = document.getElementById('cash-payment-idempotency')?.value;
        const balance = Number(this.selectedRead?.prefactura?.saldo_pendiente_calculado ?? 0);

        if (!Number.isFinite(amount) || amount <= 0) {
            Utils.showNotification('Indica un monto mayor que cero.', 'warning');
            document.getElementById('cash-payment-amount')?.focus();
            return;
        }
        if (amount > balance + 0.0001) {
            Utils.showNotification('El monto no puede superar el saldo de la prefactura.', 'warning');
            document.getElementById('cash-payment-amount')?.focus();
            return;
        }
        if (!['efectivo', 'tarjeta'].includes(method)) {
            Utils.showNotification('Selecciona un método de pago válido.', 'warning');
            return;
        }
        if (method === 'tarjeta' && !reference) {
            Utils.showNotification('Indica la referencia o autorización de la tarjeta.', 'warning');
            referenceInput?.focus();
            return;
        }

        this.paymentSubmitting = true;
        const button = document.querySelector('.modal-cash-payment .cash-payment-submit');
        if (button) {
            button.disabled = true;
            button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Procesando...';
        }

        try {
            const response = await Utils.request(`/cash/preinvoices/${preinvoiceId}/payments`, {
                method: 'POST',
                headers: { 'Idempotency-Key': idempotencyKey },
                body: JSON.stringify({
                    monto: amount,
                    metodo_pago: method,
                    referencia: reference || null
                })
            });
            const paymentNumber = response.data?.pago?.numero_pago || 'Pago registrado';
            Utils.hideModal();
            Utils.showNotification(`${paymentNumber} confirmado correctamente.`, 'success');
            await this.reloadAfterMutation(preinvoiceId);
        } catch (error) {
            Utils.showNotification(error.message || 'No se pudo registrar el cobro.', 'error');
            if (button) {
                button.disabled = false;
                button.innerHTML = '<i class="fas fa-check"></i> Confirmar cobro';
            }
        } finally {
            this.paymentSubmitting = false;
        }
    },

    async requestReprint(preinvoiceId = this.selectedPreinvoiceId) {
        if (!this.has('cash.reprint')) {
            Utils.showNotification('Tu sesión no tiene autorización para reimprimir.', 'warning');
            return;
        }
        try {
            const response = await Utils.request(`/cash/preinvoices/${preinvoiceId}/reprint-request`, {
                method: 'POST',
                body: JSON.stringify({})
            });
            Utils.showNotification('Solicitud de reimpresión registrada.', 'success');
            this.printPreinvoice(response.data);
            await this.loadDetail(preinvoiceId);
        } catch (error) {
            Utils.showNotification(error.message || 'No se pudo solicitar la reimpresión.', 'error');
        }
    },

    printPreinvoice(read = this.selectedRead) {
        const document = read?.prefactura;
        const account = read?.cuenta_global;
        if (!document || !account) return;
        const popup = window.open('', '_blank', 'width=760,height=900');
        if (!popup) {
            Utils.showNotification('El navegador bloqueó la ventana de impresión.', 'warning');
            return;
        }
        const rows = (document.items || []).map(item => `
            <tr>
                <td>${this.escapeHTML(this.itemLabel(item))}</td>
                <td>${Number(item.cantidad || 0)}</td>
                <td>${Utils.formatCurrency(Number(item.precio_unitario || 0))}</td>
                <td>${Utils.formatCurrency(Number(item.total_linea || 0))}</td>
            </tr>
        `).join('');
        popup.document.open();
        popup.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8">
            <title>${this.escapeHTML(document.numero_documento)}</title>
            <style>
                body{font-family:Arial,sans-serif;color:#111;margin:28px;line-height:1.35}
                h1{font-size:22px;margin:0 0 5px}.muted{color:#555}.meta{margin:18px 0;padding:12px;border:1px solid #bbb;border-radius:8px}
                table{width:100%;border-collapse:collapse;margin-top:16px}th,td{padding:8px;border-bottom:1px solid #ddd;text-align:left}th:last-child,td:last-child{text-align:right}
                .totals{margin:18px 0 0 auto;max-width:320px}.totals p{display:flex;justify-content:space-between;margin:6px 0}.grand{font-size:18px;border-top:2px solid #111;padding-top:8px}
                .footer{margin-top:28px;font-size:12px;color:#555;text-align:center}@media print{body{margin:8mm}}
            </style></head><body>
            <h1>Prefactura ${this.escapeHTML(document.numero_documento)}</h1>
            <div class="muted">Documento operativo vinculado a ${this.escapeHTML(account.numero_cuenta)}</div>
            <div class="meta">
                <div><strong>Pagador:</strong> ${this.escapeHTML(document.pagador_nombre || '')}</div>
                <div><strong>Cliente principal:</strong> ${this.escapeHTML(account.cliente_principal || '')}</div>
                <div><strong>${this.seatLabel(account)}:</strong> ${this.escapeHTML(account.mesa_numero ?? '-')}</div>
                <div><strong>Zona:</strong> ${this.escapeHTML(account.zona_nombre || '')}</div>
                <div><strong>Fecha:</strong> ${Utils.formatDate(document.fecha_emision)}</div>
            </div>
            <table><thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table>
            <div class="totals">
                <p><span>Subtotal</span><strong>${Utils.formatCurrency(Number(document.subtotal || 0))}</strong></p>
                <p><span>Servicio</span><strong>${Utils.formatCurrency(Number(document.servicio || 0))}</strong></p>
                <p class="grand"><span>Total</span><strong>${Utils.formatCurrency(Number(document.total || 0))}</strong></p>
            </div>
            <div class="footer">La cuenta global es la única fuente financiera de la venta.</div>
            <script>window.addEventListener('load',()=>{window.focus();window.print();});<\/script>
            </body></html>`);
        popup.document.close();
    },

    async reloadAfterMutation(preinvoiceId) {
        const [summaryResponse, queueResponse, movementsResponse] = await Promise.all([
            Utils.request('/cash/summary'),
            this.fetchQueue(),
            Utils.request('/cash/movements')
        ]);
        this.summary = summaryResponse.data || {};
        this.queue = queueResponse.data || { cuentas: [], documentos: [], resumen: {} };
        this.movements = Array.isArray(movementsResponse.data) ? movementsResponse.data : [];
        try {
            await this.loadDetail(preinvoiceId, { render: false });
        } catch (_) {
            this.selectedPreinvoiceId = null;
            this.selectedRead = null;
        }
        this.render();
    },

    buildIdempotencyKey(scope) {
        if (globalThis.crypto?.randomUUID) return `${scope}:${globalThis.crypto.randomUUID()}`;
        return `${scope}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    },

    escapeHTML(value) {
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    },

    escapeAttribute(value) {
        return this.escapeHTML(value).replaceAll('`', '&#096;');
    },

    itemLabel(item = {}) {
        const product = item.producto_nombre_snapshot || item.producto_nombre || 'Producto';
        const presentation = item.presentacion_nombre_snapshot || item.presentacion_nombre;
        const quantity = item.presentacion_cantidad_snapshot || item.presentacion_cantidad;
        return [product, presentation, quantity].filter(Boolean).join(' · ');
    },

    seatLabel(account = {}) {
        return String(account.mesa_tipo || account.mesa?.tipo || '').toLowerCase() === 'banco' ? 'Banco' : 'Mesa';
    },

    statusLabel(status) {
        const labels = {
            emitida: 'Pendiente',
            parcial: 'Pago parcial',
            pagada: 'Pagada',
            anulada: 'Anulada'
        };
        return labels[status] || status || 'Sin estado';
    },

    statusClass(status) {
        if (status === 'pagada') return 'is-paid';
        if (status === 'parcial') return 'is-partial';
        if (status === 'anulada') return 'is-voided';
        return 'is-pending';
    },

    renderSummaryCards() {
        const pending = Number(this.summary?.cuentas_pendientes || 0);
        const documents = Number(this.summary?.prefacturas_pendientes || 0);
        const documentBalance = Number(this.summary?.saldo_documental_visible || 0);
        const globalSales = Number(this.summary?.ventas_globales_hoy || 0);
        const movementTotal = Number(this.summary?.movimientos_caja_hoy || 0);
        return `
            <div class="cash-foundation-grid cash-operational-summary">
                <article class="cash-foundation-card">
                    <span class="cash-foundation-icon"><i class="fas fa-receipt"></i></span>
                    <div><small>Cuentas / documentos pendientes</small><strong>${pending} / ${documents}</strong></div>
                </article>
                <article class="cash-foundation-card">
                    <span class="cash-foundation-icon"><i class="fas fa-coins"></i></span>
                    <div><small>Saldo documental visible</small><strong>${Utils.formatCurrency(documentBalance)}</strong></div>
                </article>
                <article class="cash-foundation-card">
                    <span class="cash-foundation-icon"><i class="fas fa-chart-line"></i></span>
                    <div><small>Ventas globales hoy</small><strong>${Utils.formatCurrency(globalSales)}</strong></div>
                </article>
                <article class="cash-foundation-card">
                    <span class="cash-foundation-icon"><i class="fas fa-money-bill-transfer"></i></span>
                    <div><small>Movimientos de Caja hoy</small><strong>${Utils.formatCurrency(movementTotal)}</strong></div>
                </article>
            </div>
        `;
    },

    renderQueue() {
        if (this.queueLoading) {
            return '<div class="cash-panel-loading"><i class="fas fa-spinner fa-spin"></i><span>Actualizando documentos…</span></div>';
        }
        const accounts = Array.isArray(this.queue?.cuentas) ? this.queue.cuentas : [];
        if (!accounts.length) {
            return `
                <div class="cash-empty-state">
                    <i class="fas fa-receipt"></i>
                    <strong>No hay documentos para este filtro</strong>
                    <span>Prueba otra búsqueda o emite una prefactura desde Ver pedido.</span>
                </div>
            `;
        }

        return accounts.map(account => `
            <article class="cash-account-group">
                <header class="cash-account-group-header">
                    <div>
                        <strong>${this.escapeHTML(account.numero_cuenta)}</strong>
                        <span>${this.seatLabel(account)} ${this.escapeHTML(account.mesa?.numero ?? '-')} · ${this.escapeHTML(account.zona?.nombre || 'Sin zona')}</span>
                    </div>
                    ${account.cuenta_dividida ? '<span class="cash-split-badge"><i class="fas fa-code-branch"></i> Dividida</span>' : ''}
                </header>
                <div class="cash-account-meta">
                    <span><i class="fas fa-user"></i> ${this.escapeHTML(account.cliente_principal || 'Cliente anónimo')}</span>
                    <span><i class="fas fa-user-tie"></i> ${this.escapeHTML(account.responsable_principal || 'Sin responsable')}</span>
                    <span><i class="fas fa-wallet"></i> ${Utils.formatCurrency(Number(account.saldo_documentos_resultado || 0))}</span>
                </div>
                <div class="cash-document-list">
                    ${(account.documentos || []).map(document => `
                        <button type="button"
                                class="cash-document-row ${Number(document.id) === Number(this.selectedPreinvoiceId) ? 'is-selected' : ''}"
                                onclick="Cash.openDocument(${Number(document.id)})">
                            <span class="cash-document-main">
                                <strong>${this.escapeHTML(document.numero_documento)}</strong>
                                <small>${this.escapeHTML(document.pagador_nombre || 'Sin pagador')}</small>
                            </span>
                            <span class="cash-document-status ${this.statusClass(document.estado)}">${this.statusLabel(document.estado)}</span>
                            <span class="cash-document-amount">
                                <small>Saldo</small>
                                <strong>${Utils.formatCurrency(Number(document.saldo_pendiente || 0))}</strong>
                            </span>
                            <i class="fas fa-chevron-right"></i>
                        </button>
                    `).join('')}
                </div>
            </article>
        `).join('');
    },

    renderDetail() {
        if (this.detailLoading) {
            return '<div class="cash-panel-loading"><i class="fas fa-spinner fa-spin"></i><span>Cargando prefactura…</span></div>';
        }
        const read = this.selectedRead;
        if (!read) {
            return `
                <div class="cash-detail-empty">
                    <i class="fas fa-arrow-pointer"></i>
                    <strong>Selecciona una prefactura</strong>
                    <span>Aquí aparecerán los ítems, el saldo y los movimientos de cobro.</span>
                </div>
            `;
        }

        const document = read.prefactura;
        const account = read.cuenta_global;
        const payments = Array.isArray(read.pagos) ? read.pagos : [];
        const items = Array.isArray(document.items) ? document.items : [];
        const canCollect = this.has('cash.collect') && read.acciones?.puede_cobrar;
        const canReprint = this.has('cash.reprint') && read.acciones?.puede_reimprimir;

        return `
            <div class="cash-detail-heading">
                <div>
                    <span class="cash-eyebrow">Documento operativo</span>
                    <h3>${this.escapeHTML(document.numero_documento)}</h3>
                    <p>${this.escapeHTML(document.pagador_nombre || 'Sin pagador')} · ${this.statusLabel(document.estado)}</p>
                </div>
                <span class="cash-document-status ${this.statusClass(document.estado)}">${this.statusLabel(document.estado)}</span>
            </div>

            <div class="cash-account-context">
                <div><small>Cuenta global</small><strong>${this.escapeHTML(account.numero_cuenta)}</strong></div>
                <div><small>Cliente principal</small><strong>${this.escapeHTML(account.cliente_principal || 'Cliente anónimo')}</strong></div>
                <div><small>${this.seatLabel(account)}</small><strong>${this.escapeHTML(account.mesa_numero ?? '-')}</strong></div>
                <div><small>Zona</small><strong>${this.escapeHTML(account.zona_nombre || 'Sin zona')}</strong></div>
                <div><small>Responsable</small><strong>${this.escapeHTML(account.responsable_principal || 'Sin responsable')}</strong></div>
                <div><small>Estado de servicio</small><strong>${this.escapeHTML(account.estado_operativo || '')}</strong></div>
            </div>

            <div class="cash-document-totals">
                <div><span>Subtotal</span><strong>${Utils.formatCurrency(Number(document.subtotal || 0))}</strong></div>
                <div><span>Servicio</span><strong>${Utils.formatCurrency(Number(document.servicio || 0))}</strong></div>
                <div><span>Total</span><strong>${Utils.formatCurrency(Number(document.total || 0))}</strong></div>
                <div class="is-balance"><span>Saldo pendiente</span><strong>${Utils.formatCurrency(Number(document.saldo_pendiente_calculado || 0))}</strong></div>
            </div>

            <div class="cash-detail-section">
                <h4><i class="fas fa-utensils"></i> Consumo documentado</h4>
                <div class="table-responsive">
                    <table class="table cash-items-table">
                        <thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Total</th></tr></thead>
                        <tbody>${items.map(item => `
                            <tr>
                                <td>${this.escapeHTML(this.itemLabel(item))}</td>
                                <td>${Number(item.cantidad || 0)}</td>
                                <td>${Utils.formatCurrency(Number(item.precio_unitario || 0))}</td>
                                <td>${Utils.formatCurrency(Number(item.total_linea || 0))}</td>
                            </tr>
                        `).join('')}</tbody>
                    </table>
                </div>
            </div>

            <div class="cash-detail-section">
                <h4><i class="fas fa-money-bill-transfer"></i> Pagos del documento</h4>
                ${this.renderDocumentPayments(payments)}
            </div>

            <div class="cash-detail-actions">
                ${canReprint ? `<button type="button" class="btn btn-light" onclick="Cash.requestReprint(${Number(document.id)})"><i class="fas fa-print"></i> Reimprimir</button>` : ''}
                ${canCollect ? `<button type="button" class="btn btn-success" onclick="Cash.openPaymentModal(${Number(document.id)})"><i class="fas fa-cash-register"></i> Cobrar prefactura</button>` : ''}
                ${!canCollect && read.acciones?.puede_cobrar ? '<span class="cash-action-hint"><i class="fas fa-lock"></i> Falta la capacidad cash.collect.</span>' : ''}
                ${document.estado === 'pagada' ? '<span class="cash-action-success"><i class="fas fa-circle-check"></i> Documento liquidado. La mesa continúa activa.</span>' : ''}
            </div>
        `;
    },

    renderDocumentPayments(payments) {
        if (!payments.length) {
            return '<div class="cash-inline-empty">Todavía no hay pagos registrados para esta prefactura.</div>';
        }
        return `
            <div class="cash-payment-history">
                ${payments.map(payment => `
                    <article class="cash-payment-history-row ${payment.estado === 'anulado' ? 'is-voided' : ''}">
                        <div>
                            <strong>${this.escapeHTML(payment.numero_pago || `Pago #${payment.id}`)}</strong>
                            <small>${this.escapeHTML(payment.cajero_nombre_snapshot || payment.cajero_nombre || '')} · ${Utils.formatDateTime(payment.fecha)}</small>
                        </div>
                        <span>${this.escapeHTML(payment.metodo_pago || '')}</span>
                        <strong>${Utils.formatCurrency(Number(payment.monto || 0))}</strong>
                        <span class="cash-document-status ${payment.estado === 'anulado' ? 'is-voided' : 'is-paid'}">${payment.estado === 'anulado' ? 'Anulado' : 'Confirmado'}</span>
                    </article>
                `).join('')}
            </div>
        `;
    },

    renderMovements() {
        if (!this.movements.length) {
            return '<div class="cash-inline-empty">No hay movimientos de Caja registrados hoy.</div>';
        }
        return `
            <div class="table-responsive">
                <table class="table ventas-detalle-table cash-movements-table">
                    <thead><tr><th>Pago</th><th>Cuenta</th><th>Documento</th><th>Pagador</th><th>Método</th><th>Cajero</th><th>Fecha</th><th>Monto</th></tr></thead>
                    <tbody>${this.movements.slice(0, 20).map(movement => `
                        <tr>
                            <td>${this.escapeHTML(movement.numero_pago || '')}</td>
                            <td>${this.escapeHTML(movement.numero_cuenta || '')}</td>
                            <td>${this.escapeHTML(movement.numero_documento || '')}</td>
                            <td>${this.escapeHTML(movement.pagador_nombre || movement.cliente_principal || '')}</td>
                            <td>${this.escapeHTML(movement.metodo_pago || '')}</td>
                            <td>${this.escapeHTML(movement.cajero_nombre || '')}</td>
                            <td>${Utils.formatDateTime(movement.fecha)}</td>
                            <td>${Utils.formatCurrency(Number(movement.monto || 0))}</td>
                        </tr>
                    `).join('')}</tbody>
                </table>
            </div>
        `;
    },

    render() {
        const section = document.getElementById('cash-section');
        if (!section) return;
        if (this.loading && !this.summary) {
            section.innerHTML = '<div class="cash-page-loading"><i class="fas fa-spinner fa-spin"></i><strong>Cargando Caja…</strong></div>';
            return;
        }

        section.innerHTML = `
            <div class="section-header cash-section-header">
                <div>
                    <span class="cash-eyebrow">Operación autorizada</span>
                    <h2><i class="fas fa-cash-register"></i> Caja</h2>
                    <p>Busca una prefactura, verifica el pagador y registra el cobro sin cerrar automáticamente la mesa.</p>
                </div>
                <button type="button" class="btn btn-light" onclick="Cash.load()" ${this.loading ? 'disabled' : ''}>
                    <i class="fas fa-rotate ${this.loading ? 'fa-spin' : ''}"></i> Actualizar
                </button>
            </div>
            ${this.renderSummaryCards()}
            <div class="cash-workspace">
                <section class="cash-queue-panel">
                    <div class="cash-panel-header">
                        <div><span class="cash-eyebrow">Bandeja de cobro</span><h3>Prefacturas</h3></div>
                        <span class="cash-result-count">${Number(this.queue?.resumen?.documentos_en_resultado || 0)}</span>
                    </div>
                    <form class="cash-search-form" onsubmit="Cash.submitSearch(event)">
                        <div class="cash-search-input-wrap">
                            <i class="fas fa-magnifying-glass"></i>
                            <input id="cash-search-input" type="search" maxlength="120" autocomplete="off"
                                   value="${this.escapeAttribute(this.filters.buscar)}"
                                   placeholder="Documento, cuenta, mesa, cliente, pagador…">
                        </div>
                        <select id="cash-state-filter" onchange="Cash.changeState(this.value)" aria-label="Filtrar estado">
                            <option value="pendiente" ${this.filters.estado === 'pendiente' ? 'selected' : ''}>Pendientes</option>
                            <option value="emitida" ${this.filters.estado === 'emitida' ? 'selected' : ''}>Emitidas</option>
                            <option value="parcial" ${this.filters.estado === 'parcial' ? 'selected' : ''}>Pago parcial</option>
                            <option value="pagada" ${this.filters.estado === 'pagada' ? 'selected' : ''}>Pagadas</option>
                            <option value="anulada" ${this.filters.estado === 'anulada' ? 'selected' : ''}>Anuladas</option>
                            <option value="todos" ${this.filters.estado === 'todos' ? 'selected' : ''}>Todos</option>
                        </select>
                        <button type="submit" class="btn btn-primary"><i class="fas fa-search"></i><span>Buscar</span></button>
                        ${(this.filters.buscar || this.filters.estado !== 'pendiente') ? '<button type="button" class="btn btn-light" onclick="Cash.clearSearch()"><i class="fas fa-xmark"></i></button>' : ''}
                    </form>
                    <div class="cash-queue-scroll">${this.renderQueue()}</div>
                </section>
                <section id="cash-detail-panel" class="cash-detail-panel">${this.renderDetail()}</section>
            </div>
            <section class="cash-movements-panel">
                <div class="cash-panel-header">
                    <div><span class="cash-eyebrow">Trazabilidad</span><h3>Movimientos de Caja del día</h3></div>
                    <span class="cash-result-count">${this.movements.length}</span>
                </div>
                ${this.renderMovements()}
            </section>
            <div class="cash-foundation-notice">
                <i class="fas fa-scale-balanced"></i>
                <div><strong>Fuente financiera única</strong><p>Las prefacturas y pagos explican cómo se liquidó la cuenta. Dashboard y reportes contabilizan una sola venta por cuenta global.</p></div>
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
