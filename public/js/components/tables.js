// Tables Component
const Tables = {
    data: [],
    structure: { zonas: [], tipos_puesto: [], roles_trabajo: [], compatibilidad: null },

    // Cargar datos de mesas
    async load() {
        try {
            const [tablesResponse, structureResponse] = await Promise.all([
                Utils.request('/tables'),
                Utils.request('/tables/structure')
            ]);

            this.data = tablesResponse.data || [];
            this.structure = structureResponse.data || { zonas: [], tipos_puesto: [], roles_trabajo: [], compatibilidad: null };
            this.render();
        } catch (error) {
            console.error('Error cargando zonas:', error);
            Utils.showNotification('Error cargando datos de zonas', 'error');
        }
    },

    isAdmin() {
        const tipo = String(currentUser?.tipo || '').trim().toLowerCase();
        return tipo === 'administrador' || tipo === 'admin';
    },

    escapeHtml(value = '') {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    },

    activeZones() {
        return (this.structure?.zonas || []).filter(zone => Number(zone.activa) === 1);
    },

    activeSeatTypes() {
        return (this.structure?.tipos_puesto || []).filter(type => Number(type.activo) === 1);
    },

    getZoneById(id) {
        return (this.structure?.zonas || []).find(zone => Number(zone.id) === Number(id));
    },

    getSeatTypeById(id) {
        return (this.structure?.tipos_puesto || []).find(type => Number(type.id) === Number(id));
    },

    getWorkRoleById(id) {
        return (this.structure?.roles_trabajo || []).find(role => Number(role.id) === Number(id));
    },

    formatBooleanLabel(value, trueLabel = 'Sí', falseLabel = 'No') {
        return Number(value) === 1 ? trueLabel : falseLabel;
    },

    safeCssColor(value) {
        const color = String(value || '').trim();
        if (/^#[0-9a-fA-F]{3,8}$/.test(color)) return color;
        return null;
    },

    getZoneKeyForSeat(mesa = {}) {
        const dynamicId = Number(mesa.zona_dinamica_id || mesa.zona_id || 0);
        if (dynamicId > 0) return `zona-${dynamicId}`;

        const zonaSlug = String(mesa.zona_slug || mesa.zona || 'salon').trim().toLowerCase();
        const tipoSlug = String(mesa.tipo_puesto_slug || mesa.tipo_asiento || 'mesa').trim().toLowerCase();

        if (zonaSlug === 'barra' || (zonaSlug === 'bar' && tipoSlug === 'banco')) return 'bar-banco';
        if (zonaSlug === 'bar') return 'bar-mesa';
        return 'salon';
    },

    getSeatTypeClass(mesa = {}) {
        const tipoSlug = String(mesa.tipo_puesto_slug || mesa.tipo_asiento || 'mesa').trim().toLowerCase();
        const zoneKey = this.getZoneKeyForSeat(mesa);

        if (tipoSlug === 'banco' || zoneKey === 'bar-banco') return 'tipo-bar-banco';
        if (zoneKey === 'salon') return 'tipo-salon';
        return 'tipo-bar-mesa';
    },

    getZoneNameForSeat(mesa = {}) {
        const zone = this.getZoneById(mesa.zona_dinamica_id || mesa.zona_id);
        if (zone?.nombre) return zone.nombre;
        if (mesa.zona_nombre) return mesa.zona_nombre;

        const zoneKey = this.getZoneKeyForSeat(mesa);
        if (zoneKey === 'bar-banco') return 'Barra';
        if (zoneKey === 'bar-mesa') return 'Bar';
        return 'Salón';
    },

    getSeatTypeNameForSeat(mesa = {}) {
        const type = this.getSeatTypeById(mesa.tipo_puesto_dinamico_id || mesa.tipo_puesto_id);
        if (type?.nombre) return type.nombre;
        if (mesa.tipo_puesto_nombre) return mesa.tipo_puesto_nombre;

        const tipoSlug = String(mesa.tipo_puesto_slug || mesa.tipo_asiento || 'mesa').trim().toLowerCase();
        return tipoSlug === 'banco' ? 'Banco' : 'Mesa';
    },

    getOperationalZones() {
        const zonesByKey = new Map();
        const pushZone = (zone) => {
            if (!zone) return;
            const id = Number(zone.id || zone.zona_id || 0);
            const key = id > 0 ? `zona-${id}` : String(zone.key || zone.id || '').trim();
            if (!key || key === 'todos' || zonesByKey.has(key)) return;

            zonesByKey.set(key, {
                id: key,
                zoneId: id,
                label: zone.nombre || zone.label || 'Zona',
                icon: zone.icono || zone.icon || 'fa-location-dot',
                color: zone.color || '#3498db',
                orden: Number(zone.orden || 0),
                puestos_total: Number(zone.puestos_total || 0)
            });
        };

        (this.structure?.zonas || [])
            .filter(zone => Number(zone.activa ?? 1) === 1)
            .forEach(pushZone);

        (this.data || []).forEach(mesa => {
            const key = this.getZoneKeyForSeat(mesa);
            if (zonesByKey.has(key)) return;
            zonesByKey.set(key, {
                id: key,
                zoneId: Number(mesa.zona_dinamica_id || mesa.zona_id || 0),
                label: this.getZoneNameForSeat(mesa),
                icon: mesa.zona_icono || 'fa-location-dot',
                color: mesa.zona_color || '#3498db',
                orden: 999,
                puestos_total: 0
            });
        });

        return Array.from(zonesByKey.values()).sort((a, b) => {
            const orderDiff = Number(a.orden || 0) - Number(b.orden || 0);
            if (orderDiff !== 0) return orderDiff;
            return String(a.label || '').localeCompare(String(b.label || ''), 'es');
        });
    },

    getInternalNavItems() {
        return this.getMobileOrderedZoneItems().map(zone => ({
            id: zone.id,
            label: zone.label,
            icon: zone.icon || 'fa-layer-group'
        }));
    },

    getMobileOrderedZoneItems() {
        const zones = [
            { id: 'todos', label: 'Todos', icon: 'fa-border-all', color: '#203247' },
            ...this.getOperationalZones()
        ];

        const allZone = zones[0];
        const zoneItems = zones.filter(zone => zone.id !== allZone.id);
        const validIds = new Set(zoneItems.map(zone => zone.id));
        const priorityIds = [];

        const pushPriority = (id) => {
            if (!id || !validIds.has(id) || priorityIds.includes(id)) return;
            priorityIds.push(id);
        };

        this.getMobileOperationalPriorityZoneIds(zoneItems).forEach(pushPriority);
        this.getStoredMobilePriorityZoneIds().forEach(pushPriority);

        const activeId = this.filtroTipo || 'todos';
        if (activeId !== allZone.id) pushPriority(activeId);

        const priorityZones = priorityIds.map(id => zoneItems.find(zone => zone.id === id)).filter(Boolean);
        const remainingZones = zoneItems.filter(zone => !priorityIds.includes(zone.id));

        return [allZone, ...priorityZones, ...remainingZones];
    },

    getMobilePriorityStorageKey() {
        const userId = (typeof currentUser !== 'undefined' && currentUser) ? (currentUser.id || currentUser.nombre || 'anon') : 'anon';
        return `mundipos.tables.mobileZonePriority.${userId}`;
    },

    getStoredMobilePriorityZoneIds() {
        try {
            const raw = localStorage.getItem(this.getMobilePriorityStorageKey());
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
        } catch (error) {
            return [];
        }
    },

    rememberMobileZonePriority(zoneId) {
        if (!zoneId || zoneId === 'todos') return;

        const validIds = new Set(this.getOperationalZones().map(zone => zone.id));
        if (!validIds.has(zoneId)) return;

        try {
            const current = this.getStoredMobilePriorityZoneIds().filter(id => id !== zoneId);
            const next = [zoneId, ...current].slice(0, 12);
            localStorage.setItem(this.getMobilePriorityStorageKey(), JSON.stringify(next));
        } catch (error) {
            // Sin almacenamiento local se conserva el orden operativo calculado.
        }
    },

    getMobileOperationalPriorityZoneIds(zoneItems = []) {
        const validIds = new Set(zoneItems.map(zone => zone.id));
        const zonesByFirstActivity = new Map();

        (this.data || []).forEach((mesa, index) => {
            const estado = String(mesa.estado || '').toLowerCase();
            const isActive = estado === 'ocupada' || estado === 'reservada';
            const canOperate = Number(mesa.puede_operar || 0) === 1 || Number(mesa.soy_responsable || 0) === 1;
            if (!isActive || !canOperate) return;

            const zoneId = this.getZoneKeyForSeat(mesa);
            if (!validIds.has(zoneId)) return;

            const parsed = mesa.fecha_apertura ? Date.parse(mesa.fecha_apertura) : NaN;
            const timestamp = Number.isFinite(parsed) ? parsed : Date.now() + index;
            const previous = zonesByFirstActivity.get(zoneId);
            if (!previous || timestamp < previous.timestamp) {
                zonesByFirstActivity.set(zoneId, { id: zoneId, timestamp });
            }
        });

        return Array.from(zonesByFirstActivity.values())
            .sort((a, b) => a.timestamp - b.timestamp)
            .map(item => item.id);
    },

    normalizeActiveFilter() {
        const validIds = new Set(['todos', ...this.getOperationalZones().map(zone => zone.id)]);
        if (!validIds.has(this.filtroTipo)) {
            this.filtroTipo = 'todos';
        }
    },

    getCurrentFilterLabel() {
        if (!this.filtroTipo || this.filtroTipo === 'todos') return 'Todos';
        const zone = this.getOperationalZones().find(item => item.id === this.filtroTipo);
        return zone?.label || 'Zona';
    },

    getOperationalSummary() {
        const seats = this.getFilteredSeats();
        const countState = (state) => seats.filter(mesa => String(mesa.estado || '').toLowerCase() === state).length;
        const activeMine = seats.filter(mesa => Number(mesa.soy_responsable || 0) === 1 && ['ocupada', 'reservada'].includes(String(mesa.estado || '').toLowerCase())).length;
        const activeAssigned = seats.filter(mesa => Number(mesa.puede_operar || 0) !== 1 && ['ocupada', 'reservada'].includes(String(mesa.estado || '').toLowerCase())).length;

        return {
            total: seats.length,
            libres: countState('libre'),
            ocupadas: countState('ocupada'),
            reservadas: countState('reservada'),
            propias: activeMine,
            bloqueadas: activeAssigned
        };
    },

    renderZoneFilters() {
        const zones = this.getMobileOrderedZoneItems();
        return `
            <div class="btn-filtro-zonas internal-tabs zones-operation-tabs" aria-label="Filtros dinámicos de zonas">
                ${zones.map(zone => {
                    const color = this.safeCssColor(zone.color);
                    const style = color ? ` style="--zone-filter-color:${color}"` : '';
                    return `
                        <button class="btn btn-zona ${this.filtroTipo === zone.id ? 'active' : ''}"
                                data-tipo="${this.escapeHtml(zone.id)}"
                                data-subnav-item="${this.escapeHtml(zone.id)}"
                                onclick="Navigation.selectInternal('tables', '${this.escapeHtml(zone.id)}')"
                                title="${this.escapeHtml(zone.label)}"${style}>
                            <i class="fas ${this.escapeHtml(zone.icon || 'fa-layer-group')}"></i> ${this.escapeHtml(zone.label)}
                        </button>
                    `;
                }).join('')}
            </div>
        `;
    },

    renderOperationSummary(summary = this.getOperationalSummary()) {
        return `
            <div class="zones-operation-summary" aria-label="Resumen operativo de zonas">
                <span class="zone-summary-chip total"><i class="fas fa-layer-group"></i> ${summary.total} puestos</span>
                <span class="zone-summary-chip libre"><i class="fas fa-circle-check"></i> ${summary.libres} libres</span>
                <span class="zone-summary-chip ocupada"><i class="fas fa-fire"></i> ${summary.ocupadas} ocupadas</span>
                <span class="zone-summary-chip reservada"><i class="fas fa-clock"></i> ${summary.reservadas} reservadas</span>
                ${summary.propias ? `<span class="zone-summary-chip mine"><i class="fas fa-user-check"></i> ${summary.propias} a tu cargo</span>` : ''}
                ${summary.bloqueadas && !this.isAdmin() ? `<span class="zone-summary-chip locked"><i class="fas fa-lock"></i> ${summary.bloqueadas} asignadas</span>` : ''}
            </div>
        `;
    },

    renderOperationHero() {
        const zoneLabel = this.getCurrentFilterLabel();
        return `
            <section class="zones-operation-shell">
                <div class="zones-operation-header">
                    <div>
                        <span class="zones-admin-eyebrow">Operación de puestos</span>
                        <h3>${this.escapeHtml(zoneLabel)}</h3>
                        <p>Abre, reserva y atiende los puestos permitidos para tus roles activos.</p>
                    </div>
                    ${this.isAdmin() ? `
                        <button class="btn btn-success zones-new-seat-btn" onclick="Tables.showCreateModal()">
                            <i class="fas fa-plus"></i> Nuevo puesto
                        </button>
                    ` : ''}
                </div>
                ${this.renderZoneFilters()}
                ${this.renderOperationSummary()}
                <div class="internal-view-panel" data-internal-panel="tables">
                    <div class="mesas-grid zones-premium-grid">
                        ${this.renderMesasGrid()}
                    </div>
                </div>
            </section>
        `;
    },

    // Renderizar sección de mesas
    render() {
        const section = document.getElementById('tables-section');
        if (!section) return;

        this.filtroTipo = this.filtroTipo || 'todos';
        this.normalizeActiveFilter();

        section.innerHTML = `
            <div class="section-header zones-premium-hero">
                <div>
                    <span class="zones-admin-eyebrow">Módulo operativo</span>
                    <h2>Gestión de Zonas</h2>
                    <p>Administra la estructura física y opera los puestos por zona, rol y responsabilidad.</p>
                </div>
                <div class="zones-premium-hero-badge">
                    <i class="fas fa-shield-halved"></i>
                    <span>${this.isAdmin() ? 'Administración + operación' : 'Operación asignada'}</span>
                </div>
            </div>

            ${this.renderStructureAdminPanel()}
            ${this.renderOperationHero()}
        `;
    },

    renderStructureAdminPanel() {
    if (!this.isAdmin()) {
        return `
            <div class="zones-structure-note">
                <i class="fas fa-lock"></i>
                <span>Vista operativa: puedes trabajar con los puestos disponibles. La estructura del local la administra un usuario administrador.</span>
            </div>
        `;
    }

    const zonas = this.structure?.zonas || [];
    const tipos = this.structure?.tipos_puesto || [];
    const roles = this.structure?.roles_trabajo || [];
    const compatibility = this.structure?.compatibilidad;

    return `
        <section class="zones-admin-shell">
            <div class="zones-admin-header">
                <div>
                    <span class="zones-admin-eyebrow">Estructura del local</span>
                    <h3>Zonas, tipos y roles de trabajo</h3>
                    <p>Configura locaciones, tipos de puesto y roles operativos vinculados a zonas reales.</p>
                </div>
                <div class="zones-admin-actions">
                    <button class="btn btn-primary" onclick="Tables.showZoneFormModal()">
                        <i class="fas fa-map-location-dot"></i> Nueva zona
                    </button>
                    <button class="btn btn-light" onclick="Tables.showSeatTypeFormModal()">
                        <i class="fas fa-couch"></i> Nuevo tipo
                    </button>
                    <button class="btn btn-light" onclick="Tables.showWorkRoleFormModal()">
                        <i class="fas fa-user-tag"></i> Nuevo rol
                    </button>
                </div>
            </div>

            <div class="zones-admin-grid">
                <div class="zones-admin-column">
                    <div class="zones-admin-column-title">
                        <strong>Zonas</strong>
                        <span>${zonas.length}</span>
                    </div>
                    <div class="zones-admin-list">
                        ${zonas.length ? zonas.map(zone => this.renderZoneAdminCard(zone)).join('') : '<p class="zones-empty-admin">No hay zonas configuradas.</p>'}
                    </div>
                </div>

                <div class="zones-admin-column">
                    <div class="zones-admin-column-title">
                        <strong>Tipos de puesto</strong>
                        <span>${tipos.length}</span>
                    </div>
                    <div class="zones-admin-list">
                        ${tipos.length ? tipos.map(type => this.renderSeatTypeAdminCard(type)).join('') : '<p class="zones-empty-admin">No hay tipos de puesto configurados.</p>'}
                    </div>
                </div>

                <div class="zones-admin-column">
                    <div class="zones-admin-column-title">
                        <strong>Roles de trabajo</strong>
                        <span>${roles.length}</span>
                    </div>
                    <div class="zones-admin-list">
                        ${roles.length ? roles.map(role => this.renderWorkRoleAdminCard(role)).join('') : '<p class="zones-empty-admin">No hay roles de trabajo configurados.</p>'}
                    </div>
                </div>
            </div>

            ${compatibility ? `
                <div class="zones-compatibility ${compatibility.ok ? 'ok' : 'warning'}">
                    <i class="fas ${compatibility.ok ? 'fa-circle-check' : 'fa-triangle-exclamation'}"></i>
                    <span>${compatibility.ok ? 'Modelo dinámico compatible' : 'Compatibilidad requiere revisión'} · ${Number(compatibility.summary?.puestos_activos || 0)} puestos activos</span>
                </div>
            ` : ''}
        </section>
    `;
},

    renderZoneAdminCard(zone) {
    const zoneName = this.escapeHtml(zone.nombre);
    return `
        <article class="zone-admin-card ${Number(zone.activa) === 1 ? '' : 'is-inactive'}">
            <div class="zone-admin-icon" style="--zone-color:${this.escapeHtml(zone.color || '#3498db')}">
                <i class="fas ${this.escapeHtml(zone.icono || 'fa-location-dot')}"></i>
            </div>
            <div class="zone-admin-info">
                <strong>${zoneName}</strong>
                <small>${Number(zone.puestos_total || 0)} puestos · orden ${Number(zone.orden || 0)}</small>
                <div class="zone-admin-badges">
                    <span>${this.formatBooleanLabel(zone.acepta_reservas, 'Reserva', 'Sin reserva')}</span>
                    <span>${this.formatBooleanLabel(zone.aplica_servicio, `${Number(zone.porcentaje_servicio || 10)}% servicio`, 'Sin servicio')}</span>
                    <span>${this.formatBooleanLabel(zone.visible_dashboard, 'Dashboard', 'Oculta')}</span>
                    <span>${this.formatBooleanLabel(zone.activa, 'Activa', 'Inactiva')}</span>
                </div>
            </div>
            <button class="btn btn-light btn-sm" onclick="Tables.showZoneFormModal(${Number(zone.id)})">
                <i class="fas fa-pen"></i>
            </button>
        </article>
    `;
},

    renderSeatTypeAdminCard(type) {
    return `
        <article class="zone-admin-card ${Number(type.activo) === 1 ? '' : 'is-inactive'}">
            <div class="zone-admin-icon type-icon">
                <i class="fas ${this.escapeHtml(type.icono || 'fa-chair')}"></i>
            </div>
            <div class="zone-admin-info">
                <strong>${this.escapeHtml(type.nombre)}</strong>
                <small>${Number(type.puestos_total || 0)} puestos · orden ${Number(type.orden || 0)}</small>
                <div class="zone-admin-badges">
                    <span>${this.formatBooleanLabel(type.activo, 'Activo', 'Inactivo')}</span>
                    <span>${this.escapeHtml(type.slug || '')}</span>
                </div>
            </div>
            <button class="btn btn-light btn-sm" onclick="Tables.showSeatTypeFormModal(${Number(type.id)})">
                <i class="fas fa-pen"></i>
            </button>
        </article>
    `;
},

    renderWorkRoleAdminCard(role) {
    const zonas = Array.isArray(role.zonas) ? role.zonas : [];
    const activeZones = zonas.filter(zone => Number(zone.activa) === 1);
    const zoneNames = zonas.length
        ? zonas.map(zone => this.escapeHtml(zone.nombre)).join(' · ')
        : 'Sin zonas asignadas';

    return `
        <article class="zone-admin-card work-role-card ${Number(role.activo) === 1 && activeZones.length ? '' : 'is-inactive'}">
            <div class="zone-admin-icon role-icon">
                <i class="fas fa-user-tag"></i>
            </div>
            <div class="zone-admin-info">
                <strong>${this.escapeHtml(role.nombre)}</strong>
                <small>${zoneNames}</small>
                <div class="zone-admin-badges">
                    <span>${this.formatBooleanLabel(role.activo, 'Activo', 'Inactivo')}</span>
                    <span>${Number(activeZones.length)} zonas activas</span>
                    ${Number(activeZones.length) === 0 ? '<span class="warning-chip">Requiere zona activa</span>' : ''}
                </div>
            </div>
            <button class="btn btn-light btn-sm" onclick="Tables.showWorkRoleFormModal(${Number(role.id)})">
                <i class="fas fa-pen"></i>
            </button>
        </article>
    `;
},

    getFilteredSeats() {
    const filtro = this.filtroTipo || 'todos';
    let seats = [...this.data];

    if (filtro !== 'todos') {
        seats = seats.filter(mesa => this.getZoneKeyForSeat(mesa) === filtro);
    }

    return seats;
},



    //Filtrar por Zona
    filtrarPorZona(zonaSeleccionada) {
    this.filtroTipo = zonaSeleccionada || 'todos';
    this.normalizeActiveFilter();
    this.rememberMobileZonePriority(this.filtroTipo);

    this.render();
    Navigation.syncInternalSubnav('tables');
},

    // Renderizar grid de puestos
    renderMesasGrid() {
    if (this.data.length === 0) {
        return '<div class="zones-empty-operation"><i class="fas fa-chair"></i><span>No hay puestos configurados.</span></div>';
    }

    const puestos = this.getFilteredSeats();

    if (puestos.length === 0) {
        return `<div class="zones-empty-operation"><i class="fas fa-filter"></i><span>No hay puestos para ${this.escapeHtml(this.getCurrentFilterLabel())}.</span></div>`;
    }

    const getActionLabel = (mesa) => {
        const estado = String(mesa.estado || '').toLowerCase();
        if (estado === 'libre') return 'Abrir / Reservar';
        if (estado === 'ocupada') return Number(mesa.puede_operar || 0) === 1 || this.isAdmin() ? 'Agregar productos' : 'Responsable asignado';
        if (estado === 'reservada') return Number(mesa.puede_operar || 0) === 1 || this.isAdmin() ? 'Crear pedido' : 'Responsable asignado';
        return 'Ver puesto';
    };

    const renderCard = (mesa) => {
        const tipoSlug = String(mesa.tipo_puesto_slug || mesa.tipo_asiento || 'mesa').toLowerCase();
        const tipoNombre = this.getSeatTypeNameForSeat(mesa);
        const zonaNombre = this.getZoneNameForSeat(mesa);
        const tipoClase = this.getSeatTypeClass(mesa);
        const zoneColor = this.safeCssColor(mesa.zona_color || this.getZoneById(mesa.zona_dinamica_id || mesa.zona_id)?.color || '');
        const zoneStyle = zoneColor ? ` style="--mesa-zone-color:${zoneColor}"` : '';

        const estadoClase = mesa.estado === 'reservada' ? 'reservada' : mesa.estado;
        const estadoTexto = String(mesa.estado || '').toUpperCase();
        const puestoTitulo = mesa.nombre_visible || `${tipoNombre} ${mesa.numero}`;
        const puedeOperar = Number(mesa.puede_operar || 0) === 1 || this.isAdmin() || String(mesa.estado || '').toLowerCase() === 'libre';
        const assignedText = !puedeOperar && mesa.estado !== 'libre'
            ? '<span class="mesa-responsable-chip locked"><i class="fas fa-lock"></i> Responsable asignado</span>'
            : Number(mesa.soy_responsable || 0) === 1
                ? '<span class="mesa-responsable-chip mine"><i class="fas fa-user-check"></i> A tu cargo</span>'
                : '';

        return `
        <div class="mesa-card zones-premium-card ${estadoClase} ${tipoClase} ${puedeOperar ? '' : 'is-assigned-other'}" onclick="Tables.handleMesaClick(${mesa.id})"${zoneStyle}>
            <div class="mesa-zone-badge">
                <i class="fas ${this.escapeHtml(mesa.zona_icono || this.getZoneById(mesa.zona_dinamica_id || mesa.zona_id)?.icono || 'fa-location-dot')}"></i>
                ${this.escapeHtml(zonaNombre)} / ${this.escapeHtml(tipoNombre)}
            </div>
            <div class="mesa-numero">
                ${this.escapeHtml(puestoTitulo)}
            </div>
            <div class="mesa-estado ${mesa.estado}">${this.escapeHtml(estadoTexto)}</div>
            <div class="mesa-info">
                <small><i class="fas fa-users"></i> Capacidad: ${mesa.capacidad}</small>
                ${Number(mesa.acepta_reservas) === 1 ? `<br><small><i class="fas fa-calendar-check"></i> Reservas: Sí</small>` : `<br><small><i class="fas fa-calendar-xmark"></i> Reservas: No</small>`}
                ${Number(mesa.aplica_servicio) === 1 ? `<br><small><i class="fas fa-percent"></i> Servicio: ${Number(mesa.porcentaje_servicio || 10)}%</small>` : `<br><small><i class="fas fa-percent"></i> Servicio: No</small>`}
                ${mesa.cliente_nombre ? `<br><small><i class="fas fa-user"></i> Cliente: ${this.escapeHtml(mesa.cliente_nombre)}</small>` : ''}
                ${mesa.fecha_apertura ? `<br><small><i class="fas fa-clock"></i> Desde: ${new Date(mesa.fecha_apertura).toLocaleTimeString()}</small>` : ''}
            </div>
            <div class="mesa-premium-footer">
                <span class="mesa-action-hint ${puedeOperar ? '' : 'locked'}">${getActionLabel(mesa)}</span>
                ${assignedText}
            </div>
            <div class="mesa-actions mt-2">
                ${this.isAdmin() && mesa.estado === 'libre' ? `
                    ${tipoSlug !== 'banco' ? `
                        <button class="btn btn-light btn-sm" onclick="event.stopPropagation(); Tables.showEditModal(${mesa.id})">
                            <i class="fas fa-edit"></i>
                        </button>
                    ` : ''}
                    <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); Tables.deleteMesa(${mesa.id})">
                        <i class="fas fa-trash"></i>
                    </button>
                ` : ''}
            </div>
        </div>
        `;
    };

    return puestos.map(renderCard).join('');
},



    // Renderizar tabla de mesas
    renderMesasTable() {
    if (this.data.length === 0) {
        return '<p class="text-center">No hay zonas configuradas</p>';
    }

    return `
        <table class="table">
            <thead>
                <tr>
                    <th>Número</th>
                    <th>Capacidad</th>
                    <th>Estado</th>
                    <th>Cliente</th>
                    <th>Fecha Apertura</th>
                    <th>Acciones</th>
                </tr>
            </thead>
            <tbody>
                ${this.data.map(mesa => {
                    const tipoNombre = (mesa.zona?.toLowerCase() === 'bar' && mesa.tipo_asiento?.toLowerCase() === 'banco') 
                        ? 'Banco' 
                        : 'Mesa';

                    return `
                        <tr>
                            <td class="${mesa.zona?.toLowerCase() === 'salon' 
                                ? 'text-salon' 
                                : mesa.tipo_asiento?.toLowerCase() === 'mesa' 
                                    ? 'text-bar-mesa' 
                                    : 'text-bar-banco'}">
                                ${tipoNombre} ${mesa.numero}
                            </td>

                            <td>${mesa.capacidad} personas</td>
                            <td><span class="badge badge-${mesa.estado === 'libre' ? 'success' : mesa.estado === 'ocupada' ? 'danger' : 'warning'}">${mesa.estado}</span></td>
                            <td>${mesa.cliente_nombre || '-'}</td>
                            <td>${mesa.fecha_apertura ? Utils.formatDate(mesa.fecha_apertura) : '-'}</td>
                            <td>
                                <div class="d-flex gap-1">
                                    ${mesa.estado === 'libre' ? `
                                        <button class="btn btn-success btn-sm" onclick="Tables.showAbrirMesaModal(${mesa.id})">
                                            <i class="fas fa-play"></i> Abrir
                                        </button>
                                        <button class="btn btn-secondary btn-sm" onclick="Tables.showEditModal(${mesa.id})">
                                            <i class="fas fa-edit"></i>
                                        </button>
                                        <button class="btn btn-danger btn-sm" onclick="Tables.deleteMesa(${mesa.id})">
                                            <i class="fas fa-trash"></i>
                                        </button>
                                    ` : `
                                        <button class="btn btn-warning btn-sm" onclick="Tables.cerrarMesa(${mesa.id})">
                                            <i class="fas fa-stop"></i> Cerrar
                                        </button>
                                    `}
                                </div>
                            </td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;
},

    // Manejar click en mesa
    handleMesaClick(mesaId) {
    const mesa = this.data.find(m => m.id === mesaId);
    if (!mesa) return;

    const esBanco = mesa.zona?.toLowerCase() === 'bar' && mesa.tipo_asiento?.toLowerCase() === 'banco';

    const canOperateMesa = Number(mesa.puede_operar || 0) === 1
        || Number(mesa.soy_responsable || 0) === 1
        || this.isAdmin();

    if (mesa.estado !== 'libre' && !canOperateMesa) {
        Utils.showNotification('Responsable asignado. No puedes operar esta mesa/cuenta con tu usuario actual.', 'info');
        return;
    }

    if (mesa.estado === 'libre') {
        this.showAbrirMesaModal(mesaId);
    } else if (mesa.estado === 'ocupada') {
        this.showMesaOcupadaModal(mesaId);
    } else if (mesa.estado === 'reservada') {
        this.showMesaReservadaModal(mesaId);
    }
},

    showZoneFormModal(zoneId = null) {
    if (!this.isAdmin()) {
        Utils.showNotification('Solo un administrador puede modificar zonas', 'warning');
        return;
    }

    const zone = zoneId ? this.getZoneById(zoneId) : null;
    const isEdit = Boolean(zone);

    Utils.showModal(isEdit ? 'Editar zona' : 'Nueva zona', `
        <form id="zone-form" class="zone-structure-form">
            <input type="hidden" id="zone-id" value="${zone?.id || ''}">
            <div class="form-group">
                <label for="zone-name">Nombre de la zona *</label>
                <input type="text" id="zone-name" name="nombre" maxlength="40" value="${this.escapeHtml(zone?.nombre || '')}" placeholder="Ej: Terraza, VIP, Patio" required>
            </div>
            <div class="structure-form-row">
                <div class="form-group">
                    <label for="zone-icon">Icono Font Awesome</label>
                    <input type="text" id="zone-icon" name="icono" value="${this.escapeHtml(zone?.icono || 'fa-location-dot')}" placeholder="fa-location-dot">
                </div>
                <div class="form-group">
                    <label for="zone-color">Color/acento</label>
                    <input type="color" id="zone-color" name="color" value="${this.escapeHtml(zone?.color || '#3498db')}">
                </div>
            </div>
            <div class="structure-form-row">
                <div class="form-group">
                    <label for="zone-order">Orden</label>
                    <input type="number" id="zone-order" name="orden" min="0" value="${Number(zone?.orden || 0)}">
                </div>
                <div class="form-group">
                    <label for="zone-service-percent">% servicio</label>
                    <input type="number" id="zone-service-percent" name="porcentaje_servicio" min="0" max="100" value="${Number(zone?.porcentaje_servicio || 10)}">
                </div>
            </div>
            <div class="structure-switch-grid">
                ${this.renderSwitch('zone-reservations', 'acepta_reservas', 'Acepta reservaciones', zone ? Number(zone.acepta_reservas) === 1 : true)}
                ${this.renderSwitch('zone-service', 'aplica_servicio', 'Aplica servicio', zone ? Number(zone.aplica_servicio) === 1 : true)}
                ${this.renderSwitch('zone-dashboard', 'visible_dashboard', 'Visible en Dashboard', zone ? Number(zone.visible_dashboard) === 1 : true)}
                ${this.renderSwitch('zone-active', 'activa', 'Zona activa', zone ? Number(zone.activa) === 1 : true)}
            </div>
        </form>
    `, [
        { text: 'Cancelar', class: 'btn-light' },
        { text: `<i class="fas fa-save"></i> ${isEdit ? 'Guardar' : 'Crear zona'}`, class: 'btn-success', onclick: 'Tables.saveZone()' }
    ], 'modal-zone-structure');
},

    showSeatTypeFormModal(typeId = null) {
    if (!this.isAdmin()) {
        Utils.showNotification('Solo un administrador puede modificar tipos de puesto', 'warning');
        return;
    }

    const type = typeId ? this.getSeatTypeById(typeId) : null;
    const isEdit = Boolean(type);

    Utils.showModal(isEdit ? 'Editar tipo de puesto' : 'Nuevo tipo de puesto', `
        <form id="seat-type-form" class="zone-structure-form">
            <input type="hidden" id="seat-type-id" value="${type?.id || ''}">
            <div class="form-group">
                <label for="seat-type-name">Nombre del tipo *</label>
                <input type="text" id="seat-type-name" name="nombre" maxlength="40" value="${this.escapeHtml(type?.nombre || '')}" placeholder="Ej: Mesa, Banco, Sillón, Cabina" required>
            </div>
            <div class="structure-form-row">
                <div class="form-group">
                    <label for="seat-type-icon">Icono Font Awesome</label>
                    <input type="text" id="seat-type-icon" name="icono" value="${this.escapeHtml(type?.icono || 'fa-chair')}" placeholder="fa-chair">
                </div>
                <div class="form-group">
                    <label for="seat-type-order">Orden</label>
                    <input type="number" id="seat-type-order" name="orden" min="0" value="${Number(type?.orden || 0)}">
                </div>
            </div>
            <div class="structure-switch-grid one-column">
                ${this.renderSwitch('seat-type-active', 'activo', 'Tipo activo', type ? Number(type.activo) === 1 : true)}
            </div>
        </form>
    `, [
        { text: 'Cancelar', class: 'btn-light' },
        { text: `<i class="fas fa-save"></i> ${isEdit ? 'Guardar' : 'Crear tipo'}`, class: 'btn-success', onclick: 'Tables.saveSeatType()' }
    ], 'modal-zone-structure');
},

    renderSwitch(id, name, label, checked = true) {
    return `
        <label class="structure-switch" for="${id}">
            <input type="checkbox" id="${id}" name="${name}" ${checked ? 'checked' : ''}>
            <span></span>
            <strong>${label}</strong>
        </label>
    `;
},

    async saveZone() {
    const form = document.getElementById('zone-form');
    if (!Utils.validateForm(form)) return;

    const zoneId = document.getElementById('zone-id')?.value;
    const formData = new FormData(form);
    const data = {
        nombre: formData.get('nombre'),
        icono: formData.get('icono'),
        color: formData.get('color'),
        orden: Number(formData.get('orden') || 0),
        acepta_reservas: formData.get('acepta_reservas') === 'on',
        aplica_servicio: formData.get('aplica_servicio') === 'on',
        porcentaje_servicio: Number(formData.get('porcentaje_servicio') || 10),
        visible_dashboard: formData.get('visible_dashboard') === 'on',
        activa: formData.get('activa') === 'on'
    };

    try {
        await Utils.request(zoneId ? `/tables/zones/${zoneId}` : '/tables/zones', {
            method: zoneId ? 'PUT' : 'POST',
            body: JSON.stringify(data)
        });

        Utils.hideModal();
        Utils.showNotification(zoneId ? 'Zona actualizada correctamente' : 'Zona creada correctamente', 'success');
        await this.load();
    } catch (error) {
        Utils.showNotification(error.message || 'Error guardando zona', 'error');
    }
},

    async saveSeatType() {
    const form = document.getElementById('seat-type-form');
    if (!Utils.validateForm(form)) return;

    const typeId = document.getElementById('seat-type-id')?.value;
    const formData = new FormData(form);
    const data = {
        nombre: formData.get('nombre'),
        icono: formData.get('icono'),
        orden: Number(formData.get('orden') || 0),
        activo: formData.get('activo') === 'on'
    };

    try {
        await Utils.request(typeId ? `/tables/seat-types/${typeId}` : '/tables/seat-types', {
            method: typeId ? 'PUT' : 'POST',
            body: JSON.stringify(data)
        });

        Utils.hideModal();
        Utils.showNotification(typeId ? 'Tipo actualizado correctamente' : 'Tipo de puesto creado correctamente', 'success');
        await this.load();
    } catch (error) {
        Utils.showNotification(error.message || 'Error guardando tipo de puesto', 'error');
    }
},

    showWorkRoleFormModal(roleId = null) {
    if (!this.isAdmin()) {
        Utils.showNotification('Solo un administrador puede modificar roles de trabajo', 'warning');
        return;
    }

    const zonas = this.activeZones();
    if (!zonas.length) {
        Utils.showModal('Crear zonas primero', `
            <div class="work-role-empty-state">
                <div class="work-role-empty-icon"><i class="fas fa-map-location-dot"></i></div>
                <h4>No hay zonas activas para asignar</h4>
                <p>Antes de crear roles de trabajo, cree zonas reales del local. Los roles solo pueden vincularse a zonas existentes y activas.</p>
                <button class="btn btn-primary" onclick="Utils.hideModal(); Tables.showZoneFormModal();">
                    <i class="fas fa-plus"></i> Crear zona
                </button>
            </div>
        `, [
            { text: 'Cerrar', class: 'btn-light' }
        ], 'modal-zone-structure');
        return;
    }

    const role = roleId ? this.getWorkRoleById(roleId) : null;
    const isEdit = Boolean(role);
    const selectedZoneIds = new Set((role?.zonas || []).map(zone => Number(zone.id)));

    Utils.showModal(isEdit ? 'Editar rol de trabajo' : 'Nuevo rol de trabajo', `
        <form id="work-role-form" class="zone-structure-form">
            <input type="hidden" id="work-role-id" value="${role?.id || ''}">
            <div class="form-group">
                <label for="work-role-name">Nombre del rol *</label>
                <input type="text" id="work-role-name" name="nombre" maxlength="40" value="${this.escapeHtml(role?.nombre || '')}" placeholder="Ej: Bartender, Salonero terraza" required>
            </div>
            <div class="form-group">
                <label for="work-role-description">Descripción</label>
                <textarea id="work-role-description" name="descripcion" rows="2" maxlength="160" placeholder="Describe cuándo o dónde se usa este rol">${this.escapeHtml(role?.descripcion || '')}</textarea>
            </div>
            <div class="work-role-zone-picker">
                <div class="work-role-zone-title">
                    <strong>Zonas asignadas *</strong>
                    <span>Seleccione zonas creadas y activas</span>
                </div>
                <div class="work-role-zone-list">
                    ${zonas.map(zone => `
                        <label class="work-role-zone-option" for="work-role-zone-${Number(zone.id)}">
                            <input type="checkbox" id="work-role-zone-${Number(zone.id)}" name="zona_ids" value="${Number(zone.id)}" ${selectedZoneIds.has(Number(zone.id)) ? 'checked' : ''}>
                            <span class="work-role-zone-icon" style="--zone-color:${this.escapeHtml(zone.color || '#3498db')}">
                                <i class="fas ${this.escapeHtml(zone.icono || 'fa-location-dot')}"></i>
                            </span>
                            <span>
                                <strong>${this.escapeHtml(zone.nombre)}</strong>
                                <small>${Number(zone.puestos_total || 0)} puestos</small>
                            </span>
                        </label>
                    `).join('')}
                </div>
            </div>
            <div class="structure-switch-grid one-column">
                ${this.renderSwitch('work-role-active', 'activo', 'Rol activo', role ? Number(role.activo) === 1 : true)}
            </div>
        </form>
    `, [
        { text: 'Cancelar', class: 'btn-light' },
        { text: `<i class="fas fa-save"></i> ${isEdit ? 'Guardar' : 'Crear rol'}`, class: 'btn-success', onclick: 'Tables.saveWorkRole()' }
    ], 'modal-zone-structure');
},

    async saveWorkRole() {
    const form = document.getElementById('work-role-form');
    if (!Utils.validateForm(form)) return;

    const roleId = document.getElementById('work-role-id')?.value;
    const formData = new FormData(form);
    const zonaIds = formData.getAll('zona_ids').map(value => Number(value)).filter(Boolean);

    if (!zonaIds.length) {
        Utils.showNotification('Seleccione al menos una zona activa para el rol de trabajo', 'warning');
        return;
    }

    const data = {
        nombre: formData.get('nombre'),
        descripcion: formData.get('descripcion'),
        zona_ids: zonaIds,
        activo: formData.get('activo') === 'on'
    };

    try {
        await Utils.request(roleId ? `/tables/work-roles/${roleId}` : '/tables/work-roles', {
            method: roleId ? 'PUT' : 'POST',
            body: JSON.stringify(data)
        });

        Utils.hideModal();
        Utils.showNotification(roleId ? 'Rol de trabajo actualizado correctamente' : 'Rol de trabajo creado correctamente', 'success');
        await this.load();
    } catch (error) {
        Utils.showNotification(error.message || 'Error guardando rol de trabajo', 'error');
    }
},

    // Mostrar modal para crear puesto
    showCreateModal() {
    const zonas = this.activeZones();
    const tipos = this.activeSeatTypes();

    if (!zonas.length || !tipos.length) {
        Utils.showNotification('Antes de crear puestos debe existir al menos una zona activa y un tipo de puesto activo', 'warning');
        return;
    }

    Utils.showModal('Nuevo puesto', `
        <form id="create-mesa-form" class="zone-structure-form">
            <div class="structure-form-row">
                <div class="form-group">
                    <label for="zona-id">Zona *</label>
                    <select id="zona-id" name="zona_id" required>
                        <option value="">Seleccione una zona</option>
                        ${zonas.map(zone => `<option value="${Number(zone.id)}">${this.escapeHtml(zone.nombre)}</option>`).join('')}
                    </select>
                </div>

                <div class="form-group">
                    <label for="tipo-puesto-id">Tipo de puesto *</label>
                    <select id="tipo-puesto-id" name="tipo_puesto_id" required>
                        <option value="">Seleccione un tipo</option>
                        ${tipos.map(type => `<option value="${Number(type.id)}">${this.escapeHtml(type.nombre)}</option>`).join('')}
                    </select>
                </div>
            </div>

            <div class="structure-form-row">
                <div class="form-group">
                    <label for="numero">Número *</label>
                    <input type="number" id="numero" name="numero" readonly required>
                </div>

                <div class="form-group">
                    <label for="capacidad">Capacidad *</label>
                    <input type="number" id="capacidad" name="capacidad" min="1" max="99" required>
                </div>
            </div>

            <div class="form-group">
                <label for="nombre-visible">Nombre visible opcional</label>
                <input type="text" id="nombre-visible" name="nombre_visible" maxlength="40" placeholder="Ej: Mesa alta ventana, Cabina VIP">
            </div>

            <div class="structure-form-row">
                <div class="form-group">
                    <label for="acepta-reservas-override">Reservaciones</label>
                    <select id="acepta-reservas-override" name="acepta_reservas_override">
                        <option value="heredar">Heredar de zona</option>
                        <option value="1">Sí acepta</option>
                        <option value="0">No acepta</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="aplica-servicio-override">Servicio 10%</label>
                    <select id="aplica-servicio-override" name="aplica_servicio_override">
                        <option value="heredar">Heredar de zona</option>
                        <option value="1">Sí aplica</option>
                        <option value="0">No aplica</option>
                    </select>
                </div>
            </div>

            <div class="zone-create-hint" id="zone-create-hint">
                Seleccione zona y tipo para generar el siguiente número disponible.
            </div>
        </form>
    `, [
        { text: 'Cancelar', class: 'btn-light' },
        { text: '<i class="fas fa-plus"></i> Crear puesto', class: 'btn-success', onclick: 'Tables.createMesa()' }
    ], 'modal-zone-structure');

    const zonaSelect = document.getElementById('zona-id');
    const typeSelect = document.getElementById('tipo-puesto-id');
    const capacidadInput = document.getElementById('capacidad');

    const refreshNumber = async () => {
        const zoneId = zonaSelect.value;
        const typeId = typeSelect.value;
        const numeroInput = document.getElementById('numero');
        const hint = document.getElementById('zone-create-hint');
        const type = this.getSeatTypeById(typeId);
        const zone = this.getZoneById(zoneId);

        if (!zoneId || !typeId) {
            numeroInput.value = '';
            return;
        }

        if ((type?.slug || '').toLowerCase() === 'banco') {
            capacidadInput.value = 1;
            capacidadInput.setAttribute('readonly', 'readonly');
        } else {
            capacidadInput.removeAttribute('readonly');
            if (!capacidadInput.value || Number(capacidadInput.value) < 1) capacidadInput.value = '';
        }

        numeroInput.value = await Tables.obtenerSiguienteNumeroDinamico(zoneId, typeId);
        if (hint && zone && type) {
            hint.innerHTML = `Configuración heredada: <strong>${this.escapeHtml(zone.nombre)}</strong> · ${Number(zone.acepta_reservas) === 1 ? 'acepta reservas' : 'sin reservas'} · ${Number(zone.aplica_servicio) === 1 ? `${Number(zone.porcentaje_servicio || 10)}% servicio` : 'sin servicio'} · tipo <strong>${this.escapeHtml(type.nombre)}</strong>.`;
        }
    };

    zonaSelect.addEventListener('change', refreshNumber);
    typeSelect.addEventListener('change', refreshNumber);
},

    // Crear puesto
   async createMesa() {
    const form = document.getElementById('create-mesa-form');
    if (!Utils.validateForm(form)) {
        Utils.showNotification('Por favor complete todos los campos requeridos', 'warning');
        return;
    }

    const formData = new FormData(form);
    const zona_id = Number(formData.get('zona_id'));
    const tipo_puesto_id = Number(formData.get('tipo_puesto_id'));
    const tipo = this.getSeatTypeById(tipo_puesto_id);
    const numero = parseInt(formData.get('numero'), 10);
    let capacidad = parseInt(formData.get('capacidad'), 10);

    if ((tipo?.slug || '').toLowerCase() === 'banco') {
        capacidad = 1;
    }

    const data = {
        zona_id,
        tipo_puesto_id,
        numero,
        capacidad,
        nombre_visible: formData.get('nombre_visible') || '',
        acepta_reservas_override: formData.get('acepta_reservas_override'),
        aplica_servicio_override: formData.get('aplica_servicio_override')
    };

    try {
        await Utils.request('/tables', {
            method: 'POST',
            body: JSON.stringify(data)
        });

        Utils.hideModal();
        Utils.showNotification('Puesto creado exitosamente', 'success');

        if (typeof this.load === 'function') {
            await this.load();
        }

        if (typeof Dashboard?.refreshData === 'function') {
            Dashboard.refreshData();
        }
    } catch (error) {
        console.error('❌ Error creando puesto:', error);
        Utils.showNotification(error.message || 'Error al crear puesto', 'error');
    }
},


    // Mostrar modal para editar mesa
    showEditModal(mesaId) {
    const mesa = this.data.find(m => m.id === mesaId);
    if (!mesa) return;

    const esBanco = mesa.zona?.toLowerCase() === 'bar' && mesa.tipo_asiento?.toLowerCase() === 'banco';
    const tipoZonaTexto = mesa.zona?.toLowerCase() === 'bar' ? 'Bar' : 'Salón';

    Utils.showModal(`Editar capacidad de mesa (${esBanco ? 'Banco' : 'Mesa'} ${mesa.numero})`, `
        <form id="edit-mesa-form">
            <div class="form-group">
                <label>Número</label>
                <input type="number" name="numero" value="${mesa.numero}" class="form-control" readonly>
            </div>
            <div class="form-group">
                <label>Tipo de Zona</label>
                <input type="text" value="${tipoZonaTexto}" class="form-control" readonly>
            </div>
            <div class="form-group">
                <label for="edit-capacidad">Capacidad (personas) *</label>
                <input type="number" id="edit-capacidad" name="capacidad" 
                    min="1" max="20" value="${mesa.capacidad}" 
                    ${esBanco ? 'readonly disabled' : ''} required>
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
            onclick: `Tables.updateMesa(${mesaId})`
        }
    ]);
},

    // Actualizar mesa
    async updateMesa(mesaId) {
    const form = document.getElementById('edit-mesa-form');
    if (!Utils.validateForm(form)) {
        Utils.showNotification('Por favor complete todos los campos requeridos', 'warning');
        return;
    }

    const formData = new FormData(form);
    let capacidad = parseInt(formData.get('capacidad'));

    // Obtener mesa actual
    const mesa = this.data.find(m => m.id === mesaId);
    if (!mesa) {
        Utils.showNotification('Mesa no encontrada', 'error');
        return;
    }

    const esBanco = mesa.zona?.toLowerCase() === 'bar' && mesa.tipo_asiento?.toLowerCase() === 'banco';
    if (esBanco) {
        capacidad = 1; // Forzar capacidad = 1 si es banco
    }

    const data = { capacidad };

    try {
        await Utils.request(`/tables/${mesaId}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });

        Utils.hideModal();
        Utils.showNotification('Mesa actualizada exitosamente', 'success');
        this.load();
        if (typeof Dashboard?.refreshData === 'function') {
            Dashboard.refreshData();
        }
    } catch (error) {
        Utils.showNotification(error.message, 'error');
    }
},

    // Eliminar mesa
    async deleteMesa(mesaId) {
    const mesa = this.data.find(m => m.id === mesaId);
    if (!mesa) return;

    const esBanco = mesa.zona?.toLowerCase() === 'bar' && mesa.tipo_asiento?.toLowerCase() === 'banco';
    const tipoNombre = esBanco ? 'Banco' : 'Mesa';

    // ✅ Validar si es el último número dentro de su grupo
    const grupo = this.data.filter(m =>
        m.zona === mesa.zona && m.tipo_asiento === mesa.tipo_asiento
    );
    const maxNumero = Math.max(...grupo.map(m => m.numero));

    if (mesa.numero !== maxNumero) {
        Utils.showNotification(`Solo se puede eliminar el ${tipoNombre} con el número más alto (${maxNumero})`, 'warning');
        return;
    }

    // Confirmación
    const confirmed = await Utils.confirm(
        `¿Está seguro de eliminar el ${tipoNombre} ${mesa.numero}?`,
        'Confirmar Eliminación'
    );
    if (!confirmed) return;

    try {
        await Utils.request(`/tables/${mesaId}`, {
            method: 'DELETE'
        });

        Utils.showNotification('Zona eliminada exitosamente', 'success');
        this.load();
        if (typeof Dashboard?.refreshData === 'function') {
            Dashboard.refreshData();
        }
    } catch (error) {
        Utils.showNotification(error.message, 'error');
    }
},

    // Mostrar modal para abrir mesa
    showAbrirMesaModal(mesaId) {
    const mesa = this.data.find(m => m.id === mesaId);
    if (!mesa) return;

    const esBanco = mesa.zona?.toLowerCase() === 'bar' && mesa.tipo_asiento?.toLowerCase() === 'banco';
    const nombreZona = esBanco ? 'Banco' : 'Mesa';
    const tipoTexto = mesa.zona?.toLowerCase() === 'bar' ? 'Bar' : 'Salón';

    const estadoOptions = `
        <option value="">Seleccione un estado</option>
        <option value="ocupada" selected>OCUPADA</option>
        ${mesa.zona?.toLowerCase() !== 'bar' ? '<option value="reservada">RESERVAR</option>' : ''}
    `;

    const capacidadInput = `
        <input type="number" id="cantidad-personas" name="cantidad_personas" min="1"
            max="${esBanco ? 1 : mesa.capacidad}"
            value="${esBanco ? 1 : ''}"
            ${esBanco ? 'readonly' : ''} required>
    `;

    Utils.showModal(`Abrir Zona`, `
        <div class="open-zone-modal">
            <section class="open-zone-hero">
                <div class="open-zone-icon">
                    <i class="fas fa-door-open"></i>
                </div>
                <div class="open-zone-headline">
                    <span class="open-zone-eyebrow">Preparar atención</span>
                    <strong>${nombreZona} ${mesa.numero}</strong>
                    <div class="open-zone-meta">
                        <span><i class="fas fa-map-marker-alt"></i> ${tipoTexto}</span>
                        <span><i class="fas fa-users"></i> ${mesa.capacidad} personas</span>
                    </div>
                </div>
            </section>

            <form id="abrir-mesa-form" class="open-zone-form">
                <div class="form-group compact-field">
                    <label for="estado-mesa">Estado del ${nombreZona} *</label>
                    <select id="estado-mesa" name="estado" required onchange="Tables.toggleClienteFields()">
                        ${estadoOptions}
                    </select>
                </div>

                <div class="form-group compact-field">
                    <label for="cantidad-personas">Cantidad de personas *</label>
                    ${capacidadInput}
                </div>

                <div class="form-group compact-field" id="cliente-nombre-group">
                    <label for="cliente-nombre">Nombre del cliente *</label>
                    <input type="text" id="cliente-nombre" name="cliente_nombre" autocomplete="off" required>
                </div>

                <div class="form-group compact-field premium-time-field" id="hora-estimada-group" style="display: none;">
                    <label for="hora-estimada-desktop"><i class="fas fa-clock"></i> Hora estimada de llegada</label>
                    <div class="premium-time-control premium-time-control-desktop">
                        <i class="fas fa-clock"></i>
                        <input type="time" id="hora-estimada-desktop" aria-label="Hora estimada de llegada">
                    </div>
                    <button type="button" class="premium-time-mobile-trigger" id="hora-estimada-trigger" onclick="Tables.openMobileTimePicker()" aria-label="Seleccionar hora estimada de llegada">
                        <span class="premium-time-mobile-icon"><i class="fas fa-clock"></i></span>
                        <span class="premium-time-mobile-copy">
                            <small>Hora estimada</small>
                            <strong id="hora-estimada-display" class="is-empty">Seleccionar hora</strong>
                        </span>
                        <i class="fas fa-chevron-right premium-time-mobile-arrow"></i>
                    </button>
                    <input type="hidden" id="hora-estimada" name="hora_estimada">
                </div>
            </form>
        </div>
    `, [
        {
            text: 'Cancelar',
            class: 'btn-light'
        },
        {
            text: '<i class="fas fa-play"></i> Abrir Zona',
            class: 'btn-success',
            onclick: `Tables.abrirMesa(${mesaId})`
        }
    ], 'modal-zone-open');

    this.initializeReservationTimeControl();
},

    // Alternar campos según el estado seleccionado
    toggleClienteFields() {
    const estadoSelect = document.getElementById('estado-mesa');
    const clienteGroup = document.getElementById('cliente-nombre-group');
    const horaGroup = document.getElementById('hora-estimada-group');
    const clienteInput = document.getElementById('cliente-nombre');

    if (!estadoSelect) return;

    const estado = estadoSelect.value;

    if (estado === 'reservada') {
        clienteGroup.style.display = 'block';
        horaGroup.style.display = 'block';
        clienteInput.placeholder = 'Nombre para la reserva';
    } else if (estado === 'ocupada') {
        clienteGroup.style.display = 'block';
        horaGroup.style.display = 'none';
        clienteInput.placeholder = 'Nombre del cliente';
    } else {
        // Si no se selecciona un estado válido
        clienteGroup.style.display = 'none';
        horaGroup.style.display = 'none';
        clienteInput.placeholder = '';
    }
},

    initializeReservationTimeControl() {
    const hiddenInput = document.getElementById('hora-estimada');
    const desktopInput = document.getElementById('hora-estimada-desktop');
    const trigger = document.getElementById('hora-estimada-trigger');

    if (!hiddenInput) return;

    const syncValue = (value, options = {}) => {
        this.setHoraEstimadaValue(value, options);
    };

    if (desktopInput) {
        desktopInput.addEventListener('input', (event) => {
            syncValue(event.target.value, { syncDesktop: false });
        });

        desktopInput.addEventListener('change', (event) => {
            syncValue(event.target.value, { syncDesktop: false });
        });
    }

    if (trigger) {
        trigger.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                this.openMobileTimePicker();
            }
        });
    }

    syncValue(hiddenInput.value || desktopInput?.value || '');
},

    setHoraEstimadaValue(value, options = {}) {
    const normalizedValue = typeof value === 'string' ? value.trim().slice(0, 5) : '';
    const hiddenInput = document.getElementById('hora-estimada');
    const desktopInput = document.getElementById('hora-estimada-desktop');
    const display = document.getElementById('hora-estimada-display');

    if (hiddenInput) {
        hiddenInput.value = normalizedValue;
    }

    if (desktopInput && options.syncDesktop !== false) {
        desktopInput.value = normalizedValue;
    }

    if (display) {
        display.textContent = normalizedValue
            ? this.formatHoraEstimada(normalizedValue)
            : 'Seleccionar hora';
        display.classList.toggle('is-empty', !normalizedValue);
    }
},

    formatHoraEstimada(timeValue) {
    if (!timeValue || !timeValue.includes(':')) return 'Seleccionar hora';

    const [hourRaw, minuteRaw] = timeValue.split(':');
    const hour24 = parseInt(hourRaw, 10);
    const minute = String(minuteRaw || '00').padStart(2, '0');

    if (Number.isNaN(hour24)) return 'Seleccionar hora';

    const suffix = hour24 >= 12 ? 'p. m.' : 'a. m.';
    const hour12 = ((hour24 + 11) % 12) + 1;

    return `${hour12}:${minute} ${suffix}`;
},

    openMobileTimePicker() {
    const desktopInput = document.getElementById('hora-estimada-desktop');
    const hiddenInput = document.getElementById('hora-estimada');
    const isMobile = window.matchMedia('(max-width: 768px)').matches;

    if (!isMobile) {
        if (desktopInput?.showPicker) {
            desktopInput.showPicker();
        } else {
            desktopInput?.focus();
        }
        return;
    }

    this.closeMobileTimePicker();

    const initialValue = hiddenInput?.value || desktopInput?.value || '18:00';
    const [initialHourRaw, initialMinuteRaw] = initialValue.includes(':') ? initialValue.split(':') : ['18', '00'];
    const initialHour24 = Math.min(Math.max(parseInt(initialHourRaw, 10) || 18, 0), 23);
    const initialMinute = Math.min(Math.max(parseInt(initialMinuteRaw, 10) || 0, 0), 59);
    const initialMeridiem = initialHour24 >= 12 ? 'pm' : 'am';
    const initialHour12 = ((initialHour24 + 11) % 12) + 1;

    const hourOptions = Array.from({ length: 12 }, (_, index) => {
        const hour = index + 1;
        const selected = hour === initialHour12 ? 'selected' : '';
        return `<option value="${hour}" ${selected}>${String(hour).padStart(2, '0')}</option>`;
    }).join('');

    const minuteOptions = Array.from({ length: 60 }, (_, index) => {
        const selected = index === initialMinute ? 'selected' : '';
        return `<option value="${String(index).padStart(2, '0')}" ${selected}>${String(index).padStart(2, '0')}</option>`;
    }).join('');

    const overlay = document.createElement('div');
    overlay.id = 'mobile-time-picker-overlay';
    overlay.className = 'mobile-time-picker-overlay';
    overlay.innerHTML = `
        <div class="mobile-time-picker-sheet" role="dialog" aria-modal="true" aria-labelledby="mobile-time-picker-title">
            <div class="mobile-time-picker-header">
                <div>
                    <span class="mobile-time-picker-eyebrow">Reserva</span>
                    <h3 id="mobile-time-picker-title">Hora estimada de llegada</h3>
                </div>
                <button type="button" class="mobile-time-picker-close" aria-label="Cerrar selector de hora">&times;</button>
            </div>
            <div class="mobile-time-picker-body">
                <div class="mobile-time-picker-preview" id="mobile-time-picker-preview">${this.formatHoraEstimada(initialValue)}</div>
                <div class="mobile-time-picker-grid">
                    <div class="mobile-time-picker-field">
                        <label for="mobile-time-picker-hour">Hora</label>
                        <select id="mobile-time-picker-hour">${hourOptions}</select>
                    </div>
                    <div class="mobile-time-picker-field">
                        <label for="mobile-time-picker-minute">Minuto</label>
                        <select id="mobile-time-picker-minute">${minuteOptions}</select>
                    </div>
                </div>
                <div class="mobile-time-picker-meridiem" role="group" aria-label="Seleccionar formato horario">
                    <button type="button" class="mobile-time-picker-meridiem-btn ${initialMeridiem === 'am' ? 'is-active' : ''}" data-meridiem="am">A. M.</button>
                    <button type="button" class="mobile-time-picker-meridiem-btn ${initialMeridiem === 'pm' ? 'is-active' : ''}" data-meridiem="pm">P. M.</button>
                </div>
            </div>
            <div class="mobile-time-picker-footer">
                <button type="button" class="btn btn-light mobile-time-picker-clear">Limpiar</button>
                <button type="button" class="btn btn-success mobile-time-picker-apply">Aplicar hora</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    document.body.classList.add('mobile-time-picker-open');

    const hourSelect = overlay.querySelector('#mobile-time-picker-hour');
    const minuteSelect = overlay.querySelector('#mobile-time-picker-minute');
    const preview = overlay.querySelector('#mobile-time-picker-preview');

    const updatePreview = () => {
        const activeMeridiem = overlay.querySelector('.mobile-time-picker-meridiem-btn.is-active')?.dataset?.meridiem || 'am';
        let previewHour = parseInt(hourSelect.value, 10) || 12;
        if (activeMeridiem === 'pm' && previewHour < 12) {
            previewHour += 12;
        } else if (activeMeridiem === 'am' && previewHour === 12) {
            previewHour = 0;
        }
        preview.textContent = this.formatHoraEstimada(`${String(previewHour).padStart(2, '0')}:${minuteSelect.value}`);
    };

    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
            this.closeMobileTimePicker();
        }
    });

    overlay.querySelector('.mobile-time-picker-close').addEventListener('click', () => this.closeMobileTimePicker());
    overlay.querySelector('.mobile-time-picker-clear').addEventListener('click', () => {
        this.setHoraEstimadaValue('');
        this.closeMobileTimePicker();
    });
    overlay.querySelector('.mobile-time-picker-apply').addEventListener('click', () => this.confirmMobileTimePicker());

    overlay.querySelectorAll('.mobile-time-picker-meridiem-btn').forEach((button) => {
        button.addEventListener('click', () => {
            overlay.querySelectorAll('.mobile-time-picker-meridiem-btn').forEach(btn => btn.classList.remove('is-active'));
            button.classList.add('is-active');
            updatePreview();
        });
    });

    hourSelect.addEventListener('change', updatePreview);
    minuteSelect.addEventListener('change', updatePreview);
},

    confirmMobileTimePicker() {
    const overlay = document.getElementById('mobile-time-picker-overlay');
    if (!overlay) return;

    const hourValue = parseInt(overlay.querySelector('#mobile-time-picker-hour')?.value || '12', 10);
    const minuteValue = overlay.querySelector('#mobile-time-picker-minute')?.value || '00';
    const meridiem = overlay.querySelector('.mobile-time-picker-meridiem-btn.is-active')?.dataset?.meridiem || 'am';

    let hour24 = hourValue % 12;
    if (meridiem === 'pm') {
        hour24 += 12;
    }

    this.setHoraEstimadaValue(`${String(hour24).padStart(2, '0')}:${minuteValue}`);
    this.closeMobileTimePicker();
},

    closeMobileTimePicker() {
    document.getElementById('mobile-time-picker-overlay')?.remove();
    document.body.classList.remove('mobile-time-picker-open');
},

    // Abrir mesa
    async abrirMesa(mesaId) {
    const form = document.getElementById('abrir-mesa-form');
    if (!Utils.validateForm(form)) {
        Utils.showNotification('Por favor complete todos los campos requeridos', 'warning');
        return;
    }

    const formData = new FormData(form);
    let estado = formData.get('estado');
    const clienteNombre = formData.get('cliente_nombre');
    let cantidadPersonas = parseInt(formData.get('cantidad_personas'));
    const horaEstimada = formData.get('hora_estimada');

    const mesa = this.data.find(m => m.id === mesaId);
    if (!mesa) {
        Utils.showNotification('Mesa no encontrada', 'error');
        return;
    }

    const esBanco = mesa.zona?.toLowerCase() === 'bar' && mesa.tipo_asiento?.toLowerCase() === 'banco';

    // Lógica de seguridad para bancos
    if (esBanco) {
        estado = 'ocupada';
        cantidadPersonas = 1;
    }

    const data = {
        cliente_nombre: clienteNombre,
        estado,
        cantidad_personas: cantidadPersonas
    };

    if (!esBanco && estado === 'reservada' && horaEstimada) {
        data.hora_estimada = horaEstimada;
    }

    try {
        await Utils.request(`/tables/${mesaId}/open`, {
            method: 'POST',
            body: JSON.stringify(data)
        });

        Utils.hideModal();
        const mensaje = estado === 'reservada' ? 'Mesa reservada exitosamente' : 'Zona abierta exitosamente';
        Utils.showNotification(mensaje, 'success');
        this.load();
        if (typeof Dashboard?.refreshData === 'function') {
            Dashboard.refreshData();
        }
    } catch (error) {
        Utils.showNotification(error.message, 'error');
    }
},

    // Mostrar modal para mesa reservada
    showMesaReservadaModal(mesaId) {
    const mesa = this.data.find(m => m.id === mesaId);
    if (!mesa) return;

    const esBanco = mesa.zona?.toLowerCase() === 'bar' && mesa.tipo_asiento?.toLowerCase() === 'banco';
    const tipoNombre = esBanco ? 'Banco' : 'Mesa';

    if (esBanco) {
        Utils.showNotification('Un banco no puede estar reservado', 'warning');
        return;
    }

    const clienteNombre = mesa.cliente_nombre || mesa.nombre_reserva || 'Cliente sin nombre';
    const horaEstimada = mesa.hora_estimada || 'No especificada';
    const cantidadPersonas = mesa.cantidad_personas || 'No especificada';
    const reservationActions = [
        {
            text: 'Cancelar',
            class: 'btn-light'
        }
    ];

    if (this.isAdmin()) {
        reservationActions.push({
            text: '<i class="fas fa-users-gear"></i> Reasignar mesa',
            class: 'btn-secondary',
            onclick: `Tables.showMesaResponsiblesModal(${mesaId})`
        });
    }

    reservationActions.push(
        {
            text: '<i class="fas fa-user-check"></i> Cambiar a ocupada',
            class: 'btn-success',
            onclick: `Tables.cambiarReservaAOcupada(${mesaId})`
        },
        {
            text: '<i class="fas fa-door-open"></i> Liberar mesa',
            class: 'btn-warning',
            align: 'right',
            onclick: `Tables.liberarMesaReservada(${mesaId})`
        }
    );

    Utils.showModal(`${tipoNombre} ${mesa.numero} - Reservada`, `
        <div class="reservation-status-modal">
            <section class="reservation-status-hero">
                <div class="reservation-status-icon">
                    <i class="fas fa-calendar-check"></i>
                </div>
                <div class="reservation-status-copy">
                    <span class="reservation-eyebrow">Reserva activa</span>
                    <strong>${clienteNombre}</strong>
                    <div class="reservation-status-badge">
                        <i class="fas fa-chair"></i> ${tipoNombre.toUpperCase()} ${mesa.numero}
                    </div>
                </div>
            </section>

            <div class="reservation-status-grid">
                <div class="reservation-status-item highlight-time">
                    <i class="fas fa-clock"></i>
                    <span>Hora estimada</span>
                    <strong>${horaEstimada}</strong>
                </div>
                <div class="reservation-status-item">
                    <i class="fas fa-user-group"></i>
                    <span>Personas</span>
                    <strong>${cantidadPersonas}</strong>
                </div>
                <div class="reservation-status-item">
                    <i class="fas fa-users"></i>
                    <span>Capacidad</span>
                    <strong>${mesa.capacidad} personas</strong>
                </div>
            </div>

            <div class="reservation-action-note">
                <i class="fas fa-circle-question"></i>
                <span>Seleccione si la reserva llegó al local o si debe liberarse para volver a quedar disponible.</span>
            </div>
        </div>
    `, reservationActions, 'modal-reservation-status');
},

    // Cambiar mesa reservada a ocupada
    async cambiarReservaAOcupada(mesaId) {
    const mesa = this.data.find(m => m.id === mesaId);
    if (!mesa) {
        Utils.showNotification('Mesa no encontrada', 'error');
        return;
    }

    const esBanco = mesa.zona?.toLowerCase() === 'bar' && mesa.tipo_asiento?.toLowerCase() === 'banco';

    if (esBanco) {
        Utils.showNotification('Un banco no puede ser reservado ni cambiar a ocupada desde estado de reserva', 'warning');
        return;
    }

    try {
        await Utils.request(`/tables/${mesaId}/change-to-occupied`, {
            method: 'POST'
        });

        Utils.hideModal();
        Utils.showNotification('Mesa cambiada a ocupada exitosamente', 'success');
        this.load();
        if (typeof Dashboard?.refreshData === 'function') {
            Dashboard.refreshData();
        };
    } catch (error) {
        Utils.showNotification(error.message, 'error');
    }
},

    // Liberar mesa reservada
    async liberarMesaReservada(mesaId) {
    const mesa = this.data.find(m => m.id === mesaId);
    if (!mesa) {
        Utils.showNotification('Mesa no encontrada', 'error');
        return;
    }

    const esBanco = mesa.zona?.toLowerCase() === 'bar' && mesa.tipo_asiento?.toLowerCase() === 'banco';
    const tipoNombre = esBanco ? 'Banco' : 'Mesa';

    if (esBanco) {
        Utils.showNotification('Un banco no puede tener reservas que liberar', 'warning');
        return;
    }

    const clienteNombre = mesa.cliente_nombre || mesa.nombre_reserva || 'Cliente sin nombre';
    const confirmed = await Utils.confirm(
        `
            <div class="release-reservation-confirm">
                <div class="release-reservation-icon">
                    <i class="fas fa-calendar-xmark"></i>
                </div>
                <div class="release-reservation-copy">
                    <span class="release-reservation-eyebrow">Liberación de reserva</span>
                    <strong>¿Liberar ${tipoNombre} ${mesa.numero}?</strong>
                    <p>Se cancelará la reserva de <b>${clienteNombre}</b> y el puesto volverá a quedar disponible.</p>
                </div>
                <div class="release-reservation-summary">
                    <div>
                        <span>Puesto</span>
                        <strong>${tipoNombre.toUpperCase()} ${mesa.numero}</strong>
                    </div>
                    <div>
                        <span>Cliente</span>
                        <strong>${clienteNombre}</strong>
                    </div>
                    <div>
                        <span>Hora</span>
                        <strong>${mesa.hora_estimada || 'No especificada'}</strong>
                    </div>
                </div>
            </div>
        `,
        'Confirmar Liberación',
        {
            html: true,
            modalClass: 'modal-release-confirm',
            cancelText: 'Cancelar',
            confirmText: '<i class="fas fa-unlock"></i> Liberar mesa',
            confirmClass: 'btn-warning'
        }
    );

    if (!confirmed) return;

    try {
        await Utils.request(`/tables/${mesaId}/close`, {
            method: 'POST'
        });

        Utils.hideModal();
        Utils.showNotification(`${tipoNombre} liberado exitosamente`, 'success');
        this.load();
        if (typeof Dashboard?.refreshData === 'function') {
            Dashboard.refreshData();
        };
    } catch (error) {
        Utils.showNotification(error.message, 'error');
    }
},

    // Obtener mesa/banco para acciones operativas, aunque el módulo Zonas no esté cargado
    async getMesaForAction(mesaId) {
        const numericMesaId = parseInt(mesaId, 10);
        if (!Number.isFinite(numericMesaId)) return null;

        let mesa = Array.isArray(this.data)
            ? this.data.find(m => parseInt(m.id, 10) === numericMesaId)
            : null;

        if (mesa) return mesa;

        if (typeof Orders !== 'undefined' && Array.isArray(Orders.tables)) {
            mesa = Orders.tables.find(m => parseInt(m.id, 10) === numericMesaId);
            if (mesa) {
                if (!Array.isArray(this.data) || this.data.length === 0) {
                    this.data = Orders.tables;
                }
                return mesa;
            }
        }

        try {
            const response = await Utils.request('/tables');
            this.data = Array.isArray(response.data) ? response.data : [];
            return this.data.find(m => parseInt(m.id, 10) === numericMesaId) || null;
        } catch (error) {
            console.error('Error obteniendo zona para acción operativa:', error);
            return null;
        }
    },

    // Mostrar modal para mesa ocupada
    showMesaOcupadaModal(mesaId) {
    const mesa = this.data.find(m => m.id === mesaId);
    if (!mesa) return;

    const esBanco = mesa.zona?.toLowerCase() === 'bar' && mesa.tipo_asiento?.toLowerCase() === 'banco';
    const tipoNombre = esBanco ? 'Banco' : 'Mesa';

    const clienteNombre = mesa.cliente_nombre || 'Cliente sin nombre';
    const desdeTexto = mesa.fecha_apertura ? Utils.formatDate(mesa.fecha_apertura) : 'No especificado';
    const occupiedActions = [
        {
            text: 'Cerrar',
            class: 'btn-light'
        },
        {
            text: '<i class="fas fa-receipt"></i> Ver pedidos',
            class: 'btn-primary',
            onclick: `Utils.hideModal(); Navigation.showSection('orders');`
        }
    ];

    if (this.isAdmin()) {
        occupiedActions.push({
            text: '<i class="fas fa-users-gear"></i> Reasignar mesa',
            class: 'btn-secondary',
            onclick: `Tables.showMesaResponsiblesModal(${mesaId})`
        });
    }

    occupiedActions.push({
        text: `<i class="fas fa-stop"></i> Cerrar ${tipoNombre}`,
        class: 'btn-warning',
        align: 'right',
        onclick: `Tables.cerrarMesa(${mesaId})`
    });

    Utils.showModal(`${tipoNombre} ${mesa.numero} - Ocupado`, `
        <div class="occupied-zone-modal">
            <section class="occupied-zone-hero">
                <div class="occupied-zone-icon">
                    <i class="fas fa-utensils"></i>
                </div>
                <div class="occupied-zone-copy">
                    <span class="occupied-zone-eyebrow">Atención activa</span>
                    <strong>${clienteNombre}</strong>
                    <div class="occupied-zone-badge">
                        <i class="fas fa-location-dot"></i> ${tipoNombre.toUpperCase()} ${mesa.numero}
                    </div>
                </div>
            </section>

            <div class="occupied-zone-grid">
                <div class="occupied-zone-item">
                    <i class="fas fa-clock"></i>
                    <span>Desde</span>
                    <strong>${desdeTexto}</strong>
                </div>
                <div class="occupied-zone-item">
                    <i class="fas fa-users"></i>
                    <span>Capacidad</span>
                    <strong>${mesa.capacidad} personas</strong>
                </div>
                <div class="occupied-zone-item status-active">
                    <i class="fas fa-circle-check"></i>
                    <span>Estado</span>
                    <strong>OCUPADO</strong>
                </div>
            </div>

            <div class="occupied-zone-note">
                <i class="fas fa-receipt"></i>
                <span>Revise los pedidos asociados o cierre el puesto cuando no tenga cuentas pendientes.</span>
            </div>
        </div>
    `, occupiedActions, 'modal-zone-occupied');
},


    async showMesaResponsiblesModal(mesaId) {
        if (!this.isAdmin()) {
            Utils.showNotification('Solo un administrador puede reasignar responsables', 'warning');
            return;
        }

        try {
            const response = await Utils.request(`/tables/${mesaId}/responsibles`);
            const data = response.data || {};
            const mesa = data.mesa || this.data.find(m => Number(m.id) === Number(mesaId)) || {};
            const usuarios = Array.isArray(data.usuarios) ? data.usuarios : [];
            const tipoNombre = mesa.tipo_puesto_nombre || ((mesa.zona || '').toLowerCase() === 'bar' && (mesa.tipo_asiento || '').toLowerCase() === 'banco' ? 'Banco' : 'Mesa');
            const zonaNombre = mesa.zona_nombre || ((mesa.zona || '').toLowerCase() === 'bar' ? 'Bar' : 'Salón');

            Utils.showModal('Reasignar mesa', `
                <div class="mesa-responsibles-shell">
                    <div class="mesa-responsibles-hero">
                        <div class="mesa-responsibles-icon"><i class="fas fa-users-gear"></i></div>
                        <div>
                            <span class="mesa-responsibles-eyebrow">Responsabilidad compartida</span>
                            <strong>${this.escapeHtml(tipoNombre)} ${this.escapeHtml(mesa.numero || '')} · ${this.escapeHtml(zonaNombre)}</strong>
                            <p>Selecciona los usuarios que pueden atender esta mesa/cuenta. Debe quedar al menos un responsable asignado.</p>
                        </div>
                    </div>
                    <div class="mesa-responsibles-list">
                        ${usuarios.length ? usuarios.map(user => this.renderMesaResponsibleOption(user)).join('') : `
                            <div class="zones-empty-admin">
                                No hay usuarios activos disponibles para la zona de esta mesa.
                            </div>
                        `}
                    </div>
                </div>
            `, [
                {
                    text: 'Cancelar',
                    class: 'btn-light',
                    onclick: `Utils.hideModal(); ${String(mesa.estado || '').toLowerCase() === 'reservada' ? 'Tables.showMesaReservadaModal' : 'Tables.showMesaOcupadaModal'}(${mesaId});`
                },
                {
                    text: '<i class="fas fa-save"></i> Guardar responsables',
                    class: 'btn-primary',
                    align: 'right',
                    onclick: `Tables.saveMesaResponsibles(${Number(mesaId)})`
                }
            ], 'modal-mesa-responsibles');
        } catch (error) {
            Utils.showNotification(error.message || 'No se pudieron cargar responsables', 'error');
        }
    },

    renderMesaResponsibleOption(user = {}) {
        const checked = Number(user.asignado) === 1 ? 'checked' : '';
        const tipo = user.tipo === 'administrador' ? 'Admin' : 'Estándar';
        return `
            <label class="mesa-responsible-option">
                <input type="checkbox" class="mesa-responsible-checkbox" value="${Number(user.id)}" ${checked}>
                <span class="mesa-responsible-avatar"><i class="fas fa-user"></i></span>
                <span class="mesa-responsible-copy">
                    <strong>${this.escapeHtml(user.nombre || 'Usuario')}</strong>
                    <small>${this.escapeHtml(tipo)}</small>
                </span>
            </label>
        `;
    },

    async saveMesaResponsibles(mesaId) {
        const selectedIds = Array.from(document.querySelectorAll('.mesa-responsible-checkbox:checked'))
            .map(input => Number(input.value))
            .filter(Boolean);

        if (!selectedIds.length) {
            Utils.showNotification('Debe quedar al menos un responsable asignado', 'warning');
            return;
        }

        try {
            await Utils.request(`/tables/${mesaId}/responsibles`, {
                method: 'PUT',
                body: JSON.stringify({ usuario_ids: selectedIds })
            });

            Utils.hideModal();
            Utils.showNotification('Responsables actualizados correctamente', 'success');
            await this.load();
            if (typeof Dashboard?.refreshData === 'function') {
                Dashboard.refreshData();
            }
        } catch (error) {
            Utils.showNotification(error.message || 'No se pudieron guardar responsables', 'error');
        }
    },

    // Cerrar mesa
async cerrarMesa(mesaId) {
    const mesa = await this.getMesaForAction(mesaId);
    if (!mesa) {
        Utils.showNotification('No se pudo encontrar la mesa/banco para liberar. Actualice la vista e intente de nuevo.', 'warning');
        return false;
    }

    const esBanco = mesa.zona?.toLowerCase() === 'bar' && mesa.tipo_asiento?.toLowerCase() === 'banco';
    const tipoNombre = esBanco ? 'Banco' : 'Mesa';

    const clienteNombre = mesa.cliente_nombre || 'Sin cliente registrado';
    const zonaTexto = mesa.zona ? mesa.zona.charAt(0).toUpperCase() + mesa.zona.slice(1) : 'Zona';

    const confirmed = await Utils.confirm(
        `
            <div class="close-zone-confirm">
                <div class="close-zone-icon">
                    <i class="fas fa-cash-register"></i>
                </div>
                <div class="close-zone-copy">
                    <span class="close-zone-eyebrow">Confirmación operativa</span>
                    <strong>¿Cerrar ${tipoNombre} ${mesa.numero}?</strong>
                    <p>Asegúrese de que no tenga pedidos pendientes antes de liberar esta zona.</p>
                </div>
                <div class="close-zone-summary">
                    <div>
                        <span>Zona</span>
                        <strong>${zonaTexto}</strong>
                    </div>
                    <div>
                        <span>${tipoNombre}</span>
                        <strong>${mesa.numero}</strong>
                    </div>
                    <div>
                        <span>Cliente</span>
                        <strong>${clienteNombre}</strong>
                    </div>
                </div>
            </div>
        `,
        `Confirmar Cierre de ${tipoNombre}`,
        {
            html: true,
            modalClass: 'modal-confirm-close',
            cancelText: 'Cancelar',
            confirmText: '<i class="fas fa-lock"></i> Confirmar cierre',
            confirmClass: 'btn-warning'
        }
    );

    if (!confirmed) return false;

    try {
        await Utils.request(`/tables/${mesaId}/close`, {
            method: 'POST'
        });

        Utils.hideModal();
        Utils.showNotification(`${tipoNombre} cerrada exitosamente`, 'success');
        this.load();
        if (typeof Orders !== 'undefined' && typeof Orders.load === 'function') {
            Orders.load();
        }
        if (typeof Dashboard?.refreshData === 'function') {
            Dashboard.refreshData();
        };
        return true;
    } catch (error) {
        Utils.showNotification(error.message, 'error');
        return false;
    }
},

async obtenerSiguienteNumero(zona, tipoAsiento) {
    try {
        const params = new URLSearchParams();
        params.append('zona', zona);

        if (zona === 'bar' && tipoAsiento) {
            params.append('tipo_asiento', tipoAsiento);
        }

        const response = await Utils.request(`/tables/next-numero?${params.toString()}`);
        return response.numero;
    } catch (error) {
        console.error('❌ Error obteniendo número automático:', error);
        Utils.showNotification('Error al obtener número automático', 'error');
        return '';
    }
},

async obtenerSiguienteNumeroDinamico(zonaId, tipoPuestoId) {
    try {
        const params = new URLSearchParams();
        params.append('zona_id', zonaId);
        params.append('tipo_puesto_id', tipoPuestoId);

        const response = await Utils.request(`/tables/next-numero?${params.toString()}`);
        return response.numero;
    } catch (error) {
        console.error('❌ Error obteniendo número dinámico:', error);
        Utils.showNotification('Error al obtener número automático', 'error');
        return '';
    }
},

};



// Exportar globalmente para acceso desde otros módulos
window.Tables = Tables;
