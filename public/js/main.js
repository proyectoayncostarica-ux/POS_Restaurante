// Variables globales
let currentUser = null;
let currentSection = 'dashboard';
let headerClockTimer = null;
let lastDesktopDateTime = '';
let lastMobileDateTime = '';
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
                this.showApp();
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
                await this.transitionToApp();
                await loadRestaurantName();
                Utils.showNotification('Administrador inicial creado correctamente', 'success');

                Dashboard.refreshData();
                Dashboard.startAutoRefresh();
                Realtime.connect();

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
                await this.transitionToApp();
                await loadRestaurantName();
                Utils.showNotification('Sesión iniciada correctamente', 'success');

                // Cargar datos del dashboard y activar autorefresco
                Dashboard.refreshData();
                Dashboard.startAutoRefresh();
                Realtime.connect();

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

        stopHeaderClock();
        Realtime.disconnect();
        document.body.classList.remove('has-mobile-subnav');
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

        if (loginScreen) {
            loginScreen.style.display = 'none';
            loginScreen.classList.remove('login-card-exit', 'login-bg-exit');
        }

        if (mainApp) {
            mainApp.style.display = 'grid';
            mainApp.classList.remove('app-entering');
        }

        this.updateUserInfo();
        Navigation.showSection('dashboard');
        loadRestaurantName();
        startHeaderClock();
        Realtime.connect();
        updateGreeting();
    },

    async transitionToApp() {
        const loginScreen = document.getElementById('login-screen');
        const mainApp = document.getElementById('main-app');

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
        Navigation.showSection('dashboard');
        startHeaderClock();
        Realtime.connect();
        updateGreeting();

        await wait(650);
        mainApp.classList.remove('app-entering');
    },

    updateUserInfo() {
        if (!currentUser) return;

        const currentUserElement = document.getElementById('current-user');
        const userTypeElement = document.getElementById('user-type');
        const usuarioActualElement = document.getElementById('usuario-actual');
        const tipoUsuarioElement = document.getElementById('tipo-usuario');

        const userTypeLabel = formatUserTypeLabel(currentUser.tipo);

        if (currentUserElement) currentUserElement.textContent = currentUser.nombre;
        if (userTypeElement) userTypeElement.textContent = userTypeLabel;
        if (usuarioActualElement) usuarioActualElement.textContent = currentUser.nombre;
        if (tipoUsuarioElement) tipoUsuarioElement.textContent = userTypeLabel;
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
    // Mostrar sección
    async showSection(sectionName) {
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

            if (window.innerWidth <= 768) {
                this.closeSidebar();
            }

            if (isSameSection) {
                await this.loadSectionContent(sectionName);
                this.renderInternalSubnav(sectionName);
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

            if (transitionId !== navigationTransitionId) return;

            if (window.innerWidth <= 768) {
                this.closeSidebar();
            }

            return;
        }

        // Ocultar todas las secciones
        document.querySelectorAll('.content-section').forEach(section => {
            section.classList.remove('active');
        });

        // Remover clase active de todos los links
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.remove('active');
        });

        // Mostrar sección seleccionada
        const section = document.getElementById(`${sectionName}-section`);
        if (section) {
            section.classList.add('active');
        }

        // Activar link correspondiente
        const link = document.querySelector(`[data-section="${sectionName}"]`);
        if (link) {
            link.classList.add('active');
        }

        currentSection = sectionName;

        // Cargar contenido de la sección
        this.loadSectionContent(sectionName);

        // Cerrar sidebar en móvil
        if (window.innerWidth <= 768) {
            document.getElementById('sidebar').classList.remove('open');
        }
    },

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
        bar.innerHTML = items.map(item => `
            <button type="button"
                    class="mobile-subnav-item ${item.id === activeId ? 'active' : ''}"
                    data-subnav-item="${item.id}"
                    onclick="Navigation.selectInternal('${sectionName}', '${item.id}')"
                    aria-label="${item.label}"
                    title="${item.label}">
                <i class="fas ${item.icon}"></i>
                <span>${item.label}</span>
            </button>
        `).join('');

        bar.classList.add('is-visible');
        document.body.classList.add('has-mobile-subnav');
        this.syncInternalSubnav(sectionName);
    },

    syncInternalSubnav(sectionName = currentSection) {
        const activeId = this.getInternalActive(sectionName);

        document.querySelectorAll('[data-subnav-item]').forEach(item => {
            item.classList.toggle('active', item.getAttribute('data-subnav-item') === activeId);
        });
    },

    async selectInternal(sectionName, itemId) {
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
                    Dashboard.filtrarPorZona(itemId);
                    break;
                case 'tables':
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
            this.handleServerEvent(event, false);
        });

        this.source.addEventListener('heartbeat', (event) => {
            this.handleServerEvent(event, false);
        });

        this.source.addEventListener('operation-change', (event) => {
            this.handleServerEvent(event, true);
        });

        this.source.onerror = () => {
            this.isConnected = false;
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
    },

    scheduleReconnect() {
        if (!currentUser || this.reconnectTimer) return;

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.disconnect(false);
            this.connect();
        }, 3500);
    },

    handleServerEvent(event, shouldRefresh) {
        const payload = this.parseEvent(event);
        if (!payload) return;

        if (payload.id && payload.id <= this.lastEventId) return;
        if (payload.id) this.lastEventId = payload.id;

        if (shouldRefresh) {
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

        try {
            if (typeof Dashboard !== 'undefined') {
                if (currentSection === 'dashboard') {
                    await Dashboard.refreshData({ source: 'realtime', silent: true });
                } else if (typeof Dashboard.markStale === 'function') {
                    Dashboard.markStale();
                }
            }

            if (currentSection === 'tables' && typeof Tables !== 'undefined') {
                await Tables.load();
                return;
            }

            if (currentSection === 'orders' && typeof Orders !== 'undefined') {
                await Orders.load();
                return;
            }

            if (currentSection === 'accounts' && typeof Accounts !== 'undefined') {
                await Accounts.load();
                return;
            }

            if (currentSection === 'menu' && scope === 'menu' && typeof Menu !== 'undefined') {
                await Menu.load();
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
        if (window.innerWidth > 768) {
            Navigation.closeSidebar();
        }
    });
});

// Funciones globales para acceso desde HTML
window.Utils = Utils;
window.Auth = Auth;
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
