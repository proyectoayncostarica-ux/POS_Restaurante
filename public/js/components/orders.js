// Orders Component
const Orders = {
    orders: [],
    products: [],
    tables: [],
    currentView: 'pending', // 'pending', 'paid', 'all'
    selectedOrder: null,
    operationalMenu: null,
    menuContractVersion: null,
    preinvoiceContext: null,
    preinvoiceDraft: null,
    preinvoiceSubmitting: false,
    selectedInstructions: {},

    getOperationalPayload(response) {
        return response?.data || response || {};
    },

    normalizeImageUrl(image) {
        if (!image) return `${window.location.origin}/uploads/ImagenGenerica.jpg`;
        if (/^https?:\/\//i.test(image)) return image;
        return image.startsWith('/')
            ? `${window.location.origin}${image}`
            : `${window.location.origin}/${image}`;
    },

    productHasPresentations(product) {
        return Number(product?.tiene_presentaciones) === 1
            || Number(product?.total_presentaciones || 0) > 0
            || (Array.isArray(product?.presentaciones) && product.presentaciones.length > 0);
    },

    formatOperationalProductPrice(product) {
        if (this.productHasPresentations(product)) {
            const min = Number(product?.precio_minimo ?? product?.precio_operativo ?? 0);
            const max = Number(product?.precio_maximo ?? min);

            if (min > 0 && max > 0 && min !== max) {
                return `${Utils.formatCurrency(min)} - ${Utils.formatCurrency(max)}`;
            }

            if (min > 0) {
                return `Desde ${Utils.formatCurrency(min)}`;
            }

            return 'Elegir presentación';
        }

        return Utils.formatCurrency(Number(product?.precio_operativo ?? product?.precio ?? 0));
    },

    getOperationalProducts() {
        return (this.products || []).filter(product => Number(product?.disponible_operacion ?? 1) === 1);
    },

    getProductUnitPrice(product) {
        return Number(product?.precio_operativo ?? product?.precio ?? 0);
    },

    syncMenuOperationalState(payload = {}) {
        const categorias = payload.categorias || [];
        const productos = payload.productos || [];

        this.operationalMenu = payload;
        this.menuContractVersion = payload.version_contrato || null;
        this.products = productos;

        if (typeof Menu !== 'undefined') {
            Menu.categories = categorias;
            Menu.products = productos;
        }
    },

    async loadOperationalMenu() {
        const response = await Utils.request('/menu/operational-products');
        const payload = this.getOperationalPayload(response);
        this.syncMenuOperationalState(payload);
        return payload;
    },

    buildSelectedProductsPayload() {
        const productos = [];

        for (const [key, item] of Object.entries(this.selectedProducts || {})) {
            if (typeof item === 'object') {
                let productoId = item.producto_id;
                if (!productoId) {
                    const keyParts = String(key).split('_');
                    productoId = parseInt(keyParts[0], 10);
                } else {
                    productoId = parseInt(productoId, 10);
                }

                const cantidad = parseInt(item.cantidad, 10);
                if (!productoId || !cantidad || cantidad <= 0) continue;

                const productoPayload = {
                    producto_id: productoId,
                    cantidad
                };

                if (item.presentacion_id !== undefined && item.presentacion_id !== null) {
                    productoPayload.presentacion_id = parseInt(item.presentacion_id, 10);
                }

                const instructions = this.selectedInstructions?.[key] || {};
                if (instructions.observacion) productoPayload.observacion = instructions.observacion;
                if (instructions.adicionales) {
                    productoPayload.adicionales = String(instructions.adicionales)
                        .split(',')
                        .map(value => value.trim())
                        .filter(Boolean);
                }
                productos.push(productoPayload);
            } else {
                const productoId = parseInt(key, 10);
                const cantidad = parseInt(item, 10);
                if (!productoId || !cantidad || cantidad <= 0) continue;

                const productoPayload = {
                    producto_id: productoId,
                    cantidad
                };
                const instructions = this.selectedInstructions?.[key] || {};
                if (instructions.observacion) productoPayload.observacion = instructions.observacion;
                if (instructions.adicionales) {
                    productoPayload.adicionales = String(instructions.adicionales)
                        .split(',')
                        .map(value => value.trim())
                        .filter(Boolean);
                }
                productos.push(productoPayload);
            }
        }

        return productos;
    },

    // Cargar datos de pedidos
    async load() {
        try {
            const [ordersResponse, menuResponse, tablesResponse] = await Promise.all([
                Utils.request('/orders'),
                Utils.request('/menu/operational-products'),
                Utils.request('/tables')
            ]);

            const operationalPayload = this.getOperationalPayload(menuResponse);
            this.orders = ordersResponse.data;
            this.syncMenuOperationalState(operationalPayload);
            this.tables = tablesResponse.data;
            this.render();
        } catch (error) {
            console.error('Error cargando pedidos:', error);
            Utils.showNotification('Error cargando datos de pedidos', 'error');
        }
    },

    // Renderizar sección de pedidos
    render() {
        const section = document.getElementById('orders-section');
        
        section.innerHTML = `
            <div class="section-header">
                <h2>Gestión de Pedidos</h2>
                <p>Administra los pedidos del restaurante</p>
            </div>

            <div class="mb-3">
    <!-- Línea 1: filtros -->
    <div class="d-flex gap-2 mb-2 flex-wrap internal-tabs" aria-label="Filtros de pedidos">
        <button class="btn ${this.currentView === 'pending' ? 'btn-primary active' : 'btn-light'}" data-subnav-item="pending" onclick="Navigation.selectInternal('orders', 'pending')">
            <i class="fas fa-clock"></i> Pendientes
        </button>
        <button class="btn ${this.currentView === 'paid' ? 'btn-primary active' : 'btn-light'}" data-subnav-item="paid" onclick="Navigation.selectInternal('orders', 'paid')">
            <i class="fas fa-check-circle"></i> Pagados
        </button>
        <button class="btn ${this.currentView === 'all' ? 'btn-primary active' : 'btn-light'}" data-subnav-item="all" onclick="Navigation.selectInternal('orders', 'all')">
         <i class="fas fa-list"></i> Todos
        </button>
    </div>

    <!-- Línea 2: acciones -->
    <div class="d-flex gap-2 flex-wrap">
        <button class="btn btn-success" onclick="Orders.showCreateOrderModal()">
            <i class="fas fa-plus"></i> Nuevo Pedido
        </button>
        <button class="btn btn-sm btn-secondary" onclick="Orders.load()" title="Actualizar pedidos">
            <i class="fas fa-sync text-white"></i>
        </button>
    </div>
</div>


            <div class="internal-view-panel" data-internal-panel="orders">
                ${this.renderOrdersView()}
            </div>
        `;
    },

    // Cambiar vista
    async switchView(view) {
        this.currentView = view;
        
        try {
            let url = '/orders';
            if (view === 'pending') url += '?estado=pendiente';
            else if (view === 'paid') url += '?estado=pagado';
            
            const response = await Utils.request(url);
            this.orders = response.data;
            this.render();
            Navigation.syncInternalSubnav('orders');
        } catch (error) {
            console.error('Error cargando pedidos:', error);
            Utils.showNotification('Error cargando pedidos', 'error');
        }
    },

    // Renderizar vista de pedidos
    renderOrdersView() {
        const filteredOrders = this.getFilteredOrders();

        const pendientes = this.orders.filter(o => o.estado === 'pendiente').length;
        const pagadosHoy = this.orders.filter(o => o.estado === 'pagado' && this.isToday(o.fecha)).length;
        const creditos = this.orders.filter(o => o.estado === 'credito').length;
        const totalPagadoHoy = this.orders
            .filter(o => o.estado === 'pagado' && this.isToday(o.fecha))
            .reduce((sum, o) => sum + (o.total || 0), 0);

        return `
            <div class="orders-summary mb-3">
                <div class="d-flex gap-3 flex-wrap">
                    <span class="badge badge-warning">Pendientes: ${pendientes}</span>
                    <span class="badge badge-success">Pagados Hoy: ${pagadosHoy}</span>
                    <span class="badge badge-danger">Créditos: ${creditos}</span>
                    <span class="badge badge-info">Total: ${Utils.formatCurrency(totalPagadoHoy)}</span>
                </div>
            </div>

            <div class="table-container">
                <table class="table">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Zona</th>
                            <th>Total</th>
                            <th>Estado</th>
                            <th>Usuario</th>
                            <th>Fecha</th>
                            <th>Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${this.renderOrdersTable(filteredOrders)}
                    </tbody>
                </table>
            </div>
        `;
    },

    // Obtener pedidos filtrados
    getFilteredOrders() {
        switch (this.currentView) {
            case 'pending':
                return this.orders.filter(o => o.estado === 'pendiente');
            case 'paid':
                return this.orders.filter(o => o.estado === 'pagado');
            default:
                return this.orders;
        }
    },

    // Verificar si es hoy
    isToday(dateString) {
        const today = new Date().toDateString();
        const date = new Date(dateString).toDateString();
        return today === date;
    },

    // Renderizar tabla de pedidos
    renderOrdersTable(orders) {
        if (orders.length === 0) {
            return '<tr><td colspan="7" class="text-center">No hay pedidos</td></tr>';
        }

        return orders.map(order => {
            const nombreZona = (order.mesa_tipo && order.mesa_tipo.toLowerCase() === 'barra') ? 'Banco' : 'Mesa';

            const estadoColor = order.estado === 'pendiente'
                ? 'warning'
                : order.estado === 'pagado'
                ? 'success'
                : 'danger';

            const estadoTexto = order.estado === 'credito'
                ? 'Crédito'
                : order.estado === 'pagado'
                ? 'Pagado'
                : 'Pendiente';

            const totalTexto = order.estado === 'credito'
                ? '₡0'
                : Utils.formatCurrency(order.total);

            return `
                <tr>
                    <td><strong>#${order.id}</strong></td>
                    <td>${nombreZona} ${order.mesa_numero}</td>
                    <td>${totalTexto}</td>
                    <td>
                        <span class="badge badge-${estadoColor} ${order.estado === 'credito' ? 'text-dark' : ''}">
                            ${estadoTexto}
                        </span>
                    </td>
                    <td>${order.usuario_nombre}</td>
                    <td>${Utils.formatDate(order.fecha)}</td>
                    <td>
                        <div class="d-flex gap-1">
                            <button class="btn btn-info btn-sm" onclick="Orders.viewOrder(${order.id})">
                                <i class="fas fa-eye"></i>
                            </button>
                            ${order.estado === 'pendiente' ? `
                                ${typeof Access !== 'undefined' && Access.has('cash.access') ? `
                                    <button class="btn btn-success btn-sm" title="Abrir cuenta en Caja" onclick="Orders.openInCash(${order.id})">
                                        <i class="fas fa-cash-register"></i>
                                    </button>
                                ` : ''}
                                <button class="btn btn-primary btn-sm" onclick="Orders.showAddProductsModal(${order.id})">
                                    <i class="fas fa-plus"></i>
                                </button>
                            ` : ''}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    },    

    //Confirma Pago
    confirmarPago(orderId, zona, numero) {
        Utils.confirm(
            `¿Deseas abrir en Caja la cuenta #${orderId} de la ${zona.toLowerCase()} ${numero}?`,
            'Abrir en Caja'
        ).then(confirmado => {
            if (confirmado) {
                Orders.openInCash(orderId);
            }
        });
    },

    // Mostrar modal para crear pedido
    showCreateOrderModal(mesaId = null) {
    this.mesaIdActual = mesaId;
    const availableTables = this.tables.filter(t => t.estado === 'ocupada');
    this.modalContext = 'nuevo';

    const tipoZona = mesaId !== null
        ? (
            (() => {
                const mesa = this.tables.find(t => t.id === mesaId);
                if (!mesa) return 'zonas';

                if ((mesa.zona || '').toLowerCase() === 'bar') {
                    return (mesa.tipo_asiento || '').toLowerCase() === 'banco' ? 'bancos' : 'mesas';
                }

                return 'mesas';
            })()
        )
        : 'zonas';

    const zonaSeleccionada = mesaId !== null ? this.tables.find(t => t.id === mesaId) : null;
    const nombreZonaSeleccionada = zonaSeleccionada
        ? (zonaSeleccionada.zona?.toLowerCase() === 'bar'
            ? (zonaSeleccionada.tipo_asiento?.toLowerCase() === 'banco' ? 'Banco' : 'Mesa')
            : 'Mesa')
        : '';

    const totalPedido = this.getTotalSeleccionado();
    const tipoAsiento = zonaSeleccionada?.tipo_asiento?.toLowerCase() === 'banco' ? 'banco' : 'mesa';

    Utils.showModal(
        'Nuevo Pedido' + (
            mesaId !== null
                ? ` / ${nombreZonaSeleccionada} ${zonaSeleccionada.numero} - ${zonaSeleccionada.cliente_nombre || ''}`
                : ''
        ),
        `
        <form id="create-order-form">

            <!-- UI VISUAL PRINCIPAL -->
            <div class="form-group">
                <div id="pedido-ui-dinamico">
                    <!-- Pestañas dinámicas de categorías -->
                    <div id="pedido-tabs" class="tabs"></div>

                    <!-- Subcategorías asociadas a la pestaña activa -->
                    <div id="pedido-subcategorias" class="subcategorias"></div>

                    <!-- Grid de productos según subcategoría seleccionada -->
                    <div id="pedido-productos" class="productos-grid" style="min-height: 200px;"></div>
                </div>
            </div>

            <!-- Mostramos selector solo si mesaId es null -->
            ${
                mesaId === null
                ? `
                    <div class="form-group mesa-inline mt-3">
                        <label for="order-mesa" class="form-label-sm">Zona *</label>
                        <select id="order-mesa" name="mesa_id" class="form-control-sm" required>
                            <option value="">Seleccione una zona</option>
                            ${
                                availableTables.map(table => {
                                    const tipoNombre = table.zona?.toLowerCase() === 'bar'
                                        ? (table.tipo_asiento?.toLowerCase() === 'banco' ? 'Banco' : 'Mesa')
                                        : 'Mesa';
                                    return `<option value="${table.id}">${tipoNombre} ${table.numero} - ${table.cliente_nombre}</option>`;
                                }).join('')
                            }
                        </select>
                    </div>
                `
                : ''
            }

            <!-- Total -->
            <div class="order-total mt-3 mb-1">
                <strong>Total: <span id="order-total">$0.00</span></strong>
            </div>

        </form>
        `,
        (() => {
            const botones = [
                {
                    text: 'Crear Pedido',
                    class: 'btn-success',
                    onclick: () => Orders.showOrderSummaryModal()
                }
            ];

            if (mesaId !== null) {
                if (totalPedido > 0) {
                    botones.push({
                        text: 'Cancelar Pedido',
                        class: 'btn-primary',
                        align: 'left',
                        onclick: () => {
                            Orders.selectedProducts = {};
                            Orders.selectedInstructions = {};
                            Orders.updateOrderTotal();
                            Utils.hideModal();
                            setTimeout(() => {
                                Orders.showCreateOrderModal(mesaId);
                            }, 200);
                            Utils.showNotification('Pedido cancelado. Ahora puede liberar la mesa.', 'info');
                        }
                    });
                } else {
                    botones.push({
                        text: '<i class="fas fa-chair"></i> Liberar',
                        class: 'btn-danger',
                        align: 'left',
                        onclick: () => Orders.liberarMesaSinPedido(mesaId)
                    });
                }
            }

            botones.push({
                text: 'Cancelar',
                class: 'btn-light',
                align: 'right'
            });

            return botones;
        })(),
        'modal-lg'
    );

    // Inicializar pestañas visuales y total desde el contrato operativo de Menú
    this.loadOperationalMenu().then(() => {
        Orders.loadTabsUI();
        this.updateOrderTotal();
        Orders.refreshOrderModalUI();
    }).catch(error => {
        console.error('Error cargando menú operativo para pedido:', error);
        Utils.showNotification('Error cargando el menú operativo', 'error');
    });
    },

    // Liberar mesa/banco desde el modal Nuevo Pedido cuando no hay pedido activo
    async liberarMesaSinPedido(mesaId) {
        const numericMesaId = parseInt(mesaId, 10);
        if (!Number.isFinite(numericMesaId)) {
            Utils.showNotification('No se pudo identificar la mesa/banco para liberar', 'warning');
            return;
        }

        if (typeof Tables === 'undefined' || typeof Tables.cerrarMesa !== 'function') {
            Utils.showNotification('No se pudo cargar la acción para liberar la zona', 'error');
            return;
        }

        const mesaDesdePedido = Array.isArray(this.tables)
            ? this.tables.find(t => parseInt(t.id, 10) === numericMesaId)
            : null;

        if (mesaDesdePedido && (!Array.isArray(Tables.data) || !Tables.data.some(t => parseInt(t.id, 10) === numericMesaId))) {
            Tables.data = Array.isArray(Tables.data) && Tables.data.length > 0
                ? [...Tables.data, mesaDesdePedido]
                : [...this.tables];
        }

        const liberada = await Tables.cerrarMesa(numericMesaId);
        if (liberada) {
            this.selectedProducts = {};
            this.selectedInstructions = {};
            this.mesaIdActual = null;
            await this.load();
        }
    },

    // Agregar fila de producto
    addProductRow() {
        const container = document.getElementById('order-products');
        const newRow = document.createElement('div');
        newRow.className = 'product-selector';
        newRow.innerHTML = `
            <select class="product-select" onchange="Orders.updateProductPrice(this)">
                <option value="">Seleccione un producto</option>
                ${this.products.map(product => `
                    <option value="${product.id}" data-price="${product.precio}" data-cocina="${product.es_cocina}" data-destino="${product.destino_preparacion || 'ninguno'}">
                        ${product.nombre} - ${Utils.formatCurrency(product.precio)}
                    </option>
                `).join('')}
            </select>
            <input type="number" class="product-quantity" min="1" value="1" placeholder="Cant." onchange="Orders.calculateTotal()">
            <span class="product-price">$0.00</span>
            <button type="button" class="btn btn-danger btn-sm" onclick="Orders.removeProductRow(this)">
                <i class="fas fa-trash"></i>
            </button>
        `;
        container.appendChild(newRow);
    },

    // Remover fila de producto
    removeProductRow(button) {
        button.parentElement.remove();
        this.calculateTotal();
    },

    // Actualizar precio del producto
    updateProductPrice(select) {
        const option = select.selectedOptions[0];
        const priceSpan = select.parentElement.querySelector('.product-price');
        const quantityInput = select.parentElement.querySelector('.product-quantity');
        
        if (option && option.dataset.price) {
            const price = parseFloat(option.dataset.price);
            const quantity = parseInt(quantityInput.value) || 1;
            priceSpan.textContent = Utils.formatCurrency(price * quantity);
        } else {
            priceSpan.textContent = '$0.00';
        }
        
        this.calculateTotal();
    },

    // Calcular total
    calculateTotal() {
        const productSelectors = document.querySelectorAll('.product-selector');
        let total = 0;
        
        productSelectors.forEach(selector => {
            const select = selector.querySelector('.product-select');
            const quantity = parseInt(selector.querySelector('.product-quantity').value) || 0;
            const option = select.selectedOptions[0];
            
            if (option && option.dataset.price) {
                total += parseFloat(option.dataset.price) * quantity;
            }
        });
        
        document.getElementById('order-total').textContent = Utils.formatCurrency(total);
    },

// Crear pedido
    async createOrder() {
  const mesaId = this.mesaIdActual ?? document.getElementById('order-mesa')?.value;
  const mesa = this.tables.find(t => t.id === parseInt(mesaId));
  const tipoZona = mesa?.zona?.toLowerCase() === 'bar'
    ? (mesa?.tipo_asiento?.toLowerCase() === 'banco' ? 'banco' : 'mesa')
    : 'mesa';

  if (!mesaId) {
    Utils.showNotification(`Por favor seleccione una ${tipoZona}`, 'warning');
    return;
  }

  const productos = this.buildSelectedProductsPayload();

  if (productos.length === 0) {
    Utils.showNotification('Por favor agregue al menos un producto válido', 'warning');
    return;
  }

  try {
        const response = await Utils.request('/orders', {
      method: 'POST',
      body: JSON.stringify({
        mesa_id: parseInt(mesaId),
        productos
      })
    });

    Utils.hideModal();

    if (typeof Dashboard?.refreshData === 'function') {
      Dashboard.refreshData(mesaId);
    }

    if (response.data?.requiere_comanda) {
      Utils.showNotification('La solicitud fue enviada al área de preparación.', 'info');
    }

    Utils.showNotification('Pedido creado exitosamente', 'success');

    // 🔄 Limpiar memoria temporal
    this.selectedProducts = {};
    this.selectedInstructions = {};
    this.mesaIdActual = null;
    this.load();

  } catch (error) {
    Utils.showNotification(`Error al crear el pedido para la ${tipoZona}`, 'error');
    console.error('Error en createOrder():', error);
  }
    },

    // Orders conserva el punto de entrada visual; la navegación transversal vive en OrderWorkflow.
    async openInCash(orderId) {
        return OrderWorkflow.openInCash(orderId);
    },

    // Mostrar modal para agregar productos a una cuenta existente
    async showAddProductsModal(orderId, preserveSelection = false) {
        try {
            const response = await Utils.request(`/orders/${orderId}`);
            const order = response.data;
            await this.loadOperationalMenu();

            this.modalContext = 'agregar';
            this.orderIdActual = orderId;
            this.mesaIdActual = order.mesa_id || null;
            if (!preserveSelection) {
                this.selectedProducts = {};
                this.selectedInstructions = {};
            }

            const tipoZona = order.zona?.toLowerCase() === 'bar'
                ? (order.tipo_asiento?.toLowerCase() === 'banco' ? 'Banco' : 'Mesa')
                : 'Mesa';

            Utils.showModal(`Agregar productos / ${tipoZona} ${order.mesa_numero}`, `
                <form id="add-products-form">
                    <div class="form-group">
                        <div id="pedido-ui-dinamico">
                            <div id="pedido-tabs" class="tabs"></div>
                            <div id="pedido-subcategorias" class="subcategorias"></div>
                            <div id="pedido-productos" class="productos-grid" style="min-height: 200px;"></div>
                        </div>
                    </div>

                    <div class="order-total mt-3 mb-1">
                        <strong>Total adicional: <span id="order-total">$0.00</span></strong>
                    </div>
                </form>
            `, [
                {
                    text: 'Agregar Productos',
                    class: 'btn-success',
                    onclick: () => Orders.showOrderSummaryModal()
                },
                {
                    text: 'Ver Pedido',
                    class: 'btn-warning text-white',
                    align: 'left',
                    onclick: () => Orders.viewOrder(orderId)
                },
                {
                    text: 'Cancelar',
                    class: 'btn-light',
                    align: 'right',
                    onclick: () => {
                        Orders.selectedProducts = {};
                        Orders.selectedInstructions = {};
                        Utils.hideModal();
                    }
                }
            ], 'modal-lg');

            Orders.loadTabsUI();
            Orders.updateOrderTotal();
            Orders.refreshOrderModalUI();

            if (typeof Dashboard?.refreshData === 'function') {
                Dashboard.refreshData(order.mesa_id);
            }
        } catch (error) {
            console.error('Error cargando pedido para agregar productos:', error);
            Utils.showNotification('Error cargando pedido', 'error');
        }
    },

    // Agregar fila de producto a la lista
    addProductRowToList() {
        const container = document.getElementById('add-products-list');
        const newRow = document.createElement('div');
        newRow.className = 'product-selector';
        newRow.innerHTML = `
            <select class="product-select" onchange="Orders.updateProductPrice(this)">
                <option value="">Seleccione un producto</option>
                ${this.products.map(product => `
                    <option value="${product.id}" data-price="${product.precio}" data-cocina="${product.es_cocina}" data-destino="${product.destino_preparacion || 'ninguno'}">
                        ${product.nombre} - ${Utils.formatCurrency(product.precio)}
                    </option>
                `).join('')}
            </select>
            <input type="number" class="product-quantity" min="1" value="1" placeholder="Cant." onchange="Orders.calculateAddTotal()">
            <span class="product-price">$0.00</span>
            <button type="button" class="btn btn-danger btn-sm" onclick="Orders.removeProductRow(this)">
                <i class="fas fa-trash"></i>
            </button>
        `;
        container.appendChild(newRow);
    },

    // Calcular total adicional
    calculateAddTotal() {
        const productSelectors = document.querySelectorAll('#add-products-list .product-selector');
        let total = 0;
        
        productSelectors.forEach(selector => {
            const select = selector.querySelector('.product-select');
            const quantity = parseInt(selector.querySelector('.product-quantity').value) || 0;
            const option = select.selectedOptions[0];
            
            if (option && option.dataset.price) {
                total += parseFloat(option.dataset.price) * quantity;
            }
        });
        
        document.getElementById('add-order-total').textContent = Utils.formatCurrency(total);
    },

    // Agregar productos al pedido
    async addProductsToOrder(orderId) {
        const productos = this.buildSelectedProductsPayload();

        if (productos.length === 0) {
            Utils.showNotification('Por favor agregue al menos un producto', 'warning');
            return;
        }

        try {
            const response = await Utils.request(`/orders/${orderId}/products`, {
                method: 'POST',
                body: JSON.stringify({ productos })
            });

            Utils.hideModal();
            this.selectedProducts = {};
            this.selectedInstructions = {};
            this.orderIdActual = null;
            this.modalContext = null;

            if (response.data.requiere_comanda) {
                Utils.showNotification('La solicitud fue enviada al área de preparación.', 'info');
            }

            Utils.showNotification('Productos agregados exitosamente', 'success');
            this.load();
        } catch (error) {
            Utils.showNotification(error.message, 'error');
        }
    },

    escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    },

    roundMoney(value) {
        const numeric = Number(value || 0);
        return Math.round((numeric + Number.EPSILON) * 100) / 100;
    },

    hasOperationalCapability(code) {
        return typeof Access === 'undefined' || Access.has(code);
    },

    getConsumptionLineLabel(product = {}) {
        const name = product.producto_nombre || product.producto_nombre_snapshot || 'Producto';
        const presentation = product.presentacion_nombre || product.presentacion_nombre_snapshot;
        const amount = product.presentacion_cantidad || product.presentacion_cantidad_snapshot;
        return presentation
            ? `${name} - ${presentation}${amount ? ` (${amount})` : ''}`
            : name;
    },

    calculatePreinvoiceDraft(order, assignments = []) {
        const available = Array.isArray(order?.productos_disponibles) ? order.productos_disponibles : [];
        const byLine = new Map(available.map(line => [Number(line.pedido_producto_id || line.id), line]));
        const items = [];
        let subtotal = 0;
        let service = 0;

        assignments.forEach(assignment => {
            const lineId = Number(assignment.pedido_producto_id);
            const quantity = Number(assignment.cantidad);
            const line = byLine.get(lineId);
            if (!line || !Number.isInteger(quantity) || quantity <= 0) return;

            const max = Number(line.cantidad_disponible || 0);
            if (quantity > max) return;

            const lineSubtotal = this.roundMoney(Number(line.precio_unitario || 0) * quantity);
            const percentage = Number(line.aplica_servicio_snapshot || 0) === 1
                ? Number(line.porcentaje_servicio_snapshot || 0)
                : 0;
            const lineService = this.roundMoney(lineSubtotal * percentage / 100);
            const lineTotal = this.roundMoney(lineSubtotal + lineService);

            subtotal = this.roundMoney(subtotal + lineSubtotal);
            service = this.roundMoney(service + lineService);
            items.push({
                ...line,
                pedido_producto_id: lineId,
                cantidad_seleccionada: quantity,
                subtotal_seleccionado: lineSubtotal,
                servicio_seleccionado: lineService,
                total_seleccionado: lineTotal
            });
        });

        return {
            assignments,
            items,
            subtotal,
            service,
            total: this.roundMoney(subtotal + service)
        };
    },

    buildPreinvoiceIdempotencyKey(orderId) {
        const random = window.crypto?.randomUUID?.()
            || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        return `prefactura:${Number(orderId)}:${random}`;
    },

    async loadAccountPreinvoices(orderId) {
        const response = await Utils.request(`/orders/${orderId}/preinvoices`);
        return Array.isArray(response?.data) ? response.data : [];
    },

    renderPreinvoiceStatus(status) {
        const normalized = String(status || 'emitida').toLowerCase();
        const badge = {
            emitida: 'warning',
            parcial: 'info',
            pagada: 'success',
            anulada: 'secondary'
        }[normalized] || 'secondary';
        return `<span class="badge badge-${badge}">${this.escapeHtml(normalized)}</span>`;
    },

    getPreinvoiceAssignmentsFromView(order, splitMode) {
        const available = Array.isArray(order?.productos_disponibles) ? order.productos_disponibles : [];
        if (!splitMode) {
            return available.map(line => ({
                pedido_producto_id: Number(line.pedido_producto_id || line.id),
                cantidad: Number(line.cantidad_disponible || 0),
                version: Number(line.version || 1)
            })).filter(item => item.cantidad > 0);
        }

        return [...document.querySelectorAll('.preinvoice-line-check:checked')]
            .map(checkbox => {
                const lineId = Number(checkbox.dataset.lineId);
                const version = Number(checkbox.dataset.version || 1);
                const input = document.getElementById(`preinvoice-qty-${lineId}`);
                const quantity = Number(input?.value || 1);
                const max = Number(input?.max || 1);
                if (!Number.isInteger(quantity) || quantity <= 0 || quantity > max) return null;
                return {
                    pedido_producto_id: lineId,
                    cantidad: quantity,
                    version
                };
            })
            .filter(Boolean);
    },

    updatePreinvoiceSelection() {
        const context = this.preinvoiceContext;
        if (!context) return;

        document.querySelectorAll('.preinvoice-line-check').forEach(checkbox => {
            const input = document.getElementById(`preinvoice-qty-${checkbox.dataset.lineId}`);
            if (input) input.disabled = !checkbox.checked;
        });

        const assignments = this.getPreinvoiceAssignmentsFromView(context.order, true);
        const draft = this.calculatePreinvoiceDraft(context.order, assignments);
        const units = draft.items.reduce((sum, item) => sum + Number(item.cantidad_seleccionada || 0), 0);
        const totalElement = document.getElementById('preinvoice-selection-total');
        const unitsElement = document.getElementById('preinvoice-selection-units');
        const issueButton = document.getElementById('btn-issue-preinvoice');

        if (totalElement) totalElement.textContent = Utils.formatCurrency(draft.total);
        if (unitsElement) unitsElement.textContent = String(units);
        if (issueButton) issueButton.disabled = assignments.length === 0;
    },

    restorePreinvoiceSelection(draft) {
        if (!draft || !Array.isArray(draft.assignments)) {
            this.updatePreinvoiceSelection();
            return;
        }

        draft.assignments.forEach(assignment => {
            const lineId = Number(assignment.pedido_producto_id);
            const checkbox = document.querySelector(`.preinvoice-line-check[data-line-id="${lineId}"]`);
            const input = document.getElementById(`preinvoice-qty-${lineId}`);
            if (checkbox) checkbox.checked = true;
            if (input) {
                input.disabled = false;
                input.value = String(assignment.cantidad);
            }
        });
        this.updatePreinvoiceSelection();
    },

    setSplitAccountMode(enabled) {
        if (!this.preinvoiceContext) return;
        this.preinvoiceDraft = null;
        this.showOrderDetailModal(
            this.preinvoiceContext.order,
            this.preinvoiceContext.preinvoices,
            { splitMode: Boolean(enabled) }
        );
    },

    showOrderDetailModal(order, preinvoices = [], options = {}) {
        const seatLabel = order.mesa_tipo?.toLowerCase() === 'banco' ? 'Banco' : 'Mesa';
        const activeProducts = Array.isArray(order.productos_disponibles)
            ? order.productos_disponibles
            : (order.productos || []);
        const assignedProducts = Array.isArray(order.productos_asignados)
            ? order.productos_asignados
            : (order.productos || []).filter(product => Number(product.cantidad_asignada || 0) > 0);
        const pendingDocumentProducts = Array.isArray(order.productos_documentados_pendientes)
            ? order.productos_documentados_pendientes
            : assignedProducts.filter(product => Number(product.cantidad_documentada_pendiente || 0) > 0);
        const paidProducts = Array.isArray(order.productos_pagados)
            ? order.productos_pagados
            : assignedProducts.filter(product => Number(product.cantidad_pagada || 0) > 0);
        const reservedWithoutDocumentProducts = Array.isArray(order.productos_reservados_sin_documento)
            ? order.productos_reservados_sin_documento
            : assignedProducts.filter(product => Number(product.cantidad_reservada_sin_documento || 0) > 0);
        const lineSummary = order.resumen_lineas || {};
        const documentSummary = order.resumen_documentos || {};
        const continuity = order.continuidad_operativa || {};
        const serviceOpen = continuity.servicio_activo ?? order.estado_operativo === 'abierta';
        const temporaryZeroBalance = Boolean(continuity.saldo_temporal_cero)
            || (serviceOpen && Number(order.saldo_pendiente || 0) <= 0);
        const activeDocuments = preinvoices.filter(document => document.estado !== 'anulada');
        const splitLocked = activeDocuments.length > 0;
        const splitMode = splitLocked || Boolean(options.splitMode);
        const canSplit = this.hasOperationalCapability('orders.split');
        const canIssue = this.hasOperationalCapability('orders.issue_preinvoice');
        const canCollect = this.hasOperationalCapability('cash.collect');
        const canFinalize = this.hasOperationalCapability('orders.finalize_service');
        const canBuildSplit = canSplit && canIssue;
        const selectionEnabled = splitMode && canBuildSplit;
        const canIssueCurrent = canIssue && (!splitMode || canSplit);
        const restoreDraft = options.restoreDraft || null;

        this.preinvoiceContext = {
            order,
            preinvoices,
            splitMode,
            splitLocked
        };

        const renderConsumptionRows = (products, quantityField = 'cantidad', selectable = false) => {
            if (!products.length) {
                return `<tr><td colspan="${selectable ? 5 : 4}" class="text-muted text-center">No hay consumo disponible</td></tr>`;
            }

            return products.map(product => {
                const lineId = Number(product.pedido_producto_id || product.id);
                const quantity = Number(product[quantityField] ?? product.cantidad ?? 0);
                const label = this.escapeHtml(this.getConsumptionLineLabel(product));
                const selection = selectable ? `
                    <td class="preinvoice-select-cell">
                        <input
                            type="checkbox"
                            class="preinvoice-line-check"
                            data-line-id="${lineId}"
                            data-version="${Number(product.version || 1)}"
                            onchange="Orders.updatePreinvoiceSelection()"
                            aria-label="Seleccionar ${label}">
                    </td>
                ` : '';
                const quantityControl = selectable && quantity > 1
                    ? `<input
                            id="preinvoice-qty-${lineId}"
                            class="preinvoice-quantity-input"
                            type="number"
                            min="1"
                            max="${quantity}"
                            value="1"
                            disabled
                            onchange="Orders.updatePreinvoiceSelection()"
                            oninput="Orders.updatePreinvoiceSelection()">`
                    : selectable
                        ? `<input id="preinvoice-qty-${lineId}" type="hidden" min="1" max="1" value="1" disabled><span>1</span>`
                        : String(quantity);

                return `
                    <tr>
                        ${selection}
                        <td>${label}</td>
                        <td>${quantityControl}</td>
                        <td>${Utils.formatCurrency(product.precio_unitario)}</td>
                        <td>${Utils.formatCurrency(Number(product.precio_unitario || 0) * quantity)}</td>
                    </tr>
                `;
            }).join('');
        };

        const preinvoiceRows = preinvoices.length
            ? preinvoices.map(document => `
                <tr>
                    <td><strong>${this.escapeHtml(document.numero_documento)}</strong></td>
                    <td>${this.escapeHtml(document.pagador_nombre)}</td>
                    <td>${this.renderPreinvoiceStatus(document.estado)}</td>
                    <td>${Utils.formatCurrency(document.total)}</td>
                    <td>
                        <button class="btn btn-light btn-sm" type="button"
                                onclick="Orders.viewPreinvoice(${order.id}, ${document.id})">
                            <i class="fas fa-print"></i> Ver / imprimir
                        </button>
                    </td>
                </tr>
            `).join('')
            : '';

        const modalButtons = [{ text: 'Cerrar', class: 'btn-light' }];
        if (canIssueCurrent && activeProducts.length > 0) {
            modalButtons.push({
                text: splitMode ? 'Emitir prefactura parcial' : 'Emitir prefactura',
                class: 'btn-primary',
                align: 'right',
                onclick: () => Orders.openPreinvoiceReview(),
                id: 'btn-issue-preinvoice'
            });
        }

        const assignedUnits = Number(lineSummary.unidades_asignadas || 0);
        const pendingGlobalBalance = Number(order.saldo_pendiente ?? order.total_con_servicio ?? order.total ?? 0);
        if (serviceOpen && pendingGlobalBalance > 0 && canCollect && activeDocuments.length === 0 && assignedUnits === 0) {
            modalButtons.push({
                text: 'Pagar cuenta completa',
                class: 'btn-success text-white',
                align: 'right',
                onclick: () => Orders.confirmarPago(order.id, seatLabel, order.mesa_numero)
            });
        }
        if (serviceOpen && canFinalize) {
            modalButtons.push({
                text: '<i class="fas fa-door-open"></i> Finalizar servicio',
                class: 'btn-warning',
                align: 'right',
                onclick: () => Orders.openServiceFinalization(order.id)
            });
        }

        Utils.showModal(`${this.escapeHtml(order.numero_cuenta || `Pedido #${order.id}`)} - ${seatLabel} ${order.mesa_numero}`, `
            <div class="order-details preinvoice-workflow">
                <div class="order-info mb-3">
                    <p><strong>${seatLabel}:</strong> ${order.mesa_numero}</p>
                    <p><strong>Cliente principal:</strong> ${this.escapeHtml(order.cliente_principal || order.cliente_nombre || '')}</p>
                    <p><strong>Responsable:</strong> ${this.escapeHtml(order.usuario_nombre || '')}</p>
                    <p><strong>Fecha:</strong> ${Utils.formatDate(order.fecha)}</p>
                    <p><strong>Estado operativo:</strong> <span class="badge badge-${serviceOpen ? 'warning' : 'success'}">${this.escapeHtml(order.estado_operativo || order.estado)}</span></p>
                    <p><strong>Estado financiero:</strong> <span class="badge badge-info">${this.escapeHtml(order.estado_financiero || 'sin_documentos')}</span></p>
                </div>

                ${temporaryZeroBalance ? `
                    <div class="account-continuity-banner account-continuity-banner--settled">
                        <i class="fas fa-check-circle"></i>
                        <div>
                            <strong>El consumo actual está liquidado, pero el servicio continúa abierto.</strong>
                            <p>La mesa o banco permanece ocupado y puede recibir nuevos productos hasta que el responsable finalice el servicio explícitamente.</p>
                        </div>
                    </div>
                ` : serviceOpen && Number(order.total_pagado || 0) > 0 ? `
                    <div class="account-continuity-banner">
                        <i class="fas fa-receipt"></i>
                        <div>
                            <strong>Cuenta global abierta con pagos previos.</strong>
                            <p>Los consumos liquidados permanecen en el historial y los productos nuevos se agregan al saldo activo.</p>
                        </div>
                    </div>
                ` : ''}

                ${canBuildSplit ? `
                    <div class="split-account-control">
                        <label>
                            <input type="checkbox" id="split-account-checkbox"
                                   ${splitMode ? 'checked' : ''}
                                   ${splitLocked ? 'disabled' : ''}
                                   onchange="Orders.setSplitAccountMode(this.checked)">
                            <span>Cuenta dividida</span>
                        </label>
                        <p class="text-muted">
                            ${splitLocked
                                ? 'La cuenta ya tiene documentos separados. Las siguientes prefacturas se emiten una por una.'
                                : 'Activa esta opción para elegir los ítems y cantidades de un solo cliente.'}
                        </p>
                    </div>
                ` : ''}

                <h4>Consumo activo</h4>
                ${selectionEnabled ? '<p class="text-muted">Selecciona únicamente el consumo del cliente que se emitirá ahora.</p>' : ''}
                ${splitMode && !canBuildSplit ? '<p class="alert alert-warning">La cuenta está dividida, pero tu rol activo no permite crear otra subcuenta.</p>' : ''}
                <div class="table-container">
                    <table class="table preinvoice-selection-table">
                        <thead>
                            <tr>
                                ${selectionEnabled ? '<th class="preinvoice-select-cell">Elegir</th>' : ''}
                                <th>Producto</th>
                                <th>${selectionEnabled ? 'Cantidad para este cliente' : 'Disponible'}</th>
                                <th>Precio Unit.</th>
                                <th>Subtotal disponible</th>
                            </tr>
                        </thead>
                        <tbody>${renderConsumptionRows(activeProducts, 'cantidad_disponible', selectionEnabled)}</tbody>
                        <tfoot>
                            <tr>
                                <th colspan="${selectionEnabled ? 4 : 3}">Subtotal disponible</th>
                                <th>${Utils.formatCurrency(lineSummary.subtotal_disponible ?? order.subtotal ?? order.total)}</th>
                            </tr>
                            <tr>
                                <th colspan="${selectionEnabled ? 4 : 3}">Servicio disponible</th>
                                <th>${Utils.formatCurrency(lineSummary.servicio_disponible ?? order.monto_servicio ?? 0)}</th>
                            </tr>
                            <tr>
                                <th colspan="${selectionEnabled ? 4 : 3}">Total disponible</th>
                                <th>${Utils.formatCurrency(lineSummary.total_disponible ?? order.total_con_servicio ?? order.total)}</th>
                            </tr>
                        </tfoot>
                    </table>
                </div>

                ${selectionEnabled ? `
                    <div class="preinvoice-selection-summary">
                        <span><strong>Unidades seleccionadas:</strong> <span id="preinvoice-selection-units">0</span></span>
                        <span><strong>Total parcial:</strong> <span id="preinvoice-selection-total">${Utils.formatCurrency(0)}</span></span>
                    </div>
                ` : ''}

                ${preinvoices.length > 0 ? `
                    <h4 class="mt-3">Prefacturas emitidas</h4>
                    <p class="text-muted">Son documentos operativos separados y permanecen vinculados a la cuenta global.</p>
                    <div class="table-container">
                        <table class="table">
                            <thead><tr><th>Documento</th><th>Pagador</th><th>Estado</th><th>Total</th><th>Acción</th></tr></thead>
                            <tbody>${preinvoiceRows}</tbody>
                        </table>
                    </div>
                ` : ''}

                ${pendingDocumentProducts.length > 0 ? `
                    <h4 class="mt-3">Consumo documentado pendiente de cobro</h4>
                    <p class="text-muted">Estas cantidades pertenecen a prefacturas emitidas. Ya no aparecen como consumo activo ni pueden asignarse otra vez.</p>
                    <div class="table-container">
                        <table class="table">
                            <thead><tr><th>Producto</th><th>Pendiente</th><th>Precio Unit.</th><th>Subtotal</th></tr></thead>
                            <tbody>${renderConsumptionRows(pendingDocumentProducts, 'cantidad_documentada_pendiente', false)}</tbody>
                        </table>
                    </div>
                ` : ''}

                ${paidProducts.length > 0 ? `
                    <h4 class="mt-3">Historial de consumo liquidado</h4>
                    <p class="text-muted">Los productos pagados permanecen vinculados a la cuenta global para auditoría, pero no forman parte del consumo activo.</p>
                    <div class="table-container">
                        <table class="table">
                            <thead><tr><th>Producto</th><th>Pagado</th><th>Precio Unit.</th><th>Subtotal</th></tr></thead>
                            <tbody>${renderConsumptionRows(paidProducts, 'cantidad_pagada', false)}</tbody>
                        </table>
                    </div>
                ` : ''}

                ${reservedWithoutDocumentProducts.length > 0 ? `
                    <div class="alert alert-warning mt-3">
                        <strong>Revisión de integridad:</strong> existen cantidades reservadas sin un documento activo asociado.
                    </div>
                ` : ''}

                <div class="order-global-summary mt-3">
                    <p><strong>Total cuenta global acumulada:</strong> ${Utils.formatCurrency(order.total_con_servicio ?? order.total)}</p>
                    <p><strong>Total documentado:</strong> ${Utils.formatCurrency(documentSummary.total_documentado || 0)}</p>
                    <p><strong>Documentos pagados:</strong> ${Number(documentSummary.documentos_pagados || 0)}</p>
                    <p><strong>Total pagado global:</strong> ${Utils.formatCurrency(order.total_pagado || 0)}</p>
                    <p><strong>Saldo global pendiente:</strong> ${Utils.formatCurrency(order.saldo_pendiente ?? order.total_con_servicio ?? order.total)}</p>
                    ${serviceOpen ? '<p class="order-global-summary-note"><i class="fas fa-lock-open"></i> La mesa permanece ocupada hasta finalizar el servicio.</p>' : ''}
                </div>
            </div>
        `, modalButtons, 'modal-preinvoice-workflow');

        const issueButton = document.querySelector('.modal-footer .right-buttons .btn-primary');
        if (issueButton) issueButton.id = 'btn-issue-preinvoice';
        if (selectionEnabled) {
            this.restorePreinvoiceSelection(restoreDraft);
        }
    },

    // Ver detalles de la cuenta y cargar sus documentos operativos.
    async viewOrder(orderId) {
        try {
            const [accountResponse, preinvoices] = await Promise.all([
                Utils.request(`/orders/${orderId}`),
                this.loadAccountPreinvoices(orderId)
            ]);
            this.preinvoiceDraft = null;
            this.showOrderDetailModal(accountResponse.data, preinvoices);
        } catch (error) {
            Utils.showNotification(error.message || 'Error cargando detalles de la cuenta', 'error');
        }
    },

    buildFinalizationIdempotencyKey(orderId) {
        const random = window.crypto?.randomUUID?.()
            || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        return `finalizar:${Number(orderId)}:${random}`;
    },

    renderFinalizationStatusItem(ok, label, detail = '') {
        return `
            <li class="service-finalization-check ${ok ? 'is-ok' : 'is-blocked'}">
                <i class="fas ${ok ? 'fa-check-circle' : 'fa-exclamation-circle'}"></i>
                <div>
                    <strong>${this.escapeHtml(label)}</strong>
                    ${detail ? `<small>${this.escapeHtml(detail)}</small>` : ''}
                </div>
            </li>
        `;
    },

    async openServiceFinalization(orderId) {
        try {
            const response = await Utils.request(`/orders/${orderId}/finalization`);
            const read = response.data || {};
            const account = read.cuenta || {};
            const seat = read.puesto || {};
            const lines = read.lineas || {};
            const documents = read.documentos || {};
            const payments = read.pagos || {};
            const credits = read.creditos || {};
            const blockers = Array.isArray(read.bloqueos) ? read.bloqueos : [];
            const warnings = Array.isArray(read.advertencias) ? read.advertencias : [];
            const canFinalize = Boolean(read.puede_finalizar) && !read.ya_finalizada;

            this.serviceFinalizationContext = {
                orderId: Number(orderId),
                version: Number(account.version || 1),
                idempotencyKey: this.buildFinalizationIdempotencyKey(orderId)
            };

            const checks = [
                this.renderFinalizationStatusItem(
                    Number(lines.unidades_disponibles || 0) === 0 || Boolean(read.compatibilidad_legacy),
                    'Consumo activo documentado',
                    Number(lines.unidades_disponibles || 0) === 0
                        ? 'No quedan unidades por prefacturar.'
                        : `${Number(lines.unidades_disponibles || 0)} unidades liquidadas por compatibilidad legacy.`
                ),
                this.renderFinalizationStatusItem(
                    Number(lines.unidades_reservadas_sin_documento || 0) === 0,
                    'Integridad de cantidades',
                    Number(lines.unidades_reservadas_sin_documento || 0) === 0
                        ? 'No existen reservas huérfanas.'
                        : `${Number(lines.unidades_reservadas_sin_documento || 0)} unidades requieren revisión.`
                ),
                this.renderFinalizationStatusItem(
                    Number(documents.pendientes || 0) === 0 && Number(documents.saldo_pendiente || 0) <= 0,
                    'Prefacturas liquidadas',
                    Number(documents.pendientes || 0) === 0
                        ? 'No hay documentos pendientes.'
                        : `${Number(documents.pendientes || 0)} documentos mantienen saldo.`
                ),
                this.renderFinalizationStatusItem(
                    Number(payments.en_proceso || 0) === 0,
                    'Pagos confirmados',
                    Number(payments.en_proceso || 0) === 0
                        ? 'No existen pagos en proceso.'
                        : `${Number(payments.en_proceso || 0)} pagos todavía están procesándose.`
                ),
                this.renderFinalizationStatusItem(
                    Number(account.saldo_pendiente || 0) <= 0,
                    'Cuenta global conciliada',
                    `Saldo global: ${Utils.formatCurrency(account.saldo_pendiente || 0)}`
                )
            ].join('');

            const blockerHtml = blockers.length ? `
                <div class="alert alert-danger service-finalization-blockers">
                    <strong>No se puede finalizar todavía:</strong>
                    <ul>${blockers.map(item => `<li>${this.escapeHtml(item.message || item.code)}</li>`).join('')}</ul>
                </div>
            ` : '';
            const warningHtml = warnings.length ? `
                <div class="alert alert-warning service-finalization-warnings">
                    <strong>Advertencias:</strong>
                    <ul>${warnings.map(item => `<li>${this.escapeHtml(item.message || item.code)}</li>`).join('')}</ul>
                </div>
            ` : '';

            const buttons = [
                {
                    text: '<i class="fas fa-arrow-left"></i> Volver a la cuenta',
                    class: 'btn-light',
                    onclick: () => Orders.viewOrder(orderId)
                }
            ];
            if (canFinalize) {
                buttons.push({
                    text: '<i class="fas fa-check"></i> Finalizar y liberar',
                    class: 'btn-danger',
                    align: 'right',
                    onclick: () => Orders.confirmServiceFinalization()
                });
            }

            Utils.showModal('Finalizar servicio', `
                <div class="service-finalization-modal">
                    <div class="service-finalization-account">
                        <div><small>Cuenta global</small><strong>${this.escapeHtml(account.numero_cuenta || '')}</strong></div>
                        <div><small>${this.escapeHtml(seat.tipo || 'mesa')}</small><strong>${this.escapeHtml(seat.numero || '')}</strong></div>
                        <div><small>Cliente principal</small><strong>${this.escapeHtml(account.cliente_principal || 'Sin nombre')}</strong></div>
                        <div><small>Total global</small><strong>${Utils.formatCurrency(account.total || 0)}</strong></div>
                    </div>
                    ${read.ya_finalizada ? `
                        <div class="alert alert-success">
                            <strong>Este servicio ya fue finalizado.</strong>
                            La mesa o banco se encuentra liberado.
                        </div>
                    ` : ''}
                    <ul class="service-finalization-checklist">${checks}</ul>
                    ${blockerHtml}
                    ${warningHtml}
                    ${canFinalize ? `
                        <div class="form-group">
                            <label for="service-finalization-observation">Observación de cierre (opcional)</label>
                            <textarea id="service-finalization-observation" maxlength="500" rows="3"
                                      placeholder="Detalle operativo del cierre"></textarea>
                        </div>
                        <label class="service-finalization-confirmation">
                            <input type="checkbox" id="service-finalization-confirm">
                            <span>Confirmo que los clientes terminaron el servicio y que la mesa o banco puede liberarse.</span>
                        </label>
                    ` : ''}
                    ${Number(credits.vigentes || 0) > 0 ? `
                        <p class="service-finalization-credit-note">
                            <i class="fas fa-file-invoice-dollar"></i>
                            ${Number(credits.vigentes || 0)} crédito(s) formalizado(s) continuarán en cartera por
                            ${Utils.formatCurrency(credits.saldo_pendiente || 0)}.
                        </p>
                    ` : ''}
                </div>
            `, buttons, 'modal-service-finalization');
        } catch (error) {
            Utils.showNotification(error.message || 'No se pudo verificar la finalización del servicio.', 'error');
        }
    },

    async confirmServiceFinalization() {
        const context = this.serviceFinalizationContext;
        if (!context || this.serviceFinalizationSubmitting) return;

        const confirmation = document.getElementById('service-finalization-confirm');
        if (!confirmation?.checked) {
            Utils.showNotification('Confirma que el servicio terminó antes de liberar la mesa.', 'warning');
            confirmation?.focus();
            return;
        }

        const observation = String(document.getElementById('service-finalization-observation')?.value || '').trim();
        const actionButton = document.querySelector('.modal-service-finalization .modal-footer .btn-danger');
        this.serviceFinalizationSubmitting = true;
        if (actionButton) {
            actionButton.disabled = true;
            actionButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Finalizando...';
        }

        try {
            const response = await Utils.request(`/orders/${context.orderId}/finalize-service`, {
                method: 'POST',
                headers: { 'Idempotency-Key': context.idempotencyKey },
                body: JSON.stringify({
                    observacion: observation || null,
                    version: context.version
                })
            });
            const data = response.data || {};
            Utils.showNotification(
                `${data.cuenta?.numero_cuenta || 'Cuenta'} finalizada. ${data.puesto?.tipo || 'Mesa'} ${data.puesto?.numero || ''} liberado.`,
                'success'
            );
            this.serviceFinalizationContext = null;
            await this.load();
            if (typeof Dashboard !== 'undefined' && typeof Dashboard.load === 'function') {
                const dashboardRefresh = Dashboard.load();
                if (dashboardRefresh?.catch) dashboardRefresh.catch(() => null);
            }
        } catch (error) {
            Utils.showNotification(error.message || 'No se pudo finalizar el servicio.', 'error');
            await this.openServiceFinalization(context.orderId);
        } finally {
            this.serviceFinalizationSubmitting = false;
        }
    },

    openPreinvoiceReview() {
        const context = this.preinvoiceContext;
        if (!context) return;

        const assignments = this.getPreinvoiceAssignmentsFromView(context.order, context.splitMode);
        const draft = this.calculatePreinvoiceDraft(context.order, assignments);
        if (!draft.items.length || draft.total <= 0) {
            Utils.showNotification('Selecciona al menos un ítem y una cantidad válida.', 'warning');
            return;
        }

        const type = context.splitMode ? 'dividida' : 'completa';
        const defaultPayer = type === 'completa'
            ? (context.order.cliente_principal || context.order.cliente_nombre || '')
            : '';
        this.preinvoiceDraft = {
            ...draft,
            orderId: Number(context.order.id),
            type,
            payerName: defaultPayer,
            idempotencyKey: this.buildPreinvoiceIdempotencyKey(context.order.id)
        };

        const rows = draft.items.map(item => `
            <tr>
                <td>${this.escapeHtml(this.getConsumptionLineLabel(item))}</td>
                <td>${item.cantidad_seleccionada}</td>
                <td>${Utils.formatCurrency(item.precio_unitario)}</td>
                <td>${Utils.formatCurrency(item.total_seleccionado)}</td>
            </tr>
        `).join('');

        Utils.showModal('Confirmar prefactura', `
            <div class="preinvoice-review-modal">
                <div class="form-group">
                    <label for="preinvoice-payer-name">Nombre del cliente / pagador *</label>
                    <input id="preinvoice-payer-name" type="text" maxlength="120"
                           value="${this.escapeHtml(defaultPayer)}"
                           placeholder="Ej. Pedro" autocomplete="off">
                </div>
                <div class="table-container">
                    <table class="table">
                        <thead><tr><th>Producto</th><th>Cantidad</th><th>Precio</th><th>Total</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
                <div class="preinvoice-review-totals">
                    <p><span>Subtotal</span><strong>${Utils.formatCurrency(draft.subtotal)}</strong></p>
                    <p><span>Servicio</span><strong>${Utils.formatCurrency(draft.service)}</strong></p>
                    <p class="preinvoice-review-grand-total"><span>Total seleccionado</span><strong>${Utils.formatCurrency(draft.total)}</strong></p>
                </div>
                <p class="text-muted preinvoice-print-note">
                    Al confirmar, el documento se guarda primero y luego se abre la impresión del navegador.
                </p>
            </div>
        `, [
            {
                text: '<i class="fas fa-arrow-left"></i> Volver',
                class: 'btn-light',
                onclick: () => Orders.returnToPreinvoiceSelection()
            },
            {
                text: '<i class="fas fa-print"></i> Imprimir y emitir',
                class: 'btn-primary',
                align: 'right',
                onclick: () => Orders.emitCurrentPreinvoice()
            }
        ], 'modal-preinvoice-review');

        setTimeout(() => document.getElementById('preinvoice-payer-name')?.focus(), 0);
    },

    returnToPreinvoiceSelection() {
        const context = this.preinvoiceContext;
        const draft = this.preinvoiceDraft;
        if (!context) return;
        this.showOrderDetailModal(context.order, context.preinvoices, {
            splitMode: context.splitMode,
            restoreDraft: draft
        });
    },

    async emitCurrentPreinvoice() {
        if (this.preinvoiceSubmitting || !this.preinvoiceDraft || !this.preinvoiceContext) return;

        const payerInput = document.getElementById('preinvoice-payer-name');
        const payerName = String(payerInput?.value || '').trim().replace(/\s+/g, ' ');
        if (!payerName) {
            Utils.showNotification('Debes indicar el nombre del cliente o pagador.', 'warning');
            payerInput?.focus();
            return;
        }

        this.preinvoiceSubmitting = true;
        const actionButton = document.querySelector('.modal-preinvoice-review .modal-footer .btn-primary');
        if (actionButton) {
            actionButton.disabled = true;
            actionButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Emitiendo...';
        }

        const printWindow = window.open('', '_blank', 'width=760,height=900');
        if (printWindow) {
            printWindow.document.write('<p style="font-family:sans-serif;padding:24px">Emitiendo prefactura...</p>');
        }

        try {
            const draft = this.preinvoiceDraft;
            const response = await Utils.request(`/orders/${draft.orderId}/preinvoices`, {
                method: 'POST',
                body: JSON.stringify({
                    pagador_nombre: payerName,
                    tipo: draft.type,
                    items: draft.assignments,
                    clave_idempotencia: draft.idempotencyKey
                })
            });
            const documentData = response.data;
            if (typeof PrintingClient !== 'undefined') {
                PrintingClient.openJob(response.printing, printWindow);
            } else {
                printWindow?.close();
            }
            Utils.showNotification(`Prefactura ${documentData.numero_documento} emitida correctamente.`, 'success');
            this.preinvoiceDraft = null;
            await this.viewOrder(draft.orderId);
        } catch (error) {
            printWindow?.close();
            Utils.showNotification(error.message || 'No se pudo emitir la prefactura.', 'error');
            await this.viewOrder(this.preinvoiceDraft.orderId);
        } finally {
            this.preinvoiceSubmitting = false;
        }
    },

    async printPreinvoiceDocument(documentData, targetWindow = null) {
        const printWindow = targetWindow || window.open('', '_blank', 'width=760,height=900');
        if (printWindow) {
            printWindow.document.write('<p style="font-family:sans-serif;padding:24px">Preparando copia en Printing...</p>');
        }
        try {
            const response = await Utils.request(
                `/orders/${Number(documentData.pedido_id)}/preinvoices/${Number(documentData.id)}/print-copy`,
                { method: 'POST', body: JSON.stringify({}) }
            );
            if (typeof PrintingClient !== 'undefined') {
                PrintingClient.openJob(response.printing, printWindow);
            } else {
                printWindow?.close();
                Utils.showNotification('La copia quedó auditada en Printing.', 'info');
            }
        } catch (error) {
            printWindow?.close();
            Utils.showNotification(error.message || 'No se pudo preparar la copia de la prefactura.', 'error');
        }
    },

    async viewPreinvoice(orderId, preinvoiceId) {
        try {
            const response = await Utils.request(`/orders/${orderId}/preinvoices/${preinvoiceId}`);
            const documentData = response.data;
            const rows = (documentData.items || []).map(item => `
                <tr>
                    <td>${this.escapeHtml(this.getConsumptionLineLabel({
                        producto_nombre: item.producto_nombre_snapshot,
                        presentacion_nombre: item.presentacion_nombre_snapshot,
                        presentacion_cantidad: item.presentacion_cantidad_snapshot
                    }))}</td>
                    <td>${item.cantidad}</td>
                    <td>${Utils.formatCurrency(item.total_linea)}</td>
                </tr>
            `).join('');

            Utils.showModal(`Prefactura ${this.escapeHtml(documentData.numero_documento)}`, `
                <div class="preinvoice-document-detail">
                    <p><strong>Pagador:</strong> ${this.escapeHtml(documentData.pagador_nombre)}</p>
                    <p><strong>Cuenta global:</strong> ${this.escapeHtml(documentData.numero_cuenta_snapshot)}</p>
                    <p><strong>Estado:</strong> ${this.renderPreinvoiceStatus(documentData.estado)}</p>
                    <div class="table-container"><table class="table">
                        <thead><tr><th>Producto</th><th>Cantidad</th><th>Total</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table></div>
                    <div class="preinvoice-review-totals">
                        <p><span>Subtotal</span><strong>${Utils.formatCurrency(documentData.subtotal)}</strong></p>
                        <p><span>Servicio</span><strong>${Utils.formatCurrency(documentData.servicio)}</strong></p>
                        <p class="preinvoice-review-grand-total"><span>Total</span><strong>${Utils.formatCurrency(documentData.total)}</strong></p>
                    </div>
                </div>
            `, [
                {
                    text: '<i class="fas fa-arrow-left"></i> Volver a la cuenta',
                    class: 'btn-light',
                    onclick: () => Orders.viewOrder(orderId)
                },
                {
                    text: '<i class="fas fa-print"></i> Imprimir',
                    class: 'btn-primary',
                    align: 'right',
                    onclick: () => Orders.printPreinvoiceDocument(documentData)
                }
            ], 'modal-preinvoice-review');
        } catch (error) {
            Utils.showNotification(error.message || 'No se pudo abrir la prefactura.', 'error');
        }
    },

    renderOrderProductCards(products = []) {
        const operationalProducts = products.filter(product => Number(product?.disponible_operacion ?? 1) === 1);

        if (operationalProducts.length === 0) {
            return `<p class="text-muted">No hay productos operativos disponibles</p>`;
        }

        return operationalProducts.map(product => {
            const imagen = this.normalizeImageUrl(product.imagen || product.imagen_url);
            const precioTexto = this.formatOperationalProductPrice(product);

            return `
                <div class="producto-card" onclick="Orders.agregarProductoTemporal(${product.id})" style="position: relative;">
                    <img src="${imagen}" alt="${product.nombre}" class="producto-img" style="max-width: 100%; height: 100px; object-fit: cover; border-radius: 8px; margin-bottom: 5px;" onerror="this.src='${window.location.origin}/uploads/ImagenGenerica.jpg'">
                    <div class="producto-nombre">${product.nombre}</div>
                    <div class="producto-precio">${precioTexto}</div>
                    ${this.productHasPresentations(product)
                        ? `<div class="badge badge-info badge-presentacion" title="Tiene presentaciones"><i class="fas fa-layer-group"></i></div>`
                        : ''}
                    ${(product.destino_preparacion || (Number(product.es_cocina) === 1 ? 'cocina' : 'ninguno')) === 'cocina'
                        ? `<div class="badge badge-warning badge-cocina" title="Se prepara en Cocina"><i class="fas fa-fire"></i></div>`
                        : product.destino_preparacion === 'bar'
                            ? `<div class="badge badge-info badge-cocina" title="Se prepara en Bar"><i class="fas fa-martini-glass"></i></div>`
                            : ''}
                </div>
            `;
        }).join('');
    },

    //Carga Pestañas en Modal       
    loadTabsUI() {
  // Categorías del menú
  const categorias = Menu.categories.filter(c => c.tipo === 'principal');

  const tabsContainer = document.getElementById("pedido-tabs");
  tabsContainer.innerHTML = "";

  // Crear botones para cada pestaña
  categorias.forEach(cat => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-sm btn-light me-2 mb-2 d-flex align-items-center";
    btn.dataset.id = cat.id;
    btn.onclick = () => Orders.selectCategoriaTab(cat.id);

    // Asignar emoji según nombre de categoría
    let emoji = "";
    switch (cat.nombre.toLowerCase()) {
      case "bebidas":
        emoji = "🥤"; // Botella de refresco
        break;
      case "cervezas":
        emoji = "🍺"; // Jarra de cerveza
        break;
      case "comidas":
        emoji = "🍽️"; // Plato de comida
        break;
      case "licores":
        emoji = "🥃"; // Vaso de whisky
        break;
      case "varios":
        emoji = "📦"; // Caja o ícono genérico
        break;
      default:
        emoji = "🔖"; // Default
    }

    // Crear el texto con emoji
    const text = document.createElement("span");
    text.textContent = `${emoji} ${cat.nombre}`;

    btn.appendChild(text);
    tabsContainer.appendChild(btn);
  });

  // Activar pestaña predeterminada
  const tabInicial = categorias[0]?.id;
  if (tabInicial) {
    this.selectCategoriaTab(tabInicial);
  }
    },

    //Selecciona Pestaña según Modal
    async selectCategoriaTab(categoriaId) {
  const subcatContainer = document.getElementById("pedido-subcategorias");
  const productosContainer = document.getElementById("pedido-productos");

  subcatContainer.innerHTML = "";
  productosContainer.innerHTML = "";

  // Marcar pestaña activa visualmente
  const botones = document.querySelectorAll("#pedido-tabs button");
  botones.forEach(btn => {
    btn.classList.toggle("active", btn.dataset.id == categoriaId);
  });

  const subcategorias = (Menu.categories || []).filter(c => c.tipo === 'subcategoria' && Number(c.parent_id) === Number(categoriaId));
  const productosCategoria = this.getOperationalProducts().filter(p => Number(p.categoria_id) === Number(categoriaId));
  const productosSinSubcategoria = productosCategoria.filter(p => !p.subcategoria_id);

  if (subcategorias.length > 0) {
    const subcatHtml = subcategorias.map(sc => {
      let nombre = sc.nombre.toLowerCase();
      let emoji = "🔹";

      // Bebidas
      if (nombre === "calientes") emoji = "☕";
      else if (nombre === "gaseosas") emoji = "🥤";
      else if (nombre === "naturales") emoji = "🍹";

      // Cervezas
      else if (nombre === "bebidas preparadas") emoji = "🍸";
      else if (nombre === "extranjeras") emoji = "🍻";
      else if (nombre === "latas") emoji = "🧃";
      else if (nombre === "nacionales") emoji = "🍺";

      // Comidas
      else if (nombre === "acompañamientos") emoji = "🍟";
      else if (nombre === "bocas") emoji = "🌮";
      else if (nombre === "platos principales") emoji = "🥘";
      else if (nombre === "postres") emoji = "🍰";
      else if (nombre === "snack" || nombre === "snacks") emoji = "🍿";

      // Licores
      else if (["guaro", "ron", "tequila", "vodka", "whisky"].includes(nombre)) emoji = "🥃";
      else if (["aguardiente", "brandy", "cognac", "ginebra", "otros"].includes(nombre)) emoji = "🍾";
      else if (["licores dulces", "licores cremosos", "licores cremas", "cremas"].includes(nombre)) emoji = "🥂";
      else if (["vino", "vinos", "otros vinos"].includes(nombre)) emoji = "🍷";

      return `
        <button type="button" class="btn btn-outline-secondary btn-sm me-2 mb-2 d-inline-flex align-items-center"
                data-id="${sc.id}"
                onclick="Orders.selectSubcategoria(${sc.id}, ${categoriaId})">
          <span class="me-1">${emoji}</span>
          <span>${sc.nombre}</span>
        </button>
      `;
    }).join('');

    const sinSubcategoriaHtml = productosSinSubcategoria.length > 0
      ? `
        <button type="button" class="btn btn-outline-secondary btn-sm me-2 mb-2 d-inline-flex align-items-center"
                data-id="sin-subcategoria"
                onclick="Orders.selectSubcategoria(null, ${categoriaId})">
          <span class="me-1">📦</span>
          <span>Sin subcategoría</span>
        </button>
      `
      : '';

    subcatContainer.innerHTML = `<div class="mb-2"><strong>Subcategorías:</strong><br>${subcatHtml}${sinSubcategoriaHtml}</div>`;

    productosContainer.innerHTML = `
      <div class="alert alert-info d-flex align-items-center gap-2" role="alert">
        <i class="fas fa-hand-pointer"></i>
        Selecciona una subcategoría para ver los productos disponibles.
      </div>
    `;
    return;
  }

  productosContainer.innerHTML = this.renderOrderProductCards(productosCategoria);
    },

    //Selecciona Botón de Subcategoría
    selectSubcategoria(subId, categoriaId) {
    const botones = document.querySelectorAll("#pedido-subcategorias button");
    botones.forEach(btn => {
        const matches = subId === null
            ? btn.dataset.id === 'sin-subcategoria'
            : Number(btn.dataset.id) === Number(subId);
        btn.classList.toggle("active", matches);
    });

    const productos = this.getOperationalProducts().filter(p => {
        if (subId === null || typeof subId === 'undefined') {
            return Number(p.categoria_id) === Number(categoriaId) && !p.subcategoria_id;
        }

        return Number(p.subcategoria_id) === Number(subId);
    });

    const productosContainer = document.getElementById("pedido-productos");
    productosContainer.innerHTML = this.renderOrderProductCards(productos);
},

    //Guarda producto antes de crear Pedido
    agregarProductoTemporal(productoId) {
  if (!this.selectedProducts) this.selectedProducts = {};

  const producto = Menu.products.find(p => p.id === productoId);
  if (!producto) {
    console.warn(`Producto con ID ${productoId} no encontrado en Menu.products`);
    return;
  }

  // Si el producto tiene presentaciones operativas, abrir el selector correspondiente
  if (this.productHasPresentations(producto)) {
    this.showPresentacionesSelector(producto);
    return;
  }

  // ✅ Producto sin presentación → clave directa
  const key = `${productoId}`;

  if (this.selectedProducts[key]) {
    this.selectedProducts[key]++;
  } else {
    this.selectedProducts[key] = 1;
  }

  this.updateOrderTotal();
  this.refreshOrderModalUI();
    },

    //Actualiza el total del pedido
    updateOrderTotal() {
  let total = 0;

  for (const [key, item] of Object.entries(this.selectedProducts)) {
    if (typeof item === 'object') {
      total += item.precio * item.cantidad;
    } else {
      const productoId = parseInt(key);
      const producto = Menu.products.find(p => p.id === productoId);
      if (producto) {
        total += this.getProductUnitPrice(producto) * item;
      }
    }
  }

  const totalSpan = document.getElementById("order-total");
  if (totalSpan) {
    totalSpan.textContent = Utils.formatCurrency(total);
  }
    },

    //Actualiza el detalle del pedido
    updateProductResumen(productoKey) {
  const item = this.selectedProducts[productoKey];
  if (!item) return;

  const cantidad = typeof item === 'object' ? item.cantidad : item;
  const precio = typeof item === 'object'
    ? item.precio
    : this.getProductUnitPrice(Menu.products.find(p => p.id == productoKey));

  const cantidadCell = document.querySelector(`#row-prod-${productoKey} .prod-cantidad`);
  if (cantidadCell) {
    cantidadCell.textContent = cantidad;
  }

  const subtotalCell = document.querySelector(`#row-prod-${productoKey} .prod-subtotal`);
  if (subtotalCell) {
    const subtotal = cantidad * precio;
    subtotalCell.textContent = Utils.formatCurrency(subtotal);
  }
    },

    
    updateOrderResumenTotal() {
  let total = 0;

  for (const [key, item] of Object.entries(this.selectedProducts)) {
    if (typeof item === 'object') {
      total += item.precio * item.cantidad;
    } else {
      const productoId = parseInt(key);
      const producto = Menu.products.find(p => p.id === productoId);
      if (producto) {
        total += this.getProductUnitPrice(producto) * item;
      }
    }
  }

  const totalSpan = document.getElementById("order-summary-total");
  if (totalSpan) {
    totalSpan.textContent = Utils.formatCurrency(total);
  }

  this.updateOrderTotal();
    },


    setProductInstruction(productKey, field, value) {
  this.selectedInstructions = this.selectedInstructions || {};
  const key = String(productKey);
  const current = this.selectedInstructions[key] || { observacion: '', adicionales: '' };
  current[field] = String(value || '').slice(0, field === 'observacion' ? 500 : 300);
  this.selectedInstructions[key] = current;
    },

    renderProductInstructionFields(productKey) {
  const values = this.selectedInstructions?.[String(productKey)] || {};
  return `
    <div class="mt-2">
      <label class="form-label small mb-1">Indicaciones especiales</label>
      <textarea class="form-control form-control-sm" rows="2" maxlength="500"
        placeholder="Ej.: sin salsa, término medio"
        oninput="Orders.setProductInstruction('${String(productKey)}', 'observacion', this.value)">${this.escapeHtml(values.observacion || '')}</textarea>
      <label class="form-label small mt-2 mb-1">Adicionales</label>
      <input class="form-control form-control-sm" maxlength="300"
        placeholder="Separar con comas: arroz adicional, queso"
        value="${this.escapeHtml(values.adicionales || '')}"
        oninput="Orders.setProductInstruction('${String(productKey)}', 'adicionales', this.value)">
    </div>`;
    },

    showOrderSummaryModal() {
  this.selectedProducts = this.selectedProducts || {};

  if (Object.keys(this.selectedProducts).length === 0) {
    Utils.showNotification('No hay productos agregados al pedido', 'warning');
    return;
  }

  let contenido = `
    <div class="table-responsive">
      <table class="table table-bordered table-sm">
        <thead>
          <tr>
            <th>Producto</th>
            <th>Cantidad</th>
            <th>Subtotal</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
  `;

  for (const [key, item] of Object.entries(this.selectedProducts)) {
    if (typeof item === 'object') {
      const subtotal = item.precio * item.cantidad;
      contenido += `
        <tr id="row-prod-${key}">
          <td>
            <strong>${item.nombre}</strong>
            ${this.renderProductInstructionFields(key)}
          </td>
          <td class="prod-cantidad"><strong>${item.cantidad}</strong></td>
          <td class="prod-subtotal">${Utils.formatCurrency(subtotal)}</td>
          <td>
            <div class="btn-group btn-group-sm" role="group">
              <button type="button" class="btn btn-outline-secondary" onclick="Orders.restarProducto('${key}')">
                <i class="fas fa-minus"></i>
              </button>
              <button type="button" class="btn btn-outline-secondary" onclick="Orders.sumarProducto('${key}')">
                <i class="fas fa-plus"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    } else {
      const productoId = parseInt(key);
      const producto = Menu.products.find(p => p.id === productoId);
      if (!producto) continue;

      const subtotal = this.getProductUnitPrice(producto) * item;

      contenido += `
        <tr id="row-prod-${key}">
          <td>
            <strong>${producto.nombre}</strong>
            ${this.renderProductInstructionFields(key)}
          </td>
          <td class="prod-cantidad"><strong>${item}</strong></td>
          <td class="prod-subtotal">${Utils.formatCurrency(subtotal)}</td>
          <td>
            <div class="btn-group btn-group-sm" role="group">
              <button type="button" class="btn btn-outline-secondary" onclick="Orders.restarProducto('${key}')">
                <i class="fas fa-minus"></i>
              </button>
              <button type="button" class="btn btn-outline-secondary" onclick="Orders.sumarProducto('${key}')">
                <i class="fas fa-plus"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }
  }

  contenido += `
        </tbody>
      </table>
    </div>
    <div class="mt-3 text-end">
      <h5>Total: <span id="order-summary-total">${Utils.formatCurrency(
        this.getTotalSeleccionado()
      )}</span></h5>
    </div>
  `;

  const isAddingToExistingOrder = this.modalContext === 'agregar' && this.orderIdActual;

  Utils.showModal('Resumen del Pedido', contenido, [
    {
      text: 'Seguir Agregando',
      class: 'btn-light',
      align: 'left',
      onclick: () => {
        Utils.hideModal();
        setTimeout(() => {
          if (isAddingToExistingOrder) {
            Orders.showAddProductsModal(Orders.orderIdActual, true);
          } else {
            Orders.showCreateOrderModal(Orders.mesaIdActual);
          }
        }, 50);
      }
    },
    {
      text: isAddingToExistingOrder ? 'Cancelar Agregado' : 'Cancelar Pedido',
      class: 'btn-danger',
      align: 'left',
      onclick: async () => {
        const confirmed = await Utils.confirm(
          isAddingToExistingOrder ? '¿Desea cancelar los productos seleccionados?' : '¿Desea cancelar la orden?',
          isAddingToExistingOrder ? 'Cancelar Agregado' : 'Cancelar Pedido'
        );
        if (!confirmed) return;

        this.selectedProducts = {};
        this.selectedInstructions = {};
        this.updateOrderTotal();
        Utils.hideModal();
        Utils.showNotification(isAddingToExistingOrder ? 'Productos seleccionados descartados' : 'Pedido cancelado', 'info');
      }
    },
    {
      text: isAddingToExistingOrder ? 'Agregar Productos' : 'Crear Pedido',
      class: 'btn-success',
      align: 'right',
      onclick: () => isAddingToExistingOrder
        ? this.addProductsToOrder(this.orderIdActual)
        : this.createOrder()
    }
  ]);
    },

    sumarProducto(productoKey) {
  if (!this.selectedProducts || !this.selectedProducts[productoKey]) return;

  const item = this.selectedProducts[productoKey];

  if (typeof item === 'object') {
    item.cantidad += 1;
  } else {
    this.selectedProducts[productoKey] += 1;
  }

  this.updateOrderTotal();
  this.showOrderSummaryModal();
    },

    restarProducto(productoKey) {
  if (!this.selectedProducts || !this.selectedProducts[productoKey]) return;

  const item = this.selectedProducts[productoKey];

  if (typeof item === 'object') {
    if (item.cantidad > 1) {
      item.cantidad -= 1;
    } else {
      delete this.selectedProducts[productoKey];
      delete this.selectedInstructions?.[productoKey];
    }
  } else {
    if (item > 1) {
      this.selectedProducts[productoKey] -= 1;
    } else {
      delete this.selectedProducts[productoKey];
      delete this.selectedInstructions?.[productoKey];
    }
  }

  this.updateOrderTotal();
  this.showOrderSummaryModal();
    },


    getTotalSeleccionado() {
  let total = 0;

  for (const [key, item] of Object.entries(this.selectedProducts)) {
    if (typeof item === 'object') {
      total += item.precio * item.cantidad;
    } else {
      const productoId = parseInt(key);
      const producto = Menu.products.find(p => p.id === productoId);
      if (producto) {
        total += this.getProductUnitPrice(producto) * item;
      }
    }
  }

  return total;
    },

    refreshOrderModalUI() {
  if (this.modalContext === 'agregar') {
    this.refreshAddProductsModalUI();
    return;
  }

  this.refreshCreateOrderModalUI();
    },

    refreshAddProductsModalUI() {
  const total = this.getTotalSeleccionado();
  const orderId = this.orderIdActual;

  const totalSpan = document.getElementById("order-total");
  if (totalSpan) {
    totalSpan.textContent = Utils.formatCurrency(total);
  }

  const cantidadProductos = Object.values(this.selectedProducts || {}).reduce((acc, val) => {
    const cantidad = typeof val === 'object' ? parseInt(val.cantidad || 0, 10) : parseInt(val || 0, 10);
    return acc + (isNaN(cantidad) ? 0 : cantidad);
  }, 0);

  const footer = document.querySelector(".modal-footer");
  if (!footer) return;

  footer.innerHTML = "";

  const row = document.createElement("div");
  row.className = "d-flex w-100 align-items-center justify-content-between flex-wrap gap-2";

  const groupLeft = document.createElement("div");
  groupLeft.className = "d-flex align-items-center gap-2 flex-wrap";

  const btnAgregar = document.createElement("button");
  btnAgregar.className = "btn btn-success";
  btnAgregar.innerHTML = cantidadProductos > 0
    ? `Agregar Productos (${cantidadProductos})`
    : "Agregar Productos";
  btnAgregar.onclick = () => Orders.showOrderSummaryModal();
  groupLeft.appendChild(btnAgregar);

  if (orderId) {
    const btnVer = document.createElement("button");
    btnVer.className = "btn btn-warning text-white";
    btnVer.innerHTML = `<i class="fas fa-eye"></i> Ver Pedido`;
    btnVer.onclick = () => Orders.viewOrder(orderId);
    groupLeft.appendChild(btnVer);
  }

  const mensaje = document.createElement("div");
  mensaje.className = "mensaje-liberacion text-muted small d-flex align-items-center gap-1 flex-grow-1";
  if (total > 0) {
    mensaje.innerHTML = `<i class="fas fa-receipt"></i> Total adicional: ${Utils.formatCurrency(total)}`;
  }

  const btnCancelar = document.createElement("button");
  btnCancelar.className = "btn btn-light";
  btnCancelar.innerHTML = "Cancelar";
  btnCancelar.onclick = () => {
    Orders.selectedProducts = {};
    Orders.selectedInstructions = {};
    Utils.hideModal();
  };

  row.appendChild(groupLeft);
  row.appendChild(mensaje);
  row.appendChild(btnCancelar);
  footer.appendChild(row);
    },

    refreshCreateOrderModalUI() {
  const total = this.getTotalSeleccionado();
  const mesaId = this.mesaIdActual;

  const zona = this.tables.find(t => t.id === mesaId);
  if (!zona) return;

  const tipoAsiento = zona.tipo_asiento?.toLowerCase() === 'banco' ? 'banco' : 'mesa';

  // ✅ Conteo seguro
  const cantidadProductos = Object.values(this.selectedProducts || {}).reduce((acc, val) => {
    const cantidad = typeof val === 'object' ? parseInt(val.cantidad || 0) : parseInt(val || 0);
    return acc + (isNaN(cantidad) ? 0 : cantidad);
  }, 0);

  const footer = document.querySelector(".modal-footer");
  if (!footer) return;
  footer.innerHTML = "";

  // Eliminar advertencia previa
  const anterior = footer.querySelector(".mensaje-liberacion");
  if (anterior) anterior.remove();

  const row = document.createElement("div");
  row.className = "d-flex w-100 align-items-center justify-content-between flex-wrap gap-2";

  const groupLeft = document.createElement("div");
  groupLeft.className = "d-flex align-items-center gap-2 flex-wrap";

  const btnCrear = document.createElement("button");
  btnCrear.className = "btn btn-success";
  btnCrear.innerHTML = cantidadProductos > 0
    ? `Crear Pedido (${cantidadProductos})`
    : "Crear Pedido";
  btnCrear.onclick = () => Orders.showOrderSummaryModal();
  groupLeft.appendChild(btnCrear);

  if (mesaId !== null) {
    const btnSecundario = document.createElement("button");

    if (total > 0) {
      btnSecundario.className = "btn btn-primary";
      btnSecundario.innerHTML = "Cancelar Pedido";
      btnSecundario.onclick = async () => {
        const confirmed = await Utils.confirm('¿Desea cancelar la orden?', 'Cancelar Pedido');
        if (!confirmed) return;

        Orders.selectedProducts = {};
        Orders.selectedInstructions = {};
        Orders.updateOrderTotal();
        Utils.hideModal();
        setTimeout(() => {
          Orders.showCreateOrderModal(mesaId);
        }, 200);
        Utils.showNotification('Pedido cancelado. Ahora puede liberar la mesa.', 'info');
      };
    } else {
      btnSecundario.className = "btn btn-danger";
      btnSecundario.innerHTML = `<i class="fas fa-chair"></i> Liberar`;
      btnSecundario.onclick = () => Tables.cerrarMesa(mesaId);
    }

    groupLeft.appendChild(btnSecundario);
  }

  const mensaje = document.createElement("div");
  mensaje.className = "mensaje-liberacion text-warning small d-flex align-items-center gap-1 flex-grow-1";
  if (total > 0 && mesaId !== null) {
    mensaje.innerHTML = `<i class="fas fa-exclamation-triangle"></i> No se puede liberar la ${tipoAsiento} porque hay productos guardados para el nuevo pedido.`;
  }

  const btnCancelar = document.createElement("button");
  btnCancelar.className = "btn btn-light";
  btnCancelar.innerHTML = "Cancelar";
  btnCancelar.onclick = () => {
    Utils.hideModal();
  };

  row.appendChild(groupLeft);
  row.appendChild(mensaje);
  row.appendChild(btnCancelar);
  footer.appendChild(row);
    },

    showPresentacionesSelector(producto) {
  const productoId = producto.id;

  if (!this.presentacionesSeleccionadas) {
    this.presentacionesSeleccionadas = {};
  }

  this.presentacionesSeleccionadas[productoId] = {
    nombreProducto: producto.nombre,
    presentaciones: {}
  };

  const renderSelector = (presentacionesOperativas) => {
    const asignadas = (presentacionesOperativas || []).filter(p => {
      const disponible = Number(p.disponible_operacion ?? 1) === 1;
      const asignada = p.asignada === undefined ? true : Number(p.asignada) === 1;
      return disponible && asignada;
    });

    if (asignadas.length === 0) {
      Utils.showNotification("Este producto no tiene presentaciones operativas asignadas.", "info");
      return;
    }

    const cardsHTML = asignadas.map(p => {
      const nombreSafe = encodeURIComponent(p.nombre || 'Presentación');
      const cantidadSafe = encodeURIComponent(p.cantidad || '');
      const precio = Number(p.precio_operativo ?? p.precio ?? 0);
      const presentacionKey = Number(p.producto_presentacion_id || p.id || p.presentacion_id);

      return `
        <div class="producto-card" onclick="Orders.agregarPresentacion(
          ${productoId},
          ${presentacionKey},
          decodeURIComponent('${nombreSafe}'),
          ${precio},
          decodeURIComponent('${cantidadSafe}')
        )">
          <div class="producto-nombre">${p.nombre}</div>
          <div class="producto-precio">${Utils.formatCurrency(precio)}</div>
          ${p.tipo_presentacion_nombre ? `<small class="text-muted">${p.tipo_presentacion_nombre}</small>` : ''}
        </div>
      `;
    }).join('');

    Utils.showModal(`Seleccionar presentaciones para: ${producto.nombre}`, `
      <div id="selector-presentaciones-grid" class="productos-grid mb-3">
        ${cardsHTML}
      </div>

      <div id="resumen-presentaciones">
        ${Orders.renderResumenPresentaciones(productoId)}
      </div>
    `, [
      {
        text: 'Agregar',
        class: 'btn-success',
        onclick: `Orders.confirmarPresentaciones(${productoId})`
      },
      {
        text: 'Borrar',
        class: 'btn-secondary',
        align: 'left',
        onclick: `Orders.borrarPresentacionesSeleccionadas(${productoId})`
      },
      {
        text: 'Cancelar',
        class: 'btn-light',
        align: 'right',
        onclick: `Orders.cancelarSeleccionPresentaciones(${productoId})`
      }
    ], 'modal-lg');
  };

  if (Array.isArray(producto.presentaciones) && producto.presentaciones.length > 0) {
    renderSelector(producto.presentaciones);
    return;
  }

  Utils.request(`/menu/products/${productoId}/presentaciones`).then(response => {
    const payload = response.data || response;
    renderSelector(payload.presentaciones || []);
  }).catch(error => {
    console.error("Error cargando presentaciones:", error);
    Utils.showNotification("Error cargando presentaciones del producto", "error");
  });
    },

    agregarPresentacion(productoId, presentacionProductoId, nombrePresentacion, precio, cantidadTexto) {
  if (!this.presentacionesSeleccionadas) {
    this.presentacionesSeleccionadas = {};
  }

  // Inicializa el objeto para el producto si no existe
  if (!this.presentacionesSeleccionadas[productoId]) {
    const producto = Menu.products.find(p => p.id === productoId);
    this.presentacionesSeleccionadas[productoId] = {
      nombreProducto: producto?.nombre || 'Producto',
      presentaciones: {}
    };
  }

  const seleccion = this.presentacionesSeleccionadas[productoId];

  // Sumar o crear nueva entrada
  if (seleccion.presentaciones[presentacionProductoId]) {
    seleccion.presentaciones[presentacionProductoId].cantidad += 1;
  } else {
    seleccion.presentaciones[presentacionProductoId] = {
      nombrePresentacion,
      precio: parseFloat(precio),
      cantidadTexto,
      cantidad: 1,
      presentacion_id: presentacionProductoId  // Asegura que el ID se conserve
    };
  }

  // Re-renderizar resumen sin cerrar el modal
  this.renderResumenPresentaciones(productoId, true);
    },

    restarPresentacion(productoId, presentacionId) {
    const seleccion = Orders.presentacionesSeleccionadas?.[productoId];
        if (!seleccion || !seleccion.presentaciones[presentacionId]) return;

        const pres = seleccion.presentaciones[presentacionId];

        if (pres.cantidad > 1) {
            pres.cantidad -= 1;
        } else {
            // Si llega a 0, eliminar la presentación
            delete seleccion.presentaciones[presentacionId];
        }

        // Si ya no quedan presentaciones para este producto, eliminarlo completamente
        if (Object.keys(seleccion.presentaciones).length === 0) {
            delete Orders.presentacionesSeleccionadas[productoId];
        }

        // Re-renderizar resumen
        Orders.renderResumenPresentaciones(productoId, true);
    },

    renderResumenPresentaciones(productoId, forceRender = false) {
  const seleccion = this.presentacionesSeleccionadas?.[productoId];
  if (!seleccion || Object.keys(seleccion.presentaciones).length === 0) {
    if (forceRender && document.getElementById('resumen-presentaciones')) {
      document.getElementById('resumen-presentaciones').innerHTML = '';
    }
    return '';
  }

  const presentaciones = seleccion.presentaciones;
  let total = 0;

  const filas = Object.entries(presentaciones).map(([presentacionId, data]) => {
    const subtotal = data.cantidad * data.precio;
    total += subtotal;

    return `
      <tr>
        <td>${data.nombrePresentacion || 'Sin nombre'}</td>
        <td>${data.cantidadTexto || '-'}</td>
        <td>${data.cantidad}</td>
        <td>₡${data.precio.toFixed(2)}</td>
        <td>₡${subtotal.toFixed(2)}</td>
        <td>
          <button class="btn btn-sm btn-danger" onclick="Orders.restarPresentacion(${productoId}, ${presentacionId})">
            <i class="fas fa-minus"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');

  const tabla = `
    <div class="table-responsive mb-2">
      <table class="table table-bordered table-sm table-striped">
        <thead class="table-light">
          <tr>
            <th>Nombre</th>
            <th>Presentación</th>
            <th>Cantidad</th>
            <th>Precio</th>
            <th>Subtotal</th>
            <th>Quitar</th>
          </tr>
        </thead>
        <tbody>
          ${filas}
        </tbody>
      </table>
    </div>
    <div class="text-end me-2">
      <strong>Total: ₡${total.toFixed(2)}</strong>
    </div>
  `;

  if (forceRender && document.getElementById('resumen-presentaciones')) {
    document.getElementById('resumen-presentaciones').innerHTML = tabla;
  }

  return tabla;
    },


    borrarPresentacionesSeleccionadas(productoId) {
        if (Orders.presentacionesSeleccionadas?.[productoId]) {
            delete Orders.presentacionesSeleccionadas[productoId];
        }

        Orders.renderResumenPresentaciones(productoId, true);
    },

    cancelarSeleccionPresentaciones(productoId) {
    Orders.borrarPresentacionesSeleccionadas(productoId);
    Utils.hideModal();
    },

    confirmarPresentaciones(productoId) {
  const seleccion = this.presentacionesSeleccionadas?.[productoId];
  if (!seleccion || Object.keys(seleccion.presentaciones).length === 0) {
    Utils.showNotification('No hay presentaciones seleccionadas.', 'warning');
    return;
  }

  const producto = Menu.products.find(p => p.id === productoId);
  const nombreProducto = producto?.nombre || 'Producto';

  for (const [presentacionProductoId, data] of Object.entries(seleccion.presentaciones)) {
    // Usamos presentaciones_producto.id como parte de la clave
    const key = `${productoId}_${presentacionProductoId}`;

    if (!this.selectedProducts[key]) {
      this.selectedProducts[key] = {
        producto_id: productoId,
        presentacion_id: parseInt(presentacionProductoId), // ✅ ID correcto (de tabla presentaciones_producto)
        nombre: `${nombreProducto} - ${data.nombrePresentacion} (${data.cantidadTexto})`,
        cantidad: data.cantidad,
        precio: parseFloat(data.precio)
      };
    } else {
      this.selectedProducts[key].cantidad += data.cantidad;
    }
  }

  // Limpiar selección temporal
  delete this.presentacionesSeleccionadas[productoId];

  // Refrescar interfaz
  this.updateOrderTotal();
  this.refreshOrderModalUI();
  Utils.hideModal();

  // Volver al modal operativo correspondiente después del selector de presentaciones
  if (this.modalContext === 'agregar' && this.orderIdActual) {
    setTimeout(() => {
      this.showAddProductsModal(this.orderIdActual, true);
    }, 200);
  } else if (this.modalContext === 'nuevo') {
    setTimeout(() => {
      this.showCreateOrderModal(this.mesaIdActual ?? null);
    }, 200);
  }
    },

    selectedProducts: {},

};

