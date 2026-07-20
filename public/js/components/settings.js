// Settings Component
const Settings = {
    config: {},
    backups: [],
    printerConfigs: null,
    printerStatuses: null,
    printerTemplates: [],
    currentView: 'general', // 'general', 'printers', 'history', 'backup', 'reports'

    // Cargar datos de configuración
    async load() {
        try {
            // Solo administradores pueden acceder a configuración
            if (currentUser.tipo !== 'administrador') {
                this.renderNoAccess();
                return;
            }

            const configResponse = await Utils.request('/settings');
            this.config = configResponse.data;
            this.render();
            if (this.currentView === 'printers') await this.loadPrinterSettings();
        } catch (error) {
            console.error('Error cargando configuración:', error);
            Utils.showNotification('Error cargando configuración', 'error');
        }
    },

    // Renderizar mensaje de no acceso
    renderNoAccess() {
        const section = document.getElementById('settings-section');
        section.innerHTML = `
            <div class="section-header">
                <h2>Configuración del Sistema</h2>
                <p>Configuración general y administración</p>
            </div>
            <div class="text-center mt-4">
                <i class="fas fa-lock" style="font-size: 3rem; color: var(--warning-color);"></i>
                <h3>Acceso Restringido</h3>
                <p>Solo los administradores pueden acceder a la configuración del sistema.</p>
            </div>
        `;
    },

    // Renderizar sección de configuración
render() {
    const section = document.getElementById('settings-section');
    
    section.innerHTML = `
        <div class="section-header">
            <h2>Configuración del Sistema</h2>
            <p>Configuración general y administración</p>
        </div>

        <div class="mb-3">
            <!-- Línea 1: vistas principales + actualizar -->
            <div class="d-flex gap-2 flex-wrap mb-2 internal-tabs" aria-label="Vistas de configuración">
                <button class="btn ${this.currentView === 'general' ? 'btn-primary active' : 'btn-light'}" data-subnav-item="general" onclick="Navigation.selectInternal('settings', 'general')">
                    <i class="fas fa-cog"></i> General
                </button>
                <button class="btn ${this.currentView === 'printers' ? 'btn-primary active' : 'btn-light'}" data-subnav-item="printers" onclick="Navigation.selectInternal('settings', 'printers')">
                    <i class="fas fa-print"></i> Impresoras
                </button>
                <button class="btn ${this.currentView === 'history' ? 'btn-primary active' : 'btn-light'}" data-subnav-item="history" onclick="Navigation.selectInternal('settings', 'history')">
                    <i class="fas fa-clock-rotate-left"></i> Historial
                </button>
                <button class="btn btn-sm btn-secondary" onclick="Settings.load()" title="Actualizar configuración">
                    <i class="fas fa-sync text-white"></i>
                </button>
            </div>

            <!-- Línea 2: respaldos y reportes -->
            <div class="d-flex gap-2 flex-wrap mb-2 internal-tabs" aria-label="Vistas de configuración">
                <button class="btn ${this.currentView === 'backup' ? 'btn-primary active' : 'btn-light'}" data-subnav-item="backup" onclick="Navigation.selectInternal('settings', 'backup')">
                    <i class="fas fa-database"></i> Respaldos
                </button>
                <button class="btn ${this.currentView === 'reports' ? 'btn-primary active' : 'btn-light'}" data-subnav-item="reports" onclick="Navigation.selectInternal('settings', 'reports')">
                    <i class="fas fa-chart-line"></i> Reportes
                </button>
            </div>
        </div>
    `;

    section.innerHTML += `
        <div class="internal-view-panel" data-internal-panel="settings">
            ${this.renderCurrentView()}
        </div>
    `;
}
,

    // Cambiar vista
    switchView(view) {
        this.currentView = view;
        this.render();
        Navigation.syncInternalSubnav('settings');
        
        // Cargar datos específicos de la vista
        if (view === 'backup') {
            this.loadBackups();
        } else if (view === 'history') {
            this.loadHistory();
        } else if (view === 'printers') {
            this.loadPrinterSettings();
        }
    },

    // Renderizar vista actual
    renderCurrentView() {
        switch (this.currentView) {
            case 'general':
                return this.renderGeneralSettings();
            case 'printers':
                return this.renderPrintersView();
            case 'history':
                return this.renderHistoryView();
            case 'backup':
                return this.renderBackupView();
            case 'reports':
                return this.renderReportsView();
            default:
                return this.renderGeneralSettings();
        }
    },

    // Renderizar configuración general
    renderGeneralSettings() {
        return `
            <div class="settings-general">
                <form id="general-settings-form">
                    <div class="row">
                        <div class="col-md-6">
                            <h3>Información del Restaurante</h3>
                            <div class="form-group">
                                <label for="nombre-restaurante">Nombre del Restaurante</label>
                                <input type="text" id="nombre-restaurante" name="nombre_restaurante" value="${this.config.nombre_restaurante || ''}" required>
                            </div>
                            <div class="form-group">
                                <label for="direccion">Dirección</label>
                                <input type="text" id="direccion" name="direccion" value="${this.config.direccion || ''}">
                            </div>
                            <div class="form-group">
                                <label for="telefono">Teléfono</label>
                                <input type="text" id="telefono" name="telefono" value="${this.config.telefono || ''}">
                            </div>
                            <div class="form-group">
                                <label for="moneda">Símbolo de Moneda</label>
                                <input type="text" id="moneda" name="moneda" value="${this.config.moneda || '$'}" maxlength="3">
                            </div>
                        </div>
                        
                        <div class="col-md-6">
                            <h3>Logo del Restaurante</h3>
                            <div class="form-group">
                                <label for="logo-upload">Subir Logo</label>
                                <input type="file" id="logo-upload" accept="image/*" onchange="Settings.uploadLogo(this)">
                                <small class="text-muted">Formatos: JPG, PNG, GIF (máx. 5MB)</small>
                            </div>
                            ${this.config.logo_path ? `
                                <div class="current-logo">
                                    <p>Logo actual:</p>
                                    <img src="${this.config.logo_path}" alt="Logo" style="max-width: 200px; max-height: 100px;">
                                </div>
                            ` : ''}
                            
                            <h3 class="mt-4">Configuración del Sistema</h3>
                            <div class="alert alert-info">
                                <i class="fas fa-print"></i>
                                Las impresoras de Caja, Cocina y Bar se administran en la pestaña <strong>Impresoras</strong>.
                            </div>
                            <div class="form-group">
                                <label for="tamano-letra">Tamaño de Letra</label>
                                <select id="tamano-letra" name="tamano_letra">
                                    <option value="pequeno" ${this.config.tamano_letra === 'pequeno' ? 'selected' : ''}>Pequeño</option>
                                    <option value="mediano" ${this.config.tamano_letra === 'mediano' ? 'selected' : ''}>Mediano</option>
                                    <option value="grande" ${this.config.tamano_letra === 'grande' ? 'selected' : ''}>Grande</option>
                                </select>
                            </div>
                        </div>
                    </div>
                    
                    <div class="form-actions mt-4">
                        <button type="button" class="btn btn-primary" onclick="Settings.saveGeneralSettings()">
                            <i class="fas fa-save"></i> Guardar Configuración
                        </button>
                    </div>
                </form>
            </div>
        `;
    },

    escapeHtml(value = '') {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    },

    renderPrinterTemplateOptions(selected = null) {
        const options = ['<option value="">Predeterminada del documento</option>'];
        for (const template of this.printerTemplates || []) {
            const code = this.escapeHtml(template.codigo);
            const label = this.escapeHtml(`${template.nombre} · ${template.tipo_documento}`);
            options.push(`<option value="${code}" ${selected === template.codigo ? 'selected' : ''}>${label}</option>`);
        }
        return options.join('');
    },

    renderPrinterCard(destination, label, icon) {
        const config = this.printerConfigs?.[destination];
        const status = this.printerStatuses?.[destination] || config;
        if (!config) return '<div class="printer-config-card"><p>Cargando configuración...</p></div>';
        const state = status?.estado_dispositivo || 'desconocido';
        const stateLabel = {
            disponible: 'Disponible',
            error: 'Error',
            inactiva: 'Inactiva',
            adaptador_no_disponible: 'Adaptador no disponible',
            desconocido: 'Sin verificar'
        }[state] || state;
        return `
            <article class="printer-config-card" data-printer-destination="${destination}">
                <header class="printer-config-card__header">
                    <div>
                        <h4><i class="fas ${icon}"></i> ${label}</h4>
                        <small>Destino operativo: ${destination}</small>
                    </div>
                    <span class="printer-status printer-status--${this.escapeHtml(state)}">${this.escapeHtml(stateLabel)}</span>
                </header>
                <div class="printer-config-grid">
                    <div class="form-group">
                        <label for="printer-name-${destination}">Impresora / dispositivo</label>
                        <input id="printer-name-${destination}" type="text" value="${this.escapeHtml(config.nombre || '')}" maxlength="180">
                    </div>
                    <div class="form-group">
                        <label for="printer-adapter-${destination}">Adaptador</label>
                        <select id="printer-adapter-${destination}">
                            <option value="navegador_pdf" ${config.adaptador === 'navegador_pdf' ? 'selected' : ''}>Navegador / PDF</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="printer-paper-${destination}">Tamaño de papel</label>
                        <select id="printer-paper-${destination}">
                            ${['58mm', '80mm', 'a4', 'carta'].map(size => `<option value="${size}" ${config.tamano_papel === size ? 'selected' : ''}>${size.toUpperCase()}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="printer-copies-${destination}">Copias físicas</label>
                        <input id="printer-copies-${destination}" type="number" min="1" max="10" value="${Number(config.copias || 1)}">
                    </div>
                    <div class="form-group printer-config-grid__wide">
                        <label for="printer-template-${destination}">Plantilla</label>
                        <select id="printer-template-${destination}">${this.renderPrinterTemplateOptions(config.plantilla_codigo)}</select>
                    </div>
                    <label class="printer-toggle">
                        <input id="printer-auto-${destination}" type="checkbox" ${config.autoimpresion ? 'checked' : ''}>
                        <span>Autoimpresión</span>
                    </label>
                    <label class="printer-toggle">
                        <input id="printer-active-${destination}" type="checkbox" ${config.activa ? 'checked' : ''}>
                        <span>Destino activo</span>
                    </label>
                </div>
                <div class="printer-config-card__meta">
                    <span>Última prueba: ${config.ultimo_test_en ? this.escapeHtml(Utils.formatDate(config.ultimo_test_en)) : 'Sin ejecutar'}</span>
                    ${config.ultimo_error ? `<span class="text-danger">${this.escapeHtml(config.ultimo_error)}</span>` : ''}
                </div>
                <footer class="printer-config-card__actions">
                    <button class="btn btn-primary" type="button" onclick="Settings.savePrinter('${destination}')">
                        <i class="fas fa-save"></i> Guardar
                    </button>
                    <button class="btn btn-secondary" type="button" onclick="Settings.testPrinter('${destination}')">
                        <i class="fas fa-print"></i> Prueba de impresión
                    </button>
                </footer>
            </article>
        `;
    },

    renderPrintersView() {
        if (!this.printerConfigs) {
            return '<div class="settings-printers"><p class="text-center">Cargando impresoras...</p></div>';
        }
        return `
            <div class="settings-printers">
                <div class="printer-settings-intro">
                    <div>
                        <h3>Impresoras</h3>
                        <p>Settings guarda la configuración por destino. Printing toma un snapshot al crear cada trabajo y ejecuta el adaptador configurado.</p>
                    </div>
                    <button class="btn btn-sm btn-secondary" type="button" onclick="Settings.loadPrinterSettings()"><i class="fas fa-sync"></i> Actualizar estados</button>
                </div>
                <div class="alert alert-info">
                    <i class="fas fa-circle-info"></i>
                    Cambiar una impresora no modifica trabajos ya encolados. Los trabajos existentes conservan la configuración con la que fueron creados.
                </div>
                <div class="printer-config-list">
                    ${this.renderPrinterCard('caja', 'Caja', 'fa-cash-register')}
                    ${this.renderPrinterCard('cocina', 'Cocina', 'fa-fire-burner')}
                    ${this.renderPrinterCard('bar', 'Bar', 'fa-martini-glass-citrus')}
                </div>
            </div>
        `;
    },

    async loadPrinterSettings() {
        try {
            const [configResponse, statusResponse, templatesResponse] = await Promise.all([
                Utils.request('/settings/printers'),
                Utils.request('/printing/printers/status'),
                Utils.request('/printing/templates')
            ]);
            this.printerConfigs = configResponse.data || {};
            this.printerStatuses = statusResponse.data || {};
            this.printerTemplates = templatesResponse.data || [];
            if (this.currentView === 'printers') {
                this.render();
                Navigation.syncInternalSubnav('settings');
            }
        } catch (error) {
            console.error('Error cargando impresoras:', error);
            Utils.showNotification(error.message || 'Error cargando impresoras', 'error');
        }
    },

    readPrinterForm(destination) {
        return {
            nombre: document.getElementById(`printer-name-${destination}`)?.value || '',
            adaptador: document.getElementById(`printer-adapter-${destination}`)?.value || 'navegador_pdf',
            tamano_papel: document.getElementById(`printer-paper-${destination}`)?.value || '80mm',
            copias: Number(document.getElementById(`printer-copies-${destination}`)?.value || 1),
            plantilla_codigo: document.getElementById(`printer-template-${destination}`)?.value || null,
            autoimpresion: Boolean(document.getElementById(`printer-auto-${destination}`)?.checked),
            activa: Boolean(document.getElementById(`printer-active-${destination}`)?.checked)
        };
    },

    async savePrinter(destination) {
        try {
            const response = await Utils.request(`/settings/printers/${destination}`, {
                method: 'PUT',
                body: JSON.stringify(this.readPrinterForm(destination))
            });
            this.printerConfigs[destination] = response.data;
            Utils.showNotification(`Impresora de ${destination} guardada`, 'success');
            await this.loadPrinterSettings();
        } catch (error) {
            Utils.showNotification(error.message || 'No fue posible guardar la impresora', 'error');
        }
    },

    async testPrinter(destination) {
        const popup = window.open('', '_blank', 'width=760,height=900');
        try {
            const response = await Utils.request(`/printing/printers/${destination}/test`, {
                method: 'POST',
                body: JSON.stringify({})
            });
            if (typeof PrintingClient !== 'undefined') {
                PrintingClient.openJob({
                    id: 0,
                    estado: 'completado',
                    resultado: response.data?.salida || null
                }, popup, { autoPrint: true });
            } else if (popup) {
                popup.close();
            }
            Utils.showNotification(`Prueba de impresión de ${destination} ejecutada`, 'success');
            await this.loadPrinterSettings();
        } catch (error) {
            if (popup) popup.close();
            Utils.showNotification(error.message || 'La prueba de impresión falló', 'error');
            await this.loadPrinterSettings();
        }
    },

    // Renderizar vista de historial
    renderHistoryView() {
        return `
            <div class="settings-history">
                <div class="d-flex justify-content-between align-items-center mb-3">
                    <h3>Historial de Transacciones</h3>
                    <div class="d-flex gap-2">
                        <button class="btn btn-warning" onclick="Settings.showCleanupModal()">
                            <i class="fas fa-broom"></i> Limpiar Historial
                        </button>
                    </div>
                </div>
                
                <div class="history-filters mb-3">
                    <div class="row">
                        <div class="col-md-3">
                            <select id="history-filter-action" onchange="Settings.loadHistory()">
                                <option value="">Todas las acciones</option>
                                <option value="login">Inicios de sesión</option>
                                <option value="logout">Cierres de sesión</option>
                                <option value="crear_pedido">Crear pedidos</option>
                                <option value="procesar_pago">Procesar pagos</option>
                                <option value="crear_usuario">Crear usuarios</option>
                                <option value="actualizar_configuracion">Configuración</option>
                            </select>
                        </div>
                        <div class="col-md-3">
                            <select id="history-filter-user" onchange="Settings.loadHistory()">
                                <option value="">Todos los usuarios</option>
                            </select>
                        </div>
                        <div class="col-md-3">
                            <input type="number" id="history-limit" value="50" min="10" max="500" onchange="Settings.loadHistory()" placeholder="Límite">
                        </div>
                        <div class="col-md-3">
                            <button class="btn btn-secondary" onclick="Settings.loadHistory()">
                                <i class="fas fa-search"></i> Filtrar
                            </button>
                        </div>
                    </div>
                </div>
                
                <div id="history-table-container">
                    <p class="text-center">Cargando historial...</p>
                </div>
            </div>
        `;
    },

    // Renderizar vista de respaldos
    renderBackupView() {
        return `
            <div class="settings-backup">
                <div class="d-flex justify-content-between align-items-center mb-3">
                    <h3>Gestión de Respaldos</h3>
                    <div class="d-flex gap-2">
                        <button class="btn btn-success" onclick="Settings.createBackup()">
                            <i class="fas fa-plus"></i> Crear Respaldo
                        </button>
                        <button class="btn btn-danger" onclick="Settings.showResetDatabaseModal()">
                            <i class="fas fa-database"></i> Restablecer BD
                        </button>
                    </div>
                </div>
                
                <div class="backup-info mb-3">
                    <div class="alert alert-info">
                        <i class="fas fa-info-circle"></i>
                        Los respaldos incluyen toda la información de la base de datos: usuarios, mesas, productos, pedidos, etc.
                        Se recomienda crear respaldos regularmente.
                    </div>
                </div>
                
                <div id="backups-table-container">
                    <p class="text-center">Cargando respaldos...</p>
                </div>
            </div>
        `;
    },

    // Renderizar vista de reportes
    renderReportsView() {
        return `
            <div class="settings-reports">
                <h3>Reportes y Estadísticas</h3>
                
                <div class="reports-grid">
                    <div class="report-card">
                        <h4>Reporte de Ventas</h4>
                        <p>Generar reporte de ventas por período</p>
                        <form id="sales-report-form">
                            <div class="form-group">
                                <label for="sales-start-date">Fecha Inicio</label>
                                <input type="date" id="sales-start-date" name="start_date">
                            </div>
                            <div class="form-group">
                                <label for="sales-end-date">Fecha Fin</label>
                                <input type="date" id="sales-end-date" name="end_date">
                            </div>
                            <div class="form-group">
                                <label for="sales-group-by">Agrupar por</label>
                                <select id="sales-group-by" name="group_by">
                                    <option value="day">Día</option>
                                    <option value="week">Semana</option>
                                    <option value="month">Mes</option>
                                </select>
                            </div>
                            <button type="button" class="btn btn-primary" onclick="Settings.generateSalesReport()">
                                <i class="fas fa-chart-line"></i> Generar Reporte
                            </button>
                        </form>
                    </div>
                    
                    <div class="report-card">
                        <h4>Productos Más Vendidos</h4>
                        <p>Top de productos más vendidos</p>
                        <form id="products-report-form">
                            <div class="form-group">
                                <label for="products-start-date">Fecha Inicio</label>
                                <input type="date" id="products-start-date" name="start_date">
                            </div>
                            <div class="form-group">
                                <label for="products-end-date">Fecha Fin</label>
                                <input type="date" id="products-end-date" name="end_date">
                            </div>
                            <div class="form-group">
                                <label for="products-limit">Límite</label>
                                <input type="number" id="products-limit" name="limit" value="10" min="5" max="50">
                            </div>
                            <button type="button" class="btn btn-primary" onclick="Settings.generateProductsReport()">
                                <i class="fas fa-trophy"></i> Generar Reporte
                            </button>
                        </form>
                    </div>
                </div>
                
                <div id="reports-results" class="mt-4">
                    <!-- Los resultados de reportes se mostrarán aquí -->
                </div>
            </div>
        `;
    },

    // Guardar configuración general
    async saveGeneralSettings() {
        const form = document.getElementById('general-settings-form');
        if (!Utils.validateForm(form)) {
            Utils.showNotification('Por favor complete todos los campos requeridos', 'warning');
            return;
        }

        const formData = new FormData(form);
        const data = {};
        
        for (let [key, value] of formData.entries()) {
            data[key] = value;
        }

        try {
            await Utils.request('/settings', {
                method: 'PUT',
                body: JSON.stringify(data)
            });

            Utils.showNotification('Configuración guardada exitosamente', 'success');
            this.load();
        } catch (error) {
            Utils.showNotification(error.message, 'error');
        }
    },

    // Subir logo
    async uploadLogo(input) {
        const file = input.files[0];
        if (!file) return;

        if (file.size > 5 * 1024 * 1024) {
            Utils.showNotification('El archivo es demasiado grande (máx. 5MB)', 'warning');
            return;
        }

        const formData = new FormData();
        formData.append('logo', file);

        try {
            const response = await fetch('/api/settings/upload-logo', {
                method: 'POST',
                credentials: 'include',
                body: formData
            });

            const data = await response.json();

            if (response.ok) {
                Utils.showNotification('Logo subido exitosamente', 'success');
                this.load();
            } else {
                throw new Error(data.error || 'Error subiendo logo');
            }
        } catch (error) {
            Utils.showNotification(error.message, 'error');
        }
    },

    // Cargar historial
    async loadHistory() {
        const tipoAccion = document.getElementById('history-filter-action')?.value || '';
        const usuarioId = document.getElementById('history-filter-user')?.value || '';
        const limit = document.getElementById('history-limit')?.value || 50;

        try {
            let url = `/settings/history/transactions?limit=${limit}`;
            if (tipoAccion) url += `&tipo_accion=${tipoAccion}`;
            if (usuarioId) url += `&usuario_id=${usuarioId}`;

            const response = await Utils.request(url);
            this.renderHistoryTable(response.data);
        } catch (error) {
            console.error('Error cargando historial:', error);
            document.getElementById('history-table-container').innerHTML = 
                '<p class="text-center text-danger">Error cargando historial</p>';
        }
    },

    // Renderizar tabla de historial
    renderHistoryTable(data) {
        const container = document.getElementById('history-table-container');
        
        if (!data.historial || data.historial.length === 0) {
            container.innerHTML = '<p class="text-center">No hay registros en el historial</p>';
            return;
        }

        container.innerHTML = `
            <div class="table-container">
                <table class="table">
                    <thead>
                        <tr>
                            <th>Fecha</th>
                            <th>Acción</th>
                            <th>Usuario</th>
                            <th>Descripción</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.historial.map(item => `
                            <tr>
                                <td>${Utils.formatDate(item.fecha)}</td>
                                <td><span class="badge badge-info">${item.tipo_accion}</span></td>
                                <td>${item.usuario_nombre || 'Sistema'}</td>
                                <td>${item.descripcion}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                <div class="pagination-info">
                    Mostrando ${data.historial.length} de ${data.total} registros
                </div>
            </div>
        `;
    },

    // Mostrar modal de limpieza de historial
    showCleanupModal() {
        Utils.showModal('Limpiar Historial', `
            <form id="cleanup-form">
                <div class="form-group">
                    <label for="cleanup-days">Eliminar registros anteriores a (días)</label>
                    <input type="number" id="cleanup-days" name="days" value="30" min="1" max="365" required>
                    <small class="text-muted">Se eliminarán todos los registros más antiguos que el número de días especificado</small>
                </div>
                <div class="alert alert-warning">
                    <i class="fas fa-exclamation-triangle"></i>
                    Esta acción no se puede deshacer. Los registros eliminados no se podrán recuperar.
                </div>
            </form>
        `, [
            {
                text: 'Cancelar',
                class: 'btn-light'
            },
            {
                text: 'Limpiar Historial',
                class: 'btn-warning',
                onclick: 'Settings.cleanupHistory()'
            }
        ]);
    },

    // Limpiar historial
    async cleanupHistory() {
        const form = document.getElementById('cleanup-form');
        if (!Utils.validateForm(form)) {
            Utils.showNotification('Por favor especifique el número de días', 'warning');
            return;
        }

        const formData = new FormData(form);
        const days = parseInt(formData.get('days'));

        const confirmed = await Utils.confirm(
            `¿Está seguro de eliminar todos los registros anteriores a ${days} días?`,
            'Confirmar Limpieza'
        );

        if (!confirmed) return;

        try {
            const response = await Utils.request('/settings/history/cleanup', {
                method: 'DELETE',
                body: JSON.stringify({ days })
            });

            Utils.hideModal();
            Utils.showNotification(`Historial limpiado. ${response.data.registros_eliminados} registros eliminados`, 'success');
            this.loadHistory();
        } catch (error) {
            Utils.showNotification(error.message, 'error');
        }
    },

    // Cargar respaldos
    async loadBackups() {
        try {
            const response = await Utils.request('/settings/backup/list');
            this.backups = response.data;
            this.renderBackupsTable();
        } catch (error) {
            console.error('Error cargando respaldos:', error);
            document.getElementById('backups-table-container').innerHTML = 
                '<p class="text-center text-danger">Error cargando respaldos</p>';
        }
    },

    // Renderizar tabla de respaldos
    renderBackupsTable() {
        const container = document.getElementById('backups-table-container');
        
        if (this.backups.length === 0) {
            container.innerHTML = '<p class="text-center">No hay respaldos creados</p>';
            return;
        }

        container.innerHTML = `
            <div class="table-container">
                <table class="table">
                    <thead>
                        <tr>
                            <th>Nombre</th>
                            <th>Fecha Creación</th>
                            <th>Tamaño</th>
                            <th>Estado</th>
                            <th>Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${this.backups.map(backup => `
                            <tr>
                                <td><strong>${backup.nombre_archivo}</strong></td>
                                <td>${Utils.formatDate(backup.fecha_creacion)}</td>
                                <td>${this.formatFileSize(backup.size)}</td>
                                <td>
                                    <span class="badge badge-${backup.exists ? 'success' : 'danger'}">
                                        ${backup.exists ? 'Disponible' : 'No encontrado'}
                                    </span>
                                </td>
                                <td>
                                    <button class="btn btn-danger btn-sm" onclick="Settings.deleteBackup(${backup.id})">
                                        <i class="fas fa-trash"></i> Eliminar
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    },

    // Formatear tamaño de archivo
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },

    // Crear respaldo
    async createBackup() {
        const confirmed = await Utils.confirm(
            '¿Desea crear un respaldo de la base de datos?',
            'Crear Respaldo'
        );

        if (!confirmed) return;

        try {
            const response = await Utils.request('/settings/backup/create', {
                method: 'POST'
            });

            Utils.showNotification(`Respaldo creado exitosamente: ${response.data.backup_name}`, 'success');
            this.loadBackups();
        } catch (error) {
            Utils.showNotification(error.message, 'error');
        }
    },

    // Eliminar respaldo
    async deleteBackup(backupId) {
        const backup = this.backups.find(b => b.id === backupId);
        if (!backup) return;

        const confirmed = await Utils.confirm(
            `¿Está seguro de eliminar el respaldo "${backup.nombre_archivo}"?`,
            'Confirmar Eliminación'
        );

        if (!confirmed) return;

        try {
            await Utils.request(`/settings/backup/${backupId}`, {
                method: 'DELETE'
            });

            Utils.showNotification('Respaldo eliminado exitosamente', 'success');
            this.loadBackups();
        } catch (error) {
            Utils.showNotification(error.message, 'error');
        }
    },

    // Generar reporte de ventas
    async generateSalesReport() {
        const form = document.getElementById('sales-report-form');
        const formData = new FormData(form);
        
        const params = new URLSearchParams();
        if (formData.get('start_date')) params.append('start_date', formData.get('start_date'));
        if (formData.get('end_date')) params.append('end_date', formData.get('end_date'));
        params.append('group_by', formData.get('group_by'));

        try {
            const response = await Utils.request(`/settings/reports/sales?${params}`);
            this.renderSalesReport(response.data);
        } catch (error) {
            Utils.showNotification('Error generando reporte de ventas', 'error');
        }
    },

    // Renderizar reporte de ventas
    renderSalesReport(data) {
        const container = document.getElementById('reports-results');
        
        if (data.length === 0) {
            container.innerHTML = '<p class="text-center">No hay datos para el período seleccionado</p>';
            return;
        }

        const totalVentas = data.reduce((sum, item) => sum + item.total_ventas, 0);
        const totalPedidos = data.reduce((sum, item) => sum + item.num_pedidos, 0);

        container.innerHTML = `
            <div class="report-results">
                <h4>Reporte de Ventas</h4>
                <div class="report-summary mb-3">
                    <div class="d-flex gap-3">
                        <span class="badge badge-success">Total Ventas: ${Utils.formatCurrency(totalVentas)}</span>
                        <span class="badge badge-info">Total Pedidos: ${totalPedidos}</span>
                        <span class="badge badge-warning">Promedio: ${Utils.formatCurrency(totalVentas / totalPedidos || 0)}</span>
                    </div>
                </div>
                <div class="table-container">
                    <table class="table">
                        <thead>
                            <tr>
                                <th>Período</th>
                                <th>Pedidos</th>
                                <th>Ventas</th>
                                <th>Promedio</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.map(item => `
                                <tr>
                                    <td>${item.periodo}</td>
                                    <td>${item.num_pedidos}</td>
                                    <td>${Utils.formatCurrency(item.total_ventas)}</td>
                                    <td>${Utils.formatCurrency(item.promedio_pedido || 0)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    },

    // Generar reporte de productos
    async generateProductsReport() {
        const form = document.getElementById('products-report-form');
        const formData = new FormData(form);
        
        const params = new URLSearchParams();
        if (formData.get('start_date')) params.append('start_date', formData.get('start_date'));
        if (formData.get('end_date')) params.append('end_date', formData.get('end_date'));
        params.append('limit', formData.get('limit'));

        try {
            const response = await Utils.request(`/settings/reports/top-products?${params}`);
            this.renderProductsReport(response.data);
        } catch (error) {
            Utils.showNotification('Error generando reporte de productos', 'error');
        }
    },

    // Renderizar reporte de productos
    renderProductsReport(data) {
        const container = document.getElementById('reports-results');
        
        if (data.length === 0) {
            container.innerHTML = '<p class="text-center">No hay datos para el período seleccionado</p>';
            return;
        }

        container.innerHTML = `
            <div class="report-results">
                <h4>Productos Más Vendidos</h4>
                <div class="table-container">
                    <table class="table">
                        <thead>
                            <tr>
                                <th>Posición</th>
                                <th>Producto</th>
                                <th>Precio</th>
                                <th>Cantidad Vendida</th>
                                <th>Ingresos</th>
                                <th>Pedidos</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.map((item, index) => `
                                <tr>
                                    <td><strong>#${index + 1}</strong></td>
                                    <td>${item.nombre}</td>
                                    <td>${Utils.formatCurrency(item.precio)}</td>
                                    <td>${item.total_vendido}</td>
                                    <td>${Utils.formatCurrency(item.ingresos_totales)}</td>
                                    <td>${item.num_pedidos}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    },

    // Mostrar modal de restablecimiento de base de datos
    showResetDatabaseModal() {
        Utils.showModal('Restablecer Base de Datos', `
            <div class="alert alert-danger">
                <i class="fas fa-exclamation-triangle"></i>
                <strong>¡ADVERTENCIA!</strong> Esta acción eliminará todos los datos agregados por usuarios.
            </div>
            <p>Se eliminarán los siguientes datos:</p>
            <ul>
                <li>Pedidos y productos de pedidos</li>
                <li>Pagos realizados</li>
                <li>Cuentas de crédito</li>
                <li>Historial de transacciones</li>
                <li>Comandas</li>
                <li>Pagos de créditos</li>
            </ul>
            <p><strong>Se mantendrán:</strong></p>
            <ul>
                <li>Usuarios del sistema</li>
                <li>Mesas configuradas</li>
                <li>Categorías y productos del menú</li>
                <li>Configuración del sistema</li>
                <li>Respaldos existentes</li>
            </ul>
            <div class="form-group mt-3">
                <label for="reset-confirmation">Para confirmar, escriba "RESTABLECER" en mayúsculas:</label>
                <input type="text" id="reset-confirmation" class="form-control" placeholder="RESTABLECER">
            </div>
        `, [
            {
                text: 'Cancelar',
                class: 'btn-light'
            },
            {
                text: 'Restablecer Base de Datos',
                class: 'btn-danger',
                onclick: 'Settings.resetDatabase()'
            }
        ]);
    },

    // Restablecer base de datos
    async resetDatabase() {
        const confirmation = document.getElementById('reset-confirmation').value;
        
        if (confirmation !== 'RESTABLECER') {
            Utils.showNotification('Debe escribir "RESTABLECER" para confirmar la acción', 'warning');
            return;
        }

        const doubleConfirm = await Utils.confirm(
            '¿Está completamente seguro de que desea restablecer la base de datos? Esta acción NO se puede deshacer.',
            'Confirmación Final'
        );

        if (!doubleConfirm) return;

        try {
            const response = await Utils.request('/settings/reset-database', {
                method: 'POST'
            });

            Utils.hideModal();
            Utils.showNotification(`Base de datos restablecida exitosamente. ${response.data.message}`, 'success');
            
            // Recargar la página después de un breve delay para mostrar el mensaje
            setTimeout(() => {
                window.location.reload();
            }, 2000);
        } catch (error) {
            Utils.showNotification(error.message, 'error');
        }
    }
};

