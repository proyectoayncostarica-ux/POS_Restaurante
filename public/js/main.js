// Variables globales
let currentUser = null;
let currentSection = 'dashboard';
let headerClockTimer = null;
let lastDesktopDateTime = '';
let lastMobileDateTime = '';

const Access = {
    getPolicy() {
        return typeof OperationalAccess !== 'undefined'
            ? OperationalAccess.buildPolicy(currentUser)
            : { capabilities: currentUser?.capacidades || [], isAdmin: false, allowedSections: [] };
    },

    has(capability) {
        return typeof OperationalAccess !== 'undefined'
            ? OperationalAccess.has(currentUser, capability)
            : false;
    },

    canOpen(sectionName) {
        return typeof OperationalAccess !== 'undefined'
            ? OperationalAccess.canOpen(currentUser, sectionName)
            : false;
    },

    getInitialSection() {
        return typeof OperationalAccess !== 'undefined'
            ? OperationalAccess.getInitialSection(currentUser)
            : 'dashboard';
    },

    applyNavigation() {
        const policy = this.getPolicy();
        const departmentalKitchen = policy.isDepartmental && policy.departmentCode === 'cocina';
        document.body.classList.toggle('kitchen-department-mode', Boolean(departmentalKitchen));
        document.getElementById('main-app')?.classList.toggle('kitchen-exclusive-app', Boolean(departmentalKitchen));

        document.querySelectorAll('[data-section]').forEach(link => {
            const section = link.getAttribute('data-section');
            const item = link.closest('.nav-item') || link;
            item.hidden = !this.canOpen(section);
        });

        const visibleSidebarLinks = Array.from(document.querySelectorAll('#sidebar .nav-link'))
            .filter(link => !link.closest('.nav-item')?.hidden);
        const menuToggle = document.getElementById('menu-toggle');
        if (menuToggle) menuToggle.hidden = visibleSidebarLinks.length === 0;

        const cashButton = document.getElementById('cash-header-btn');
        if (cashButton) cashButton.hidden = !this.canOpen('cash');
    }
};

const DashboardFocus = {
    isActive: false,

    get button() {
        return document.getElementById('dashboard-fullscreen-btn');
    },

    isDesktop() {
        return window.matchMedia('(min-width: 769px)').matches;
    },

    toggle() {
        if (this.isActive) {
            this.deactivate();
            return;
        }
        this.activate();
    },

    async activate() {
        if (!this.isDesktop()) {
            Utils.showNotification('El modo pantalla completa del Dashboard está disponible en PC.', 'info');
            return;
        }

        if (currentSection !== 'dashboard' && typeof Navigation !== 'undefined') {
            await Navigation.showSection('dashboard');
        }

        const app = document.getElementById('main-app');
        if (!app) return;

        this.isActive = true;
        document.body.classList.add('dashboard-focus-active');
        app.classList.add('dashboard-focus-mode');
        this.updateButton();
    },

    deactivate(showNotice = false) {
        const app = document.getElementById('main-app');
        this.isActive = false;
        document.body.classList.remove('dashboard-focus-active');
        if (app) app.classList.remove('dashboard-focus-mode');
        this.updateButton();

        if (showNotice) {
            Utils.showNotification('Modo pantalla completa desactivado.', 'info');
        }
    },

    updateButton() {
        const btn = this.button;
        if (!btn) return;

        const shouldShow = this.isDesktop() && currentSection === 'dashboard';
        btn.hidden = !shouldShow;
        btn.classList.toggle('active', this.isActive && shouldShow);
        btn.setAttribute('aria-pressed', this.isActive && shouldShow ? 'true' : 'false');
        btn.setAttribute('aria-label', this.isActive
            ? 'Salir de pantalla completa operativa del Dashboard'
            : 'Activar pantalla completa operativa del Dashboard');
        btn.title = this.isActive ? 'Salir de pantalla completa' : 'Pantalla completa';

        const icon = btn.querySelector('i');
        const label = btn.querySelector('.dashboard-fullscreen-label');
        if (icon) icon.className = this.isActive ? 'fas fa-compress' : 'fas fa-expand';
        if (label) label.textContent = this.isActive ? 'Salir pantalla completa' : 'Pantalla completa';
    },

    handleSectionChange(sectionName) {
        if (sectionName !== 'dashboard' && this.isActive) {
            this.deactivate();
        } else {
            this.updateButton();
        }
    },

    handleResize() {
        if (!this.isDesktop() && this.isActive) {
            this.deactivate();
        }
        this.updateButton();
    }
};
let navigationTransitionId = 0;
const APP_NAME = 'MundiPOS';
const INTERNAL_SUBNAV = {
    dashboard: [
        { id: 'todos', label: 'Todos', icon: 'fa-border-all' },
        { id: 'salon', label: 'Salón', icon: 'fa-chair' },
        { id: 'bar-mesa', label: 'Bar', icon: 'fa-martini-glass-citrus' },
        { id: 'bar-banco', label: 'Barra', icon: 'fa-grip-lines' }
    ],
    tables: [
        { id: 'todos', label: 'Todos', icon: 'fa-border-all' },
        { id: 'salon', label: 'Salón', icon: 'fa-chair' },
        { id: 'bar-mesa', label: 'Bar', icon: 'fa-martini-glass-citrus' },
        { id: 'bar-banco', label: 'Barra', icon: 'fa-grip-lines' }
    ],
    menu: [
        { id: 'products', label: 'Productos', icon: 'fa-utensils' },
        { id: 'categories', label: 'Categorías', icon: 'fa-tags' },
        { id: 'presentations', label: 'Presentaciones', icon: 'fa-box-open' }
    ],
    orders: [
        { id: 'pending', label: 'Pendientes', icon: 'fa-clock' },
        { id: 'paid', label: 'Pagados', icon: 'fa-check-circle' },
        { id: 'all', label: 'Todos', icon: 'fa-list' }
    ],
    settings: [
        { id: 'general', label: 'General', icon: 'fa-gear' },
        { id: 'printers', label: 'Impresoras', icon: 'fa-print' },
        { id: 'history', label: 'Historial', icon: 'fa-clock-rotate-left' },
        { id: 'backup', label: 'Respaldos', icon: 'fa-database' },
        { id: 'reports', label: 'Reportes', icon: 'fa-chart-line' }
    ]
};

// API Base URL
const API_BASE = '/api';
const MUNDIPOS_CLIENT_ID = getOrCreateClientId();

