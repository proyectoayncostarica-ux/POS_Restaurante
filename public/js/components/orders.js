// Orders Component
const Orders = {
    orders: [],
    products: [],
    tables: [],
    currentView: 'pending', // 'pending', 'paid', 'all'
    selectedOrder: null,

    // Cargar datos de pedidos
    async load() {
        try {
            const [ordersResponse, productsResponse, tablesResponse] = await Promise.all([
                Utils.request('/orders'),
                Utils.request('/menu/products'),
                Utils.request('/tables')
            ]);
            
            this.orders = ordersResponse.data;
            this.products = productsResponse.data;
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


            ${this.renderOrdersView()}
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
                                <button class="btn btn-success btn-sm" onclick="Orders.showPaymentModal(${order.id})">
                                    <i class="fas fa-dollar-sign"></i>
                                </button>
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
            `¿Deseas cobrar el pedido #${orderId} de la ${zona.toLowerCase()} ${numero}?`,
            'Confirmar Pago'
        ).then(confirmado => {
            if (confirmado) {
                Orders.showPaymentModal(orderId);
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
                        onclick: () => Tables.cerrarMesa(mesaId)
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

    // Inicializar pestañas visuales y total
    Menu.load().then(() => {
        Orders.loadTabsUI();
        this.updateOrderTotal();
        Orders.refreshCreateOrderModalUI(); 
    });
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
                    <option value="${product.id}" data-price="${product.precio}" data-cocina="${product.es_cocina}">
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

  const productos = [];
    for (const [key, item] of Object.entries(this.selectedProducts)) {
  if (typeof item === 'object') {
    // 🔧 Extraer producto_id desde item o desde la clave (soporta "5_2" o "12")
    let productoId = item.producto_id;
    if (!productoId) {
      const keyParts = key.split('_');
      productoId = parseInt(keyParts[0]); // ejemplo: "5_2" → 5
    } else {
      productoId = parseInt(productoId);
    }

    const cantidad = parseInt(item.cantidad);
    if (!productoId || !cantidad || cantidad <= 0) continue;

    const productoPayload = {
    producto_id: productoId,
    cantidad,
    precio: item.precio // ✅ incluir precio usado
    };

    if (item.presentacion_id !== undefined && item.presentacion_id !== null) {
      productoPayload.presentacion_id = item.presentacion_id;
    }


    productos.push(productoPayload);
  } else {
    const productoId = parseInt(key);
    const cantidad = parseInt(item);
    if (!productoId || !cantidad || cantidad <= 0) continue;

    productos.push({
      producto_id: productoId,
      cantidad
    });
  }
    }


  if (productos.length === 0) {
    Utils.showNotification('Por favor agregue al menos un producto válido', 'warning');
    return;
  }
  // 🧪 VALIDACIÓN PREVIA EN CONSOLA
console.log('%c🟢 Validación de productos antes de enviar al backend:', 'color: green; font-weight: bold;');
productos.forEach((item, i) => {
  console.log(`Producto ${i + 1}:`, {
    producto_id: item.producto_id,
    presentacion_id: item.presentacion_id ?? '(sin presentación)',
    cantidad: item.cantidad,
    precio: item.precio
  });
});

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
      const confirmed = await Utils.confirm(
        '¿Desea imprimir la comanda para cocina?',
        'Comanda de Cocina'
      );
      if (confirmed) {
        this.printComanda(response.data.comanda_id);
      }
    }

    Utils.showNotification('Pedido creado exitosamente', 'success');

    // 🔄 Limpiar memoria temporal
    this.selectedProducts = {};
    this.mesaIdActual = null;
    this.load();

  } catch (error) {
    Utils.showNotification(`Error al crear el pedido para la ${tipoZona}`, 'error');
    console.error('Error en createOrder():', error);
  }
    },

    // Mostrar modal de pago
    async showPaymentModal(orderId) {
        try {
            const response = await Utils.request(`/orders/${orderId}`);
            const order = response.data;
            const isBarra = order.mesa_tipo?.toLowerCase() === 'barra';

            const subtotal = order.total;
            const aplicarServicioInicial = !isBarra;
            const servicio = aplicarServicioInicial ? subtotal * 0.10 : 0;
            const total = subtotal + servicio;

            const nombreZona = isBarra ? 'Banco' : 'Mesa';

            Utils.showModal(`Procesar Pago - Pedido #${order.id}`, `
                <div class="payment-details">
                    <div class="order-summary mb-3">
                        <p><strong>${nombreZona}:</strong> ${order.mesa_numero}</p>
                        <p><strong>Cliente:</strong> ${order.cliente_nombre}</p>
                    </div>

                    <div class="payment-breakdown">
                        <div class="d-flex justify-content-between">
                            <span>Subtotal:</span>
                            <span>${Utils.formatCurrency(subtotal)}</span>
                        </div>
                        <div class="d-flex justify-content-between">
                            <span>Servicio (10%):</span>
                            <span id="pago-servicio">${Utils.formatCurrency(servicio)}</span>
                        </div>
                        <hr>
                        <div class="d-flex justify-content-between">
                            <strong>Total:</strong>
                            <strong id="pago-total">${Utils.formatCurrency(total)}</strong>
                        </div>
                    </div>

                    <form id="payment-form" class="mt-3">
                        <div class="form-group">
                            <label for="metodo-pago">Método de Pago *</label>
                            <select id="metodo-pago" name="metodo_pago" required>
                                <option value="">Seleccione método</option>
                                <option value="efectivo">Efectivo</option>
                                <option value="tarjeta">Tarjeta</option>
                                <option value="credito">Crédito</option>
                            </select>
                        </div>

                        ${!isBarra ? `
                        <div class="form-group text-center">
                            <div class="form-check d-inline-flex align-items-center justify-content-center gap-2">
                                <input type="checkbox" class="form-check-input" id="aplicar-servicio" checked onchange="Orders.updatePaymentTotal(${subtotal})">
                                <label class="form-check-label" for="aplicar-servicio">
                                    Aplicar 10% de servicio
                                </label>
                            </div>
                        </div>
                        ` : ''}
                    </form>
                </div>
            `, [
                {
                    text: 'Cancelar',
                    class: 'btn-light'
                },
                {
                    text: 'Procesar Pago',
                    class: 'btn-success',
                    onclick: `Orders.processPayment(${orderId}, ${order.mesa_id})`
                }
            ]);
        } catch (error) {
            Utils.showNotification('Error cargando datos del pedido', 'error');
        }
    },

    updatePaymentTotal(subtotal) {
        const checkbox = document.getElementById('aplicar-servicio');
        const aplicarServicio = checkbox ? checkbox.checked : false;
        const servicio = aplicarServicio ? subtotal * 0.10 : 0;
        const total = subtotal + servicio;

        const servicioElem = document.getElementById('pago-servicio');
        const totalElem = document.getElementById('pago-total');

        if (servicioElem) servicioElem.innerText = Utils.formatCurrency(servicio);
        if (totalElem) totalElem.innerText = Utils.formatCurrency(total);
    },

    // Procesar pago
    async processPayment(orderId) {
        const form = document.getElementById('payment-form');
        if (!Utils.validateForm(form)) {
            Utils.showNotification('Por favor complete todos los campos requeridos', 'warning');
            return;
        }

        const formData = new FormData(form);
        const metodo = formData.get('metodo_pago');
        const aplicarServicio = document.getElementById('aplicar-servicio')?.checked || false;

        // Si el método es crédito, se debe validar con contraseña de administrador
        if (metodo === 'credito') {
            // Guardar temporalmente la info para continuar luego de la validación
            this.pendingPayment = {
                orderId,
                metodo_pago: metodo,
                aplicar_servicio: aplicarServicio
            };
            this.showAdminPasswordModal();
            return;
        }

        // Si no es crédito, continuar con el pago normal
        this.finalizePayment(orderId, metodo, aplicarServicio);
    },

    async finalizePayment(orderId, metodo_pago, aplicar_servicio, adminPass = null) {
        try {
            // 🟢 Obtener datos del pedido, incluyendo mesa_id
            const pedido = await Utils.request(`/orders/${orderId}`);

            const data = {
                metodo_pago,
                aplicar_servicio,
                admin_pass: adminPass,
                mesa_id: pedido.data.mesa_id  // ✅ Se usa para cerrar la mesa desde backend
            };

            const response = await Utils.request(`/orders/${orderId}/pay`, {
                method: 'POST',
                body: JSON.stringify(data)
            });

            Utils.hideModal();
            if (metodo_pago === 'credito') {
                Utils.showNotification(
                    `Crédito fue correctamente autorizado. Total pendiente: ${Utils.formatCurrency(response.data.total)}`,
                    'success'
                );
            } else {
                Utils.showNotification(
                    `Pago procesado exitosamente - Total: ${Utils.formatCurrency(response.data.total)}`,
                    'success'
                );
            }

            // ✅ Refrescar dashboard en tiempo real con mesaId correcto
            if (typeof Dashboard?.refreshData === 'function') {
                Dashboard.refreshData(pedido.data.mesa_id);
            }

            this.load(); // Recarga pedidos

            const printReceipt = await Utils.confirm('¿Desea imprimir el recibo?', 'Imprimir Recibo');
            if (printReceipt) {
                this.printReceipt(response.data);
            }
        } catch (error) {
            Utils.showNotification(error.message, 'error');
        }
    },

    //Muestra Modal de Contraseña
    showAdminPasswordModal() {
        const contenido = `
            <div class="form-group">
                <label for="admin-pass">Contraseña de administrador:</label>
                <input type="password" id="admin-pass" class="form-control" placeholder="Contraseña" required>
            </div>
        `;

        Utils.showModal('Autorización Requerida', contenido, [
            {
                text: 'Cancelar',
                class: 'btn-light',
                onclick: 'Utils.hideModal()'
            },
            {
                text: 'Confirmar',
                class: 'btn-primary',
                onclick: 'Orders.confirmAdminPassword()'
            }
        ]);
    },

    //Confirma Contraseña
    confirmAdminPassword() {
        const pass = document.getElementById('admin-pass')?.value;
        if (!pass) {
            Utils.showNotification('Debe ingresar la contraseña', 'warning');
            return;
        }

        const { orderId, metodo_pago, aplicar_servicio } = this.pendingPayment;
        Utils.hideModal();

        this.finalizePayment(orderId, metodo_pago, aplicar_servicio, pass);
    },

    // Mostrar modal para agregar productos
    async showAddProductsModal(orderId) {
        try {
            const response = await Utils.request(`/orders/${orderId}`);
            const order = response.data;
            //this.modalContext = 'agregar';
            // Obtener tipo y número para el botón
            const tipoZona = order.zona?.toLowerCase() === 'bar'
        ? (order.tipo_asiento?.toLowerCase() === 'banco' ? 'Banco' : 'Mesa')
        : 'Mesa';

    const textoBoton = `Agregar a ${tipoZona} ${order.mesa_numero}`;


            const modalContent = `
                <form id="add-products-form">
                    <div class="form-group">
                        <label>Productos a Agregar *</label>
                        <div id="add-products-list">
                            <div class="product-selector">
                                <select class="product-select" onchange="Orders.updateProductPrice(this)">
                                    <option value="">Seleccione un producto</option>
                                    ${this.products.map(product => `
                                        <option value="${product.id}" data-price="${product.precio}" data-cocina="${product.es_cocina}">
                                            ${product.nombre} - ${Utils.formatCurrency(product.precio)}
                                        </option>
                                    `).join('')}
                                </select>
                                <input type="number" class="product-quantity" min="1" value="1" placeholder="Cant." onchange="Orders.calculateTotal()">
                                <span class="product-price">$0.00</span>
                                <button type="button" class="btn btn-danger btn-sm" onclick="Orders.removeProductRow(this)">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                        </div>

                        <div class="d-flex justify-content-between align-items-center mt-3">
                            <button type="button" class="btn btn-secondary btn-sm" onclick="Orders.addProductRowToList()">
                                <i class="fas fa-plus"></i> Más Producto
                            </button>
                            <button type="button" class="btn btn-warning text-white btn-sm" onclick="Orders.viewOrder(${orderId})">
                                <i class="fas fa-eye"></i> Ver Pedido
                            </button>
                        </div>

                        <div class="order-total mt-3">
                            <strong>Total Adicional: <span id="add-order-total">$0.00</span></strong>
                        </div>
                    </div>
                </form>
            `;

            Utils.showModal('Agregar Productos al Pedido', modalContent, [
                {
                    text: 'Cancelar',
                    class: 'btn-light'
                },
                {
                    text: textoBoton,
                    class: 'btn-success',
                    onclick: `Orders.addProductsToOrder(${orderId})`
                }
            ]);
                if (typeof Dashboard?.refreshData === 'function') {
                    Dashboard.refreshData(order.mesa_id); // ⚠️ Requiere que tengas acceso al mesa_id
                }

        } catch (error) {
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
                    <option value="${product.id}" data-price="${product.precio}" data-cocina="${product.es_cocina}">
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
        // Recopilar productos (sumar cantidades de productos repetidos)
        const productosMap = new Map();
        const productSelectors = document.querySelectorAll('#add-products-list .product-selector');

        productSelectors.forEach(selector => {
            const select = selector.querySelector('.product-select');
            const quantityInput = selector.querySelector('.product-quantity');

            const value = select?.value;
            const quantity = parseInt(quantityInput?.value || '0');

            if (value && quantity > 0) {
                const productoId = parseInt(value);

                if (productosMap.has(productoId)) {
                    const cantidadActual = productosMap.get(productoId);
                    productosMap.set(productoId, cantidadActual + quantity);
                } else {
                    productosMap.set(productoId, quantity);
                }
            }
        });

        const productos = Array.from(productosMap.entries()).map(([producto_id, cantidad]) => ({
            producto_id,
            cantidad
        }));

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

            // Verificar si requiere comanda
            if (response.data.requiere_comanda) {
                const confirmed = await Utils.confirm(
                    '¿Desea imprimir la comanda para cocina?',
                    'Comanda de Cocina'
                );

                if (confirmed) {
                    this.printComanda(response.data.comanda_id);
                }
            }

            Utils.showNotification('Productos agregados exitosamente', 'success');
            this.load();
        } catch (error) {
            Utils.showNotification(error.message, 'error');
        }
    },

    // Imprimir comanda
    printComanda(comandaId) {
        // Aquí se implementaría la lógica de impresión de comanda
        Utils.showNotification('Comanda enviada a cocina', 'info');
    },

    // Imprimir recibo
    printReceipt(paymentData) {
        // Aquí se implementaría la lógica de impresión de recibo
        Utils.showNotification('Recibo generado', 'info');
    },

    // Ver detalles del pedido
    async viewOrder(orderId) {
        try {
            const response = await Utils.request(`/orders/${orderId}`);
            const order = response.data;

            const nombreZona = order.mesa_tipo?.toLowerCase() === 'barra' ? 'Banco' : 'Mesa';

            const modalButtons = [
                {
                    text: 'Cerrar',
                    class: 'btn-light'
                }
            ];

            // Mostrar "Pagar" solo si el pedido está pendiente
            if (order.estado !== 'pagado') {
                modalButtons.push({
                    text: 'Pagar',
                    class: 'btn-success text-white',
                    onclick: `Orders.confirmarPago(${order.id}, '${nombreZona}', ${order.mesa_numero})`
                });
            }

            Utils.showModal(`Pedido #${order.id} - ${nombreZona} ${order.mesa_numero}`, `
                <div class="order-details">
                    <div class="order-info mb-3">
                        <p><strong>${nombreZona}:</strong> ${order.mesa_numero}</p>
                        <p><strong>Cliente:</strong> ${order.cliente_nombre}</p>
                        <p><strong>Usuario:</strong> ${order.usuario_nombre}</p>
                        <p><strong>Fecha:</strong> ${Utils.formatDate(order.fecha)}</p>
                        <p><strong>Estado:</strong> <span class="badge badge-${order.estado === 'pendiente' ? 'warning' : 'success'}">${order.estado}</span></p>
                    </div>
                    
                    <h4>Productos</h4>
                    <div class="table-container">
                        <table class="table">
                            <thead>
                                <tr>
                                    <th>Producto</th>
                                    <th>Cantidad</th>
                                    <th>Precio Unit.</th>
                                    <th>Subtotal</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${order.productos.map(producto => {
                                    const nombreCompleto = producto.presentacion_nombre
                                        ? `${producto.producto_nombre} - ${producto.presentacion_nombre} (${producto.presentacion_cantidad})`
                                        : producto.producto_nombre;

                                    return `
                                        <tr>
                                            <td>${nombreCompleto}</td>
                                            <td>${producto.cantidad}</td>
                                            <td>${Utils.formatCurrency(producto.precio_unitario)}</td>
                                            <td>${Utils.formatCurrency(producto.precio_unitario * producto.cantidad)}</td>
                                        </tr>
                                    `;
                                }).join('')}

                            </tbody>
                            <tfoot>
                                <tr>
                                    <th colspan="3">Total</th>
                                    <th>${Utils.formatCurrency(order.total)}</th>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            `, modalButtons);
        } catch (error) {
            Utils.showNotification('Error cargando detalles del pedido', 'error');
        }
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

  // Subcategorías
  const subcategorias = Menu.categories.filter(c => c.tipo === 'subcategoria' && c.parent_id === categoriaId);
  const productos = Menu.products.filter(p =>
    p.categoria_id === categoriaId || subcategorias.some(sc => sc.id === p.subcategoria_id)
  );

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

    subcatContainer.innerHTML = `<div class="mb-2"><strong>Subcategorías:</strong><br>${subcatHtml}</div>`;
  }

  // Alerta en espera
  productosContainer.innerHTML = `
    <div class="alert alert-info d-flex align-items-center gap-2" role="alert">
      <i class="fas fa-hand-pointer"></i>
      Selecciona una subcategoría para ver los productos disponibles.
    </div>
  `;
    },

    //Selecciona Botón de Subcategoría
    selectSubcategoria(subId, categoriaId) {
    const botones = document.querySelectorAll("#pedido-subcategorias button");
    botones.forEach(btn => {
        btn.classList.toggle("active", btn.dataset.id == subId);
    });

    const productos = Menu.products.filter(p => p.subcategoria_id === subId);

    const productosContainer = document.getElementById("pedido-productos");
    if (productos.length === 0) {
        productosContainer.innerHTML = `<p class="text-muted">No hay productos en esta subcategoría</p>`;
        return;
    }

    productosContainer.innerHTML = productos.map(p => {
        const imagen = p.imagen
            ? `${window.location.origin}${p.imagen}`
            : `${window.location.origin}/uploads/ImagenGenerica.jpg`;

        return `
        <div class="producto-card" onclick="Orders.agregarProductoTemporal(${p.id})" style="position: relative;">
            <img src="${imagen}" alt="${p.nombre}" class="producto-img" style="max-width: 100%; height: 100px; object-fit: cover; border-radius: 8px; margin-bottom: 5px;">
            
            <div class="producto-nombre">${p.nombre}</div>
            <div class="producto-precio">${Utils.formatCurrency(p.precio)}</div>

            ${p.tiene_presentaciones
                ? `<div class="badge badge-info badge-presentacion" title="Tiene presentaciones">
                        <i class="fas fa-layer-group"></i>
                  </div>`
                : ''}
        </div>
        `;
    }).join('');
},

    //Guarda producto antes de crear Pedido
    agregarProductoTemporal(productoId) {
  if (!this.selectedProducts) this.selectedProducts = {};

  const producto = Menu.products.find(p => p.id === productoId);
  if (!producto) {
    console.warn(`Producto con ID ${productoId} no encontrado en Menu.products`);
    return;
  }

  // Si el producto tiene presentaciones, abrir el modal correspondiente
  if (producto.tiene_presentaciones) {
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
  this.refreshCreateOrderModalUI();
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
        total += producto.precio * item;
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
    : (Menu.products.find(p => p.id == productoKey)?.precio || 0);

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
        total += producto.precio * item;
      }
    }
  }

  const totalSpan = document.getElementById("order-summary-total");
  if (totalSpan) {
    totalSpan.textContent = Utils.formatCurrency(total);
  }

  this.updateOrderTotal();
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
          <td>${item.nombre}</td>
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

      const subtotal = producto.precio * item;

      contenido += `
        <tr id="row-prod-${key}">
          <td>${producto.nombre}</td>
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

  Utils.showModal('Resumen del Pedido', contenido, [
    {
      text: 'Seguir Agregando',
      class: 'btn-light',
      align: 'left',
      onclick: () => {
        Utils.hideModal();
        setTimeout(() => {
          Orders.showCreateOrderModal(Orders.mesaIdActual);
        }, 50);
      }
    },
    {
      text: 'Cancelar Pedido',
      class: 'btn-danger',
      align: 'left',
      onclick: async () => {
        const confirmed = await Utils.confirm('¿Desea cancelar la orden?', 'Cancelar Pedido');
        if (!confirmed) return;

        this.selectedProducts = {};
        this.updateOrderTotal();
        Utils.hideModal();
        Utils.showNotification('Pedido cancelado', 'info');
      }
    },
    {
      text: 'Crear Pedido',
      class: 'btn-success',
      align: 'right',
      onclick: () => this.createOrder()
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
    }
  } else {
    if (item > 1) {
      this.selectedProducts[productoKey] -= 1;
    } else {
      delete this.selectedProducts[productoKey];
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
        total += producto.precio * item;
      }
    }
  }

  return total;
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

  // Inicializar selección
  this.presentacionesSeleccionadas[productoId] = {
    nombreProducto: producto.nombre,
    presentaciones: {}
  };

  // Consultar presentaciones desde backend
  Utils.request(`/menu/products/${productoId}/presentaciones`).then(response => {
    const { presentaciones } = response.data;
    const asignadas = (presentaciones || []).filter(p => p.asignada);

    if (asignadas.length === 0) {
      Utils.showNotification("Este producto no tiene presentaciones asignadas.", "info");
      return;
    }

    // Generar cards con escape seguro (evita problemas con comillas)
    const cardsHTML = asignadas.map(p => {
      const nombreSafe = encodeURIComponent(p.nombre);
      const cantidadSafe = encodeURIComponent(p.cantidad);

      return `
        <div class="producto-card" onclick="Orders.agregarPresentacion(
          ${productoId},
          ${p.id},
          decodeURIComponent('${nombreSafe}'),
          ${p.precio},
          decodeURIComponent('${cantidadSafe}')
        )">
          <div class="producto-nombre">${p.nombre}</div>
          <div class="producto-precio">₡${parseFloat(p.precio).toFixed(2)}</div>
        </div>
      `;
    }).join('');

    // Mostrar el modal
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
  this.refreshCreateOrderModalUI();
  Utils.hideModal();

  // Si está en contexto de creación, volver a mostrar modal
  if (this.modalContext === 'nuevo' && this.mesaIdActual !== null) {
    setTimeout(() => {
      this.showCreateOrderModal(this.mesaIdActual);
    }, 200);
  }
    },

    selectedProducts: {},

};

