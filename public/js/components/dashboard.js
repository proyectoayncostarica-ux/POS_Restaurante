// Dashboard Component
const Dashboard = {
    data: null,
    filtroTipo: 'todos',
    filtroEstado: null,
    autoRefreshInterval: null,
    isLoading: false,
    loadError: null,
    isStale: false,
    realtimeRefreshInProgress: false,

    async load() {
        this.isLoading = true;
        this.loadError = null;
        this.renderLoadingState();

        try {
            const response = await Utils.request('/dashboard');
            this.data = response.data;
            this.isLoading = false;
            this.render();
            this.setupEventListeners();
        } catch (error) {
            console.error('Error cargando dashboard:', error);
            this.isLoading = false;
            this.loadError = error;
            this.renderErrorState();
            Utils.showNotification('Error cargando datos del dashboard', 'error');
        }
    },

    render() {
        if (!this.data) return;
        this.filtroTipo = this.filtroTipo || 'todos';

        this.setText('greeting-message', getGreetingMessage());
        this.updateOperationalMetrics();
        this.renderMesasGrid();
        this.renderUltimasCuentasPagadas();
        this.updateLastUpdated();
        Navigation.syncInternalSubnav('dashboard');
    },

    renderLoadingState() {
        const container = document.getElementById('mesas-grid');
        if (container) {
            container.innerHTML = Array.from({ length: 6 }).map(() => `
                <div class="mesa-card dashboard-skeleton-card">
                    <div class="dashboard-skeleton-line short"></div>
                    <div class="dashboard-skeleton-line"></div>
                    <div class="dashboard-skeleton-line small"></div>
                </div>
            `).join('');
        }

        this.setText('dashboard-status-message', 'Actualizando operación...');
    },

    renderErrorState() {
        const container = document.getElementById('mesas-grid');
        if (container) {
            container.innerHTML = `
                <div class="dashboard-empty-state dashboard-empty-state-wide">
                    <i class="fas fa-triangle-exclamation"></i>
                    <strong>No se pudo cargar el Dashboard</strong>
                    <span>Revisa la conexión con el servidor e intenta de nuevo.</span>
                    <button class="btn btn-primary btn-sm" onclick="Dashboard.load()">
                        <i class="fas fa-rotate-right"></i> Reintentar
                    </button>
                </div>
            `;
        }

        this.setText('dashboard-status-message', 'Error al actualizar');
    },

    setupEventListeners() {
        const ventasCard = document.getElementById('ventas-del-dia-card');
        if (ventasCard && ventasCard.dataset.listenerReady !== 'true') {
            ventasCard.addEventListener('click', () => this.mostrarDetalleVentas());
            ventasCard.dataset.listenerReady = 'true';
        }
    },

    filtrarPorZona(zonaSeleccionada) {
        this.filtroTipo = zonaSeleccionada || 'todos';
        this.resetEstadoFilterIfUnavailable();

        document.querySelectorAll('#dashboard-section .btn-zona').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tipo === this.filtroTipo);
        });

        this.updateOperationalMetrics();
        this.renderMesasGrid();
        this.updateLastUpdated();
        Navigation.syncInternalSubnav('dashboard');
    },

    filtrarPorEstado(estadoSeleccionado) {
        const estado = this.normalizeEstado(estadoSeleccionado);
        const resumen = this.getOperationalSummary();
        const zonaActual = this.getActiveZoneSummary(resumen);
        const cantidad = this.getSummaryStateCount(zonaActual, estado);

        if (!cantidad) {
            this.filtroEstado = null;
            this.updateOperationalMetrics();
            this.renderMesasGrid();
            return;
        }

        this.filtroEstado = this.filtroEstado === estado ? null : estado;
        this.updateOperationalMetrics();
        this.renderMesasGrid();
        this.updateLastUpdated();
    },

    updateOperationalMetrics() {
        const data = this.data || {};
        this.resetEstadoFilterIfUnavailable();
        const resumen = this.getOperationalSummary();
        const zonaActual = this.getActiveZoneSummary(resumen);
        const totales = resumen.totales || {};
        const pendientes = Number(data.cuentasPendientes) || 0;
        const ventasHoy = Number(data.ventasHoy) || 0;
        const zonasTotal = Number(zonaActual.total) || 0;
        const puestosVisibles = this.getVisibleMesas().length;
        const totalVista = this.filtroEstado ? puestosVisibles : zonasTotal;
        const ocupadas = Number(zonaActual.ocupadas) || 0;
        const ocupacion = zonasTotal > 0 ? Math.round((ocupadas / zonasTotal) * 100) : 0;

        this.setText('mesas-libres', totales.mesasLibres || data.mesasLibres || 0);
        this.setText('mesas-ocupadas', totales.mesasOcupadas || data.mesasOcupadas || 0);
        this.setText('mesas-reservadas', totales.mesasReservadas || data.mesasReservadas || 0);
        this.setText('bancos-libres', totales.bancosLibres || data.bancosLibres || 0);
        this.setText('bancos-ocupados', totales.bancosOcupados || data.bancosOcupados || 0);

        this.setHTML('cuentas-pendientes', `<i class="fas fa-hourglass-half" style="color: var(--warning-color);"></i> <b>${pendientes}</b>`);
        this.setHTML('cuentas-pagadas', `<i class="fas fa-check-circle" style="color: var(--success-color);"></i> <b>${data.cuentasPagadas || 0}</b>`);
        this.setHTML('creditos-pagados', `<i class="fas fa-money-check-alt" style="color: var(--danger-color);"></i> <b>${data.creditosPagados || 0}</b>`);

        this.setText('creditos-disponibles', data.creditosDisponibles || 0);
        this.setText('monto-total-creditos', Utils.formatCurrency(data.montoTotalCreditos || 0));

        this.setHTML('ventas-contado', `<i class="fas fa-money-bill-wave" style="color: var(--success-color);"></i> <b>${Utils.formatCurrency(data.ventasContado || 0)}</b>`);
        this.setHTML('ventas-credito', `<i class="fas fa-credit-card" style="color: var(--info-color);"></i> <b>${Utils.formatCurrency(data.ventasCredito || 0)}</b>`);
        this.setHTML('ventas-hoy', `<b>${Utils.formatCurrency(ventasHoy)}</b>`);

        this.setText('dashboard-current-filter', this.getCurrentViewLabel());
        this.setText('dashboard-current-total', totalVista);
        this.setText('dashboard-current-libres', zonaActual.libres || 0);
        this.setText('dashboard-current-ocupadas', zonaActual.ocupadas || 0);
        this.setText('dashboard-current-reservadas', zonaActual.reservadas || 0);
        this.setText('dashboard-current-consumo', Utils.formatCurrency(zonaActual.consumo || 0));
        this.setText('dashboard-occupancy-rate', `${ocupacion}%`);
        this.setText('dashboard-pending-orders', pendientes);
        this.setText('dashboard-sales-total', Utils.formatCurrency(ventasHoy));
        this.setText('dashboard-status-message', pendientes > 0 ? `${pendientes} cuenta${pendientes === 1 ? '' : 's'} pendiente${pendientes === 1 ? '' : 's'}` : 'Operación sin cuentas pendientes');
        this.updateStateFilterControls(zonaActual);
    },

    renderMesasGrid() {
        const container = document.getElementById('mesas-grid');
        if (!container || !this.data) return;

        const zonas = this.getVisibleMesas();
        const label = this.getZoneLabel(this.filtroTipo);
        this.setText('dashboard-summary-title', `Zonas · ${label}`);

        if (!zonas.length) {
            const estadoLabel = this.filtroEstado ? this.getEstadoLabel(this.filtroEstado).toLowerCase() : null;
            container.innerHTML = `
                <div class="dashboard-empty-state dashboard-empty-state-wide">
                    <i class="fas fa-chair"></i>
                    <strong>${estadoLabel ? `No hay puestos ${estadoLabel} en ${label}` : `No hay zonas para ${label}`}</strong>
                    <span>${estadoLabel ? 'El filtro de estado se reiniciará al cambiar a una zona sin coincidencias.' : 'Crea o revisa las zonas desde el módulo Zonas.'}</span>
                </div>
            `;
            return;
        }

        container.innerHTML = zonas.map(mesa => this.renderMesaCard(mesa)).join('');
    },

    renderMesaCard(mesa) {
        const tipoAsiento = (mesa.tipo_asiento || 'mesa').toLowerCase();
        const zona = (mesa.zona || 'salon').toLowerCase();
        const esBanco = zona === 'bar' && tipoAsiento === 'banco';
        const tipoNombre = esBanco ? 'Banco' : 'Mesa';
        const estado = this.normalizeEstado(mesa.estado);
        const badgeInfo = this.getMesaBadge(mesa);
        const monto = Number(mesa.monto_consumido) || 0;
        const action = this.getMesaAction(mesa);
        const tituloPrincipal = this.getMesaPrimaryTitle(mesa, tipoNombre, estado);
        const zonaLabel = `${tipoNombre} ${mesa.numero}`;
        const estadoPrincipal = this.getMesaStatusSlot(mesa, tipoNombre, estado);
        const estadoClass = estado === 'ocupada' ? `${estado} mesa-ubicacion-destacada` : estado;

        return `
            <button type="button" class="mesa-card dashboard-zone-card ${estado} ${badgeInfo.typeClass}"
                    onclick="${action.onclick}" ${action.doubleClick ? `ondblclick="${action.doubleClick}"` : ''}
                    aria-label="${this.escapeHTML(zonaLabel)}, ${this.getEstadoLabel(estado)}">
                <span class="badge-zona ${badgeInfo.badgeClass}">${badgeInfo.label}</span>
                <span class="mesa-numero">${tituloPrincipal}</span>
                <span class="mesa-estado ${estadoClass}">${estadoPrincipal}</span>
                <span class="mesa-info dashboard-zone-info">
                    ${this.getMesaInfo(mesa, monto, tipoNombre)}
                </span>
                <span class="dashboard-zone-action">${action.label}</span>
            </button>
        `;
    },

    getMesaPrimaryTitle(mesa, tipoNombre, estado) {
        const zonaLabel = `${tipoNombre} ${mesa.numero}`;

        if (estado === 'ocupada' || estado === 'reservada') {
            const cliente = String(mesa.cliente_nombre || '').trim();
            return this.escapeHTML(cliente || zonaLabel);
        }

        return this.escapeHTML(zonaLabel);
    },

    getMesaReferenceBadge(mesa, tipoNombre, estado) {
        const zonaLabel = `${tipoNombre} ${mesa.numero}`.toUpperCase();
        return `<small class="mesa-reference-badge mesa-reference-${estado}">${this.escapeHTML(zonaLabel)}</small>`;
    },

    getMesaStatusSlot(mesa, tipoNombre, estado) {
        if (estado === 'ocupada') {
            return this.escapeHTML(`${tipoNombre} ${mesa.numero}`.toUpperCase());
        }

        return this.getEstadoLabel(estado);
    },

    getMesaOperationalStatusBadge(estado) {
        const estadoLabel = this.getEstadoLabel(estado).toUpperCase();
        return `<small class="mesa-reference-badge mesa-operational-status mesa-operational-${estado}">${this.escapeHTML(estadoLabel)}</small>`;
    },

    getMesaInfo(mesa, monto, tipoNombre) {
        const estado = this.normalizeEstado(mesa.estado);

        if (estado === 'libre') {
            return `<small>Capacidad: ${this.escapeHTML(mesa.capacidad || 1)} persona${Number(mesa.capacidad) === 1 ? '' : 's'}</small>`;
        }

        if (estado === 'ocupada') {
            return `
                ${this.getMesaOperationalStatusBadge(estado)}
                <strong class="mesa-monto-destacado">${Utils.formatCurrency(monto)}</strong>
            `;
        }

        if (estado === 'reservada') {
            return `
                ${this.getMesaReferenceBadge(mesa, tipoNombre, estado)}
                ${mesa.hora_estimada ? `<small>Hora: ${this.escapeHTML(mesa.hora_estimada)}</small>` : ''}
                ${mesa.cantidad_personas ? `<small>Personas: ${this.escapeHTML(mesa.cantidad_personas)}</small>` : ''}
            `;
        }

        return '<small>Sin información</small>';
    },

    getMesaAction(mesa) {
        const estado = this.normalizeEstado(mesa.estado);

        if (estado === 'libre') {
            return {
                label: 'Abrir',
                onclick: `Dashboard.abrirZona(${mesa.id})`
            };
        }

        if (estado === 'reservada') {
            return {
                label: 'Ver reserva',
                onclick: `Dashboard.verReserva(${mesa.id})`
            };
        }

        if (!mesa.pedido_id || Number(mesa.monto_consumido || 0) === 0) {
            return {
                label: 'Crear pedido',
                onclick: `Dashboard.abrirNuevoPedido(${mesa.id})`
            };
        }

        return {
            label: 'Agregar productos',
            onclick: `Dashboard.abrirAgregarProductos(${mesa.id}, ${mesa.pedido_id})`,
            doubleClick: `Dashboard.abrirProcesarPago(${mesa.id}, ${mesa.pedido_id})`
        };
    },

    getMesaBadge(mesa) {
        const zona = (mesa.zona || 'salon').toLowerCase();
        const tipoAsiento = (mesa.tipo_asiento || 'mesa').toLowerCase();

        if (zona === 'bar' && tipoAsiento === 'banco') {
            return { label: 'Barra', badgeClass: 'badge-barra', typeClass: 'tipo-bar-banco' };
        }

        if (zona === 'bar') {
            return { label: 'Bar', badgeClass: 'badge-barra-mesa', typeClass: 'tipo-bar-mesa' };
        }

        return { label: 'Salón', badgeClass: 'badge-salon', typeClass: 'tipo-salon' };
    },

    getFilteredMesas() {
        const mesas = Array.isArray(this.data?.mesasDetalle) ? this.data.mesasDetalle : [];
        const filtro = this.filtroTipo || 'todos';

        if (filtro === 'todos') return mesas;

        return mesas.filter(m => this.normalizeZoneKey(m) === filtro);
    },

    getVisibleMesas() {
        const mesas = this.getFilteredMesas();
        if (!this.filtroEstado) return mesas;
        return mesas.filter(m => this.normalizeEstado(m.estado) === this.filtroEstado);
    },

    createEmptyZoneSummary(label) {
        return {
            label,
            total: 0,
            libres: 0,
            ocupadas: 0,
            reservadas: 0,
            consumo: 0
        };
    },

    buildSummaryFromMesas() {
        const zonas = {
            todos: this.createEmptyZoneSummary('Todos'),
            salon: this.createEmptyZoneSummary('Salón'),
            'bar-mesa': this.createEmptyZoneSummary('Bar'),
            'bar-banco': this.createEmptyZoneSummary('Barra')
        };

        const mesas = Array.isArray(this.data?.mesasDetalle) ? this.data.mesasDetalle : [];

        mesas.forEach(mesa => {
            const zoneKey = this.normalizeZoneKey(mesa);
            const estado = this.normalizeEstado(mesa.estado);
            const monto = Number(mesa.monto_consumido) || 0;
            const targets = [zonas.todos, zonas[zoneKey]].filter(Boolean);

            targets.forEach(summary => {
                summary.total += 1;
                if (estado === 'libre') summary.libres += 1;
                if (estado === 'ocupada') summary.ocupadas += 1;
                if (estado === 'reservada') summary.reservadas += 1;
                if (monto > 0) summary.consumo += monto;
            });
        });

        return {
            zonas,
            totales: {
                mesasLibres: zonas.salon.libres + zonas['bar-mesa'].libres,
                mesasOcupadas: zonas.salon.ocupadas + zonas['bar-mesa'].ocupadas,
                mesasReservadas: zonas.salon.reservadas + zonas['bar-mesa'].reservadas,
                bancosLibres: zonas['bar-banco'].libres,
                bancosOcupados: zonas['bar-banco'].ocupadas,
                bancosReservados: zonas['bar-banco'].reservadas
            }
        };
    },

    getOperationalSummary() {
        const clientSummary = this.buildSummaryFromMesas();
        const hasMesasDetalle = Array.isArray(this.data?.mesasDetalle) && this.data.mesasDetalle.length > 0;

        if (hasMesasDetalle || clientSummary.zonas.todos.total > 0) {
            return clientSummary;
        }

        const zonas = this.data?.zonasResumen || {};
        return {
            zonas: {
                todos: zonas.todos || this.createEmptyZoneSummary('Todos'),
                salon: zonas.salon || this.createEmptyZoneSummary('Salón'),
                'bar-mesa': zonas['bar-mesa'] || this.createEmptyZoneSummary('Bar'),
                'bar-banco': zonas['bar-banco'] || this.createEmptyZoneSummary('Barra')
            },
            totales: {
                mesasLibres: this.data?.mesasLibres || 0,
                mesasOcupadas: this.data?.mesasOcupadas || 0,
                mesasReservadas: this.data?.mesasReservadas || 0,
                bancosLibres: this.data?.bancosLibres || 0,
                bancosOcupados: this.data?.bancosOcupados || 0,
                bancosReservados: this.data?.bancosReservados || 0
            }
        };
    },

    getActiveZoneSummary(summary = this.getOperationalSummary()) {
        return summary.zonas?.[this.filtroTipo || 'todos'] || this.createEmptyZoneSummary(this.getZoneLabel(this.filtroTipo));
    },

    getSummaryStateCount(summary, estado) {
        const normalized = this.normalizeEstado(estado);
        const fieldMap = {
            libre: 'libres',
            ocupada: 'ocupadas',
            reservada: 'reservadas'
        };
        return Number(summary?.[fieldMap[normalized]] || 0);
    },

    resetEstadoFilterIfUnavailable() {
        if (!this.filtroEstado) return;
        const resumen = this.getOperationalSummary();
        const zonaActual = this.getActiveZoneSummary(resumen);
        if (this.getSummaryStateCount(zonaActual, this.filtroEstado) === 0) {
            this.filtroEstado = null;
        }
    },

    updateStateFilterControls(zonaActual = this.getActiveZoneSummary()) {
        document.querySelectorAll('#dashboard-section [data-dashboard-state-filter]').forEach(control => {
            const estado = this.normalizeEstado(control.dataset.dashboardStateFilter);
            const cantidad = this.getSummaryStateCount(zonaActual, estado);
            const isActive = this.filtroEstado === estado;
            control.classList.toggle('active', isActive);
            control.classList.toggle('is-empty', cantidad === 0);
            control.setAttribute('aria-pressed', isActive ? 'true' : 'false');
            control.setAttribute('title', cantidad > 0
                ? `Filtrar ${this.getZoneLabel(this.filtroTipo)} por ${this.getEstadoLabel(estado).toLowerCase()}`
                : `No hay puestos ${this.getEstadoLabel(estado).toLowerCase()} en ${this.getZoneLabel(this.filtroTipo)}`);
        });
    },

    getCurrentViewLabel() {
        const zoneLabel = this.getZoneLabel(this.filtroTipo);
        if (!this.filtroEstado) return zoneLabel;
        return `${zoneLabel} · ${this.getEstadoLabel(this.filtroEstado)}`;
    },

    normalizeZoneKey(row = {}) {
        const zona = String(row.zona || 'salon').trim().toLowerCase();
        const tipoAsiento = String(row.tipo_asiento || 'mesa').trim().toLowerCase();

        if (zona === 'bar' && tipoAsiento === 'banco') return 'bar-banco';
        if (zona === 'bar') return 'bar-mesa';
        return 'salon';
    },

    normalizeEstado(estado) {
        const value = String(estado || 'libre').trim().toLowerCase();
        const aliases = {
            disponible: 'libre',
            libre: 'libre',
            ocupada: 'ocupada',
            ocupado: 'ocupada',
            activa: 'ocupada',
            activo: 'ocupada',
            reservada: 'reservada',
            reservado: 'reservada'
        };
        return aliases[value] || 'libre';
    },

    getZoneLabel(filtro) {
        const labels = {
            todos: 'Todos',
            salon: 'Salón',
            'bar-mesa': 'Bar',
            'bar-banco': 'Barra'
        };
        return labels[filtro] || 'Todos';
    },

    getEstadoLabel(estado) {
        const normalized = this.normalizeEstado(estado);
        const labels = {
            libre: 'Libre',
            ocupada: 'Ocupada',
            reservada: 'Reservada'
        };
        return labels[normalized] || normalized;
    },

    escapeHTML(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    },

    setText(id, value) {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    },

    setHTML(id, value) {
        const element = document.getElementById(id);
        if (element) element.innerHTML = value;
    },

    updateLastUpdated() {
        if (!this.data?.actualizadoEn) return;

        const date = new Date(this.data.actualizadoEn);
        const formatted = Number.isNaN(date.getTime())
            ? 'Actualizado'
            : `Actualizado ${date.toLocaleTimeString('es-CR', { hour: 'numeric', minute: '2-digit' })}`;

        this.setText('dashboard-last-updated', formatted);
    },

    async ensureTablesData() {
        if (typeof Tables === 'undefined') return false;

        if (Array.isArray(Tables.data) && Tables.data.length > 0) return true;

        const response = await Utils.request('/tables');
        Tables.data = response.data || [];
        return true;
    },

    async abrirZona(mesaId) {
        try {
            const ready = await this.ensureTablesData();
            if (ready) Tables.showAbrirMesaModal(mesaId);
        } catch (error) {
            Utils.showNotification('No se pudo abrir la zona seleccionada', 'error');
        }
    },

    async verReserva(mesaId) {
        try {
            const ready = await this.ensureTablesData();
            if (ready) Tables.showMesaReservadaModal(mesaId);
        } catch (error) {
            Utils.showNotification('No se pudo cargar la reserva', 'error');
        }
    },

    // Renderizar últimas cuentas pagadas del día
    renderUltimasCuentasPagadas() {
        const container = document.getElementById('cuentas-pagadas-recientes');
        if (!container) return;

        const cuentas = Array.isArray(this.data?.ultimasCuentasPagadas)
            ? this.data.ultimasCuentasPagadas.slice(0, 5)
            : [];

        if (!cuentas.length) {
            container.innerHTML = `
                <div class="dashboard-empty-state dashboard-paid-empty">
                    <i class="fas fa-receipt"></i>
                    <strong>No hay cuentas pagadas hoy</strong>
                    <span>Las ventas cerradas aparecerán aquí apenas se pague una cuenta.</span>
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <div class="dashboard-paid-list" aria-label="Últimas cuentas pagadas del día">
                ${cuentas.map(cuenta => this.renderCuentaPagadaCard(cuenta)).join('')}
            </div>
        `;
    },

    renderCuentaPagadaCard(cuenta) {
        const esBanco = (cuenta.zona || '').toLowerCase() === 'bar' && (cuenta.tipo_asiento || '').toLowerCase() === 'banco';
        const zonaLabel = esBanco ? 'Banco' : 'Mesa';
        const fecha = cuenta.fecha ? new Date(cuenta.fecha) : null;
        const hora = fecha && !Number.isNaN(fecha.getTime())
            ? fecha.toLocaleTimeString('es-CR', { hour: 'numeric', minute: '2-digit', hour12: true })
            : 'Hoy';

        return `
            <button type="button" class="dashboard-paid-card" onclick="Dashboard.verCuenta(${cuenta.id})" aria-label="Ver cuenta pagada ${cuenta.id}">
                <span class="dashboard-paid-icon"><i class="fas fa-check"></i></span>
                <span class="dashboard-paid-main">
                    <strong>${zonaLabel} ${cuenta.mesa_numero || '-'}</strong>
                    <small>${cuenta.cliente_nombre || 'Cliente anónimo'} · ${hora}</small>
                </span>
                <span class="dashboard-paid-amount">${Utils.formatCurrency(cuenta.total || 0)}</span>
                <span class="dashboard-paid-action"><i class="fas fa-arrow-right"></i></span>
            </button>
        `;
    },

    // Mostrar detalle de ventas del día
    async mostrarDetalleVentas() {
        try {
            const response = await Utils.request('/dashboard/ventas-detalle');
            const ventasDetalle = response.data;

            if (!ventasDetalle || ventasDetalle.length === 0) {
                Utils.showModal('Ventas del Día', '<p class="text-center">No hay ventas registradas hoy</p>', [
                    { text: 'Cerrar', class: 'btn-light' }
                ]);
                return;
            }

            const modalContent = `
                <div class="ventas-modal-content">
                    <h3>Desglose Detallado de Ventas del Día</h3>
                    <table class="ventas-detalle-table">
                        <thead>
                            <tr>
                                <th>Zona</th>
                                <th>Cliente</th>
                                <th>Hora de Venta</th>
                                <th>Total</th>
                                <th>Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${ventasDetalle.map(venta => {
                                return `
                                <tr>
                                    <td>${((venta.zona || '').toLowerCase() === 'bar' && (venta.tipo_asiento || '').toLowerCase() === 'banco') ? 'Banco' : 'Mesa'} ${venta.mesa_numero}</td>
                                    <td>${venta.cliente_nombre || 'Cliente anónimo'}</td>
                                    <td>${Utils.formatDateTime(venta.fecha_venta)}</td>
                                    <td>₡${Utils.formatNumber(venta.total)}</td>
                                    <td>
                                        <i class="fas fa-search-plus search-icon" 
                                           onclick="Dashboard.verDetalleVenta(${venta.id}, '${venta.tipo_asiento}')" 
                                           title="Ver detalle" style="cursor: pointer; margin-right: 10px;"></i>
                                        <i class="fas fa-print print-icon" 
                                           onclick="Dashboard.reimprimirFactura(${venta.id})" 
                                           title="Reimprimir factura" style="cursor: pointer;"></i>
                                    </td>
                                </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            `;

            Utils.showModal('Ventas del Día', modalContent, [
                {
                    text: 'Cerrar',
                    class: 'btn-light'
                }
            ]);
        } catch (error) {
            Utils.showNotification('Error cargando detalle de ventas', 'error');
        }
    },

    // Ver detalle específico de una venta
async verDetalleVenta(ventaId, tipo) {
    try {
        const response = await Utils.request(`/accounts/${ventaId}`);
        const venta = response.data;

        const nombreZona = ((venta.zona || '').toLowerCase() === 'bar' && (venta.tipo_asiento || '').toLowerCase() === 'banco') ? 'Banco' : 'Mesa';

        const modalContent = `
            <div class="venta-detalle">
                <h3>Detalle de Venta #${venta.id}</h3>
                <div class="venta-info">
                    <p><strong>${nombreZona}:</strong> ${venta.mesa_numero}</p>
                    <p><strong>Cliente?:</strong> ${venta.cliente_nombre}</p>
                    <p><strong>Fecha:</strong> ${Utils.formatDateTime(venta.fecha)}</p>
                    <p><strong>Total:</strong> ₡${Utils.formatNumber(venta.total)}</p>
                </div>
                <div class="venta-items">
                    <h4>Productos:</h4>
                    <table class="table">
                        <thead>
                            <tr>
                                <th>Producto</th>
                                <th>Cantidad</th>
                                <th>Precio</th>
                                <th>Subtotal</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${venta.items.map(item => `
                                <tr>
                                    <td>${item.producto_nombre}</td>
                                    <td>${item.cantidad}</td>
                                    <td>₡${Utils.formatNumber(item.precio)}</td>
                                    <td>₡${Utils.formatNumber(item.subtotal)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        Utils.showModal('Detalle de Venta', modalContent, [
            {
                text: 'Reimprimir Factura',
                class: 'btn-primary',
                onclick: `Dashboard.reimprimirFactura(${ventaId})`
            },
            {
                text: 'Cerrar',
                class: 'btn-light'
            }
        ]);
    } catch (error) {
        Utils.showNotification('Error cargando detalle de venta', 'error');
    }
}
,

    // Ver cuenta específica
async verCuenta(cuentaId) {
    try {
        const response = await Utils.request(`/accounts/${cuentaId}`);
        const cuenta = response.data;

        // Determinar si es Mesa o Banco
        const nombreZona = ((cuenta.zona || '').toLowerCase() === 'bar' && (cuenta.tipo_asiento || '').toLowerCase() === 'banco') ? 'Banco' : 'Mesa';

        const modalContent = `
            <div class="cuenta-detalle">
                <h3>Detalle de Cuenta #${cuenta.id}</h3>
                <div class="cuenta-info">
                    <p><strong>${nombreZona}:</strong> ${cuenta.mesa_numero}</p>
                    <p><strong>Cliente:</strong> ${cuenta.cliente_nombre}</p>
                    <p><strong>Fecha:</strong> ${Utils.formatDateTime(cuenta.fecha)}</p>
                    <p><strong>Total:</strong> ₡${Utils.formatNumber(cuenta.total)}</p>
                </div>
                <div class="cuenta-items">
                    <h4>Productos:</h4>
                    <table class="table">
                        <thead>
                            <tr>
                                <th>Producto</th>
                                <th>Cantidad</th>
                                <th>Precio</th>
                                <th>Subtotal</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${cuenta.items.map(item => `
                                <tr>
                                    <td>${item.producto_nombre}</td>
                                    <td>${item.cantidad}</td>
                                    <td>₡${Utils.formatNumber(item.precio)}</td>
                                    <td>₡${Utils.formatNumber(item.subtotal)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        Utils.showModal('Detalle de Cuenta', modalContent, [
            {
                text: 'Reimprimir Factura',
                class: 'btn-primary',
                onclick: `Dashboard.reimprimirFactura(${cuentaId})`
            },
            {
                text: 'Cerrar',
                class: 'btn-light'
            }
        ]);
    } catch (error) {
        Utils.showNotification('Error cargando detalle de cuenta', 'error');
    }
}, 

    // Reimprimir factura
    async reimprimirFactura(cuentaId) {
        try {
            await Utils.request(`/accounts/${cuentaId}/reprint`, {
                method: 'POST'
            });
            Utils.showNotification('Factura enviada a impresión', 'success');
        } catch (error) {
            Utils.showNotification('Error al reimprimir factura', 'error');
        }
    },

    // Actualizar datos automáticamente
    startAutoRefresh() {
        this.stopAutoRefresh();

        this.autoRefreshInterval = setInterval(() => {
            if (currentSection === 'dashboard') {
                this.refreshData();
            }
        }, 7000);
    },

    stopAutoRefresh() {
        if (this.autoRefreshInterval) {
            clearInterval(this.autoRefreshInterval);
            this.autoRefreshInterval = null;
        }
    },

    // Refrescar solo los datos sin recargar toda la vista
    async refreshData(options = {}) {
        if (this.realtimeRefreshInProgress) return;

        this.realtimeRefreshInProgress = true;

        try {
            const response = await Utils.request('/dashboard');
            this.data = response.data;
            this.isStale = false;
            this.updateOperationalMetrics();
            this.renderMesasGrid();
            this.renderUltimasCuentasPagadas();
            this.updateLastUpdated();

            if (options.source === 'realtime') {
                this.setText('dashboard-status-message', 'Operación sincronizada');
            }
        } catch (error) {
            console.error('Error refrescando datos del dashboard:', error);
            this.setText('dashboard-status-message', 'No se pudo actualizar');
        } finally {
            this.realtimeRefreshInProgress = false;
        }
    },

    markStale() {
        this.isStale = true;
    },

    // Abrir modal de nuevo pedido desde el dashboard
    abrirNuevoPedido(mesaId) {
        Orders.mesaIdActual = mesaId;
        Orders.load().then(() => {
            Orders.showCreateOrderModal(mesaId);
        });
    },

    // Abrir modal de agregar productos desde el dashboard
    abrirAgregarProductos(mesaId, pedidoId) {
        Orders.load().then(() => {
            Orders.showAddProductsModal(pedidoId);
        });
    },

    // Abrir modal de procesar pago desde el dashboard
    abrirProcesarPago(mesaId, pedidoId) {
        Orders.load().then(() => {
            Orders.showPaymentModal(pedidoId);
        });
    }
};

// Iniciar auto-refresh cuando se carga el script
//document.addEventListener('DOMContentLoaded', function() {
    //Dashboard.startAutoRefresh();});

// Función para generar el saludo contextual
function getGreetingMessage() {
    const hour = new Date().getHours();
    let greeting;
    if (hour < 12) {
        greeting = "Buenos días";
    } else if (hour < 18) {
        greeting = "Buenas tardes";
    } else {
        greeting = "Buenas noches";
    }
    return `${greeting}, ${currentUser.nombre}!`;
}
window.Dashboard = Dashboard;


