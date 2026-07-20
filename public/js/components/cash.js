// Caja Component · v3.2.4
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

        const preinvoice = read.prefactura;
        const account = read.cuenta_global;
        const balance = Number(preinvoice.saldo_pendiente_calculado ?? preinvoice.saldo_pendiente ?? 0);
        const idempotencyKey = this.buildIdempotencyKey('payment');

        Utils.showModal(`Cobrar ${this.escapeHTML(preinvoice.numero_documento)}`, `
            <div class="cash-payment-modal" data-balance="${balance}">
                <div class="cash-payment-context">
                    <div>
                        <small>Cuenta global</small>
                        <strong>${this.escapeHTML(account.numero_cuenta)}</strong>
                    </div>
                    <div>
                        <small>Pagador</small>
                        <strong>${this.escapeHTML(preinvoice.pagador_nombre || 'Sin nombre')}</strong>
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
                    <input type="hidden" id="cash-payment-preinvoice-id" value="${Number(preinvoice.id)}">
                    <input type="hidden" id="cash-payment-idempotency" value="${this.escapeAttribute(idempotencyKey)}">

                    <div class="form-group">
                        <label for="cash-payment-method">Modalidad de pago *</label>
                        <select id="cash-payment-method" required onchange="Cash.onPaymentMethodChange(this.value)">
                            <option value="efectivo">Efectivo</option>
                            <option value="tarjeta">Tarjeta</option>
                            <option value="mixto">Mixto: efectivo + tarjeta</option>
                        </select>
                    </div>

                    <div id="cash-payment-simple-fields">
                        <div class="form-group">
                            <label for="cash-payment-amount">Monto aplicado *</label>
                            <input id="cash-payment-amount" type="number" min="0.01" max="${balance}" step="0.01"
                                   value="${balance}" inputmode="decimal" required autocomplete="off"
                                   oninput="Cash.updatePaymentTotals()">
                            <small class="cash-form-help">Puede registrar un abono o liquidar el saldo completo.</small>
                        </div>
                        <div class="form-group" id="cash-payment-cash-received-group">
                            <label for="cash-payment-cash-received">Efectivo recibido *</label>
                            <input id="cash-payment-cash-received" type="number" min="0.01" step="0.01"
                                   value="${balance}" inputmode="decimal" autocomplete="off"
                                   oninput="Cash.updatePaymentTotals()">
                        </div>
                        <div class="form-group" id="cash-payment-reference-group" hidden>
                            <label for="cash-payment-reference">Referencia / autorización *</label>
                            <input id="cash-payment-reference" type="text" maxlength="180" autocomplete="off"
                                   placeholder="Ej. AUTH-123456">
                        </div>
                    </div>

                    <div id="cash-payment-mixed-fields" class="cash-mixed-fields" hidden>
                        <div class="cash-mixed-grid">
                            <div class="form-group">
                                <label for="cash-payment-mixed-cash">Monto en efectivo *</label>
                                <input id="cash-payment-mixed-cash" type="number" min="0.01" step="0.01"
                                       value="" inputmode="decimal" autocomplete="off"
                                       oninput="Cash.updatePaymentTotals()">
                            </div>
                            <div class="form-group">
                                <label for="cash-payment-mixed-received">Efectivo recibido *</label>
                                <input id="cash-payment-mixed-received" type="number" min="0.01" step="0.01"
                                       value="" inputmode="decimal" autocomplete="off"
                                       oninput="Cash.updatePaymentTotals()">
                            </div>
                            <div class="form-group">
                                <label for="cash-payment-mixed-card">Monto en tarjeta *</label>
                                <input id="cash-payment-mixed-card" type="number" min="0.01" step="0.01"
                                       value="${balance}" inputmode="decimal" autocomplete="off"
                                       oninput="Cash.updatePaymentTotals()">
                            </div>
                            <div class="form-group">
                                <label for="cash-payment-mixed-reference">Referencia de tarjeta *</label>
                                <input id="cash-payment-mixed-reference" type="text" maxlength="180"
                                       autocomplete="off" placeholder="Ej. AUTH-123456">
                            </div>
                        </div>
                        <small class="cash-form-help">Ambos medios deben tener un monto mayor que cero. El vuelto se calcula solamente sobre el efectivo.</small>
                    </div>

                    <div class="cash-payment-calculation">
                        <div><span>Total aplicado</span><strong id="cash-payment-total-applied">${Utils.formatCurrency(balance)}</strong></div>
                        <div><span>Total recibido/cargado</span><strong id="cash-payment-total-received">${Utils.formatCurrency(balance)}</strong></div>
                        <div class="is-change"><span>Vuelto</span><strong id="cash-payment-change">${Utils.formatCurrency(0)}</strong></div>
                        <div><span>Saldo posterior</span><strong id="cash-payment-remaining">${Utils.formatCurrency(0)}</strong></div>
                    </div>

                    <div class="cash-payment-scope-note">
                        <i class="fas fa-circle-info"></i>
                        <span>Este cobro afecta únicamente a ${this.escapeHTML(preinvoice.numero_documento)}. La mesa continúa abierta hasta finalizar el servicio.</span>
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

        setTimeout(() => {
            globalThis.document.getElementById('cash-payment-amount')?.select();
            this.updatePaymentTotals();
        }, 0);
    },

    openCreditModal(preinvoiceId = this.selectedPreinvoiceId) {
        if (!this.has('cash.collect')) {
            Utils.showNotification('Tu sesión no tiene autorización para formalizar créditos.', 'warning');
            return;
        }
        const read = this.selectedRead;
        if (!read || Number(read.prefactura?.id) !== Number(preinvoiceId)) {
            this.openDocument(preinvoiceId).then(() => this.openCreditModal(preinvoiceId));
            return;
        }
        if (!read.acciones?.puede_trasladar_credito) {
            Utils.showNotification('Esta prefactura no admite traslado a crédito.', 'warning');
            return;
        }
        const document = read.prefactura;
        const balance = Number(document.saldo_pendiente_calculado || 0);
        Utils.showModal(`Formalizar crédito · ${this.escapeHTML(document.numero_documento)}`, `
            <div class="cash-credit-modal">
                <div class="cash-payment-balance"><span>Saldo que se trasladará a crédito</span><strong>${Utils.formatCurrency(balance)}</strong></div>
                <p class="cash-form-help">El documento quedará liquidado mediante crédito, pero la deuda continuará vinculada a la misma cuenta global. La mesa no se libera.</p>
                <form id="cash-credit-form" onsubmit="Cash.submitCredit(event)">
                    <input type="hidden" id="cash-credit-preinvoice-id" value="${Number(document.id)}">
                    <input type="hidden" id="cash-credit-idempotency" value="${this.escapeAttribute(this.buildIdempotencyKey('credit'))}">
                    <div class="form-group">
                        <label for="cash-credit-admin-password">Contraseña de administrador *</label>
                        <input id="cash-credit-admin-password" type="password" required autocomplete="current-password">
                    </div>
                    <div class="form-group">
                        <label for="cash-credit-observation">Observación</label>
                        <textarea id="cash-credit-observation" maxlength="500" rows="3" placeholder="Motivo o condición autorizada"></textarea>
                    </div>
                </form>
            </div>
        `, [
            { text: 'Cancelar', class: 'btn-light', onclick: () => Utils.hideModal() },
            { text: '<i class="fas fa-file-signature"></i> Autorizar crédito', class: 'btn-warning cash-credit-submit', align: 'right', onclick: () => Cash.submitCredit() }
        ], 'modal-cash-credit');
        setTimeout(() => document.getElementById('cash-credit-admin-password')?.focus(), 0);
    },

    async submitCredit(event) {
        event?.preventDefault();
        const preinvoiceId = Number(document.getElementById('cash-credit-preinvoice-id')?.value || 0);
        const adminPassword = String(document.getElementById('cash-credit-admin-password')?.value || '');
        const observation = String(document.getElementById('cash-credit-observation')?.value || '').trim();
        const idempotencyKey = document.getElementById('cash-credit-idempotency')?.value;
        if (!preinvoiceId || !adminPassword) {
            Utils.showNotification('La contraseña de administrador es obligatoria.', 'warning');
            return;
        }
        const button = document.querySelector('.modal-cash-credit .cash-credit-submit');
        if (button) { button.disabled = true; button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Formalizando…'; }
        try {
            const response = await Utils.request(`/cash/preinvoices/${preinvoiceId}/credit`, {
                method: 'POST',
                headers: { 'Idempotency-Key': idempotencyKey },
                body: JSON.stringify({ admin_password: adminPassword, observacion: observation })
            });
            Utils.hideModal();
            Utils.showNotification(`Crédito ${response.data?.numero_credito || ''} formalizado sin cerrar la mesa.`, 'success');
            await this.loadDetail(preinvoiceId, { render: false });
            await this.load({ preserveSelection: true });
        } catch (error) {
            Utils.showNotification(error.message || 'No se pudo formalizar el crédito.', 'error');
            if (button) { button.disabled = false; button.innerHTML = '<i class="fas fa-file-signature"></i> Autorizar crédito'; }
        }
    },

    onPaymentMethodChange(method) {
        const simple = document.getElementById('cash-payment-simple-fields');
        const mixed = document.getElementById('cash-payment-mixed-fields');
        const cashGroup = document.getElementById('cash-payment-cash-received-group');
        const cashInput = document.getElementById('cash-payment-cash-received');
        const referenceGroup = document.getElementById('cash-payment-reference-group');
        const referenceInput = document.getElementById('cash-payment-reference');
        const amountInput = document.getElementById('cash-payment-amount');

        const isMixed = method === 'mixto';
        const isCard = method === 'tarjeta';
        if (simple) simple.hidden = isMixed;
        if (mixed) mixed.hidden = !isMixed;
        if (cashGroup) cashGroup.hidden = isCard;
        if (cashInput) cashInput.required = !isCard && !isMixed;
        if (referenceGroup) referenceGroup.hidden = !isCard;
        if (referenceInput) referenceInput.required = isCard;
        if (amountInput) amountInput.required = !isMixed;

        this.updatePaymentTotals();
    },

    paymentNumber(id) {
        const value = Number(document.getElementById(id)?.value || 0);
        return Number.isFinite(value) ? Math.max(0, value) : 0;
    },

    updatePaymentTotals() {
        const modal = document.querySelector('.cash-payment-modal');
        if (!modal) return;
        const balance = Number(modal.dataset.balance || 0);
        const method = String(document.getElementById('cash-payment-method')?.value || 'efectivo');

        let applied = 0;
        let received = 0;
        let change = 0;

        if (method === 'mixto') {
            const cashApplied = this.paymentNumber('cash-payment-mixed-cash');
            const cashReceived = this.paymentNumber('cash-payment-mixed-received');
            const cardApplied = this.paymentNumber('cash-payment-mixed-card');
            applied = cashApplied + cardApplied;
            received = cashReceived + cardApplied;
            change = Math.max(0, cashReceived - cashApplied);
        } else {
            applied = this.paymentNumber('cash-payment-amount');
            if (method === 'efectivo') {
                const cashReceived = this.paymentNumber('cash-payment-cash-received');
                received = cashReceived;
                change = Math.max(0, cashReceived - applied);
            } else {
                received = applied;
            }
        }

        const remaining = Math.max(0, balance - applied);
        const values = {
            'cash-payment-total-applied': applied,
            'cash-payment-total-received': received,
            'cash-payment-change': change,
            'cash-payment-remaining': remaining
        };
        Object.entries(values).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) element.textContent = Utils.formatCurrency(value);
        });

        const changeRow = document.getElementById('cash-payment-change')?.closest('div');
        if (changeRow) changeRow.classList.toggle('has-change', change > 0);
    },

    buildPaymentPayload() {
        const method = String(document.getElementById('cash-payment-method')?.value || '');
        if (!['efectivo', 'tarjeta', 'mixto'].includes(method)) {
            throw new Error('Selecciona una modalidad de pago válida.');
        }

        if (method === 'mixto') {
            const cashApplied = this.paymentNumber('cash-payment-mixed-cash');
            const cashReceived = this.paymentNumber('cash-payment-mixed-received');
            const cardApplied = this.paymentNumber('cash-payment-mixed-card');
            const cardReference = String(document.getElementById('cash-payment-mixed-reference')?.value || '').trim();

            if (cashApplied <= 0 || cardApplied <= 0) {
                throw new Error('En un pago mixto, efectivo y tarjeta deben ser mayores que cero.');
            }
            if (cashReceived < cashApplied) {
                throw new Error('El efectivo recibido no puede ser menor que el efectivo aplicado.');
            }
            if (!cardReference) {
                throw new Error('Indica la referencia o autorización de la tarjeta.');
            }

            return {
                metodo_pago: 'mixto',
                medios_pago: [
                    {
                        tipo: 'efectivo',
                        monto_aplicado: cashApplied,
                        monto_recibido: cashReceived
                    },
                    {
                        tipo: 'tarjeta',
                        monto_aplicado: cardApplied,
                        referencia: cardReference
                    }
                ]
            };
        }

        const amount = this.paymentNumber('cash-payment-amount');
        if (amount <= 0) throw new Error('Indica un monto mayor que cero.');

        if (method === 'tarjeta') {
            const reference = String(document.getElementById('cash-payment-reference')?.value || '').trim();
            if (!reference) throw new Error('Indica la referencia o autorización de la tarjeta.');
            return {
                monto: amount,
                metodo_pago: 'tarjeta',
                referencia: reference
            };
        }

        const received = this.paymentNumber('cash-payment-cash-received');
        if (received < amount) {
            throw new Error('El efectivo recibido no puede ser menor que el monto aplicado.');
        }
        return {
            monto: amount,
            metodo_pago: 'efectivo',
            monto_recibido: received
        };
    },

    async submitPayment(event) {
        event?.preventDefault();
        if (this.paymentSubmitting) return;

        const preinvoiceId = Number(document.getElementById('cash-payment-preinvoice-id')?.value || 0);
        const idempotencyKey = document.getElementById('cash-payment-idempotency')?.value;
        const balance = Number(this.selectedRead?.prefactura?.saldo_pendiente_calculado ?? 0);
        let payload;

        try {
            payload = this.buildPaymentPayload();
        } catch (error) {
            Utils.showNotification(error.message, 'warning');
            return;
        }

        const applied = Array.isArray(payload.medios_pago)
            ? payload.medios_pago.reduce((sum, tender) => sum + Number(tender.monto_aplicado || 0), 0)
            : Number(payload.monto || 0);
        if (applied > balance + 0.0001) {
            Utils.showNotification('El total aplicado no puede superar el saldo de la prefactura.', 'warning');
            return;
        }

        this.paymentSubmitting = true;
        const button = document.querySelector('.modal-cash-payment .cash-payment-submit');
        if (button) {
            button.disabled = true;
            button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Procesando...';
        }

        try {
            const response = await Utils.requestIdempotent(`/cash/preinvoices/${preinvoiceId}/payments`, {
                method: 'POST',
                headers: { 'Idempotency-Key': idempotencyKey },
                body: JSON.stringify(payload)
            });
            const payment = response.data?.pago || {};
            const paymentNumber = payment.numero_pago || 'Pago registrado';
            const change = Number(payment.vuelto || 0);
            Utils.hideModal();
            Utils.showNotification(
                change > 0
                    ? `${paymentNumber} confirmado. Vuelto: ${Utils.formatCurrency(change)}.`
                    : `${paymentNumber} confirmado correctamente.`,
                'success'
            );
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

        const popup = window.open('', '_blank', 'width=760,height=900');
        if (!popup) {
            Utils.showNotification('El navegador bloqueó la ventana de impresión.', 'warning');
            return;
        }

        popup.document.open();
        popup.document.write('<p style="font-family:sans-serif;padding:24px">Preparando copia auditada en Printing...</p>');
        popup.document.close();

        try {
            const response = await Utils.request(`/cash/preinvoices/${preinvoiceId}/reprint-request`, {
                method: 'POST',
                body: JSON.stringify({})
            });
            PrintingClient.openJob(response.printing, popup);
            Utils.showNotification('Solicitud de reimpresión registrada.', 'success');
            await this.loadDetail(preinvoiceId);
        } catch (error) {
            if (!popup.closed) popup.close();
            Utils.showNotification(error.message || 'No se pudo solicitar la reimpresión.', 'error');
        }
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
        const creditBalance = Number(this.summary?.saldo_creditos || 0);
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
                <article class="cash-foundation-card">
                    <span class="cash-foundation-icon"><i class="fas fa-file-invoice-dollar"></i></span>
                    <div><small>Saldo de créditos activos</small><strong>${Utils.formatCurrency(creditBalance)}</strong></div>
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
        const canCredit = this.has('cash.collect') && read.acciones?.puede_trasladar_credito;
        const canReprint = this.has('cash.reprint') && read.acciones?.puede_reimprimir;
        const credit = read.credito || null;

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

            ${credit ? `<div class="cash-credit-status-card">
                <div><small>Crédito formalizado</small><strong>${this.escapeHTML(credit.numero_credito || '')}</strong></div>
                <div><small>Deudor</small><strong>${this.escapeHTML(credit.cliente_nombre || '')}</strong></div>
                <div><small>Saldo del crédito</small><strong>${Utils.formatCurrency(Number(credit.saldo_pendiente || 0))}</strong></div>
                <span class="cash-document-status ${credit.estado === 'saldado' ? 'is-paid' : 'is-partial'}">${this.escapeHTML(credit.estado || '')}</span>
            </div>` : ''}

            <div class="cash-detail-section">
                <h4><i class="fas fa-money-bill-transfer"></i> Pagos del documento</h4>
                ${this.renderDocumentPayments(payments)}
            </div>

            <div class="cash-detail-actions">
                ${canReprint ? `<button type="button" class="btn btn-light" onclick="Cash.requestReprint(${Number(document.id)})"><i class="fas fa-print"></i> Reimprimir</button>` : ''}
                ${canCredit ? `<button type="button" class="btn btn-warning" onclick="Cash.openCreditModal(${Number(document.id)})"><i class="fas fa-file-signature"></i> Trasladar a crédito</button>` : ''}
                ${canCollect ? `<button type="button" class="btn btn-success" onclick="Cash.openPaymentModal(${Number(document.id)})"><i class="fas fa-cash-register"></i> Cobrar prefactura</button>` : ''}
                ${!canCollect && read.acciones?.puede_cobrar ? '<span class="cash-action-hint"><i class="fas fa-lock"></i> Falta la capacidad cash.collect.</span>' : ''}
                ${document.estado === 'pagada' ? '<span class="cash-action-success"><i class="fas fa-circle-check"></i> Documento liquidado. La mesa continúa activa.</span>' : ''}
            </div>
        `;
    },

    paymentMethodLabel(method) {
        const labels = {
            efectivo: 'Efectivo',
            tarjeta: 'Tarjeta',
            mixto: 'Mixto',
            credito: 'Crédito'
        };
        return labels[String(method || '').toLowerCase()] || method || '';
    },

    renderTenderSummary(payment = {}) {
        const tenders = Array.isArray(payment.medios_pago) ? payment.medios_pago : [];
        if (!tenders.length) {
            const change = Number(payment.vuelto || 0);
            return change > 0
                ? `<small class="cash-payment-change-note">Vuelto: ${Utils.formatCurrency(change)}</small>`
                : '';
        }
        return `
            <div class="cash-payment-tenders">
                ${tenders.map(tender => `
                    <span class="cash-payment-tender">
                        <i class="fas ${tender.tipo === 'tarjeta' ? 'fa-credit-card' : (tender.tipo === 'credito' ? 'fa-file-invoice-dollar' : 'fa-money-bill-wave')}"></i>
                        ${this.paymentMethodLabel(tender.tipo)} ${Utils.formatCurrency(Number(tender.monto_aplicado || 0))}
                        ${Number(tender.vuelto || 0) > 0 ? ` · Vuelto ${Utils.formatCurrency(Number(tender.vuelto || 0))}` : ''}
                    </span>
                `).join('')}
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
                            ${this.renderTenderSummary(payment)}
                        </div>
                        <span>${this.escapeHTML(this.paymentMethodLabel(payment.metodo_pago))}</span>
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
                            <td>
                                ${this.escapeHTML(this.paymentMethodLabel(movement.metodo_pago))}
                                ${Number(movement.vuelto || 0) > 0 ? `<small class="cash-payment-change-note">Vuelto ${Utils.formatCurrency(Number(movement.vuelto || 0))}</small>` : ''}
                            </td>
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
