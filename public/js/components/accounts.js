// Accounts Component
const Accounts = {
    accounts: [],
    summary: null,

    // Cargar datos de cuentas
    async load() {
        try {
            const [accountsResponse, summaryResponse] = await Promise.all([
                Utils.request('/accounts'),
                Utils.request('/accounts/summary/stats')
            ]);
            
            this.accounts = accountsResponse.data;
            this.summary = summaryResponse.data;
            this.render();
        } catch (error) {
            console.error('Error cargando cuentas:', error);
            Utils.showNotification('Error cargando datos de cuentas', 'error');
        }
    },

    // Renderizar sección de cuentas
    render() {
        const section = document.getElementById('accounts-section');
        
        section.innerHTML = `
            <div class="section-header">
                <h2>Gestión de Créditos</h2>
                <p>Administra los créditos pendientes de pago</p>
            </div>

            <div class="mb-3">
                <!-- Línea 1: botones -->
                <div class="d-flex gap-2 flex-wrap mb-2">
                    <button class="btn btn-success" onclick="Accounts.showCreateAccountModal()">
                        <i class="fas fa-plus"></i> Nuevo Crédito
                    </button>
                    <button class="btn btn-secondary" onclick="Accounts.load()">
                        <i class="fas fa-sync"></i> Actualizar
                    </button>
                </div>

                <!-- Línea 2: resumen -->
                <div class="accounts-summary">
                    ${this.renderSummary()}
                </div>
            </div>


            <div class="accounts-content">
                ${this.renderAccountsTable()}
            </div>

            ${this.renderClientSummary()}
        `;
    },

    // Renderizar resumen
    renderSummary() {
        if (!this.summary) return '';
        
        return `
            <div class="d-flex gap-3">
                <span class="badge badge-info">Total Créditos: ${this.summary.total_cuentas}</span>
                <span class="badge badge-warning">Monto Pendiente: ${Utils.formatCurrency(this.summary.monto_total_pendiente)}</span>
            </div>
        `;
    },

    // Renderizar tabla de cuentas
renderAccountsTable() {
    if (this.accounts.length === 0) {
        return `
            <div class="table-container">
                <p class="text-center">No hay créditos pendientes</p>
            </div>
        `;
    }

    return `
        <div class="table-container">
            <table class="table">
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Cliente</th>
                        <th>Monto Pendiente</th>
                        <th>Fecha</th>
                        <th>Acciones</th>
                    </tr>
                </thead>
                <tbody>
                    ${this.accounts.map(account => `
                        <tr>
                            <td><strong>#${account.id}</strong></td>
                            <td>${account.cliente_nombre}</td>
                            <td>${Utils.formatCurrency(account.monto_total)}</td>
                            <td>${Utils.formatDate(account.fecha)}</td>
                            <td>
                                <div class="d-flex gap-1">
                                    <button class="btn btn-primary btn-sm" onclick="Accounts.showPaymentModal(${account.id})">
                                        <i class="fas fa-dollar-sign"></i> Abonar
                                    </button>
                                    <button class="btn btn-success btn-sm" onclick="Accounts.showFullPaymentModal(${account.id})">
                                        <i class="fas fa-check"></i> Pagar Todo
                                    </button>

                                    ${currentUser.tipo === 'administrador' ? `
                                        <button class="btn btn-danger btn-sm" onclick="Accounts.deleteAccount(${account.id})">
                                            <i class="fas fa-trash"></i>
                                        </button>
                                    ` : ''}
                                </div>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
                <tfoot>
                    <tr>
                        <th colspan="2">Total Pendiente</th>
                        <th>${Utils.formatCurrency(this.accounts.reduce((sum, acc) => sum + acc.monto_total, 0))}</th>
                        <th colspan="2"></th>
                    </tr>
                </tfoot>
            </table>
        </div>
    `;
},


    // Renderizar resumen por cliente
    renderClientSummary() {
        if (!this.summary || !this.summary.cuentas_por_cliente || this.summary.cuentas_por_cliente.length === 0) {
            return '';
        }

        return `
            <div class="client-summary mt-4">
                <h3>Resumen por Cliente</h3>
                <div class="table-container">
                    <table class="table">
                        <thead>
                            <tr>
                                <th>Cliente</th>
                                <th>Número de Cuentas</th>
                                <th>Monto Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${this.summary.cuentas_por_cliente.map(client => `
                                <tr>
                                    <td><strong>${client.cliente_nombre}</strong></td>
                                    <td>${client.num_cuentas}</td>
                                    <td>${Utils.formatCurrency(client.monto_total)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    },

    // Mostrar modal para crear cuenta
    showCreateAccountModal() {
        Utils.showModal('Nuevo Crédito', `
            <form id="create-account-form">
                <div class="form-group">
                    <label for="cliente-nombre">Nombre del Cliente *</label>
                    <input type="text" id="cliente-nombre" name="cliente_nombre" required>
                </div>
                <div class="form-group">
                    <label for="monto-total">Monto Total *</label>
                    <input type="number" id="monto-total" name="monto_total" step="0.01" min="0.01" required>
                </div>
                <div class="form-group">
                    <small class="text-muted">
                        Esta cuenta se agregará como deuda pendiente del cliente.
                    </small>
                </div>
            </form>
        `, [
            {
                text: 'Cancelar',
                class: 'btn-light'
            },
            {
                text: 'Crear Crédito',
                class: 'btn-success',
                onclick: 'Accounts.createAccount()'
            }
        ]);
    },

    // Crear cuenta
    async createAccount() {
        const form = document.getElementById('create-account-form');
        if (!Utils.validateForm(form)) {
            Utils.showNotification('Por favor complete todos los campos requeridos', 'warning');
            return;
        }

        const formData = new FormData(form);
        const data = {
            cliente_nombre: formData.get('cliente_nombre'),
            monto_total: parseFloat(formData.get('monto_total'))
        };

        try {
            await Utils.request('/accounts', {
                method: 'POST',
                body: JSON.stringify(data)
            });

            Utils.hideModal();
            Utils.showNotification('Crédito creado exitosamente', 'success');
            this.load();
        } catch (error) {
            Utils.showNotification(error.message, 'error');
        }
    },

    // Mostrar modal de pago/abono
    showPaymentModal(accountId) {
        const account = this.accounts.find(acc => acc.id === accountId);
        if (!account) return;

      Utils.showModal(`Abonar a Crédito - ${account.cliente_nombre}`, `
            <div class="account-info mb-3">
                <p><strong>Cliente:</strong> ${account.cliente_nombre}</p>
                <p><strong>Monto Pendiente:</strong> ${Utils.formatCurrency(account.monto_total)}</p>
                <p><strong>Fecha:</strong> ${Utils.formatDate(account.fecha)}</p>
            </div>
            
            <form id="payment-form">
                <div class="form-group">
                    <label for="monto-abono">Monto a Abonar *</label>
                    <input type="number" id="monto-abono" name="monto_abono" step="0.01" min="0.01" max="${account.monto_total}" required>
                    <small class="text-muted">Máximo: ${Utils.formatCurrency(account.monto_total)}</small>
                </div>
                <div class="form-group">
                    <label for="metodo-pago">Método de Pago *</label>
                    <select id="metodo-pago" name="metodo_pago" required>
                        <option value="">Seleccione método</option>
                        <option value="efectivo">Efectivo</option>
                        <option value="tarjeta">Tarjeta</option>
                    </select>
                </div>
                
                <div class="payment-options mt-3">
                    <button type="button" class="btn btn-warning" onclick="Accounts.setFullAmount(${account.monto_total})">
                        <i class="fas fa-dollar-sign"></i> Pagar Todo (${Utils.formatCurrency(account.monto_total)})
                    </button>
                </div>
            </form>
        `, [
            {
                text: 'Cancelar',
                class: 'btn-light'
            },
            {
                text: 'Procesar Abono',
                class: 'btn-success',
                onclick: `Accounts.processPayment(${accountId})`
            }
        ]);
    },

    // Establecer monto completo
    setFullAmount(amount) {
        document.getElementById('monto-abono').value = amount;
    },

    // Procesar pago/abono
async processPayment(accountId) {
    const form = document.getElementById('payment-form');
    if (!Utils.validateForm(form)) {
        Utils.showNotification('Por favor complete todos los campos requeridos', 'warning');
        return;
    }

    const formData = new FormData(form);
    const data = {
        monto_abono: parseFloat(formData.get('monto_abono')),
        metodo_pago: formData.get('metodo_pago')
    };

    const account = this.accounts.find(acc => acc.id === accountId);

    if (data.monto_abono > account.monto_total) {
        Utils.showNotification('El monto del abono no puede ser mayor al monto pendiente', 'warning');
        return;
    }

    try {
        const response = await Utils.request(`/accounts/${accountId}/payment`, {
            method: 'POST',
            body: JSON.stringify(data)
        });

        if (response.data.cuenta_saldada) {
            // Redirigir al flujo completo
            Utils.hideModal();
            setTimeout(() => {
                this.processFullPayment(accountId);
            }, 500);
            return;
        }

        Utils.hideModal();
        Utils.showNotification(`Abono procesado. Restante: ${Utils.formatCurrency(response.data.monto_restante)}`, 'success');
        this.load();

        const printReceipt = await Utils.confirm(
            '¿Desea imprimir el comprobante de pago?',
            'Imprimir Comprobante'
        );

        if (printReceipt) {
            this.printPaymentReceipt(response.data, account);
        }
    } catch (error) {
        Utils.showNotification(error.message, 'error');
    }
},


    // Pagar cuenta completa

getAccountById(id) {
    return this.accounts.find(acc => acc.id === id);
}
,

showFullPaymentModal(id) {
    const cuenta = this.getAccountById(id);
    if (!cuenta) {
        Utils.showNotification('No se pudo encontrar la cuenta seleccionada', 'error');
        return;
    }

    this.pendingAccountId = id;

    const contenido = `
        <p style="margin-bottom: 1rem; font-weight: bold;">
            Monto total a pagar: ${Utils.formatCurrency(cuenta.monto_total)}
        </p>

        <form id="full-payment-form">
            <div class="form-group">
                <label for="metodo_pago">Método de Pago *</label>
                <select name="metodo_pago" id="metodo_pago" required class="form-control">
                    <option value="">Seleccione...</option>
                    <option value="efectivo">Efectivo</option>
                    <option value="tarjeta">Tarjeta</option>
                </select>
            </div>
        </form>
    `;

    Utils.showModal(`Pagar Crédito Completo - ${cuenta.cliente_nombre}`, contenido, [
        {
            text: 'Cancelar',
            class: 'btn-secondary'
        },
        {
            text: 'Confirmar Pago',
            class: 'btn-primary',
            onclick: `Accounts.processFullPayment(${id})`
        }
    ]);
},

    // Procesar pago completo
    async processFullPayment(accountId) {
        const form = document.getElementById('full-payment-form');
        if (!Utils.validateForm(form)) {
            Utils.showNotification('Por favor seleccione el método de pago', 'warning');
            return;
        }

        const formData = new FormData(form);
        const data = {
            metodo_pago: formData.get('metodo_pago')
        };

        try {
            const response = await Utils.request(`/accounts/${accountId}/pay-full`, {
                method: 'POST',
                body: JSON.stringify(data)
            });

            Utils.hideModal();
            Utils.showNotification(`Cuenta saldada completamente. Total pagado: ${Utils.formatCurrency(response.data.monto_pagado)}`, 'success');
            this.load();
            
            // Opción de imprimir comprobante
            const printReceipt = await Utils.confirm(
                '¿Desea imprimir el comprobante de pago?',
                'Imprimir Comprobante'
            );
            
            if (printReceipt) {
                this.printFullPaymentReceipt(response.data);
            }
        } catch (error) {
            Utils.showNotification(error.message, 'error');
        }
    },

    // Eliminar cuenta (solo administradores)
    async deleteAccount(accountId) {
        if (currentUser.tipo !== 'administrador') {
            Utils.showNotification('Solo los administradores pueden eliminar cuentas', 'warning');
            return;
        }

        const account = this.accounts.find(acc => acc.id === accountId);
        if (!account) return;

        const confirmed = await Utils.confirm(
            `¿Está seguro de eliminar el crédito de ${account.cliente_nombre} por ${Utils.formatCurrency(account.monto_total)}?\n\nEsta acción no se puede deshacer.`,
            'Confirmar Eliminación'
        );

        if (!confirmed) return;

        try {
            await Utils.request(`/accounts/${accountId}`, {
                method: 'DELETE'
            });

            Utils.showNotification('Crédito eliminado exitosamente', 'success');
            this.load();
        } catch (error) {
            Utils.showNotification(error.message, 'error');
        }
    },

    // Imprimir comprobante de abono
    printPaymentReceipt(paymentData, account) {
        // Aquí se implementaría la lógica de impresión del comprobante
        const receiptContent = `
            COMPROBANTE DE ABONO
            ====================
            Cliente: ${account.cliente_nombre}
            Monto Abonado: ${Utils.formatCurrency(paymentData.monto_abonado)}
            Método de Pago: ${paymentData.metodo_pago}
            Monto Restante: ${Utils.formatCurrency(paymentData.monto_restante)}
            Fecha: ${new Date().toLocaleString()}
        `;
        
        console.log('Comprobante de abono:', receiptContent);
        Utils.showNotification('Comprobante generado', 'info');
    },

    // Imprimir comprobante de pago completo
    printFullPaymentReceipt(paymentData) {
        // Aquí se implementaría la lógica de impresión del comprobante
        const receiptContent = `
            COMPROBANTE DE PAGO COMPLETO
            ============================
            Cliente: ${paymentData.cliente_nombre}
            Monto Pagado: ${Utils.formatCurrency(paymentData.monto_pagado)}
            Método de Pago: ${paymentData.metodo_pago}
            Estado: CUENTA SALDADA
            Fecha: ${new Date().toLocaleString()}
        `;
        
        console.log('Comprobante de pago completo:', receiptContent);
        Utils.showNotification('Comprobante generado', 'info');
    }
};
