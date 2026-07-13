// Users Component
const Users = {
    users: [],
    stats: null,
    workRoles: [],

    // Cargar datos de usuarios
    async load() {
        try {
            // Solo administradores pueden acceder a gestión de usuarios
            if (currentUser.tipo !== 'administrador') {
                this.renderNoAccess();
                return;
            }

            const [usersResponse, statsResponse, workRolesResponse] = await Promise.all([
                Utils.request('/users'),
                Utils.request('/users/stats/summary'),
                Utils.request('/users/work-roles')
            ]);

            this.users = usersResponse.data || [];
            this.stats = statsResponse.data || null;
            this.workRoles = workRolesResponse.data || [];
            this.render();
        } catch (error) {
            console.error('Error cargando usuarios:', error);
            Utils.showNotification('Error cargando datos de usuarios', 'error');
        }
    },

    escapeHtml(value = '') {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    },

    systemRoleLabel(tipo) {
        return tipo === 'administrador' ? 'Administrador' : 'Estándar';
    },

    roleIdsFromUser(user = {}) {
        return (Array.isArray(user.roles_trabajo) ? user.roles_trabajo : [])
            .map(role => Number(role.id))
            .filter(id => Number.isFinite(id) && id > 0);
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
            <div class="section-header users-premium-header">
                <div>
                    <h2>Gestión de Usuarios</h2>
                    <p>Administra el rol de sistema y los roles de trabajo permitidos para cada usuario.</p>
                </div>
                <div class="users-header-actions">
                    <button class="btn btn-success" onclick="Users.showCreateUserModal()">
                        <i class="fas fa-plus"></i> Nuevo Usuario
                    </button>
                    <button class="btn btn-sm btn-secondary" onclick="Users.load()" title="Actualizar usuarios">
                        <i class="fas fa-sync"></i>
                    </button>
                    <button class="btn btn-info" onclick="Users.showChangePasswordModal()">
                        <i class="fas fa-key"></i> Cambiar Mi Contraseña
                    </button>
                </div>
            </div>

            <div class="users-summary">
                ${this.renderSummary()}
            </div>

            ${this.renderWorkRoleReadiness()}

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
            <div class="users-summary-grid">
                <span class="badge badge-info">Total: ${this.stats.total_usuarios || 0}</span>
                <span class="badge badge-success">Estándar: ${this.stats.usuarios_basicos || 0}</span>
                <span class="badge badge-warning">Administradores: ${this.stats.administradores || 0}</span>
                <span class="badge badge-info">Con roles: ${this.stats.usuarios_con_roles || 0}</span>
                ${Number(this.stats.usuarios_estandar_sin_roles || 0) > 0 ? `<span class="badge badge-danger">Estándar sin roles: ${this.stats.usuarios_estandar_sin_roles}</span>` : ''}
            </div>
        `;
    },

    renderWorkRoleReadiness() {
        const activeRoles = this.workRoles.filter(role => Number(role.activo) === 1 && Number(role.zonas_activas || 0) > 0);

        if (activeRoles.length) {
            return `
                <div class="users-workrole-note ok">
                    <i class="fas fa-user-tag"></i>
                    <span>${activeRoles.length} rol(es) de trabajo disponibles para asignar a usuarios estándar.</span>
                </div>
            `;
        }

        return `
            <div class="users-workrole-note warning">
                <i class="fas fa-triangle-exclamation"></i>
                <span>Antes de crear usuarios estándar, crea al menos un rol de trabajo activo con zonas activas desde el módulo Zonas.</span>
            </div>
        `;
    },

    renderWorkRoleChips(user = {}) {
        const roles = Array.isArray(user.roles_trabajo) ? user.roles_trabajo : [];
        if (!roles.length) {
            return '<span class="user-role-empty">Sin rol de trabajo</span>';
        }

        return `
            <div class="user-work-role-chips">
                ${roles.map(role => `
                    <span class="user-work-role-chip ${Number(role.activo) === 1 && Number(role.zonas_activas || 0) > 0 ? '' : 'is-warning'}">
                        <i class="fas fa-user-tag"></i>
                        ${this.escapeHtml(role.nombre)}
                    </span>
                `).join('')}
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
            <div class="table-container users-table-container">
                <table class="table users-table">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Usuario</th>
                            <th>Rol de sistema</th>
                            <th>Roles de trabajo</th>
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
                                    <strong>${this.escapeHtml(user.nombre)}</strong>
                                    ${user.id === currentUser.id ? '<span class="badge badge-info">Tú</span>' : ''}
                                </td>
                                <td>
                                    <span class="badge badge-${user.tipo === 'administrador' ? 'warning' : 'info'}">
                                        ${this.systemRoleLabel(user.tipo)}
                                    </span>
                                </td>
                                <td>${this.renderWorkRoleChips(user)}</td>
                                <td>
                                    <span class="badge badge-${user.activo ? 'success' : 'danger'}">
                                        ${user.activo ? 'Activo' : 'Inactivo'}
                                    </span>
                                </td>
                                <td>${Utils.formatDate(user.fecha_creacion)}</td>
                                <td>
                                    <div class="d-flex gap-1 users-action-buttons">
                                        <button class="btn btn-secondary btn-sm" onclick="Users.showEditUserModal(${Number(user.id)})">
                                            <i class="fas fa-edit"></i>
                                        </button>
                                        ${user.id !== currentUser.id ? `
                                            <button class="btn btn-danger btn-sm" onclick="Users.deleteUser(${Number(user.id)})">
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
                                <th>Rol de sistema</th>
                                <th>Fecha Creación</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${this.stats.ultimos_usuarios.map(user => `
                                <tr>
                                    <td>${this.escapeHtml(user.nombre)}</td>
                                    <td>
                                        <span class="badge badge-${user.tipo === 'administrador' ? 'warning' : 'info'}">
                                            ${this.systemRoleLabel(user.tipo)}
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

    renderWorkRolePicker(selectedIds = [], formPrefix = 'user') {
        const selected = new Set((selectedIds || []).map(id => Number(id)));
        const roles = this.workRoles || [];

        if (!roles.length) {
            return `
                <div class="user-work-role-picker empty">
                    <div class="users-workrole-note warning compact">
                        <i class="fas fa-triangle-exclamation"></i>
                        <span>No hay roles de trabajo creados. Los usuarios estándar requieren al menos uno.</span>
                    </div>
                </div>
            `;
        }

        return `
            <div class="user-work-role-picker">
                <div class="user-work-role-picker-title">
                    <strong>Roles de trabajo</strong>
                    <span>Selecciona las zonas operativas permitidas para este usuario.</span>
                </div>
                <div class="user-work-role-options">
                    ${roles.map(role => {
                        const isUsable = Number(role.activo) === 1 && Number(role.zonas_activas || 0) > 0;
                        return `
                            <label class="user-work-role-option ${isUsable ? '' : 'is-disabled'}">
                                <input type="checkbox"
                                       name="roles_trabajo_ids"
                                       value="${Number(role.id)}"
                                       ${selected.has(Number(role.id)) ? 'checked' : ''}
                                       ${isUsable ? '' : 'disabled'}
                                       onchange="Users.syncWorkRoleHint('${formPrefix}')">
                                <span>
                                    <strong>${this.escapeHtml(role.nombre)}</strong>
                                    <small>${this.escapeHtml(role.zonas_nombre || 'Sin zonas activas')}</small>
                                </span>
                            </label>
                        `;
                    }).join('')}
                </div>
                <small class="text-muted" data-work-role-hint-for="${formPrefix}"></small>
            </div>
        `;
    },

    syncWorkRoleHint(formPrefix) {
        const form = document.getElementById(formPrefix);
        if (!form) return;

        const tipo = form.querySelector('[name="tipo"]')?.value || 'basico';
        const selectedCount = form.querySelectorAll('input[name="roles_trabajo_ids"]:checked').length;
        const hint = form.querySelector(`[data-work-role-hint-for="${formPrefix}"]`);
        if (!hint) return;

        if (tipo === 'administrador') {
            hint.textContent = selectedCount
                ? 'El administrador también tendrá estos roles operativos disponibles.'
                : 'Los administradores pueden quedar sin roles de trabajo.';
            hint.className = 'text-muted';
            return;
        }

        if (selectedCount === 0) {
            hint.textContent = 'Los usuarios estándar deben tener al menos un rol de trabajo.';
            hint.className = 'text-danger';
        } else {
            hint.textContent = `${selectedCount} rol(es) de trabajo seleccionado(s).`;
            hint.className = 'text-muted';
        }
    },

    getSelectedWorkRoleIds(form) {
        return Array.from(form.querySelectorAll('input[name="roles_trabajo_ids"]:checked'))
            .map(input => Number(input.value))
            .filter(id => Number.isFinite(id) && id > 0);
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
                    <label for="user-tipo">Rol de sistema *</label>
                    <select id="user-tipo" name="tipo" required onchange="Users.syncWorkRoleHint('create-user-form')">
                        <option value="">Seleccione rol</option>
                        <option value="basico">Usuario Estándar</option>
                        <option value="administrador">Administrador</option>
                    </select>
                </div>
                ${this.renderWorkRolePicker([], 'create-user-form')}
                <div class="form-group">
                    <small class="text-muted">
                        <strong>Usuario Estándar:</strong> opera puestos según sus roles de trabajo.<br>
                        <strong>Administrador:</strong> acceso completo al sistema y puede quedar sin roles operativos.
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
        ], 'modal-user-roles');

        this.syncWorkRoleHint('create-user-form');
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
            tipo: formData.get('tipo'),
            roles_trabajo_ids: this.getSelectedWorkRoleIds(form)
        };

        if (data.password.length < 6) {
            Utils.showNotification('La contraseña debe tener al menos 6 caracteres', 'warning');
            return;
        }

        if (data.tipo === 'basico' && data.roles_trabajo_ids.length === 0) {
            Utils.showNotification('Los usuarios estándar deben tener al menos un rol de trabajo', 'warning');
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
        const user = this.users.find(u => Number(u.id) === Number(userId));
        if (!user) return;

        Utils.showModal('Editar Usuario', `
            <form id="edit-user-form">
                <div class="form-group">
                    <label for="edit-user-nombre">Nombre de Usuario *</label>
                    <input type="text" id="edit-user-nombre" name="nombre" value="${this.escapeHtml(user.nombre)}" required>
                </div>
                <div class="form-group">
                    <label for="edit-user-password">Nueva Contraseña</label>
                    <input type="password" id="edit-user-password" name="password" minlength="6">
                    <small class="text-muted">Dejar en blanco para mantener la contraseña actual</small>
                </div>
                <div class="form-group">
                    <label for="edit-user-tipo">Rol de sistema *</label>
                    <select id="edit-user-tipo" name="tipo" required onchange="Users.syncWorkRoleHint('edit-user-form')">
                        <option value="basico" ${user.tipo === 'basico' ? 'selected' : ''}>Usuario Estándar</option>
                        <option value="administrador" ${user.tipo === 'administrador' ? 'selected' : ''}>Administrador</option>
                    </select>
                </div>
                ${this.renderWorkRolePicker(this.roleIdsFromUser(user), 'edit-user-form')}
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
                onclick: `Users.updateUser(${Number(userId)})`
            }
        ], 'modal-user-roles');

        // Deshabilitar checkbox de activo si es el usuario actual
        if (user.id === currentUser.id) {
            document.getElementById('edit-user-activo').disabled = true;
        }

        this.syncWorkRoleHint('edit-user-form');
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
            activo: formData.get('activo') === 'on' ? 1 : 0,
            roles_trabajo_ids: this.getSelectedWorkRoleIds(form)
        };

        if (data.tipo === 'basico' && data.roles_trabajo_ids.length === 0) {
            Utils.showNotification('Los usuarios estándar deben tener al menos un rol de trabajo', 'warning');
            return;
        }

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
            await Utils.request(`/users/${Number(userId)}`, {
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
        const user = this.users.find(u => Number(u.id) === Number(userId));
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
            await Utils.request(`/users/${Number(userId)}`, {
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