// Utilidades
const Utils = {
    // Realizar peticiones HTTP
    async request(url, options = {}) {
        try {
            const fetchOptions = {
                credentials: 'include',
                ...options
            };

            const headers = { ...(options.headers || {}) };
            const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;

            if (!isFormData && !headers['Content-Type']) {
                headers['Content-Type'] = 'application/json';
            }

            headers['X-MundiPOS-Client'] = MUNDIPOS_CLIENT_ID;
            fetchOptions.headers = headers;

            const response = await fetch(API_BASE + url, fetchOptions);
            const contentType = response.headers.get('content-type') || '';
            const data = contentType.includes('application/json')
                ? await response.json()
                : { success: response.ok, message: await response.text() };

            if (!response.ok) {
                throw new Error(data.error || data.message || 'Error en la petición');
            }

            return data;
        } catch (error) {
            console.error('Error en petición:', error);
            throw error;
        }
    },

    // Mostrar notificaciones
    showNotification(message, type = 'info') {
        const container = document.getElementById('notification-container');
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <div class="d-flex justify-content-between align-items-center">
                <span>${message}</span>
                <button onclick="this.parentElement.parentElement.remove()" style="background: none; border: none; font-size: 1.2rem; cursor: pointer;">&times;</button>
            </div>
        `;
        
        container.appendChild(notification);

        // Auto-remover después de 5 segundos
        setTimeout(() => {
            if (notification.parentElement) {
                notification.remove();
            }
        }, 5000);
    },

    // Mostrar modal
    showModal(title, content, actions = [], modalClass = '') {
    const overlay = document.getElementById('modal-overlay');
    const modalContent = document.getElementById('modal-content');

    modalContent.className = `modal-content ${modalClass}`;
    modalContent.innerHTML = `
        <div class="modal-header">
            <h3>${title}</h3>
            <button class="modal-close" onclick="Utils.hideModal()">&times;</button>
        </div>
        <div class="modal-body">
            ${content}
        </div>
    `;

    // Footer con botones
    if (actions.length > 0) {
        const footer = document.createElement('div');
        footer.className = 'modal-footer d-flex justify-between mt-3';

        const leftGroup = document.createElement('div');
        leftGroup.className = 'left-buttons';

        const rightGroup = document.createElement('div');
        rightGroup.className = 'right-buttons';

        actions.forEach(action => {
            const btn = document.createElement('button');
            btn.className = `btn ${action.class || 'btn-secondary'}`;
            btn.innerHTML = action.text;
            btn.type = 'button';

            if (typeof action.onclick === 'function') {
                btn.addEventListener('click', action.onclick);
            } else {
                btn.setAttribute('onclick', action.onclick || 'Utils.hideModal()');
            }

            if (action.align === 'right') {
                rightGroup.appendChild(btn);
            } else {
                leftGroup.appendChild(btn);
            }
        });

        footer.appendChild(leftGroup);
        footer.appendChild(rightGroup);
        modalContent.appendChild(footer);
    }

    overlay.style.display = 'flex';
},

    // Ocultar modal
    hideModal() {
        document.getElementById('modal-overlay').style.display = 'none';
    },

    // Confirmar acción
    async confirm(message, title = 'Confirmar', options = {}) {
        return new Promise((resolve) => {
            const opts = (typeof options === 'string')
                ? { modalClass: options }
                : (options || {});

            const body = opts.html ? message : `<p>${message}</p>`;

            Utils.showModal(title, body, [
                {
                    text: opts.cancelText || 'Cancelar',
                    class: opts.cancelClass || 'btn-light',
                    onclick: 'Utils.hideModal(); window.confirmResolve(false);'
                },
                {
                    text: opts.confirmText || 'Confirmar',
                    class: opts.confirmClass || 'btn-primary',
                    align: 'right',
                    onclick: 'Utils.hideModal(); window.confirmResolve(true);'
                }
            ], opts.modalClass || '');
            
            window.confirmResolve = resolve;
        });
    },

    // Formatear moneda
    formatCurrency(amount) {
        return `₡${this.formatNumber(amount)}`;
    },

    // Formatear número
    formatNumber(number) {
        return new Intl.NumberFormat('es-CR').format(number);
    },

    // Formatear fecha
    formatDate(dateString) {
        return new Date(dateString).toLocaleString('es-ES');
    },

    // Formatear solo hora
    formatTime(dateString) {
        return new Date(dateString).toLocaleTimeString('es-ES', {
            hour: '2-digit',
            minute: '2-digit'
        });
    },

    // Formatear fecha y hora completa
    formatDateTime(dateString) {
        return new Date(dateString).toLocaleString('es-ES', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    },

    // Validar formulario
    validateForm(formElement) {
        const inputs = formElement.querySelectorAll('input[required], select[required], textarea[required]');
        let isValid = true;

        inputs.forEach(input => {
            if (!input.value.trim()) {
                input.style.borderColor = 'var(--danger-color)';
                isValid = false;
            } else {
                input.style.borderColor = 'var(--border-color)';
            }
        });

        return isValid;
    }
};

// Autenticación
const Auth = {
    requiresBootstrapSetup: false,
    pendingRoleChangeIds: [],

    // Verificar sesión
    async checkSession() {
        try {
            const bootstrapStatus = await this.checkBootstrapStatus();
            if (bootstrapStatus.requiresSetup) {
                currentUser = null;
                this.showBootstrapSetup();
                return false;
            }

            const response = await Utils.request('/auth/verify');
            if (response.authenticated) {
                currentUser = response.user;
                await this.continueAuthenticatedSession({ animated: false });
                return true;
            }

            this.showLogin();
            return false;
        } catch (error) {
            console.error('Error verificando sesión:', error);
            this.showLogin();
            return false;
        }
    },

    async checkBootstrapStatus() {
        const response = await Utils.request('/public/bootstrap-status', {
            method: 'GET',
            cache: 'no-store'
        });

        const data = response.data || {};
        this.requiresBootstrapSetup = Boolean(data.requiresSetup);
        return data;
    },

    // Crear el primer administrador cuando la instalación todavía no tiene ninguno.
    async createBootstrapAdmin(nombre, password, confirmPassword) {
        try {
            const response = await Utils.request('/auth/bootstrap-admin', {
                method: 'POST',
                body: JSON.stringify({ nombre, password, confirmPassword })
            });

            if (response.success) {
                this.requiresBootstrapSetup = false;
                currentUser = response.user;
                await this.continueAuthenticatedSession({ animated: true });
                await loadRestaurantName();
                Utils.showNotification('Administrador inicial creado correctamente', 'success');

                if (!this.requiresOperationalRoleSelection()) {
                    Dashboard.refreshData();
                    Dashboard.startAutoRefresh();
                    Realtime.connect();
                }

                return true;
            }

            return false;
        } catch (error) {
            Utils.showNotification(error.message, 'error');
            return false;
        }
    },

    // Iniciar sesión
    async login(username, password) {
        try {
            const response = await Utils.request('/auth/login', {
                method: 'POST',
                body: JSON.stringify({ nombre: username, password })
            });

            if (response.success) {
                currentUser = response.user;
                await this.continueAuthenticatedSession({ animated: true });
                await loadRestaurantName();

                if (this.requiresOperationalRoleSelection()) {
                    Utils.showNotification('Selecciona tu rol de trabajo para iniciar la operación', 'info');
                    return true;
                }

                Utils.showNotification('Sesión iniciada correctamente', 'success');

                if (Access.canOpen('dashboard')) {
                    Dashboard.refreshData();
                    Dashboard.startAutoRefresh();
                } else {
                    Dashboard.stopAutoRefresh();
                }
                Realtime.reconnectForSession();

                return true;
            }

            return false;
        } catch (error) {
            Utils.showNotification(error.message, 'error');
            return false;
        }
    },

    // Cerrar sesión
    async logout() {
        try {
            await Utils.request('/auth/logout', { method: 'POST' });
            currentUser = null;

            Dashboard.stopAutoRefresh();
            Realtime.disconnect();
            this.showLogin();

            Utils.showNotification('Sesión cerrada correctamente', 'info');
        } catch (error) {
            console.error('Error cerrando sesión:', error);

            // Forzar logout local
            currentUser = null;
            Dashboard.stopAutoRefresh();
            Realtime.disconnect();
            this.showLogin();
        }
    },

    // Mostrar pantalla de login
    showLogin() {
        const loginScreen = document.getElementById('login-screen');
        const mainApp = document.getElementById('main-app');
        const operationalScreen = document.getElementById('operational-session-screen');

        if (operationalScreen) operationalScreen.style.display = 'none';
        stopHeaderClock();
        Realtime.disconnect();
        if (typeof Kitchen !== 'undefined') Kitchen.stopTimers();
        document.body.classList.remove('has-mobile-subnav', 'kitchen-department-mode');
        document.getElementById('main-app')?.classList.remove('kitchen-exclusive-app');
        document.getElementById('mobile-subnav')?.classList.remove('is-visible');
        resetLoginForm();
        setLoginMode('login');

        if (mainApp) {
            mainApp.classList.remove('app-entering');
            mainApp.style.display = 'none';
        }

        if (loginScreen) {
            loginScreen.classList.remove('login-card-exit', 'login-bg-exit');
            loginScreen.style.display = 'flex';
        }
    },

    showBootstrapSetup() {
        const loginScreen = document.getElementById('login-screen');
        const mainApp = document.getElementById('main-app');
        const operationalScreen = document.getElementById('operational-session-screen');

        if (operationalScreen) operationalScreen.style.display = 'none';
        stopHeaderClock();
        Realtime.disconnect();
        document.body.classList.remove('has-mobile-subnav');
        document.getElementById('mobile-subnav')?.classList.remove('is-visible');
        resetLoginForm();
        setLoginMode('bootstrap');

        if (mainApp) {
            mainApp.classList.remove('app-entering');
            mainApp.style.display = 'none';
        }

        if (loginScreen) {
            loginScreen.classList.remove('login-card-exit', 'login-bg-exit');
            loginScreen.style.display = 'flex';
        }
    },

    // Mostrar aplicación principal
    showApp() {
        const loginScreen = document.getElementById('login-screen');
        const mainApp = document.getElementById('main-app');
        const operationalScreen = document.getElementById('operational-session-screen');

        if (operationalScreen) operationalScreen.style.display = 'none';

        if (loginScreen) {
            loginScreen.style.display = 'none';
            loginScreen.classList.remove('login-card-exit', 'login-bg-exit');
        }

        if (mainApp) {
            mainApp.style.display = 'grid';
            mainApp.classList.remove('app-entering');
        }

        this.updateUserInfo();
        Access.applyNavigation();
        Navigation.showSection(Access.getInitialSection());
        loadRestaurantName();
        startHeaderClock();
        Realtime.connect();
        updateGreeting();
    },

    async transitionToApp() {
        const loginScreen = document.getElementById('login-screen');
        const mainApp = document.getElementById('main-app');
        const operationalScreen = document.getElementById('operational-session-screen');

        if (operationalScreen) operationalScreen.style.display = 'none';

        if (!loginScreen || !mainApp) {
            this.showApp();
            return;
        }

        loginScreen.classList.add('login-card-exit');
        await wait(430);
        loginScreen.classList.add('login-bg-exit');
        await wait(420);

        loginScreen.style.display = 'none';
        loginScreen.classList.remove('login-card-exit', 'login-bg-exit');

        mainApp.style.display = 'grid';
        mainApp.classList.add('app-entering');
        this.updateUserInfo();
        Access.applyNavigation();
        Navigation.showSection(Access.getInitialSection());
        startHeaderClock();
        Realtime.connect();
        updateGreeting();

        await wait(650);
        mainApp.classList.remove('app-entering');
    },

    requiresOperationalRoleSelection() {
        return Boolean(currentUser?.sesion_operativa?.requiere_seleccion);
    },

    canOperateWithCurrentSession() {
        return Boolean(currentUser?.sesion_operativa?.puede_operar);
    },

    async continueAuthenticatedSession(options = {}) {
        if (this.requiresOperationalRoleSelection() || !this.canOperateWithCurrentSession()) {
            this.showOperationalSessionSelection();
            return;
        }

        if (options.animated) {
            await this.transitionToApp();
        } else {
            this.showApp();
        }
    },

    showOperationalSessionSelection() {
        const loginScreen = document.getElementById('login-screen');
        const mainApp = document.getElementById('main-app');
        const operationalScreen = document.getElementById('operational-session-screen');
        const operationalUser = document.getElementById('operational-session-user');
        const operationalSubtitle = document.getElementById('operational-session-subtitle');
        const rolesContainer = document.getElementById('operational-role-options');
        const blockedMessage = document.getElementById('operational-session-blocked');
        const enterButton = document.getElementById('operational-session-enter-btn');

        stopHeaderClock();
        Realtime.disconnect();
        Dashboard.stopAutoRefresh();
        document.body.classList.remove('has-mobile-subnav');
        document.getElementById('mobile-subnav')?.classList.remove('is-visible');

        if (loginScreen) loginScreen.style.display = 'none';
        if (mainApp) mainApp.style.display = 'none';
        if (operationalScreen) operationalScreen.style.display = 'flex';

        const session = currentUser?.sesion_operativa || {};
        const roles = Array.isArray(session.roles_disponibles) ? session.roles_disponibles : [];
        const activeIds = new Set((session.rol_trabajo_ids || []).map(id => Number(id)));
        const initialSelected = activeIds.size ? [...activeIds] : (roles.length === 1 ? [Number(roles[0].id)] : []);

        if (operationalUser) {
            operationalUser.textContent = currentUser?.nombre || 'Usuario';
        }

        if (operationalSubtitle) {
            operationalSubtitle.textContent = roles.length
                ? 'Elige uno o varios roles de trabajo para esta sesión.'
                : 'No hay roles de trabajo activos disponibles para continuar.';
        }

        if (blockedMessage) {
            blockedMessage.hidden = roles.length > 0;
            blockedMessage.textContent = session.mensaje || 'Solicita a un administrador asignarte un rol de trabajo activo.';
        }

        if (!rolesContainer) return;

        rolesContainer.innerHTML = roles.length ? `
            <label class="operational-role-card operational-role-card-all">
                <input type="checkbox" id="operational-select-all" onchange="Auth.toggleAllOperationalRoles(this.checked)">
                <span class="operational-role-icon"><i class="fas fa-check-double"></i></span>
                <span class="operational-role-copy">
                    <strong>Todos</strong>
                    <small>Selecciona todos los roles disponibles para este usuario.</small>
                </span>
            </label>
            ${roles.map(role => this.renderOperationalRoleOption(role, initialSelected.includes(Number(role.id)))).join('')}
        ` : `
            <div class="operational-session-empty">
                <i class="fas fa-triangle-exclamation"></i>
                <strong>Sin rol operativo disponible</strong>
                <span>Este usuario no tiene un rol activo con zonas activas.</span>
            </div>
        `;

        this.syncOperationalRoleSelectionState();
        if (enterButton) enterButton.disabled = !roles.length || !this.getCheckedOperationalRoleIds().length;
    },

    renderOperationalRoleOption(role, checked = false) {
        const zones = Array.isArray(role.zonas) ? role.zonas.filter(zone => Number(zone.activa) === 1) : [];
        const zoneNames = zones.length
            ? zones.map(zone => this.escapeHtml(zone.nombre)).join(' · ')
            : (Number(role.requiere_zona ?? 1) === 0 ? 'No requiere zona · acceso por capacidades' : 'Sin zonas activas');

        return `
            <label class="operational-role-card operational-role-card-check ${checked ? 'is-selected' : ''}" data-role-id="${Number(role.id)}">
                <input type="checkbox" class="operational-role-checkbox" value="${Number(role.id)}" ${checked ? 'checked' : ''} onchange="Auth.syncOperationalRoleSelectionState()">
                <span class="operational-role-icon"><i class="fas ${String(role.slug || '') === 'cajero' ? 'fa-cash-register' : 'fa-user-tag'}"></i></span>
                <span class="operational-role-copy">
                    <strong>${this.escapeHtml(role.nombre)}</strong>
                    <small>${zoneNames}</small>
                </span>
                <span class="operational-role-checkmark"><i class="fas fa-check"></i></span>
            </label>
        `;
    },

    getCheckedOperationalRoleIds() {
        return Array.from(document.querySelectorAll('#operational-role-options .operational-role-checkbox:checked'))
            .map(input => Number(input.value))
            .filter(id => Number.isFinite(id) && id > 0);
    },

    toggleAllOperationalRoles(checked = false) {
        document.querySelectorAll('#operational-role-options .operational-role-checkbox').forEach(input => {
            input.checked = Boolean(checked);
        });
        this.syncOperationalRoleSelectionState();
    },

    syncOperationalRoleSelectionState() {
        const checkboxes = Array.from(document.querySelectorAll('#operational-role-options .operational-role-checkbox'));
        const checked = checkboxes.filter(input => input.checked);
        const selectAll = document.getElementById('operational-select-all');
        const enterButton = document.getElementById('operational-session-enter-btn');

        document.querySelectorAll('#operational-role-options .operational-role-card-check').forEach(card => {
            const input = card.querySelector('.operational-role-checkbox');
            card.classList.toggle('is-selected', Boolean(input?.checked));
        });

        if (selectAll) {
            selectAll.checked = Boolean(checkboxes.length && checked.length === checkboxes.length);
            selectAll.indeterminate = Boolean(checked.length && checked.length < checkboxes.length);
        }

        if (enterButton) enterButton.disabled = checked.length === 0;
    },

    escapeHtml(value = '') {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    },

    async selectOperationalRole(roleId) {
        return this.selectOperationalRoles([roleId]);
    },

    async submitOperationalRoles() {
        const roleIds = this.getCheckedOperationalRoleIds();
        if (!roleIds.length) {
            Utils.showNotification('Selecciona al menos un rol de trabajo para entrar', 'warning');
            return;
        }

        await this.selectOperationalRoles(roleIds);
    },

    async selectOperationalRoles(roleIds = []) {
        const normalizedIds = [...new Set((Array.isArray(roleIds) ? roleIds : [roleIds]).map(id => Number(id)).filter(id => id > 0))];
        if (!normalizedIds.length) {
            Utils.showNotification('Selecciona al menos un rol de trabajo para entrar', 'warning');
            return;
        }

        try {
            const enterButton = document.getElementById('operational-session-enter-btn');
            if (enterButton) {
                enterButton.disabled = true;
                enterButton.classList.add('is-loading');
            }

            const response = await Utils.request('/auth/operational-session', {
                method: 'POST',
                body: JSON.stringify({
                    rol_trabajo_ids: normalizedIds,
                    roles_trabajo_ids: normalizedIds,
                    role_ids: normalizedIds,
                    rol_trabajo_id: normalizedIds[0],
                    roleId: normalizedIds[0]
                })
            });

            if (response.success) {
                currentUser = response.user;
                this.showApp();
                await loadRestaurantName();
                Utils.showNotification('Roles de trabajo activos seleccionados', 'success');

                Dashboard.refreshData();
                Dashboard.startAutoRefresh();
                Realtime.connect();
            }
        } catch (error) {
            Utils.showNotification(error.message, 'error');
            this.showOperationalSessionSelection();
        }
    },


    canOpenRoleChangeControl() {
        const session = currentUser?.sesion_operativa || {};
        const roles = Array.isArray(session.roles_disponibles) ? session.roles_disponibles : [];
        return roles.length > 1 || Boolean(session.requiere_seleccion && roles.length);
    },

    buildRoleChangeStatusFromOperationalSession(response = {}) {
        const session = response.data || response.user?.sesion_operativa || currentUser?.sesion_operativa || {};
        const roles = Array.isArray(session.roles_disponibles) ? session.roles_disponibles : [];
        const activeRoles = getActiveWorkRoles(response.user || currentUser);

        return {
            puede_cambiar: true,
            bloqueo: {
                bloqueado: false,
                cuentas_pendientes: 0,
                puestos_ocupados: 0,
                mensaje: null
            },
            rol_trabajo_actual: activeRoles[0] || null,
            roles_trabajo_actuales: activeRoles,
            roles_disponibles: roles,
            sesion_operativa: session
        };
    },

    async requestRoleChangeStatus() {
        const response = await fetch(`${API_BASE}/auth/operational-session/change-status`, {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
            headers: {
                'Content-Type': 'application/json',
                'X-MundiPOS-Client': MUNDIPOS_CLIENT_ID
            }
        });

        const contentType = response.headers.get('content-type') || '';
        const data = contentType.includes('application/json')
            ? await response.json()
            : { success: response.ok, message: await response.text() };

        if (response.status === 404) {
            const sessionResponse = await Utils.request('/auth/operational-session', {
                method: 'GET',
                cache: 'no-store'
            });

            return {
                success: true,
                data: this.buildRoleChangeStatusFromOperationalSession(sessionResponse),
                user: sessionResponse.user,
                fallback: true
            };
        }

        if (!response.ok) {
            throw new Error(data.error || data.message || 'No se pudo consultar el cambio de rol');
        }

        return data;
    },

    async openRoleChangeModal() {
        if (!currentUser) return;

        if (!this.canOpenRoleChangeControl()) {
            Utils.showNotification('Este usuario no tiene otros roles de trabajo disponibles para cambiar.', 'info');
            return;
        }

        try {
            const response = await this.requestRoleChangeStatus();

            if (response.user) {
                currentUser = response.user;
                this.updateUserInfo();
            }

            const data = response.data || {};
            const roles = Array.isArray(data.roles_disponibles) ? data.roles_disponibles : [];
            if (!roles.length) {
                Utils.showNotification('No tienes roles de trabajo activos disponibles.', 'info');
                return;
            }

            Utils.showModal(
                'Cambio de Rol',
                this.renderRoleChangeModal(data),
                [
                    {
                        text: 'Cancelar',
                        class: 'btn-light',
                        onclick: 'Utils.hideModal()'
                    },
                    {
                        text: '<i class="fas fa-check"></i> Aplicar cambio',
                        class: 'btn-primary',
                        align: 'right',
                        onclick: 'Auth.submitRoleChangeSelection()'
                    }
                ],
                'modal-role-change'
            );

            this.syncRoleChangeSelectionState();
        } catch (error) {
            Utils.showNotification(error.message || 'No se pudo consultar el cambio de rol', 'error');
        }
    },

    renderRoleChangeModal(data = {}) {
        const roles = Array.isArray(data.roles_disponibles) ? data.roles_disponibles : [];
        const activeRoles = Array.isArray(data.roles_trabajo_actuales) && data.roles_trabajo_actuales.length
            ? data.roles_trabajo_actuales
            : getActiveWorkRoles(currentUser);
        const activeIds = new Set(activeRoles.map(role => Number(role.id)));
        const currentRoleName = activeRoles.length
            ? activeRoles.map(role => role.nombre).join(' + ')
            : 'Sin rol operativo';

        return `
            <div class="role-change-shell">
                <div class="role-change-current">
                    <span>Roles actuales</span>
                    <strong>${this.escapeHtml(currentRoleName)}</strong>
                </div>
                <div class="role-change-helper">
                    <i class="fas fa-circle-info"></i>
                    <span>Selecciona uno o varios roles. Si dejas una zona con mesas compartidas, el sistema te libera de esas responsabilidades. Si eres responsable único, el cambio se bloquea.</span>
                </div>
                <div class="role-change-options" aria-label="Roles de trabajo disponibles para cambio">
                    <label class="role-change-option role-change-option-all">
                        <input type="checkbox" id="role-change-select-all" onchange="Auth.toggleAllRoleChangeRoles(this.checked)">
                        <span class="role-change-option-icon"><i class="fas fa-check-double"></i></span>
                        <span class="role-change-option-copy">
                            <strong>Todos</strong>
                            <small>Activar todos los roles disponibles para este usuario.</small>
                        </span>
                        <span class="role-change-option-action">Todos</span>
                    </label>
                    ${roles.map(role => this.renderRoleChangeOption(role, activeIds.has(Number(role.id)))).join('')}
                </div>
            </div>
        `;
    },

    renderRoleChangeOption(role, checked = false) {
        const zones = Array.isArray(role.zonas) ? role.zonas.filter(zone => Number(zone.activa) === 1) : [];
        const zoneNames = zones.length
            ? zones.map(zone => this.escapeHtml(zone.nombre)).join(' · ')
            : 'Sin zonas activas';

        return `
            <label class="role-change-option role-change-option-check ${checked ? 'is-selected' : ''}" data-role-id="${Number(role.id)}">
                <input type="checkbox" class="role-change-checkbox" value="${Number(role.id)}" ${checked ? 'checked' : ''} onchange="Auth.syncRoleChangeSelectionState()">
                <span class="role-change-option-icon"><i class="fas fa-user-tag"></i></span>
                <span class="role-change-option-copy">
                    <strong>${this.escapeHtml(role.nombre)}</strong>
                    <small>${zoneNames}</small>
                </span>
                <span class="role-change-option-action"><i class="fas fa-check"></i></span>
            </label>
        `;
    },

    getCheckedRoleChangeIds() {
        return Array.from(document.querySelectorAll('.modal-role-change .role-change-checkbox:checked'))
            .map(input => Number(input.value))
            .filter(id => Number.isFinite(id) && id > 0);
    },

    toggleAllRoleChangeRoles(checked = false) {
        document.querySelectorAll('.modal-role-change .role-change-checkbox').forEach(input => {
            input.checked = Boolean(checked);
        });
        this.syncRoleChangeSelectionState();
    },

    syncRoleChangeSelectionState() {
        const checkboxes = Array.from(document.querySelectorAll('.modal-role-change .role-change-checkbox'));
        const checked = checkboxes.filter(input => input.checked);
        const selectAll = document.getElementById('role-change-select-all');

        document.querySelectorAll('.modal-role-change .role-change-option-check').forEach(card => {
            const input = card.querySelector('.role-change-checkbox');
            card.classList.toggle('is-selected', Boolean(input?.checked));
        });

        if (selectAll) {
            selectAll.checked = Boolean(checkboxes.length && checked.length === checkboxes.length);
            selectAll.indeterminate = Boolean(checked.length && checked.length < checkboxes.length);
        }
    },

    async submitRoleChangeSelection() {
        const roleIds = this.getCheckedRoleChangeIds();
        if (!roleIds.length) {
            Utils.showNotification('Selecciona al menos un rol de trabajo', 'warning');
            return;
        }

        await this.changeOperationalRole(roleIds);
    },

    async changeOperationalRole(roleIds, options = {}) {
        const normalizedIds = [...new Set((Array.isArray(roleIds) ? roleIds : [roleIds]).map(id => Number(id)).filter(id => id > 0))];
        if (!normalizedIds.length) {
            Utils.showNotification('Selecciona al menos un rol de trabajo', 'warning');
            return;
        }

        try {
            const currentIds = getActiveWorkRoles(currentUser).map(role => Number(role.id)).sort((a, b) => a - b);
            const selectedSorted = [...normalizedIds].sort((a, b) => a - b);
            const isRoleChange = currentIds.length > 0 && (currentIds.length !== selectedSorted.length || currentIds.some((id, index) => id !== selectedSorted[index]));
            const currentUserType = String(currentUser?.tipo || '').trim().toLowerCase();
            const requiresAdminAuthorization = !['administrador', 'admin'].includes(currentUserType) && isRoleChange && !options.adminPassword;

            if (requiresAdminAuthorization) {
                this.showRoleChangeAuthorizationModal(normalizedIds);
                return;
            }

            const response = await Utils.request('/auth/operational-session', {
                method: 'POST',
                body: JSON.stringify({
                    rol_trabajo_ids: normalizedIds,
                    roles_trabajo_ids: normalizedIds,
                    role_ids: normalizedIds,
                    rol_trabajo_id: normalizedIds[0],
                    roleId: normalizedIds[0],
                    admin_password: options.adminPassword || undefined,
                    adminPassword: options.adminPassword || undefined
                })
            });

            if (response.success) {
                currentUser = response.user;
                this.updateUserInfo();
                Realtime.reconnectForSession();
                Utils.hideModal();
                Utils.showNotification('Roles de trabajo actualizados correctamente', 'success');

                if (typeof Dashboard !== 'undefined' && typeof Dashboard.refreshData === 'function') {
                    Dashboard.refreshData();
                }

                if (currentSection === 'tables' && typeof Tables !== 'undefined' && typeof Tables.load === 'function') {
                    Tables.load();
                }
            }
        } catch (error) {
            Utils.showNotification(error.message || 'No se pudo cambiar el rol de trabajo', 'error');

            if (typeof Auth.openRoleChangeModal === 'function') {
                Auth.openRoleChangeModal();
            }
        }
    },

    showRoleChangeAuthorizationModal(roleIds) {
        const normalizedIds = [...new Set((Array.isArray(roleIds) ? roleIds : [roleIds]).map(id => Number(id)).filter(id => id > 0))];
        this.pendingRoleChangeIds = normalizedIds;

        const roles = currentUser?.sesion_operativa?.roles_disponibles || [];
        const targetRoles = roles.filter(role => normalizedIds.includes(Number(role.id)));
        const currentRoles = getActiveWorkRoles(currentUser);
        const targetName = targetRoles.length ? targetRoles.map(role => role.nombre).join(' + ') : 'roles seleccionados';
        const currentName = currentRoles.length ? currentRoles.map(role => role.nombre).join(' + ') : 'rol actual';

        Utils.showModal('Autorizar cambio de rol', `
            <div class="role-change-auth-shell">
                <div class="role-change-auth-icon"><i class="fas fa-shield-halved"></i></div>
                <div class="role-change-auth-copy">
                    <strong>${this.escapeHtml(currentName)} → ${this.escapeHtml(targetName)}</strong>
                    <p>Un administrador debe ingresar su contraseña para autorizar este cambio de roles.</p>
                    <small>Si el usuario quedaría como responsable único de una mesa activa fuera de sus nuevos roles, el sistema bloqueará el cambio aunque la contraseña sea correcta.</small>
                </div>
                <label class="form-group role-change-auth-field">
                    <span>Contraseña de administrador</span>
                    <input type="password" id="role-change-admin-password" autocomplete="current-password" placeholder="Contraseña admin" onkeydown="if(event.key === 'Enter') Auth.submitRoleChangeAuthorization()">
                </label>
            </div>
        `, [
            {
                text: 'Cancelar',
                class: 'btn-light',
                onclick: 'Auth.openRoleChangeModal()'
            },
            {
                text: '<i class="fas fa-check"></i> Autorizar cambio',
                class: 'btn-primary',
                align: 'right',
                onclick: 'Auth.submitRoleChangeAuthorization()'
            }
        ], 'modal-role-change-auth');

        setTimeout(() => document.getElementById('role-change-admin-password')?.focus(), 80);
    },

    async submitRoleChangeAuthorization() {
        const input = document.getElementById('role-change-admin-password');
        const adminPassword = input?.value || '';
        if (!adminPassword.trim()) {
            Utils.showNotification('Ingrese la contraseña de administrador', 'warning');
            input?.focus();
            return;
        }

        await this.changeOperationalRole(this.pendingRoleChangeIds || [], { adminPassword });
    },

    async refreshCurrentUserFromServer(options = {}) {
        try {
            const response = await Utils.request('/auth/verify', {
                method: 'GET',
                cache: 'no-store'
            });

            if (response.authenticated && response.user) {
                currentUser = response.user;
                this.updateUserInfo();
                return true;
            }
        } catch (error) {
            if (!options.silent) {
                Utils.showNotification('No se pudo actualizar la sesión operativa', 'warning');
            }
        }

        return false;
    },

    updateUserInfo() {
        if (!currentUser) return;

        const currentUserElement = document.getElementById('current-user');
        const userTypeElement = document.getElementById('user-type');
        const activeWorkRoleElement = document.getElementById('active-work-role');
        const roleChangeButton = document.getElementById('role-change-btn');
        const userInfoElement = document.querySelector('.user-info');
        const usuarioActualElement = document.getElementById('usuario-actual');
        const tipoUsuarioElement = document.getElementById('tipo-usuario');

        const userTypeLabel = formatUserTypeLabel(currentUser.tipo);
        const workRoleLabel = formatActiveWorkRoleLabel(currentUser);
        const hasActiveWorkRole = Boolean(getActiveWorkRole(currentUser));
        const canChangeRole = this.canOpenRoleChangeControl();

        if (currentUserElement) {
            currentUserElement.textContent = currentUser.nombre;
            currentUserElement.title = currentUser.nombre || '';
        }

        if (userTypeElement) {
            userTypeElement.textContent = userTypeLabel;
            userTypeElement.title = `Rol de sistema: ${userTypeLabel}`;
        }

        if (activeWorkRoleElement) {
            activeWorkRoleElement.textContent = workRoleLabel;
            activeWorkRoleElement.title = canChangeRole
                ? `Rol de trabajo activo: ${workRoleLabel}. Toca para cambiar de rol.`
                : `Rol de trabajo activo: ${workRoleLabel}`;
            activeWorkRoleElement.disabled = !canChangeRole;
            activeWorkRoleElement.classList.toggle('is-clickable', canChangeRole);
        }

        if (roleChangeButton) {
            roleChangeButton.hidden = !canChangeRole;
            roleChangeButton.disabled = !canChangeRole;
            roleChangeButton.title = canChangeRole
                ? 'Cambiar rol de trabajo activo'
                : 'Sin otros roles de trabajo disponibles';
        }

        if (userInfoElement) {
            userInfoElement.classList.toggle('has-work-role', hasActiveWorkRole);
            userInfoElement.classList.toggle('without-work-role', !hasActiveWorkRole);
            userInfoElement.setAttribute('title', `${currentUser.nombre || 'Usuario'} · ${userTypeLabel} · ${workRoleLabel}`);
        }

        if (usuarioActualElement) usuarioActualElement.textContent = currentUser.nombre;
        if (tipoUsuarioElement) tipoUsuarioElement.textContent = userTypeLabel;
        Access.applyNavigation();
    }
};

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function resetLoginForm() {
    const loginForm = document.getElementById('login-form');
    const bootstrapForm = document.getElementById('bootstrap-admin-form');
    const errorDiv = document.getElementById('login-error');

    if (loginForm) loginForm.reset();
    if (bootstrapForm) bootstrapForm.reset();

    if (errorDiv) {
        errorDiv.textContent = '';
        errorDiv.style.display = 'none';
    }

    resetSubmitButton(
        loginForm?.querySelector('button[type="submit"]'),
        '<i class="fas fa-sign-in-alt"></i>',
        'Iniciar sesión'
    );

    resetSubmitButton(
        bootstrapForm?.querySelector('button[type="submit"]'),
        '<i class="fas fa-user-plus"></i>',
        'Crear administrador'
    );
}

function resetSubmitButton(button, iconHtml, label) {
    if (!button) return;

    button.disabled = false;
    button.classList.remove('is-loading');
    button.innerHTML = `
        <span class="btn-content">
            ${iconHtml}
            ${label}
        </span>
    `;
}

function setLoginMode(mode = 'login') {
    const loginCard = document.getElementById('login-card');
    const loginForm = document.getElementById('login-form');
    const bootstrapForm = document.getElementById('bootstrap-admin-form');
    const eyebrow = document.querySelector('.login-eyebrow');
    const title = document.querySelector('.login-header h1');
    const restaurantName = document.getElementById('login-restaurant-name');
    const isBootstrap = mode === 'bootstrap';

    loginCard?.classList.toggle('is-bootstrap-setup', isBootstrap);

    if (loginForm) loginForm.hidden = isBootstrap;
    if (bootstrapForm) bootstrapForm.hidden = !isBootstrap;

    if (eyebrow) {
        eyebrow.textContent = isBootstrap
            ? 'Configuración inicial'
            : 'Punto de venta inteligente';
    }

    if (title) {
        title.textContent = isBootstrap
            ? 'Crear administrador'
            : 'MundiPOS';
    }

    if (restaurantName) {
        restaurantName.textContent = isBootstrap
            ? 'Primero crea el usuario administrador principal'
            : (restaurantName.dataset.businessName || restaurantName.textContent || 'Cargando negocio...');
    }
}

// Navegación
const Navigation = {
    mobileSubnavMoreOpen: false,

    // Mostrar sección
    async showSection(sectionName) {
        if (!Access.canOpen(sectionName)) {
            Utils.showNotification('Tu sesión no tiene acceso a esta sección.', 'warning');
            const fallback = Access.getInitialSection();
            if (fallback !== sectionName) return this.showSection(fallback);
            return;
        }
        {
            const transitionId = ++navigationTransitionId;
            const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            const currentActiveSection = document.querySelector('.content-section.active');
            const nextSection = document.getElementById(`${sectionName}-section`);
            const isSameSection = currentSection === sectionName && currentActiveSection === nextSection;

            document.querySelectorAll('.nav-link').forEach(link => {
                link.classList.remove('active');
            });

            const link = document.querySelector(`[data-section="${sectionName}"]`);
            if (link) {
                link.classList.add('active');
            }

            const cashButton = document.getElementById('cash-header-btn');
            if (cashButton) cashButton.classList.toggle('active', sectionName === 'cash');

            if (window.innerWidth <= 768) {
                this.closeSidebar();
            }

            if (isSameSection) {
                await this.loadSectionContent(sectionName);
                this.renderInternalSubnav(sectionName);
                DashboardFocus.handleSectionChange(sectionName);
                return;
            }

            if (currentActiveSection && !prefersReducedMotion) {
                currentActiveSection.classList.add('section-leaving');
                await wait(160);
            }

            if (transitionId !== navigationTransitionId) return;

            document.querySelectorAll('.content-section').forEach(section => {
                section.classList.remove('active', 'section-leaving');
            });

            if (nextSection) {
                nextSection.classList.add('active');
            }

            currentSection = sectionName;
            await this.loadSectionContent(sectionName);
            this.renderInternalSubnav(sectionName);
            DashboardFocus.handleSectionChange(sectionName);

            if (transitionId !== navigationTransitionId) return;

            if (window.innerWidth <= 768) {
                this.closeSidebar();
            }

            return;
        }    },

    // Cargar contenido de sección
    async loadSectionContent(sectionName) {
        try {
            switch (sectionName) {
                case 'dashboard':
                    await Dashboard.load();
                    break;
                case 'tables':
                    await Tables.load();
                    break;
                case 'menu':
                    await Menu.load();
                    break;
                case 'orders':
                    await Orders.load();
                    break;
                case 'accounts':
                    await Accounts.load();
                    break;
                case 'cash':
                    await Cash.load();
                    break;
                case 'kitchen':
                    if (typeof Kitchen !== 'undefined') await Kitchen.load({ source: 'navigation' });
                    break;
                case 'users':
                    await Users.load();
                    break;
                case 'settings':
                    await Settings.load();
                    break;
            }
        } catch (error) {
            console.error(`Error cargando sección ${sectionName}:`, error);
            Utils.showNotification(`Error cargando ${sectionName}`, 'error');
        }
    },

    // Toggle sidebar en móvil
    getInternalItems(sectionName) {
        if (sectionName === 'dashboard' && typeof Dashboard !== 'undefined' && typeof Dashboard.getInternalNavItems === 'function') {
            const dynamicItems = Dashboard.getInternalNavItems();
            if (Array.isArray(dynamicItems) && dynamicItems.length) return dynamicItems;
        }

        if (sectionName === 'tables' && typeof Tables !== 'undefined' && typeof Tables.getInternalNavItems === 'function') {
            const dynamicItems = Tables.getInternalNavItems();
            if (Array.isArray(dynamicItems) && dynamicItems.length) return dynamicItems;
        }

        return INTERNAL_SUBNAV[sectionName] || [];
    },

    getInternalActive(sectionName) {
        switch (sectionName) {
            case 'dashboard':
                return Dashboard.filtroTipo || 'todos';
            case 'tables':
                return Tables.filtroTipo || 'todos';
            case 'menu':
                return Menu.currentView || 'products';
            case 'orders':
                return Orders.currentView || 'pending';
            case 'settings':
                return Settings.currentView || 'general';
            default:
                return '';
        }
    },

    getMobileSubnavLayout(sectionName, items = [], activeId = '') {
        if (!['dashboard', 'tables'].includes(sectionName) || items.length <= 4) {
            return { visibleItems: items, overflowItems: [] };
        }

        const allItem = items.find(item => item.id === 'todos') || items[0];
        const zoneItems = items.filter(item => item.id !== allItem.id);
        const visibleZones = zoneItems.slice(0, 3);
        const overflowItems = zoneItems.slice(3);

        return {
            visibleItems: [allItem, ...visibleZones],
            overflowItems,
            hasActiveOverflow: overflowItems.some(item => item.id === activeId)
        };
    },

    renderMobileSubnavButton(sectionName, item, activeId) {
        return `
            <button type="button"
                    class="mobile-subnav-item ${item.id === activeId ? 'active' : ''}"
                    data-subnav-item="${item.id}"
                    onclick="Navigation.selectInternal('${sectionName}', '${item.id}')"
                    aria-label="${item.label}"
                    title="${item.label}">
                <i class="fas ${item.icon}"></i>
                <span>${item.label}</span>
            </button>
        `;
    },

    renderInternalSubnav(sectionName = currentSection) {
        const bar = document.getElementById('mobile-subnav');
        const items = this.getInternalItems(sectionName);

        if (!bar || !items.length) {
            document.body.classList.remove('has-mobile-subnav');
            if (bar) {
                bar.classList.remove('is-visible');
                bar.innerHTML = '';
            }
            return;
        }

        const activeId = this.getInternalActive(sectionName);
        const layout = this.getMobileSubnavLayout(sectionName, items, activeId);
        const visibleHtml = layout.visibleItems
            .map(item => this.renderMobileSubnavButton(sectionName, item, activeId))
            .join('');

        const overflowHtml = layout.overflowItems.length ? `
            <div class="mobile-subnav-more-wrap ${this.mobileSubnavMoreOpen ? 'is-open' : ''}">
                <button type="button"
                        class="mobile-subnav-item mobile-subnav-more ${layout.hasActiveOverflow ? 'active' : ''} ${this.mobileSubnavMoreOpen ? 'is-open' : ''}"
                        data-subnav-more="true"
                        onclick="Navigation.toggleMobileSubnavMore(event)"
                        aria-haspopup="true"
                        aria-expanded="${this.mobileSubnavMoreOpen ? 'true' : 'false'}"
                        aria-label="Mostrar más zonas"
                        title="Más zonas">
                    <i class="fas fa-ellipsis"></i>
                    <span>Más...</span>
                </button>
                <div class="mobile-subnav-more-menu ${this.mobileSubnavMoreOpen ? 'is-open' : ''}" role="menu" aria-label="Más zonas">
                    ${layout.overflowItems.map(item => `
                        <button type="button"
                                class="mobile-subnav-more-option ${item.id === activeId ? 'active' : ''}"
                                data-subnav-item="${item.id}"
                                onclick="Navigation.selectInternal('${sectionName}', '${item.id}')"
                                role="menuitem"
                                title="${item.label}">
                            <i class="fas ${item.icon}"></i>
                            <span>${item.label}</span>
                        </button>
                    `).join('')}
                </div>
            </div>
        ` : '';

        bar.innerHTML = `${visibleHtml}${overflowHtml}`;
        bar.classList.toggle('has-overflow', Boolean(layout.overflowItems.length));
        bar.classList.add('is-visible');
        document.body.classList.add('has-mobile-subnav');
        this.syncInternalSubnav(sectionName);
    },

    toggleMobileSubnavMore(event) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        this.mobileSubnavMoreOpen = !this.mobileSubnavMoreOpen;
        this.renderInternalSubnav(currentSection);
    },

    closeMobileSubnavMore() {
        if (!this.mobileSubnavMoreOpen) return;
        this.mobileSubnavMoreOpen = false;
        this.renderInternalSubnav(currentSection);
    },

    syncInternalSubnav(sectionName = currentSection) {
        const activeId = this.getInternalActive(sectionName);

        document.querySelectorAll('[data-subnav-item]').forEach(item => {
            item.classList.toggle('active', item.getAttribute('data-subnav-item') === activeId);
        });

        document.querySelectorAll('[data-subnav-more]').forEach(button => {
            const wrapper = button.closest('.mobile-subnav-more-wrap');
            const hasActiveOverflow = Array.from(wrapper?.querySelectorAll('.mobile-subnav-more-option') || [])
                .some(item => item.getAttribute('data-subnav-item') === activeId);
            button.classList.toggle('active', hasActiveOverflow);
            button.classList.toggle('is-open', this.mobileSubnavMoreOpen);
            button.setAttribute('aria-expanded', this.mobileSubnavMoreOpen ? 'true' : 'false');
        });
    },

    async selectInternal(sectionName, itemId) {
        this.mobileSubnavMoreOpen = false;

        if (currentSection !== sectionName) {
            await this.showSection(sectionName);
        }

        const currentActive = this.getInternalActive(sectionName);
        if (currentActive === itemId) {
            this.syncInternalSubnav(sectionName);
            return;
        }

        await this.runInternalTransition(sectionName, async () => {
            switch (sectionName) {
                case 'dashboard':
                    if (typeof Dashboard.rememberMobileZonePriority === 'function') {
                        Dashboard.rememberMobileZonePriority(itemId);
                    }
                    Dashboard.filtrarPorZona(itemId);
                    break;
                case 'tables':
                    if (typeof Tables.rememberMobileZonePriority === 'function') {
                        Tables.rememberMobileZonePriority(itemId);
                    }
                    Tables.filtrarPorZona(itemId);
                    break;
                case 'menu':
                    Menu.switchView(itemId);
                    break;
                case 'orders':
                    await Orders.switchView(itemId);
                    break;
                case 'settings':
                    Settings.switchView(itemId);
                    break;
            }
        });

        this.renderInternalSubnav(sectionName);
        this.syncInternalSubnav(sectionName);
    },

    getInternalTransitionTarget(sectionName = currentSection) {
        const section = document.getElementById(`${sectionName}-section`);
        if (!section) return null;

        if (sectionName === 'dashboard') {
            return section.querySelector('#mesas-grid') || section.querySelector('.dashboard-tables') || section;
        }

        if (sectionName === 'menu') {
            return section.querySelector('[data-internal-panel="menu-content"]')
                || section.querySelector('[data-internal-panel="menu"]')
                || section;
        }

        const scopedPanel = section.querySelector(`[data-internal-panel="${sectionName}"]`);
        if (scopedPanel) return scopedPanel;

        return section.querySelector('[data-internal-panel]') || section;
    },

    async runInternalTransition(sectionName, action) {
        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        if (prefersReducedMotion) {
            await action();
            return;
        }

        const target = this.getInternalTransitionTarget(sectionName);

        if (target) {
            target.classList.remove('internal-panel-entering', 'internal-panel-ready');
            target.classList.add('internal-panel-leaving');
            await wait(160);
        }

        await action();

        const newTarget = this.getInternalTransitionTarget(sectionName);
        if (!newTarget) return;

        newTarget.classList.remove('internal-panel-leaving', 'internal-panel-ready');
        newTarget.classList.add('internal-panel-entering');

        requestAnimationFrame(() => {
            newTarget.classList.add('internal-panel-ready');
        });

        window.setTimeout(() => {
            newTarget.classList.remove('internal-panel-entering', 'internal-panel-ready');
        }, 320);
    },

    toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        if (sidebar.classList.contains('open')) {
            this.closeSidebar();
        } else {
            this.openSidebar();
        }
    },

    openSidebar() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebar-overlay');

        sidebar.classList.add('open');
        overlay?.classList.add('open');
    },

    closeSidebar() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebar-overlay');

        sidebar.classList.remove('open');
        overlay?.classList.remove('open');
    }
};



// Sincronización en tiempo real entre estaciones/dispositivos
const Realtime = {
    source: null,
    reconnectTimer: null,
    refreshTimer: null,
    isConnected: false,
    lastEventId: 0,

    connect() {
        if (!currentUser || typeof EventSource === 'undefined') return;
        if (this.source && this.source.readyState !== EventSource.CLOSED) return;

        this.disconnect(false);

        const url = `${API_BASE}/realtime/events?clientId=${encodeURIComponent(MUNDIPOS_CLIENT_ID)}`;
        this.source = new EventSource(url, { withCredentials: true });

        this.source.addEventListener('connected', (event) => {
            this.isConnected = true;
            if (typeof Kitchen !== 'undefined') Kitchen.updateConnectionStatus(true);
            this.handleServerEvent(event, false);
        });

        this.source.addEventListener('heartbeat', (event) => {
            this.isConnected = true;
            if (typeof Kitchen !== 'undefined') Kitchen.updateConnectionStatus(true);
            this.handleServerEvent(event, false);
        });

        this.source.addEventListener('operation-change', (event) => {
            this.handleServerEvent(event, true);
        });

        this.source.onerror = () => {
            this.isConnected = false;
            if (typeof Kitchen !== 'undefined') Kitchen.updateConnectionStatus(false);
            this.scheduleReconnect();
        };
    },

    disconnect(clearReconnect = true) {
        if (clearReconnect && this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
            this.refreshTimer = null;
        }

        if (this.source) {
            this.source.close();
            this.source = null;
        }

        this.isConnected = false;
        if (typeof Kitchen !== 'undefined') Kitchen.updateConnectionStatus(false);
    },

    scheduleReconnect() {
        if (!currentUser || this.reconnectTimer) return;

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.disconnect(false);
            this.connect();
        }, 3500);
    },

    reconnectForSession() {
        this.disconnect(true);
        window.setTimeout(() => this.connect(), 120);
    },

    isPayloadRelevant(payload = {}) {
        if (!currentUser || !payload) return false;
        return typeof OperationalAccess !== 'undefined'
            ? OperationalAccess.canReceiveRealtime(currentUser, payload)
            : false;
    },

    handleServerEvent(event, shouldRefresh) {
        const payload = this.parseEvent(event);
        if (!payload) return;

        if (payload.id && payload.id <= this.lastEventId) return;
        if (payload.id) this.lastEventId = payload.id;

        if (shouldRefresh && this.isPayloadRelevant(payload)) {
            this.scheduleOperationalRefresh(payload);
        }
    },

    parseEvent(event) {
        try {
            return JSON.parse(event.data || '{}');
        } catch (error) {
            console.warn('MundiPOS realtime: evento inválido', error);
            return null;
        }
    },

    scheduleOperationalRefresh(payload = {}) {
        if (!currentUser) return;

        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }

        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = null;
            this.refreshVisibleOperation(payload);
        }, 250);
    },

    async refreshVisibleOperation(payload = {}) {
        const scope = payload.scope || 'operacion';
        const isSelfTarget = Array.isArray(payload.targetUserIds)
            && payload.targetUserIds.map(id => Number(id)).includes(Number(currentUser?.id || 0));

        try {
            if (['sesion', 'usuarios', 'estructura'].includes(scope)
                && isSelfTarget
                && payload.sourceClientId !== MUNDIPOS_CLIENT_ID) {
                const previousSection = currentSection;
                await Auth.refreshCurrentUserFromServer({ silent: true });
                Access.applyNavigation();

                if (!Access.canOpen(previousSection)) {
                    await Navigation.showSection(Access.getInitialSection());
                }

                this.reconnectForSession();
            }

            if (typeof Dashboard !== 'undefined') {
                if (currentSection === 'dashboard') {
                    await Dashboard.refreshData({ source: 'realtime', silent: true, payload });
                } else if (typeof Dashboard.markStale === 'function') {
                    Dashboard.markStale();
                }
            }

            if (currentSection === 'tables' && typeof Tables !== 'undefined') {
                await Tables.load({ source: 'realtime', payload });
                return;
            }

            if (currentSection === 'orders' && typeof Orders !== 'undefined') {
                await Orders.load({ source: 'realtime', payload });
                return;
            }

            if (currentSection === 'accounts' && typeof Accounts !== 'undefined') {
                await Accounts.load({ source: 'realtime', payload });
                return;
            }

            if (currentSection === 'cash' && typeof Cash !== 'undefined') {
                await Cash.load({ source: 'realtime', payload });
                return;
            }

            if (currentSection === 'kitchen' && typeof Kitchen !== 'undefined') {
                await Kitchen.load({ source: 'realtime', payload, silent: true });
                return;
            }

            if (currentSection === 'users' && scope === 'usuarios' && typeof Users !== 'undefined') {
                await Users.load({ source: 'realtime', payload });
                return;
            }

            if (currentSection === 'menu' && scope === 'menu' && typeof Menu !== 'undefined') {
                await Menu.load({ source: 'realtime', payload });
            }
        } catch (error) {
            console.warn('MundiPOS realtime: no se pudo refrescar la vista activa', error);
        }
    }
};



// PWA
const PWA = {
    deferredPrompt: null,
    registration: null,

    init() {
        this.bindInstallPrompt();
        this.registerServiceWorker();
        this.updateInstallButtonVisibility();
    },

    bindInstallPrompt() {
        const installButton = document.getElementById('pwa-install-btn');

        window.addEventListener('beforeinstallprompt', (event) => {
            event.preventDefault();
            this.deferredPrompt = event;
            this.updateInstallButtonVisibility();
        });

        window.addEventListener('appinstalled', () => {
            this.deferredPrompt = null;
            this.updateInstallButtonVisibility();
            Utils.showNotification('MundiPOS instalado correctamente', 'success');
        });

        if (installButton) {
            installButton.addEventListener('click', () => this.promptInstall());
        }
    },

    async promptInstall() {
        if (!this.isInstallContextSecure()) {
            this.showInstallHelp('secure-origin');
            return;
        }

        if (!this.deferredPrompt) {
            this.showInstallHelp(this.isIOS() ? 'ios' : 'manual');
            return;
        }

        const promptEvent = this.deferredPrompt;
        this.deferredPrompt = null;
        promptEvent.prompt();

        try {
            await promptEvent.userChoice;
        } finally {
            this.updateInstallButtonVisibility();
        }
    },

    updateInstallButtonVisibility() {
        const installButton = document.getElementById('pwa-install-btn');
        if (!installButton) return;

        const isStandalone = this.isStandalone();
        const canPromptInstall = Boolean(this.deferredPrompt) && !isStandalone;
        const shouldShowHelp = !isStandalone && (!this.isInstallContextSecure() || this.isIOS());
        const shouldShow = canPromptInstall || shouldShowHelp;

        installButton.hidden = !shouldShow;
        installButton.classList.toggle('is-visible', shouldShow);
        installButton.classList.toggle('is-help-only', shouldShow && !canPromptInstall);
        installButton.title = canPromptInstall
            ? 'Instalar MundiPOS'
            : 'Ver requisitos de instalación PWA';
        installButton.setAttribute('aria-label', installButton.title);
    },

    async registerServiceWorker() {
        if (!('serviceWorker' in navigator)) return;

        if (!this.isInstallContextSecure()) {
            console.warn('MundiPOS PWA: el service worker requiere HTTPS o localhost/127.0.0.1 para ser instalable. Origen actual:', window.location.origin);
            this.updateInstallButtonVisibility();
            return;
        }

        try {
            const registration = await navigator.serviceWorker.register('/POS/service-worker.js', { scope: '/POS/' });
            this.registration = registration;

            registration.addEventListener('updatefound', () => {
                const newWorker = registration.installing;
                if (!newWorker) return;

                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        this.notifyUpdateAvailable(newWorker);
                    }
                });
            });

            this.updateInstallButtonVisibility();
        } catch (error) {
            console.warn('No se pudo registrar el service worker de MundiPOS:', error);
        }
    },

    isInstallContextSecure() {
        const host = window.location.hostname;
        return window.location.protocol === 'https:'
            || host === 'localhost'
            || host === '127.0.0.1'
            || host === '[::1]';
    },

    isStandalone() {
        return window.matchMedia('(display-mode: standalone)').matches
            || window.matchMedia('(display-mode: window-controls-overlay)').matches
            || window.navigator.standalone === true;
    },

    isIOS() {
        const ua = window.navigator.userAgent || '';
        return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && 'ontouchend' in document);
    },

    showInstallHelp(reason = 'manual') {
        const secureMessage = `
            <p>La instalación PWA requiere abrir MundiPOS desde <strong>HTTPS</strong> o desde <strong>localhost/127.0.0.1</strong>.</p>
            <p>En PC puedes probar con <code>http://localhost:3000/POS/</code>. En móvil, si accedes por la IP local de la PC, debes usar HTTPS con un certificado confiable en el dispositivo.</p>
        `;

        const iosMessage = `
            <p>En iPhone/iPad el navegador no muestra el botón automático de instalación.</p>
            <p>Usa <strong>Compartir</strong> y luego <strong>Agregar a pantalla de inicio</strong>.</p>
        `;

        const manualMessage = `
            <p>El navegador todavía no entregó el evento de instalación automática.</p>
            <p>Verifica en DevTools &gt; Application que el manifest y el service worker estén activos, o usa el botón de instalación de Chrome/Edge en la barra de dirección cuando aparezca.</p>
        `;

        const content = reason === 'secure-origin'
            ? secureMessage
            : reason === 'ios'
                ? iosMessage
                : manualMessage;

        Utils.showModal('Instalar MundiPOS', `<div class="pwa-install-help">${content}</div>`, [
            {
                text: 'Entendido',
                class: 'btn-primary',
                onclick: 'Utils.hideModal()'
            }
        ]);
    },

    notifyUpdateAvailable(worker) {
        const container = document.getElementById('notification-container');
        if (!container) return;

        const notification = document.createElement('div');
        notification.className = 'notification info pwa-update-notification';
        notification.innerHTML = `
            <div class="pwa-update-content">
                <span>Hay una actualización de MundiPOS lista.</span>
                <button type="button" class="btn btn-primary btn-sm">Actualizar</button>
            </div>
        `;

        notification.querySelector('button')?.addEventListener('click', () => {
            worker.postMessage({ type: 'SKIP_WAITING' });
            window.location.reload();
        });

        container.appendChild(notification);
    }
};

// Event Listeners
document.addEventListener('DOMContentLoaded', async function() {
    PWA.init();
    await loadPublicBranding();

    // Verificar sesión al cargar
    await Auth.checkSession();
    updateGreeting();

    // Login form
    document.getElementById('login-form')?.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        const errorDiv = document.getElementById('login-error');

        if (!username || !password) {
            errorDiv.textContent = 'Por favor ingrese usuario y contraseña';
            errorDiv.style.display = 'block';
            return;
        }

        errorDiv.style.display = 'none';
        
        const button = e.target.querySelector('button[type="submit"]');
        const originalText = button.innerHTML;
        button.classList.add('is-loading');
        button.innerHTML = '<span class="btn-content"><span class="loading"></span> Preparando panel...</span>';
        button.disabled = true;

        const success = await Auth.login(username, password);

        if (!success) {
            button.innerHTML = originalText;
            button.disabled = false;
            button.classList.remove('is-loading');
            errorDiv.textContent = 'Usuario o contraseña incorrectos';
            errorDiv.style.display = 'block';
        }

    });

    document.getElementById('bootstrap-admin-form')?.addEventListener('submit', async function(e) {
        e.preventDefault();

        const name = document.getElementById('bootstrap-admin-name').value.trim();
        const password = document.getElementById('bootstrap-admin-password').value;
        const confirmPassword = document.getElementById('bootstrap-admin-confirm-password').value;
        const errorDiv = document.getElementById('login-error');

        if (!name || !password || !confirmPassword) {
            errorDiv.textContent = 'Complete todos los campos para crear el administrador inicial';
            errorDiv.style.display = 'block';
            return;
        }

        if (password !== confirmPassword) {
            errorDiv.textContent = 'Las contraseñas no coinciden';
            errorDiv.style.display = 'block';
            return;
        }

        if (password.length < 8) {
            errorDiv.textContent = 'La contraseña debe tener al menos 8 caracteres';
            errorDiv.style.display = 'block';
            return;
        }

        errorDiv.style.display = 'none';

        const button = e.target.querySelector('button[type="submit"]');
        const originalText = button.innerHTML;
        button.classList.add('is-loading');
        button.innerHTML = '<span class="btn-content"><span class="loading"></span> Creando administrador...</span>';
        button.disabled = true;

        const success = await Auth.createBootstrapAdmin(name, password, confirmPassword);

        if (!success) {
            button.innerHTML = originalText;
            button.disabled = false;
            button.classList.remove('is-loading');
            errorDiv.textContent = errorDiv.textContent || 'No se pudo crear el administrador inicial';
            errorDiv.style.display = 'block';
        }
    });

    // Logout button
    document.getElementById('logout-btn').addEventListener('click', function() {
        Auth.logout();
    });

    // Menu toggle
    document.getElementById('menu-toggle').addEventListener('click', function() {
        Navigation.toggleSidebar();
    });

    // Navigation links
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            this.classList.remove('nav-link-pressed');
            void this.offsetWidth;
            this.classList.add('nav-link-pressed');
            const section = this.getAttribute('data-section');
            if (window.innerWidth <= 768) {
                Navigation.closeSidebar();
            }
            Navigation.showSection(section);
        });
    });

    document.getElementById('sidebar-overlay')?.addEventListener('click', function() {
        Navigation.closeSidebar();
    });

    // Dashboard quick navigation cards/badges
    document.addEventListener('click', function(e) {
        const target = e.target.closest('#dashboard-section [data-navigate]');
        if (!target) return;

        const section = target.getAttribute('data-navigate');
        if (!section) return;

        if (window.innerWidth <= 768) {
            Navigation.closeSidebar();
        }

        Navigation.showSection(section);
    });

    document.addEventListener('keydown', function(e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;

        const target = e.target.closest?.('#dashboard-section [data-navigate]');
        if (!target) return;

        e.preventDefault();
        target.click();
    });

    // Modal overlay click
    document.getElementById('modal-overlay').addEventListener('click', function(e) {
        if (e.target === this) {
            Utils.hideModal();
        }
    });

    // Cerrar dropdown de zonas móviles al tocar fuera
    document.addEventListener('click', function(e) {
        if (!e.target.closest?.('#mobile-subnav')) {
            Navigation.closeMobileSubnavMore();
        }
    });

    // Cerrar sidebar al hacer click fuera en móvil
    document.addEventListener('click', function(e) {
        if (window.innerWidth <= 768) {
            const sidebar = document.getElementById('sidebar');
            const menuToggle = document.getElementById('menu-toggle');
            
            if (!sidebar.contains(e.target) && !menuToggle.contains(e.target)) {
                Navigation.closeSidebar();
            }
        }
    });

    // Responsive sidebar
    window.addEventListener('resize', function() {
        Navigation.closeMobileSubnavMore();
        if (window.innerWidth > 768) {
            Navigation.closeSidebar();
        }
    });
});

// Funciones globales para acceso desde HTML
window.Utils = Utils;
window.Auth = Auth;
window.Access = Access;
window.Navigation = Navigation;
window.PWA = PWA;
window.Realtime = Realtime;



function getOrCreateClientId() {
    const storageKey = 'mundiposClientId';

    try {
        const existing = localStorage.getItem(storageKey);
        if (existing) return existing;

        const generated = (window.crypto && typeof window.crypto.randomUUID === 'function')
            ? window.crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

        localStorage.setItem(storageKey, generated);
        return generated;
    } catch (error) {
        return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }
}



function getActiveWorkRoles(user = currentUser) {
    const session = user?.sesion_operativa || {};
    const activeRoles = Array.isArray(session.roles_trabajo_activos)
        ? session.roles_trabajo_activos.filter(role => role && role.nombre)
        : [];

    if (activeRoles.length) return activeRoles;

    const legacyRole = session.rol_trabajo || user?.rol_trabajo_activo || null;
    return legacyRole?.nombre ? [legacyRole] : [];
}

function getActiveWorkRole(user = currentUser) {
    return getActiveWorkRoles(user)[0] || null;
}

function formatActiveWorkRoleLabel(user = currentUser) {
    const activeRoles = getActiveWorkRoles(user);
    if (activeRoles.length === 1) return activeRoles[0].nombre;
    if (activeRoles.length === 2) return activeRoles.map(role => role.nombre).join(' + ');
    if (activeRoles.length > 2) return `${activeRoles.length} roles activos`;

    const session = user?.sesion_operativa || {};
    const userType = String(user?.tipo || '').trim().toLowerCase();

    if (session.requiere_seleccion) {
        return 'Seleccionar rol';
    }

    if (session.modo === 'bloqueado_sin_rol') {
        return 'Sin rol activo';
    }

    if (userType === 'administrador' || userType === 'admin') {
        return 'Sin rol operativo';
    }

    return 'Rol pendiente';
}

function formatUserTypeLabel(tipo) {
    const normalizedType = String(tipo || '').trim().toLowerCase();

    if (normalizedType === 'administrador' || normalizedType === 'admin') {
        return 'Admin';
    }

    if (normalizedType === 'usuario' || normalizedType === 'estandar' || normalizedType === 'estándar') {
        return 'Estándar';
    }

    return tipo || 'Usuario';
}

function formatHeaderDateTime(now) {
    return now.toLocaleString('es-CR', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    }).replace(',', ' ·');
}

function formatMobileHeaderDateTime(now) {
    const dateLine = now.toLocaleDateString('es-CR', {
        weekday: 'short',
        day: '2-digit',
        month: 'short'
    }).replace('.', '').replace(',', '');

    const timeLine = now.toLocaleTimeString('es-CR', {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });

    return `
        <span class="mobile-date-line">${dateLine}</span>
        <span class="mobile-time-line">${timeLine}</span>
    `;
}

// Función para actualizar la fecha y hora del header activo
function updateDateTime() {
    const now = new Date();
    const desktopDateTime = formatHeaderDateTime(now);
    const mobileDateTime = formatMobileHeaderDateTime(now);
    const desktopNode = document.getElementById('current-datetime');
    const mobileNode = document.getElementById('mobile-current-datetime');

    if (desktopNode && desktopDateTime !== lastDesktopDateTime) {
        desktopNode.textContent = desktopDateTime;
        lastDesktopDateTime = desktopDateTime;
    }

    if (mobileNode && mobileDateTime !== lastMobileDateTime) {
        mobileNode.innerHTML = mobileDateTime;
        lastMobileDateTime = mobileDateTime;
    }
}

function startHeaderClock() {
    updateDateTime();

    if (headerClockTimer) return;

    headerClockTimer = setInterval(updateDateTime, 1000);
}

function stopHeaderClock() {
    if (!headerClockTimer) return;

    clearInterval(headerClockTimer);
    headerClockTimer = null;
    lastDesktopDateTime = '';
    lastMobileDateTime = '';
}


// Función para cargar y mostrar el nombre del negocio y versión en la app
async function loadPublicBranding() {
    try {
        const response = await fetch(`${API_BASE}/public/branding`, {
            credentials: 'include'
        });

        if (!response.ok) return;

        const result = await response.json();
        const data = result.data || {};
        applyBranding(data);
    } catch (error) {
        console.warn('No se pudo cargar el branding público:', error);
        applyBranding({});
    }
}

function applyBranding(data = {}) {
    const businessName = data.nombre_restaurante || 'Tu negocio';
    const version = data.version_app || '';

    document.title = APP_NAME;

    const loginRestaurantName = document.getElementById('login-restaurant-name');
    const restaurantName = document.getElementById('restaurant-name');
    const versionSpan = document.getElementById('app-version');
    const loginFooterVersion = document.getElementById('login-footer-version');

    if (loginRestaurantName) {
        loginRestaurantName.dataset.businessName = businessName;
        if (!Auth.requiresBootstrapSetup) {
            loginRestaurantName.textContent = businessName;
        }
    }
    if (restaurantName) restaurantName.textContent = businessName;
    if (versionSpan && version) versionSpan.textContent = version;
    if (loginFooterVersion && version) {
        loginFooterVersion.textContent = `v${String(version).replace(/^v/i, '')}`;
    }
}

// Función para cargar y mostrar el nombre del negocio y versión con sesión activa
async function loadRestaurantName() {
    try {
        const response = await Utils.request("/settings");
        applyBranding(response.data || {});
    } catch (error) {
        console.error("Error cargando la configuración:", error);
    }
}


// Función para actualizar el saludo contextual
function updateGreeting() {
    const now = new Date();
    const hour = now.getHours();
    let greeting;
    
    if (hour >= 5 && hour < 12) {
        greeting = "Buenos días";
    } else if (hour >= 12 && hour < 18) {
        greeting = "Buenas tardes";
    } else {
        greeting = "Buenas noches";
    }
    
    const greetingElement = document.getElementById('greeting-text');
    if (greetingElement) {
        greetingElement.textContent = greeting;
    }
}


window.addEventListener('resize', () => {
    if (typeof DashboardFocus !== 'undefined') {
        DashboardFocus.handleResize();
    }
});

window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && typeof DashboardFocus !== 'undefined' && DashboardFocus.isActive) {
        DashboardFocus.deactivate();
    }
});
