// Tables Component
const Tables = {
    data: [],

    // Cargar datos de mesas
    async load() {
        try {
            const response = await Utils.request('/tables');
            this.data = response.data;
            this.render();
        } catch (error) {
            console.error('Error cargando zonas:', error);
            Utils.showNotification('Error cargando datos de zonas', 'error');
        }
    },

    // Renderizar sección de mesas
    render() {
    const section = document.getElementById('tables-section');
    this.filtroTipo = this.filtroTipo || 'todos';

    // Filtros y etiquetas
    const filtros = ['todos', 'salon', 'bar-mesa', 'bar-banco'];
    const iconos = {
        'todos': 'fa-border-all',
        'salon': 'fa-chair',
        'bar-mesa': 'fa-martini-glass-citrus',
        'bar-banco': 'fa-grip-lines'
    };
    const nombres = {
        'todos': 'Todos',
        'salon': 'Salón',
        'bar-mesa': 'Bar',
        'bar-banco': 'Barra'
    };

    const botonesFiltro = `
        <div class="btn-filtro-zonas internal-tabs" aria-label="Filtros de zonas">
            ${filtros.map(tipo => `
                <button class="btn btn-zona ${this.filtroTipo === tipo ? 'active' : ''}"
                        data-tipo="${tipo}"
                        data-subnav-item="${tipo}"
                        onclick="Navigation.selectInternal('tables', '${tipo}')">
                    <i class="fas ${iconos[tipo]}"></i> ${nombres[tipo]}
                </button>
            `).join('')}
        </div>
    `;

    section.innerHTML = `
        <div class="section-header">
            <h2>Gestión de Zonas</h2>
            <p>Administra las zonas del restaurante</p>
        </div>

        <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-3">
            <div class="d-flex gap-2">
                <button class="btn btn-success" onclick="Tables.showCreateModal()">
                    <i class="fas fa-plus"></i> Nueva Zona
                </button>
            </div>

            ${botonesFiltro}
        </div>

        <div class="internal-view-panel" data-internal-panel="tables">
            <div class="d-flex gap-2">
                <span class="badge badge-success">Libres: ${this.data.filter(m => m.estado === 'libre').length}</span>
                <span class="badge badge-danger">Ocupadas: ${this.data.filter(m => m.estado === 'ocupada').length}</span>
                <span class="badge badge-warning">Reservadas: ${this.data.filter(m => m.estado === 'reservada').length}</span>
            </div>

            <div class="mesas-grid">
                ${this.renderMesasGrid()}
            </div>
        </div>
    `;
},

    //Filtrar por Zona
    filtrarPorZona(zonaSeleccionada) {
    this.filtroTipo = zonaSeleccionada;

    // Quitar clase activa de todos
    document.querySelectorAll('.btn-zona').forEach(btn => {
        btn.classList.remove('active');
    });

    // Activar el botón correcto
    const activo = document.querySelector(`.btn-zona[data-tipo="${zonaSeleccionada}"]`);
    if (activo) activo.classList.add('active');

    this.render();
    Navigation.syncInternalSubnav('tables');
},

    // Renderizar grid de mesas
    renderMesasGrid() {
    if (this.data.length === 0) {
        return '<p class="text-center">No hay zonas configuradas</p>';
    }

    // Filtro actual o valor por defecto
    const filtro = this.filtroTipo || 'todos';

    // Separar mesas y bancos
    let mesas = this.data.filter(m => (m.tipo_asiento || '').toLowerCase() === 'mesa');
    let bancos = this.data.filter(m => (m.tipo_asiento || '').toLowerCase() === 'banco');

    // Aplicar filtros
    if (filtro === 'salon') {
        mesas = mesas.filter(m => (m.zona || '').toLowerCase() === 'salon');
        bancos = [];
    } else if (filtro === 'bar-mesa') {
        mesas = mesas.filter(m =>
            (m.zona || '').toLowerCase() === 'bar' &&
            (m.tipo_asiento || '').toLowerCase() === 'mesa'
        );
        bancos = [];
    } else if (filtro === 'bar-banco') {
        mesas = [];
        bancos = bancos.filter(m =>
            (m.zona || '').toLowerCase() === 'bar' &&
            (m.tipo_asiento || '').toLowerCase() === 'banco'
        );
    }

    // Renderizar tarjeta individual
    const renderCard = (mesa) => {
        const tipoClase = (mesa.zona?.toLowerCase() === 'salon')
            ? 'tipo-salon'
            : (mesa.tipo_asiento?.toLowerCase() === 'mesa' ? 'tipo-bar-mesa' : 'tipo-bar-banco');

        const estadoClase = mesa.estado === 'reservada' ? 'reservada' : mesa.estado;

        return `
        <div class="mesa-card ${estadoClase} ${tipoClase}" onclick="Tables.handleMesaClick(${mesa.id})">
            <div class="mesa-numero">
                ${(mesa.zona?.toLowerCase() === 'bar' && mesa.tipo_asiento?.toLowerCase() === 'banco') ? 'Banco' : 'Mesa'} ${mesa.numero}
            </div>
            <div class="mesa-estado ${mesa.estado}">${mesa.estado}</div>
            <div class="mesa-info">
                <small>Capacidad: ${mesa.capacidad}</small>
                ${mesa.cliente_nombre ? `<br><small>Cliente: ${mesa.cliente_nombre}</small>` : ''}
                ${mesa.fecha_apertura ? `<br><small>Desde: ${new Date(mesa.fecha_apertura).toLocaleTimeString()}</small>` : ''}
            </div>
            <div class="mesa-actions mt-2">
                ${mesa.estado === 'libre' ? `
                    ${!(mesa.zona?.toLowerCase() === 'bar' && mesa.tipo_asiento?.toLowerCase() === 'banco') ? `
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

    // Renderizar todas
    return [...mesas.map(renderCard), ...bancos.map(renderCard)].join('');
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

    if (mesa.estado === 'libre') {
        this.showAbrirMesaModal(mesaId);
    } else if (mesa.estado === 'ocupada') {
        this.showMesaOcupadaModal(mesaId);
    } else if (mesa.estado === 'reservada') {
        this.showMesaReservadaModal(mesaId);
    }
},

    // Mostrar modal para crear mesa
    showCreateModal() {
    Utils.showModal('Nueva Zona', `
        <form id="create-mesa-form">
            <div class="form-group">
                <label for="tipo-zona">Tipo de Zona *</label>
                <select id="tipo-zona" name="tipo_zona" required>
                    <option value="">Seleccione un tipo</option>
                    <option value="salon">Salón</option>
                    <option value="bar">Bar</option>
                </select>
            </div>

            <div class="form-group" id="tipo-asiento-group" style="display: none;">
                <label for="tipo-asiento">Tipo de Asiento *</label>
                <select id="tipo-asiento" name="tipo_asiento">
                    <option value="mesa">Mesa</option>
                    <option value="banco">Banco</option>
                </select>
            </div>

            <div class="form-group">
                <label for="numero">Número *</label>
                <input type="number" id="numero" name="numero" readonly required>
            </div>

            <div class="form-group">
                <label for="capacidad">Capacidad (personas) *</label>
                <input type="number" id="capacidad" name="capacidad" min="1" max="20" required>
            </div>
        </form>
    `, [
        { text: 'Cancelar', class: 'btn-light' },
        { text: 'Crear Zona', class: 'btn-success', onclick: 'Tables.createMesa()' }
    ]);

    const tipoZona = document.getElementById('tipo-zona');
    const tipoAsientoGroup = document.getElementById('tipo-asiento-group');
    const tipoAsiento = document.getElementById('tipo-asiento');
    const numeroInput = document.getElementById('numero');
    const capacidadInput = document.getElementById('capacidad');

    // Función auxiliar para actualizar número automáticamente
    const actualizarNumero = async () => {
        const zona = tipoZona.value;
        const tipo = zona === 'bar' ? tipoAsiento.value : null;

        if (!zona || (zona === 'bar' && !tipo)) {
            numeroInput.value = '';
            return;
        }

        const numero = await Tables.obtenerSiguienteNumero(zona, tipo);
        numeroInput.value = numero;
    };

    // Evento al cambiar tipo de zona
    tipoZona.addEventListener('change', async function () {
        const esBar = this.value === 'bar';
        tipoAsientoGroup.style.display = esBar ? 'block' : 'none';

        if (!esBar) {
            tipoAsiento.value = 'mesa';
            capacidadInput.removeAttribute('readonly');
            capacidadInput.removeAttribute('disabled');
            capacidadInput.value = '';
            await actualizarNumero();
        } else {
            tipoAsiento.value = '';
            numeroInput.value = '';
        }
    });

    // Evento al cambiar tipo de asiento
    tipoAsiento.addEventListener('change', async function () {
        const isBanco = this.value === 'banco';

        if (isBanco) {
            capacidadInput.value = 1;
            capacidadInput.setAttribute('readonly', 'readonly');
            capacidadInput.setAttribute('disabled', 'disabled');
        } else {
            capacidadInput.removeAttribute('readonly');
            capacidadInput.removeAttribute('disabled');
            capacidadInput.value = '';
        }

        await actualizarNumero();
    });
},

    // Actualizar capacidad según el tipo de mesa
    updateCapacidadByTipo() {
    const tipoZona = document.getElementById('tipo-zona');
    const tipoAsientoGroup = document.getElementById('tipo-asiento-group');
    const tipoAsiento = document.getElementById('tipo-asiento');
    const capacidadInput = document.getElementById('capacidad');
    const numeroInput = document.getElementById('numero');

    tipoZona.addEventListener('change', async () => {
        const zona = tipoZona.value;
        const esBar = zona === 'bar';

        tipoAsientoGroup.style.display = esBar ? 'block' : 'none';

        if (!esBar) {
            tipoAsiento.value = '';
            numeroInput.readOnly = true;
            const numero = await Tables.obtenerSiguienteNumero(zona);
            numeroInput.value = numero;

            capacidadInput.removeAttribute('readonly');
            capacidadInput.removeAttribute('disabled');
            capacidadInput.value = '';
        } else {
            numeroInput.value = '';
            numeroInput.readOnly = true;
        }
    });

    tipoAsiento.addEventListener('change', async () => {
        const zona = tipoZona.value;
        const tipo = tipoAsiento.value;

        if (zona === 'bar' && tipo) {
            const numero = await Tables.obtenerSiguienteNumero(zona, tipo);
            numeroInput.value = numero;
            numeroInput.readOnly = true;
        }

        if (tipo === 'banco') {
            capacidadInput.value = 1;
            capacidadInput.setAttribute('readonly', 'readonly');
            capacidadInput.setAttribute('disabled', 'disabled');
        } else {
            capacidadInput.removeAttribute('readonly');
            capacidadInput.removeAttribute('disabled');
            capacidadInput.value = '';
        }
    });

},

    // Crear mesa
   async createMesa() {
    const form = document.getElementById('create-mesa-form');
    if (!Utils.validateForm(form)) {
        Utils.showNotification('Por favor complete todos los campos requeridos', 'warning');
        return;
    }

    const formData = new FormData(form);

    const tipo_zona = formData.get('tipo_zona');
    const tipo_asiento = formData.get('tipo_asiento') || null;
    const numero = parseInt(formData.get('numero'), 10);
    let capacidad = parseInt(formData.get('capacidad'), 10);

    // Forzar capacidad si es banco
    if (tipo_zona === 'bar' && tipo_asiento === 'banco') {
        capacidad = 1;
    }

    const data = {
        tipo_zona,
        tipo_asiento: tipo_zona === 'bar' ? tipo_asiento : null,
        numero,
        capacidad
    };

    try {
        
        await Utils.request('/tables', {
            method: 'POST',
            body: JSON.stringify(data)
        });

        Utils.hideModal();
        Utils.showNotification('Zona creada exitosamente', 'success');

        if (typeof this.load === 'function') {
            this.load();
        }

        if (typeof Dashboard?.refreshData === 'function') {
            Dashboard.refreshData();
        }
    } catch (error) {
        console.error('❌ Error creando zona:', error);
        Utils.showNotification(error.message || 'Error al crear zona', 'error');
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
    `, [
        {
            text: 'Cancelar',
            class: 'btn-light'
        },
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
    ], 'modal-reservation-status');
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
    `, [
        {
            text: 'Cerrar',
            class: 'btn-light'
        },
        {
            text: '<i class="fas fa-receipt"></i> Ver pedidos',
            class: 'btn-primary',
            onclick: `Utils.hideModal(); Navigation.showSection('orders');`
        },
        {
            text: `<i class="fas fa-stop"></i> Cerrar ${tipoNombre}`,
            class: 'btn-warning',
            align: 'right',
            onclick: `Tables.cerrarMesa(${mesaId})`
        }
    ], 'modal-zone-occupied');
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

};



// Exportar globalmente para acceso desde otros módulos
window.Tables = Tables;
