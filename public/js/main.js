// Variables globales
let currentUser = null;
let currentSection = 'dashboard';

// API Base URL
const API_BASE = '/api';

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
    async confirm(message, title = 'Confirmar') {
        return new Promise((resolve) => {
            Utils.showModal(title, `<p>${message}</p>`, [
                {
                    text: 'Cancelar',
                    class: 'btn-light',
                    onclick: 'Utils.hideModal(); window.confirmResolve(false);'
                },
                {
                    text: 'Confirmar',
                    class: 'btn-primary',
                    onclick: 'Utils.hideModal(); window.confirmResolve(true);'
                }
            ]);
            
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
    // Verificar sesión
    async checkSession() {
        try {
            const response = await Utils.request('/auth/verify');
            if (response.authenticated) {
                currentUser = response.user;
                this.showApp();
                return true;
            } else {
                this.showLogin();
                return false;
            }
        } catch (error) {
            console.error('Error verificando sesión:', error);
            this.showLogin();
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
            this.showApp();
            loadRestaurantName();
            Utils.showNotification('Sesión iniciada correctamente', 'success');

            // ✅ Cargar datos del dashboard y activar autorefresco
            Dashboard.refreshData();         // Carga inicial
            Dashboard.startAutoRefresh();    // Activar auto-actualización solo con sesión activa

            return true;
        }
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

        Dashboard.stopAutoRefresh(); // ✅ Detener auto-refresh del dashboard
        this.showLogin();

        Utils.showNotification('Sesión cerrada correctamente', 'info');
    } catch (error) {
        console.error('Error cerrando sesión:', error);

        // Forzar logout local
        currentUser = null;

        Dashboard.stopAutoRefresh(); // ✅ También detener en caso de error
        this.showLogin();
    }
}
,

    // Mostrar pantalla de login
    showLogin() {
        document.getElementById('login-screen').style.display = 'flex';
        document.getElementById('main-app').style.display = 'none';
    },

    // Mostrar aplicación principal
    showApp() {
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('main-app').style.display = 'grid';
        
        // Actualizar información del usuario
        const currentUserElement = document.getElementById('current-user');
        const userTypeElement = document.getElementById('user-type');
        const usuarioActualElement = document.getElementById('usuario-actual');
        const tipoUsuarioElement = document.getElementById('tipo-usuario');
        
        if (currentUserElement) currentUserElement.textContent = currentUser.nombre;
        if (userTypeElement) userTypeElement.textContent = currentUser.tipo;
        if (usuarioActualElement) usuarioActualElement.textContent = currentUser.nombre;
        if (tipoUsuarioElement) tipoUsuarioElement.textContent = currentUser.tipo;

        // Cargar dashboard por defecto
        Navigation.showSection("dashboard");
        loadRestaurantName();
        updateGreeting();
    }
};

// Navegación
const Navigation = {
    // Mostrar sección
    showSection(sectionName) {
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
    toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        sidebar.classList.toggle('open');
    }
};

// Event Listeners
document.addEventListener('DOMContentLoaded', function() {
    // Verificar sesión al cargar
    Auth.checkSession();
    updateDateTime();
    updateGreeting();

    // Login form
    document.getElementById('login-form').addEventListener('submit', async function(e) {
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
        button.innerHTML = '<span class="loading"></span> Iniciando...';
        button.disabled = true;

        const success = await Auth.login(username, password);
        
        button.innerHTML = originalText;
        button.disabled = false;

        if (!success) {
            errorDiv.textContent = 'Usuario o contraseña incorrectos';
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
            const section = this.getAttribute('data-section');
            Navigation.showSection(section);
        });
    });

    // Dashboard cards navigation
    document.addEventListener('click', function(e) {
        const card = e.target.closest('.dashboard-card[data-navigate]');
        if (card) {
            const section = card.getAttribute('data-navigate');
            Navigation.showSection(section);
        }
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
                sidebar.classList.remove('open');
            }
        }
    });

    // Responsive sidebar
    window.addEventListener('resize', function() {
        if (window.innerWidth > 768) {
            document.getElementById('sidebar').classList.remove('open');
        }
    });
});

// Funciones globales para acceso desde HTML
window.Utils = Utils;
window.Auth = Auth;
window.Navigation = Navigation;



// Función para actualizar la fecha y hora
function updateDateTime() {
    const now = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: true };
    const dateTimeString = now.toLocaleString('es-CR', options);
    document.getElementById('current-datetime').textContent = dateTimeString;
}

// Actualizar cada segundo
setInterval(updateDateTime, 1000);


// Función para cargar y mostrar el nombre del restaurante y versión
async function loadRestaurantName() {
    try {
        const response = await Utils.request("/settings");
        const data = response.data;

        if (data.nombre_restaurante) {
            document.getElementById("restaurant-name").textContent = data.nombre_restaurante;
        }

        // ✅ Mostrar versión en el sidebar
        if (data.version_app) {
            const versionSpan = document.getElementById("app-version");
            if (versionSpan) {
                versionSpan.textContent = data.version_app;
            }
        }

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