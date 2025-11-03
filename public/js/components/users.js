// Users Component
const Users = {
    users: [],
    stats: null,

    // Cargar datos de usuarios
    async load() {
        try {
            // Solo administradores pueden acceder a gestión de usuarios
            if (currentUser.tipo !== 'administrador') {
                this.renderNoAccess();
                return;
            }

            const [usersResponse, statsResponse] = await Promise.all([
                Utils.request('/users'),
                Utils.request('/users/stats/summary')
            ]);
            
            this.users = usersResponse.data;
            this.stats = statsResponse.data;
            this.render();
        } catch (error) {
            console.error('Error cargando usuarios:', error);
            Utils.showNotification('Error cargando datos de usuarios', 'error');
        }
    },

    // Renderizar mensaje de no acceso
    renderNoAccess() {
        const section = document.getElementById('users-section');
        section.innerHTML = `
            <div class="section-header">
                <h2>Gestión de Usuarios</h2>
                <p>Administra los usuarios del sistema</p>
            </div>
            <div class="text-center mt-4">
                <i class="fas fa-lock" style="font-size: 3rem; color: var(--warning-color);"></i>
                <h3>Acceso Restringido</h3>
                <p>Solo los administradores pueden acceder a la gestión de usuarios.</p>
            </div>
        `;
    },

    // Renderizar sección de usuarios
    render() {
        const section = document.getElementById('users-section');
        
        section.innerHTML = `
            <div class="section-header">
                <h2>Gestión de Usuarios</h2>
                <p>Administra los usuarios del sistema</p>
            </div>

            <div class="mb-3">
                <!-- Línea 1: botones -->
                <div class="d-flex gap-2 flex-wrap mb-2">
                    <button class="btn btn-success" onclick="Users.showCreateUserModal()">
                        <i class="fas fa-plus"></i> Nuevo Usuario
                    </button>
                    <button class="btn btn-sm btn-secondary" onclick="Users.load()">
                        <i class="fas fa-sync"></i>
                    </button>
                    <button class="btn btn-info" onclick="Users.showChangePasswordModal()">
                        <i class="fas fa-key"></i> Cambiar Mi Contraseña
                    </button>
                </div>

                <!-- Línea 2: resumen -->
                <div class="users-summary">
                    ${this.renderSummary()}
                </div>
            </div>


            <div class="users-content">
                ${this.renderUsersTable()}
            </div>

            ${this.renderRecentUsers()}
        `;
    },

    // Renderizar resumen
    renderSummary() {
        if (!this.stats) return '';
        
        return `
            <div class="d-flex gap-3">
                <span class="badge badge-info">Total: ${this.stats.total_usuarios}</span>
                <span class="badge badge-success">Básicos: ${this.stats.usuarios_basicos}</span>
                <span class="badge badge-warning">Administradores: ${this.stats.administradores}</span>
            </div>
        `;
    },

    // Renderizar tabla de usuarios
    renderUsersTable() {
        if (this.users.length === 0) {
            return `
                <div class="table-container">
                    <p class="text-center">No hay usuarios registrados</p>
                </div>
            `;
        }

        return `
            <div class="table-container">
                <table class="table">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Nombre</th>
                            <th>Tipo</th>
                            <th>Estado</th>
                            <th>Fecha Creación</th>
                            <th>Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${this.users.map(user => `
                            <tr>
                                <td><strong>#${user.id}</strong></td>
                                <td>
                                    ${user.nombre}
                                    ${user.id === currentUser.id ? '<span class="badge badge-info">Tú</span>' : ''}
                                </td>
                                <td>
                                    <span class="badge badge-${user.tipo === 'administrador' ? 'warning' : 'info'}">
                                        ${user.tipo}
                                    </span>
                                </td>
                                <td>
                                    <span class="badge badge-${user.activo ? 'success' : 'danger'}">
                                        ${user.activo ? 'Activo' : 'Inactivo'}
                                    </span>
                                </td>
                                <td>${Utils.formatDate(user.fecha_creacion)}</td>
                                <td>
                                    <div class="d-flex gap-1">
                                        <button class="btn btn-secondary btn-sm" onclick="Users.showEditUserModal(${user.id})">
                                            <i class="fas fa-edit"></i>
                                        </button>
                                        ${user.id !== currentUser.id ? `
                                            <button class="btn btn-danger btn-sm" onclick="Users.deleteUser(${user.id})">
                                                <i class="fas fa-trash"></i>
                                            </button>
                                        ` : ''}
                                    </div>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    },

    // Renderizar usuarios recientes
    renderRecentUsers() {
        if (!this.stats || !this.stats.ultimos_usuarios || this.stats.ultimos_usuarios.length === 0) {
            return '';
        }

        return `
            <div class="recent-users mt-4">
                <h3>Usuarios Recientes</h3>
                <div class="table-container">
                    <table class="table">
                        <thead>
                            <tr>
                                <th>Nombre</th>
                                <th>Tipo</th>
                                <th>Fecha Creación</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${this.stats.ultimos_usuarios.map(user => `
                                <tr>
                                    <td>${user.nombre}</td>
                                    <td>
                                        <span class="badge badge-${user.tipo === 'administrador' ? 'warning' : 'info'}">
                                            ${user.tipo}
                                        </span>
                                    </td>
                                    <td>${Utils.formatDate(user.fecha_creacion)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    },

    // Mostrar modal para crear usuario
    showCreateUserModal() {
        Utils.showModal('Nuevo Usuario', `
            <form id="create-user-form">
                <div class="form-group">
                    <label for="user-nombre">Nombre de Usuario *</label>
                    <input type="text" id="user-nombre" name="nombre" required>
                    <small class="text-muted">El nombre debe ser único en el sistema</small>
                </div>
                <div class="form-group">
                    <label for="user-password">Contraseña *</label>
                    <input type="password" id="user-password" name="password" required minlength="6">
                    <small class="text-muted">Mínimo 6 caracteres</small>
                </div>
                <div class="form-group">
                    <label for="user-tipo">Tipo de Usuario *</label>
                    <select id="user-tipo" name="tipo" required>
                        <option value="">Seleccione tipo</option>
                        <option value="basico">Usuario Básico</option>
                        <option value="administrador">Administrador</option>
                    </select>
                </div>
                <div class="form-group">
                    <small class="text-muted">
                        <strong>Usuario Básico:</strong> Puede gestionar mesas, pedidos y cuentas.<br>
                        <strong>Administrador:</strong> Acceso completo al sistema incluyendo usuarios y configuración.
                    </small>
                </div>
            </form>
        `, [
            {
                text: 'Cancelar',
                class: 'btn-light'
            },
            {
                text: 'Crear Usuario',
                class: 'btn-success',
                onclick: 'Users.createUser()'
            }
        ]);
    },

    // Crear usuario
    async createUser() {
        const form = document.getElementById('create-user-form');
        if (!Utils.validateForm(form)) {
            Utils.showNotification('Por favor complete todos los campos requeridos', 'warning');
            return;
        }

        const formData = new FormData(form);
        const data = {
            nombre: formData.get('nombre'),
            password: formData.get('password'),
            tipo: formData.get('tipo')
        };

        if (data.password.length < 6) {
            Utils.showNotification('La contraseña debe tener al menos 6 caracteres', 'warning');
            return;
        }

        try {
            await Utils.request('/users', {
                method: 'POST',
                body: JSON.stringify(data)
            });

            Utils.hideModal();
            Utils.showNotification('Usuario creado exitosamente', 'success');
            this.load();
        } catch (error) {
            Utils.showNotification(error.message, 'error');
        }
    },

    // Mostrar modal para editar usuario
    showEditUserModal(userId) {
        const user = this.users.find(u => u.id === userId);
        if (!user) return;

        Utils.showModal('Editar Usuario', `
            <form id="edit-user-form">
                <div class="form-group">
                    <label for="edit-user-nombre">Nombre de Usuario *</label>
                    <input type="text" id="edit-user-nombre" name="nombre" value="${user.nombre}" required>
                </div>
                <div class="form-group">
                    <label for="edit-user-password">Nueva Contraseña</label>
                    <input type="password" id="edit-user-password" name="password" minlength="6">
                    <small class="text-muted">Dejar en blanco para mantener la contraseña actual</small>
                </div>
                <div class="form-group">
                    <label for="edit-user-tipo">Tipo de Usuario *</label>
                    <select id="edit-user-tipo" name="tipo" required>
                        <option value="basico" ${user.tipo === 'basico' ? 'selected' : ''}>Usuario Básico</option>
                        <option value="administrador" ${user.tipo === 'administrador' ? 'selected' : ''}>Administrador</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>
                        <input type="checkbox" id="edit-user-activo" name="activo" ${user.activo ? 'checked' : ''}>
                        Usuario Activo
                    </label>
                    ${user.id === currentUser.id ? '<small class="text-muted">No puedes desactivar tu propia cuenta</small>' : ''}
                </div>
            </form>
        `, [
            {
                text: 'Cancelar',
                class: 'btn-light'
            },
            {
                text: 'Guardar Cambios',
                class: 'btn-primary',
                onclick: `Users.updateUser(${userId})`
            }
        ]);

        // Deshabilitar checkbox de activo si es el usuario actual
        if (user.id === currentUser.id) {
            document.getElementById('edit-user-activo').disabled = true;
        }
    },

    // Actualizar usuario
    async updateUser(userId) {
        const form = document.getElementById('edit-user-form');
        if (!Utils.validateForm(form)) {
            Utils.showNotification('Por favor complete todos los campos requeridos', 'warning');
            return;
        }

        const formData = new FormData(form);
        const data = {
            nombre: formData.get('nombre'),
            tipo: formData.get('tipo'),
            activo: formData.get('activo') === 'on' ? 1 : 0
        };

        // Solo incluir contraseña si se proporcionó
        const password = formData.get('password');
        if (password) {
            if (password.length < 6) {
                Utils.showNotification('La contraseña debe tener al menos 6 caracteres', 'warning');
                return;
            }
            data.password = password;
        }

        try {
            await Utils.request(`/users/${userId}`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });

            Utils.hideModal();
            Utils.showNotification('Usuario actualizado exitosamente', 'success');
            this.load();
        } catch (error) {
            Utils.showNotification(error.message, 'error');
        }
    },

    // Eliminar usuario
    async deleteUser(userId) {
        const user = this.users.find(u => u.id === userId);
        if (!user) return;

        if (user.id === currentUser.id) {
            Utils.showNotification('No puedes eliminar tu propia cuenta', 'warning');
            return;
        }

        const confirmed = await Utils.confirm(
            `¿Está seguro de eliminar al usuario "${user.nombre}"?\n\nEsta acción no se puede deshacer.`,
            'Confirmar Eliminación'
        );

        if (!confirmed) return;

        try {
            await Utils.request(`/users/${userId}`, {
                method: 'DELETE'
            });

            Utils.showNotification('Usuario eliminado exitosamente', 'success');
            this.load();
        } catch (error) {
            Utils.showNotification(error.message, 'error');
        }
    },

    // Mostrar modal para cambiar contraseña
    showChangePasswordModal() {
        Utils.showModal('Cambiar Mi Contraseña', `
            <form id="change-password-form">
                <div class="form-group">
                    <label for="current-password">Contraseña Actual *</label>
                    <input type="password" id="current-password" name="current_password" required>
                </div>
                <div class="form-group">
                    <label for="new-password">Nueva Contraseña *</label>
                    <input type="password" id="new-password" name="new_password" required minlength="6">
                    <small class="text-muted">Mínimo 6 caracteres</small>
                </div>
                <div class="form-group">
                    <label for="confirm-password">Confirmar Nueva Contraseña *</label>
                    <input type="password" id="confirm-password" name="confirm_password" required minlength="6">
                </div>
            </form>
        `, [
            {
                text: 'Cancelar',
                class: 'btn-light'
            },
            {
                text: 'Cambiar Contraseña',
                class: 'btn-primary',
                onclick: 'Users.changePassword()'
            }
        ]);
    },

    // Cambiar contraseña
    async changePassword() {
        const form = document.getElementById('change-password-form');
        if (!Utils.validateForm(form)) {
            Utils.showNotification('Por favor complete todos los campos requeridos', 'warning');
            return;
        }

        const formData = new FormData(form);
        const currentPassword = formData.get('current_password');
        const newPassword = formData.get('new_password');
        const confirmPassword = formData.get('confirm_password');

        if (newPassword !== confirmPassword) {
            Utils.showNotification('Las contraseñas no coinciden', 'warning');
            return;
        }

        if (newPassword.length < 6) {
            Utils.showNotification('La nueva contraseña debe tener al menos 6 caracteres', 'warning');
            return;
        }

        const data = {
            current_password: currentPassword,
            new_password: newPassword
        };

        try {
            await Utils.request('/users/change-password', {
                method: 'PUT',
                body: JSON.stringify(data)
            });

            Utils.hideModal();
            Utils.showNotification('Contraseña cambiada exitosamente', 'success');
        } catch (error) {
            Utils.showNotification(error.message, 'error');
        }
    }
};

