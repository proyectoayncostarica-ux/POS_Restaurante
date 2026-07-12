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

        <div class="d-flex gap-2">
            <span class="badge badge-success">Libres: ${this.data.filter(m => m.estado === 'libre').length}</span>
            <span class="badge badge-danger">Ocupadas: ${this.data.filter(m => m.estado === 'ocupada').length}</span>
            <span class="badge badge-warning">Reservadas: ${this.data.filter(m => m.estado === 'reservada').length}</span>
        </div>

        <div class="mesas-grid">
            ${this.renderMesasGrid()}
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

    Utils.showModal(`Abrir Zona (${nombreZona} ${mesa.numero})`, `
        <form id="abrir-mesa-form">
            <div class="form-group">
                <label>${nombreZona}: ${mesa.numero}</label>
                <p>
                    Tipo: <span class="badge badge-info">${tipoTexto}</span><br>
                    Capacidad: ${mesa.capacidad} personas
                </p>
            </div>

            <div class="form-group">
                <label for="estado-mesa">Estado del ${nombreZona} *</label>
                <select id="estado-mesa" name="estado" required onchange="Tables.toggleClienteFields()">
                    ${estadoOptions}
                </select>
            </div>

            <div class="form-group">
                <label for="cantidad-personas">Cantidad de Personas *</label>
                ${capacidadInput}
            </div>

            <div class="form-group" id="cliente-nombre-group">
                <label for="cliente-nombre">Nombre del Cliente *</label>
                <input type="text" id="cliente-nombre" name="cliente_nombre" required>
            </div>

            <div class="form-group" id="hora-estimada-group" style="display: none;">
                <label for="hora-estimada">Hora Estimada de Llegada</label>
                <input type="time" id="hora-estimada" name="hora_estimada">
            </div>
        </form>
    `, [
        {
            text: 'Cancelar',
            class: 'btn-light'
        },
        {
            text: 'Abrir Zona',
            class: 'btn-success',
            onclick: `Tables.abrirMesa(${mesaId})`
        }
    ]);
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

    Utils.showModal(`${tipoNombre} ${mesa.numero} - Reservada`, `
        <div class="mesa-info">
            <p><strong>Reservado por:</strong> ${mesa.cliente_nombre || mesa.nombre_reserva}</p>
            <p><strong>Hora estimada:</strong> ${mesa.hora_estimada || 'No especificada'}</p>
            <p><strong>Capacidad:</strong> ${mesa.capacidad} personas</p>
            <p><strong>Cantidad de personas:</strong> ${mesa.cantidad_personas || 'No especificada'}</p>
        </div>
        <div class="alert alert-warning mt-3">
            <i class="fas fa-question-circle"></i>
            ¿Qué desea hacer con esta mesa reservada?
        </div>
    `, [
        {
            text: 'Cancelar',
            class: 'btn-light'
        },
        {
            text: 'Cambiar a OCUPADA',
            class: 'btn-success',
            onclick: `Tables.cambiarReservaAOcupada(${mesaId})`
        },
        {
            text: 'Liberar Mesa',
            class: 'btn-warning',
            onclick: `Tables.liberarMesaReservada(${mesaId})`
        }
    ]);
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

    const confirmed = await Utils.confirm(
        `¿Está seguro de liberar el ${tipoNombre} ${mesa.numero}? Se cancelará la reserva.`,
        'Confirmar Liberación'
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

    // Mostrar modal para mesa ocupada
    showMesaOcupadaModal(mesaId) {
    const mesa = this.data.find(m => m.id === mesaId);
    if (!mesa) return;

    const esBanco = mesa.zona?.toLowerCase() === 'bar' && mesa.tipo_asiento?.toLowerCase() === 'banco';
    const tipoNombre = esBanco ? 'Banco' : 'Mesa';

    Utils.showModal(`${tipoNombre} ${mesa.numero} - Ocupado`, `
        <div class="mesa-info">
            <p><strong>Cliente:</strong> ${mesa.cliente_nombre}</p>
            <p><strong>Desde:</strong> ${Utils.formatDate(mesa.fecha_apertura)}</p>
            <p><strong>Capacidad:</strong> ${mesa.capacidad} personas</p>
        </div>
        <div class="mesa-actions mt-3">
            <button class="btn btn-primary" onclick="Utils.hideModal(); Navigation.showSection('orders');">
                <i class="fas fa-receipt"></i> Ver Pedidos
            </button>
            <button class="btn btn-warning" onclick="Tables.cerrarMesa(${mesaId})">
                <i class="fas fa-stop"></i> Cerrar ${tipoNombre}
            </button>
        </div>
    `, [
        {
            text: 'Cerrar',
            class: 'btn-light'
        }
    ]);
},

    // Cerrar mesa
async cerrarMesa(mesaId) {
    const mesa = this.data.find(m => m.id === mesaId);
    if (!mesa) return;

    const esBanco = mesa.zona?.toLowerCase() === 'bar' && mesa.tipo_asiento?.toLowerCase() === 'banco';
    const tipoNombre = esBanco ? 'Banco' : 'Mesa';

    const confirmed = await Utils.confirm(
        `¿Está seguro de cerrar el/la ${tipoNombre} ${mesa.numero}? Asegúrese de que no tenga pedidos pendientes.`,
        `Confirmar Cierre de ${tipoNombre}`
    );

    if (!confirmed) return;

    try {
        await Utils.request(`/tables/${mesaId}/close`, {
            method: 'POST'
        });

        Utils.hideModal();
        Utils.showNotification(`${tipoNombre} cerrada exitosamente`, 'success');
        this.load();
        if (typeof Dashboard?.refreshData === 'function') {
            Dashboard.refreshData();
        };
    } catch (error) {
        Utils.showNotification(error.message, 'error');
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
