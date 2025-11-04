// Orders Component
const KITCHEN_TICKET_WIDTH_MM = 80;
const Orders = {
  selectedProductsAdd: {},
  // Datos temporales para el pedido en creación
    selectedProducts: {},
    orders: [],
    products: [],
    tables: [],
    currentView: 'pending', // 'pending', 'paid', 'all'
    selectedOrder: null,

    // === Contexto estable para modal "Agregar productos" ===
    activeOrderCtx: null,
    activeOrderId() { return this.activeOrderCtx && this.activeOrderCtx.id ? this.activeOrderCtx.id : null; },

    // === Helpers dinero para efectivo ===
    _parseMoney(str) {
      if (typeof str === 'number') return isFinite(str) ? str : 0;
      const s = String(str || '')
        .replace(/[^\d.,-]/g, '')
        .replace(/\s+/g, '');
      const norm = s.replace(/\./g, '').replace(',', '.');
      const n = parseFloat(norm);
      return isNaN(n) ? 0 : n;
    },

    // Leer total actual del modal de pago
    _readTotalFromPaymentModal() {
      // #pago-total es un <strong> con texto formateado
      const el = document.querySelector('#pago-total');
      if (!el) return 0;
      const txt = (el.textContent || el.innerText || '').replace(/[^\d.,-]/g, '').replace(/\./g, '').replace(',', '.');
      const n = parseFloat(txt);
      return isNaN(n) ? 0 : n;
    },

    // === Sub-modal: Pago en efectivo (UI con badges y tipografía grande) ===
    showCashModal(orderId, aplicarServicio) {
      const total = this._readTotalFromPaymentModal();
      // 🔒 Persistir total para validaciones aunque se reemplace el DOM del modal
      this._cashTotal = Number(total || 0);

      Utils.showModal('Pago en efectivo', `
        <div class="payment-cash">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <span class="fw-semibold">Total a pagar</span>
            <span id="cash-total-badge" class="badge bg-success px-3 py-2 fs-4 fw-bold" aria-live="polite">${Utils.formatCurrency(total)}</span>
          </div>

          <div class="form-group mb-2">
            <label for="cash-recibido" class="fw-semibold">Efectivo recibido</label>
            <input id="cash-recibido" type="text" class="form-control form-control-lg fw-bold" inputmode="decimal" placeholder="0,00" autocomplete="off">
            <small id="cash-error" class="text-danger fw-semibold" style="display:none"></small>
          </div>

          <!-- Acciones rápidas -->
          <div class="d-flex flex-wrap gap-2 mb-2">
            <button type="button" class="btn btn-sm btn-outline-secondary" id="btn-cash-exacto">Monto exacto</button>
            <button type="button" class="btn btn-sm btn-outline-secondary cash-add" data-add="500">+₡500</button>
            <button type="button" class="btn btn-sm btn-outline-secondary cash-add" data-add="1000">+₡1.000</button>
            <button type="button" class="btn btn-sm btn-outline-secondary cash-add" data-add="2000">+₡2.000</button>
            <button type="button" class="btn btn-sm btn-outline-secondary cash-add" data-add="5000">+₡5.000</button>
            <button type="button" class="btn btn-sm btn-outline-secondary cash-add" data-add="10000">+₡10.000</button>
          </div>

          <!-- Redondeos -->
          <div class="d-flex flex-wrap gap-2 mb-2">
            <button type="button" class="btn btn-sm btn-outline-primary cash-round" data-step="100">Redondear a ₡100</button>
            <button type="button" class="btn btn-sm btn-outline-primary cash-round" data-step="500">Redondear a ₡500</button>
            <button type="button" class="btn btn-sm btn-outline-primary cash-round" data-step="1000">Redondear a ₡1.000</button>
          </div>

          <hr class="my-2">

          <div class="d-flex justify-content-between align-items-center mb-2">
            <span class="fw-semibold">Faltante</span>
            <span id="cash-faltante-badge" class="badge bg-danger px-3 py-2 fs-3 fw-bold" style="display:none" aria-live="polite">₡0,00</span>
          </div>

          <div class="d-flex justify-content-between align-items-center">
            <span class="fw-semibold">Cambio</span>
            <span id="cash-cambio-badge" class="badge bg-primary px-3 py-2 fs-4 fw-bold" aria-live="polite">₡0,00</span>
          </div>
        </div>
      `, [
        { text: 'Cancelar', class: 'btn-light' },
        { text: 'Confirmar cobro', id: 'btn-confirm-cash', class: 'btn-success disabled', onclick: `Orders.confirmCash(${orderId}, ${aplicarServicio ? 'true' : 'false'})` }
      ]);

      const $inp   = document.getElementById('cash-recibido');
      const $err   = document.getElementById('cash-error');
      const $btn   = document.querySelector('#btn-confirm-cash');

      const $faltanteBadge = document.getElementById('cash-faltante-badge');
      const $cambioBadge   = document.getElementById('cash-cambio-badge');

      // Usar el total persistido
      const totalNum = Number(this._cashTotal || 0);

      const setBtnEnabled = (ok) => {
        if (!$btn) return;
        if (ok) { $btn.classList.remove('disabled'); $btn.removeAttribute('disabled'); }
        else    { $btn.classList.add('disabled');    $btn.setAttribute('disabled', 'disabled'); }
      };

      const recalc = () => {
        const recibido = this._parseMoney($inp.value);
        if (recibido <= 0) {
          $err.textContent = 'Ingrese un monto válido.';
          $err.style.display = 'block';
          $cambioBadge.textContent = Utils.formatCurrency(0);
          $faltanteBadge.style.display = 'none';
          setBtnEnabled(false);
          return false;
        }
        if (recibido < totalNum) {
          const faltante = totalNum - recibido;
          $err.textContent = `Monto insuficiente. Faltan ${Utils.formatCurrency(faltante)}.`;
          $err.style.display = 'block';
          $faltanteBadge.textContent = Utils.formatCurrency(faltante);
          $faltanteBadge.style.display = 'inline-block';
          $cambioBadge.textContent = Utils.formatCurrency(0);
          setBtnEnabled(false);
          return false;
        }
        $err.style.display = 'none';
        $faltanteBadge.style.display = 'none';
        const cambio = Math.max(recibido - totalNum, 0);
        $cambioBadge.textContent = Utils.formatCurrency(cambio);
        setBtnEnabled(true);
        return true;
      };

      $inp.addEventListener('input', recalc);
      $inp.addEventListener('focus', () => { $inp.select(); });
      $inp.addEventListener('blur', () => {
        const n = this._parseMoney($inp.value);
        $inp.value = n.toFixed(2).replace('.', ',');
        recalc();
      });
      $inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          if (recalc()) this.confirmCash(orderId, aplicarServicio);
          e.preventDefault();
        }
      });

      document.getElementById('btn-cash-exacto')?.addEventListener('click', () => {
        $inp.value = Number(totalNum).toFixed(2).replace('.', ',');
        recalc();
      });

      document.querySelectorAll('.cash-add').forEach(btn => {
        btn.addEventListener('click', () => {
          const add = Number(btn.getAttribute('data-add') || '0');
          const cur = this._parseMoney($inp.value);
          const val = Math.max(cur + add, 0);
          $inp.value = val.toFixed(2).replace('.', ',');
          recalc();
        });
      });

      document.querySelectorAll('.cash-round').forEach(btn => {
        btn.addEventListener('click', () => {
          const step = Number(btn.getAttribute('data-step') || '1');
          const cur = Math.max(this._parseMoney($inp.value || '0'), totalNum);
          const rounded = Math.ceil(cur / step) * step;
          $inp.value = rounded.toFixed(2).replace('.', ',');
          recalc();
        });
      });

      setTimeout(() => $inp?.focus(), 50);
    },

    // Confirmar pago en efectivo (validación robusta con total persistido)
    confirmCash(orderId, aplicarServicio) {
      const $btn = document.querySelector('#btn-confirm-cash');
      if ($btn && ($btn.disabled || $btn.classList.contains('disabled'))) {
        Utils.showNotification('Monto en efectivo insuficiente', 'warning');
        return;
      }

      // 1) Total desde memoria; 2) fallback: badge del submodal; 3) último recurso: modal de pago (puede no existir)
      let total = Number(this._cashTotal || 0);
      if (!total) {
        const badgeTxt = document.getElementById('cash-total-badge')?.textContent || '';
        total = this._parseMoney(badgeTxt);
      }
      if (!total) {
        total = this._readTotalFromPaymentModal();
      }

      const recibido = this._parseMoney(document.getElementById('cash-recibido')?.value || '0');

      // Epsilon por decimales
      if (!(recibido > 0) || (recibido + 1e-6) < total) {
        Utils.showNotification('Monto en efectivo insuficiente', 'warning');
        return;
      }

      const cambio = Math.max(recibido - total, 0);

      Utils.hideModal();
      this._lastCashInfo = { recibido, cambio, total };
      this.finalizePayment(orderId, 'efectivo', aplicarServicio, null, this._lastCashInfo);
    },

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
    <div class="d-flex gap-2 mb-2 flex-wrap">
        <button class="btn ${this.currentView === 'pending' ? 'btn-primary' : 'btn-light'}" onclick="Orders.switchView('pending')">
            <i class="fas fa-clock"></i> Pendientes
        </button>
        <button class="btn ${this.currentView === 'paid' ? 'btn-primary' : 'btn-light'}" onclick="Orders.switchView('paid')">
            <i class="fas fa-check"></i> Pagados
        </button>
        <button class="btn ${this.currentView === 'all' ? 'btn-primary' : 'btn-light'}" onclick="Orders.switchView('all')">
         Todos
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
        } catch (error) {
            console.error('Error cargando pedidos:', error);
            Utils.showNotification('Error cargando pedidos', 'error');
        }
    },

    // Renderizar vista de pedidos
    renderOrdersView() {
      const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
      const normZona = z => String(z || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita acentos (Salón -> Salon)
        .toLowerCase().trim();

      const filteredOrders = this.getFilteredOrders();

      const pendientes  = this.orders.filter(o => o.estado === 'pendiente').length;
      const pagadosHoy  = this.orders.filter(o => o.estado === 'pagado' && this.isToday(o.fecha)).length;
      const creditos    = this.orders.filter(o => o.estado === 'credito').length;

      // Solo pedidos PAGADOS hoy
      const pedidosPagadosHoy = this.orders.filter(o => o.estado === 'pagado' && this.isToday(o.fecha));

      // Acumuladores
      let totalProductosHoy = 0;   // total de productos (con IVA) = o.total
      let totalServicioHoy  = 0;   // 10% solo si aplica (zona=salon)
      let totalIvaHoy       = 0;   // IVA dentro de o.total
      let totalPagadoHoy    = 0;   // productos + servicio

      pedidosPagadosHoy.forEach(o => {
        const subtotalConIVA = round2(Number(o.total) || 0); // total de productos con IVA (sin servicio)

        // Determinar si aplica servicio (no dependemos de o.aplica_servicio_10)
        const aplicaServicio = (typeof o?.aplica_servicio_10 === 'boolean')
          ? o.aplica_servicio_10
          : (normZona(o?.zona) === 'salon');

        const servicio = aplicaServicio ? round2(subtotalConIVA * 0.10) : 0;

        // IVA siempre se calcula a partir del subtotal con IVA (no depende del 10%)
        const precioBase = round2(subtotalConIVA / 1.13);
        const iva        = round2(subtotalConIVA - precioBase);

        const totalCobrado = round2(subtotalConIVA + servicio);

        totalProductosHoy += subtotalConIVA;
        totalServicioHoy  += servicio;
        totalIvaHoy       += iva;
        totalPagadoHoy    += totalCobrado;
      });

      return `
        <div class="orders-summary mb-3">
          <div class="d-flex gap-3 flex-wrap">
            <span class="badge badge-warning">Pendientes: ${pendientes}</span>
            <span class="badge badge-success">Pagados Hoy: ${pagadosHoy}</span>
            <span class="badge badge-danger">Créditos: ${creditos}</span>
          </div>

          <div class="mt-2 d-flex gap-3 flex-wrap">
            <span class="badge badge-info">Total Cobrado: ${Utils.formatCurrency(totalPagadoHoy)}</span>
            <span class="badge bg-secondary">IVA 13 %: ${Utils.formatCurrency(totalIvaHoy)}</span>
            <span class="badge bg-primary">Servicio 10 %: ${Utils.formatCurrency(totalServicioHoy)}</span>
            <span class="badge bg-dark">Subtotales: ${Utils.formatCurrency(totalProductosHoy-totalIvaHoy)}</span>
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
  if (!orders || orders.length === 0) {
    return '<tr><td colspan="7" class="text-center">No hay pedidos</td></tr>';
  }

  const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const norm = str => String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quita acentos
    .toLowerCase()
    .trim();

  return orders.map(order => {
    const zonaRaw = order.zona || '';
    const tipoRaw = order.tipo_asiento || order.mesa_tipo || '';
    const zonaNorm = norm(zonaRaw);
    const tipoNorm = norm(tipoRaw);

    // === Lógica de nombres ===
    // "Barra" tiene prioridad cuando tipo_asiento = banco
    let nombreZona;
    if (tipoNorm === 'banco') {
      nombreZona = 'Barra';
    } else if (zonaNorm === 'salon') {
      nombreZona = 'Salón';
    } else if (zonaNorm === 'bar' || zonaNorm === 'barra') {
      nombreZona = 'Bar';
    } else {
      nombreZona = zonaRaw || 'Zona';
    }

    // Mostrar "Mesa" o "Banco" según tipo
    const nombreAsiento = tipoNorm === 'banco' ? 'Banco' : 'Mesa';

    // Determinar si aplica servicio 10%
    const aplicaServicio = (typeof order.aplica_servicio_10 === 'boolean')
      ? order.aplica_servicio_10
      : (zonaNorm === 'salon');

    const subtotalConIVA = Number(order.total) || 0;
    const servicio = (order.servicio_10_monto != null)
      ? Number(order.servicio_10_monto) || 0
      : (aplicaServicio ? round2(subtotalConIVA * 0.10) : 0);

    const totalCobrado = (order.total_cobrado != null)
      ? Number(order.total_cobrado) || 0
      : round2(subtotalConIVA + servicio);

    // Estado visual
    const estado = String(order.estado || '').toLowerCase();
    const estadoColor = estado === 'pendiente' ? 'warning'
                      : estado === 'pagado'   ? 'success'
                      : 'danger';
    const estadoTexto = estado === 'credito'
      ? 'Crédito'
      : estado === 'pagado'
      ? 'Pagado'
      : 'Pendiente';

    const totalTexto = estado === 'credito'
      ? '₡0'
      : Utils.formatCurrency(totalCobrado);

    // Zona completa: “Salón / Mesa 1” o “Barra / Banco 3”
    const zonaCompleta = `${nombreZona} / ${nombreAsiento} ${order.mesa_numero}`;

    return `
      <tr>
        <td><strong>#${order.id}</strong></td>
        <td>${zonaCompleta}</td>
        <td>${totalTexto}</td>
        <td>
          <span class="badge badge-${estadoColor} ${estado === 'credito' ? 'text-dark' : ''}">
            ${estadoTexto}
          </span>
        </td>
        <td>${order.usuario_nombre || '-'}</td>
        <td>${Utils.formatDate(order.fecha)}</td>
        <td>
          <div class="d-flex gap-1">
            <button class="btn btn-info btn-sm" onclick="Orders.viewOrder(${order.id})">
              <i class="fas fa-eye"></i>
            </button>
            ${estado === 'pendiente' ? `
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

    // Mostrar modal de pago (fuente de verdad: backend)
    async showPaymentModal(orderId) {
    try {
      const response = await Utils.request(`/orders/${orderId}`);
      const order = response?.data?.data ?? response?.data ?? response;
      this.activeOrderCtx = order;
      const zonaStr = String(order.zona ?? '').toLowerCase().trim();
      const tipoAsientoStr = String(order.tipo_asiento ?? '').toLowerCase().trim();

      // Regla desde backend si viene, sino: salón aplica, bar no
      const aplicaServicioBack = (typeof order.aplica_servicio_10 === 'boolean') ? order.aplica_servicio_10 : null;
      const aplicarServicio = (aplicaServicioBack !== null) ? aplicaServicioBack : (zonaStr === 'salon');

      const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

      // Subtotal de productos (con IVA)
      const subtotal = round2(order.subtotal ?? order.total ?? 0);

      // IVA desglosado desde subtotal
      const precioBase = round2(subtotal / 1.13);
      const ivaMonto   = round2(subtotal - precioBase);

      // Servicio 10%
      const servicio = (typeof order.servicio_10_monto === 'number')
        ? round2(order.servicio_10_monto)
        : (aplicarServicio ? round2(subtotal * 0.10) : 0);

      const total = round2(subtotal + servicio);

      // Etiquetas
      const asientoLabel = (zonaStr === 'bar' && tipoAsientoStr === 'banco') ? 'Banco' : 'Mesa';
      // Zona prioriza valor válido; si no viene claro, se infiere desde aplicarServicio
      const nombreZona = (zonaStr === 'salon') ? 'Salón'
                      : (zonaStr === 'bar')   ? 'Bar'
                      : (aplicarServicio ? 'Salón' : 'Bar');

      const labelServicio = aplicarServicio
        ? 'Aplicar 10% de servicio (zona Salón)'
        : 'No aplica 10% de servicio (zona Bar)';

      const checkboxHtml = `
        <div class="form-group text-center">
          <div class="form-check d-inline-flex align-items-center justify-content-center gap-2">
            <input type="checkbox" class="form-check-input" id="aplicar-servicio"
              ${aplicarServicio ? 'checked' : ''} disabled>
            <label class="form-check-label" for="aplicar-servicio">${labelServicio}</label>
          </div>
        </div>`;

      Utils.showModal(
        // Título con “Mesa/Banco: #”
        `${asientoLabel}: ${order.mesa_numero} — Procesar Pago`,
        `
        <div class="payment-details">
          <div class="order-summary mb-3">
            <!-- Requisito: arriba de Zona debe ir Mesa/Banco: # -->
            <p><strong>${asientoLabel}:</strong> ${order.mesa_numero}</p>
            <p><strong>Zona:</strong> ${nombreZona}</p>
            <p><strong>Cliente:</strong> ${order.cliente_nombre || '-'}</p>
            <p><strong>Pedido:</strong> #${order.id}</p>
          </div>

          <div class="payment-breakdown">
            <div class="d-flex justify-content-between">
              <span>Precio sin IVA:</span><span>${Utils.formatCurrency(precioBase)}</span>
            </div>
            <div class="d-flex justify-content-between">
              <span>IVA (13%):</span><span>${Utils.formatCurrency(ivaMonto)}</span>
            </div>
            <hr class="my-2">
            <div class="d-flex justify-content-between">
              <span>Subtotal (con IVA):</span><span>${Utils.formatCurrency(subtotal)}</span>
            </div>
            <div class="d-flex justify-content-between">
              <span>Servicio (10%):</span><span id="pago-servicio">${Utils.formatCurrency(servicio)}</span>
            </div>
            <hr>
            <div class="d-flex justify-content-between">
              <strong>Total a pagar:</strong><strong id="pago-total">${Utils.formatCurrency(total)}</strong>
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
            ${checkboxHtml}
          </form>
        </div>
        `,
        [
          { text: 'Cancelar', class: 'btn-light' },
          { text: 'Procesar Pago', class: 'btn-success', onclick: `Orders.processPayment(${orderId}, ${order.mesa_id})` }
        ]
      );

      console.debug('[Pago] raw response:', response);
      console.debug('[Pago] order usado:', order);
      console.debug('[Pago] zona:', order?.zona, 'tipo_asiento:', order?.tipo_asiento,
                    'aplica_servicio_10:', order?.aplica_servicio_10,
                    'servicio_10_monto:', order?.servicio_10_monto);

    } catch (error) {
      console.error('❌ Error en showPaymentModal:', error);
      Utils.showNotification('Error cargando datos del pedido', 'error');
    }
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

  if (metodo === 'credito') {
    this.pendingPayment = { orderId, metodo_pago: metodo, aplicar_servicio: aplicarServicio };
    this.showAdminPasswordModal();
    return;
  }

  if (metodo === 'efectivo') {
    this.showCashModal(orderId, aplicarServicio);
    return;
  }

  this.finalizePayment(orderId, metodo, aplicarServicio);
    },

  // Finalizar pago
    async finalizePayment(orderId, metodo_pago, aplicar_servicio, adminPass = null, cashInfo = null) {
  try {
    const pedido = await Utils.request(`/orders/${orderId}`);

    const data = {
      metodo_pago,
      aplicar_servicio,
      admin_pass: adminPass,
      mesa_id: pedido.data.mesa_id
    };

    if (metodo_pago === 'efectivo' && cashInfo) {
      data.efectivo_recibido = Number(cashInfo.recibido);
      data.efectivo_cambio   = Number(cashInfo.cambio);
    }

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
        `Pago procesado - Total: ${Utils.formatCurrency(response.data.total)}`,
        'success'
      );
    }

    if (typeof Dashboard?.refreshData === 'function') {
      Dashboard.refreshData(pedido.data.mesa_id);
    }

    this.load();

    const printReceipt = await Utils.confirm('¿Desea imprimir el recibo?', 'Imprimir Recibo');
    if (printReceipt) {
      const payload = {
        ...response.data,
        metodo_pago,
        efectivo_recibido: cashInfo?.recibido ?? null,
        efectivo_cambio: cashInfo?.cambio ?? null
      };
      this.printReceipt(payload);
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

    // Mostrar modal para agregar productos (con preservación del bucket)
      async showAddProductsModal(orderId, opts = {}) {
    const { preserve = false } = opts;
    try {
      const resp = await Utils.request(`/orders/${orderId}`);
      const raw = resp?.data?.data ?? resp?.data ?? resp;
      const order = {
        id: raw.id ?? raw.pedido?.id ?? raw.order?.id ?? orderId,
        mesa_numero: raw.mesa_numero ?? raw.mesa?.numero ?? '',
        zona: raw.zona ?? raw.mesa?.zona ?? '',
        tipo_asiento: raw.tipo_asiento ?? raw.mesa?.tipo_asiento ?? ''
      };
      if (!order.id) throw new Error('Pedido no encontrado');

      const sameOrder = Orders.activeOrderCtx && Orders.activeOrderCtx.id === order.id;
      if (!preserve && !sameOrder) {
        Orders.selectedProductsAdd = {};
      }

      Orders.activeOrderCtx = order;
      Orders.modalContext = 'agregar';

      Utils.showModal(
        `Agregar productos — ${
          (order.zona || '').toLowerCase() === 'bar'
            ? ((order.tipo_asiento || '').toLowerCase() === 'banco' ? 'Banco' : 'Mesa')
            : 'Mesa'
        } ${order.mesa_numero || ''}`,
        `
          <div id="pedido-tabs" class="tabs"></div>
          <div id="pedido-subcategorias" class="subcategorias"></div>
          <div id="pedido-productos" class="productos-grid" style="min-height:200px;"></div>
          <div class="order-total mt-3 mb-1">
            <strong>Total Adicional: <span id="order-total">₡0,00</span></strong>
          </div>
        `,
        [{ text: 'Cerrar', class: 'btn-light', onclick: () => Orders._cleanupAddModalOverrides() }],
        'modal-lg'
      );

      await Menu.load();
      Orders.loadTabsUI();
      Orders._updateAddOrderTotal();
      Orders._refreshAddFooter(order);
    } catch (e) {
      console.error('Error en showAddProductsModal:', e);
      Utils.showNotification(e?.message || 'Error cargando pedido', 'error');
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
        if (!orderId) { Utils.showNotification('No se pudo identificar el pedido. Cierre y vuelva a abrir el modal.', 'error'); return; }
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

    // Ver detalles del pedido
    async viewOrder(orderId) {
  try {
    const response = await Utils.request(`/orders/${orderId}`);
    const order = response?.data?.data ?? response?.data ?? response;

    const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
    const toStr = (v) => (v == null ? '' : String(v));
    const norm = (s) => toStr(s)
      .normalize('NFD').replace(/\p{Diacritic}/gu, '') // quitar acentos
      .toLowerCase().trim();

    // === Resolver método de pago desde múltiples fuentes ===
    const resolvePaymentMethod = (o) => {
      const addIf = (arr, v) => { if (v !== undefined && v !== null && String(v).trim() !== '') arr.push(v); };

      const candidates = [];
      // Campos planos comunes
      addIf(candidates, o.metodo_pago);
      addIf(candidates, o.metodo);
      addIf(candidates, o.payment_method);
      addIf(candidates, o.forma_pago);
      addIf(candidates, o.tipo_pago);
      addIf(candidates, o.pago_metodo);
      addIf(candidates, o.metodoPago);
      addIf(candidates, o.method);

      // Posibles IDs numéricos
      addIf(candidates, o.metodo_pago_id);
      addIf(candidates, o.payment_method_id);
      addIf(candidates, o.forma_pago_id);
      addIf(candidates, o.tipo_pago_id);

      // Anidados
      addIf(candidates, o?.payment?.method);
      addIf(candidates, o?.payment?.method_id);
      addIf(candidates, o?.detalle_pago?.metodo);
      addIf(candidates, o?.detalle_pago?.tipo);

      // Arreglos de pagos
      const pagosArr = Array.isArray(o.pagos) ? o.pagos
                      : (Array.isArray(o.payments) ? o.payments : null);
      if (pagosArr && pagosArr.length) {
        const p0 = pagosArr.find(p => Number(p.monto ?? p.amount) > 0) || pagosArr[0];
        addIf(candidates, p0?.metodo);
        addIf(candidates, p0?.method);
        addIf(candidates, p0?.tipo);
        addIf(candidates, p0?.forma);
        addIf(candidates, p0?.payment_method);
        addIf(candidates, p0?.metodo_id);
        addIf(candidates, p0?.method_id);
      }

      if (!candidates.length) return { label: '', color: '', raw: '' };

      const raw = toStr(candidates[0]).trim();
      const m = norm(raw);

      // Map explícito: efectivo
      if (m === '1' || m.includes('efectivo') || m.includes('contado') || m.includes('cash') || m === 'ef') {
        return { label: 'Efectivo', color: 'success', raw };
      }

      // Map explícito: tarjeta POS (débito/crédito)
      if (m === '2' || m.includes('tarjeta') || m.includes('debito') || m.includes('credito') ||
          m.includes('visa') || m.includes('master') || m.includes('amex') || m.includes('pos') ||
          m.includes('datofono') || m.includes('datafono') || m.includes('datáfono') || m.includes('terminal')) {
        return { label: 'Tarjeta', color: 'info', raw };
      }

      // Transferencia / SINPE
      if (m.includes('sinpe') || m.includes('transfer')) {
        return { label: 'Transferencia', color: 'primary', raw };
      }

      // Fallback: muestra lo que venga, pero visible
      return { label: raw, color: 'secondary', raw };
    };

    // ====== Normalización zona/asiento ======
    const zonaStr = norm(order.zona);
    const tipoAsientoStr = norm(order.tipo_asiento || order.mesa_tipo);

    const asientoLabel = (zonaStr === 'bar' && tipoAsientoStr === 'banco') ? 'Banco' : 'Mesa';
    const nombreZona = (zonaStr === 'salon') ? 'Salón' : (zonaStr === 'bar' ? 'Bar' : (order.zona || '-'));

    // ====== Reglas de cálculo ======
    const subtotalConIVA = round2(order.total || 0);
    const precioBase     = round2(subtotalConIVA / 1.13);
    const ivaMonto       = round2(subtotalConIVA - precioBase);
    const aplicaServicio = (typeof order.aplica_servicio_10 === 'boolean')
      ? order.aplica_servicio_10
      : (zonaStr === 'salon');
    const servicio10     = aplicaServicio ? round2(subtotalConIVA * 0.10) : 0;
    const totalPagar     = round2(subtotalConIVA + servicio10);

    // ====== Estado ======
    const estadoRaw = toStr(order.estado);
    const estado = norm(estadoRaw);
    const estadoColor = (estado === 'pendiente') ? 'warning'
                      : (estado === 'pagado')   ? 'success'
                      : 'danger';

    // ====== Método de pago (solo si pagado) ======
    const metodoInfo = (estado === 'pagado') ? resolvePaymentMethod(order) : { label: '', color: '', raw: '' };

    // --- BOTONES DEL MODAL ---
    const modalButtons = [{ text: 'Cerrar', class: 'btn-light' }];
    if (estado === 'pagado') {
      modalButtons.push({
        text: '<i class="fas fa-print"></i> Reimprimir',
        class: 'btn-primary text-white',
        onclick: `Orders.reimprimirTicket(${order.id})`
      });
    }
    if (estado !== 'pagado') {
      modalButtons.push({
        text: 'Pagar',
        class: 'btn-success text-white',
        onclick: `Orders.confirmarPago(${order.id}, '${asientoLabel}', ${order.mesa_numero})`
      });
    }

    // --- FILAS DE PRODUCTOS ---
    const rows = (order.productos || []).map(p => {
      const nombreCompleto = p.presentacion_nombre
        ? `${p.producto_nombre} - ${p.presentacion_nombre} (${p.presentacion_cantidad})`
        : p.producto_nombre;
      return `
        <tr>
          <td>${nombreCompleto}</td>
          <td>${p.cantidad}</td>
          <td>${Utils.formatCurrency(p.precio_unitario)}</td>
          <td>${Utils.formatCurrency((p.precio_unitario || 0) * (p.cantidad || 0))}</td>
        </tr>
      `;
    }).join('');

    // --- CONTENIDO DEL MODAL ---
    Utils.showModal(`Pedido #${order.id} - ${asientoLabel} ${order.mesa_numero}`, `
      <div class="order-details">
        <div class="order-info mb-3">
          <p><strong>${asientoLabel}:</strong> ${order.mesa_numero}</p>
          <p><strong>Zona:</strong> ${nombreZona}</p>
          <p><strong>Cliente:</strong> ${order.cliente_nombre || '-'}</p>
          <p><strong>Usuario:</strong> ${order.usuario_nombre || '-'}</p>
          <p><strong>Fecha:</strong> ${Utils.formatDateTime ? Utils.formatDateTime(order.fecha) : Utils.formatDate(order.fecha)}</p>
          <p><strong>Estado:</strong> <span class="badge badge-${estadoColor}">${toStr(estadoRaw).toUpperCase()}</span></p>
          ${ (estado === 'pagado' && metodoInfo.label)
              ? `<p data-qa="metodo-pago"><strong>Método de Pago:</strong> <span class="badge badge-${metodoInfo.color}">${toStr(metodoInfo.label).toUpperCase()}</span></p>`
              : '' }
        </div>

        <h4>Productos</h4>
        <div class="table-container">
          <table class="table">
            <thead>
              <tr>
                <th>Producto</th><th>Cantidad</th><th>Precio Unit.</th><th>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              ${rows || '<tr><td colspan="4" class="text-center">Sin productos</td></tr>'}
              <tr>
                <td colspan="3" class="text-end"><strong>Total productos (con IVA):</strong></td>
                <td><strong>${Utils.formatCurrency(subtotalConIVA)}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>

        <h5>Desglose</h5>
        <div class="payment-breakdown">
          <div class="d-flex justify-content-between">
            <span>Precio sin IVA:</span><span>${Utils.formatCurrency(precioBase)}</span>
          </div>
          <div class="d-flex justify-content-between">
            <span>IVA (13%):</span><span>${Utils.formatCurrency(ivaMonto)}</span>
          </div>
          <hr class="my-2">
          <div class="d-flex justify-content-between">
            <span>Subtotal (con IVA):</span><span>${Utils.formatCurrency(subtotalConIVA)}</span>
          </div>
          <div class="d-flex justify-content-between">
            <span>Servicio (10%):</span><span>${Utils.formatCurrency(servicio10)}</span>
          </div>
          <hr>
          <div class="d-flex justify-content-between">
            <strong>Total a pagar:</strong><strong>${Utils.formatCurrency(totalPagar)}</strong>
          </div>
          <div class="small text-muted mt-1">
            ${aplicaServicio ? 'Se aplica 10% de servicio por zona Salón.' : 'No aplica 10% de servicio (zona Bar).'}
          </div>
        </div>
      </div>
    `, modalButtons);

    // --- LOGS QA (ver inputs exactos del backend) ---
    console.debug('[ViewOrder] order.id:', order.id);
    console.debug('[ViewOrder] estado raw:', order.estado, '→ normalizado:', estado);
    console.debug('[ViewOrder] candidatos método (planos/anidados):', {
      metodo_pago: order.metodo_pago, metodo: order.metodo, payment_method: order.payment_method,
      forma_pago: order.forma_pago, tipo_pago: order.tipo_pago, pago_metodo: order.pago_metodo,
      metodoPago: order.metodoPago, method: order.method,
      metodo_pago_id: order.metodo_pago_id, payment_method_id: order.payment_method_id,
      forma_pago_id: order.forma_pago_id, tipo_pago_id: order.tipo_pago_id,
      payment_method_nested: order?.payment?.method, payment_method_id_nested: order?.payment?.method_id,
      detalle_pago_metodo: order?.detalle_pago?.metodo, detalle_pago_tipo: order?.detalle_pago?.tipo
    });
    if (Array.isArray(order.pagos) || Array.isArray(order.payments)) {
      console.debug('[ViewOrder] pagos array:', (order.pagos || order.payments));
    }
    console.debug('[ViewOrder] metodo resuelto:', metodoInfo);

    // Logs existentes
    console.debug('[ViewOrder] zona:', order.zona, 'tipo_asiento:', order.tipo_asiento || order.mesa_tipo,
                  'aplica_servicio_10:', aplicaServicio,
                  'precioBase:', precioBase, 'iva:', ivaMonto,
                  'servicio10:', servicio10, 'totalPagar:', totalPagar);

  } catch (error) {
    console.error('❌ Error cargando detalles del pedido:', error);
    Utils.showNotification('Error cargando detalles del pedido', 'error');
  }
    },

    // === Helper: card de producto (reutilizable) ===
    _renderProductoCard(p) {
      let imagen = '';
      try {
        imagen = p.imagen
          ? new URL(p.imagen, window.location.origin).toString()
          : new URL('/uploads/ImagenGenerica.jpg', window.location.origin).toString();
      } catch(_) {
        imagen = `${window.location.origin}/uploads/ImagenGenerica.jpg`;
      }

      return `
        <div class="producto-card" onclick="Orders.agregarProductoTemporalRouter(${p.id})" style="position: relative;">
          <img src="${imagen}" alt="${p.nombre}" class="producto-img"
              style="max-width: 100%; height: 100px; object-fit: cover; border-radius: 8px; margin-bottom: 5px;">
          <div class="producto-nombre">${p.nombre}</div>
          <div class="producto-precio">${Utils.formatCurrency(p.precio)}</div>
          ${p.tiene_presentaciones ? `
            <div class="badge badge-info badge-presentacion" title="Tiene presentaciones">
              <i class="fas fa-layer-group"></i>
            </div>` : ''}
        </div>`;
    },

  // === Helper: obtener favoritos con fallback ===
    getFavoritos(limit = 24) {
      const prods = Array.isArray(Menu.products) ? Menu.products.slice() : [];

      // a) Marcados explícitamente
      let marcados = prods.filter(p => p?.favorito === true || p?.es_favorito === true || p?.top_seller === true);

      if (marcados.length > 0) {
        // Mantener orden relativo; si quieres puedes ordenar por vendidos desc también
        return marcados.slice(0, limit);
      }

      // b) Fallback por métrica de ventas si existe
      const conMetricas = prods.filter(p => typeof p?.vendidos === 'number' || typeof p?.sales_count === 'number');
      if (conMetricas.length > 0) {
        conMetricas.sort((a, b) => {
          const av = (typeof a.vendidos === 'number' ? a.vendidos : (a.sales_count || 0));
          const bv = (typeof b.vendidos === 'number' ? b.vendidos : (b.sales_count || 0));
          return bv - av; // desc
        });
        return conMetricas.slice(0, limit);
      }

      // c) No hay info
      return [];
    },

    // Carga Pestañas en Modal (con Favoritos)
    loadTabsUI() {
      const categorias = (Menu.categories || []).filter(c => c.tipo === 'principal');

      const tabsContainer = document.getElementById("pedido-tabs");
      tabsContainer.innerHTML = "";

      // --- Pestaña fija de Favoritos ---
      const favBtn = document.createElement("button");
      favBtn.type = "button";
      favBtn.className = "btn btn-sm btn-warning me-2 mb-2 d-flex align-items-center";
      favBtn.dataset.id = 'favoritos';
      favBtn.onclick = () => Orders.selectCategoriaTab('favoritos');
      const favText = document.createElement("span");
      favText.textContent = `⭐ Favoritos`;
      favBtn.appendChild(favText);
      tabsContainer.appendChild(favBtn);

      // --- Pestañas por categoría ---
      categorias.forEach(cat => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn btn-sm btn-light me-2 mb-2 d-flex align-items-center";
        btn.dataset.id = String(cat.id);
        btn.onclick = () => Orders.selectCategoriaTab(cat.id);

        let emoji = "🔖";
        switch ((cat.nombre || '').toLowerCase()) {
          case "bebidas":   emoji = "🥤"; break;
          case "cervezas":  emoji = "🍺"; break;
          case "comidas":   emoji = "🍽️"; break;
          case "licores":   emoji = "🥃"; break;
          case "varios":    emoji = "📦"; break;
        }

        const text = document.createElement("span");
        text.textContent = `${emoji} ${cat.nombre}`;

        btn.appendChild(text);
        tabsContainer.appendChild(btn);
      });

      // Activar pestaña predeterminada:
      // Si hay favoritos, abrir Favoritos; si no, primera categoría
      const favoritos = this.getFavoritos(1);
      if (favoritos.length > 0) {
        this.selectCategoriaTab('favoritos');
      } else {
        const tabInicial = categorias[0]?.id;
        if (tabInicial) this.selectCategoriaTab(tabInicial);
      }
    },

    // Selecciona Pestaña según Modal (con soporte Favoritos y categorías sin subcategorías)
    async selectCategoriaTab(categoriaId) {
    const subcatContainer = document.getElementById("pedido-subcategorias");
    const productosContainer = document.getElementById("pedido-productos");

    subcatContainer.innerHTML = "";
    productosContainer.innerHTML = "";

    // Marcar pestaña activa visualmente
    const botones = document.querySelectorAll("#pedido-tabs button");
    botones.forEach(btn => {
      btn.classList.toggle("active", btn.dataset.id == String(categoriaId));
    });

    // --- Caso especial: Favoritos ---
    if (String(categoriaId) === 'favoritos') {
      const favoritos = this.getFavoritos(24);
      if (favoritos.length === 0) {
        productosContainer.innerHTML = `
          <div class="alert alert-warning" role="alert">
            No hay productos favoritos configurados.
          </div>`;
        return;
      }
      productosContainer.innerHTML = favoritos.map(p => Orders._renderProductoCard(p)).join('');
      return;
    }

    // --- Caso categorías normales ---
    const subcategorias = (Menu.categories || []).filter(c => c.tipo === 'subcategoria' && c.parent_id == categoriaId);
    const productosCat = (Menu.products || []).filter(p => p.categoria_id == categoriaId);

    if (subcategorias.length > 0) {
      const subcatHtml = subcategorias.map(sc => {
        const nombre = (sc.nombre || '').toLowerCase();
        let emoji = "🔹";

        if (nombre === "calientes") emoji = "☕";
        else if (nombre === "gaseosas") emoji = "🥤";
        else if (nombre === "naturales") emoji = "🍹";
        else if (nombre === "bebidas preparadas") emoji = "🍸";
        else if (nombre === "extranjeras") emoji = "🍻";
        else if (nombre === "latas") emoji = "🧃";
        else if (nombre === "nacionales") emoji = "🍺";
        else if (nombre === "acompañamientos") emoji = "🍟";
        else if (nombre === "bocas") emoji = "🌮";
        else if (nombre === "platos principales") emoji = "🥘";
        else if (nombre === "postres") emoji = "🍰";
        else if (nombre === "snack" || nombre === "snacks") emoji = "🍿";
        else if (["guaro","ron","tequila","vodka","whisky"].includes(nombre)) emoji = "🥃";
        else if (["aguardiente","brandy","cognac","ginebra","otros"].includes(nombre)) emoji = "🍾";
        else if (["licores dulces","licores cremosos","licores cremas","cremas"].includes(nombre)) emoji = "🥂";
        else if (["vino","vinos","otros vinos"].includes(nombre)) emoji = "🍷";

        return `
          <button type="button" class="btn btn-outline-secondary btn-sm me-2 mb-2 d-inline-flex align-items-center"
                  data-id="${sc.id}"
                  onclick="Orders.selectSubcategoria(${sc.id}, ${categoriaId})">
            <span class="me-1">${emoji}</span>
            <span>${sc.nombre}</span>
          </button>`;
      }).join('');

      subcatContainer.innerHTML = `<div class="mb-2"><strong>Subcategorías:</strong><br>${subcatHtml}</div>`;
      productosContainer.innerHTML = `
        <div class="alert alert-info d-flex align-items-center gap-2" role="alert">
          <i class="fas fa-hand-pointer"></i>
          Selecciona una subcategoría para ver los productos disponibles.
        </div>`;
      return;
    }

    // Sin subcategorías → render directa por categoría
      if (productosCat.length === 0) {
        productosContainer.innerHTML = `<p class="text-muted">No hay productos en esta categoría</p>`;
        return;
      }
      productosContainer.innerHTML = productosCat.map(p => Orders._renderProductoCard(p)).join('');
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
        <div class="producto-card" onclick="Orders.agregarProductoTemporalRouter(${p.id})" style="position: relative;">
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

  // Router de contexto para click en card de producto
    agregarProductoTemporalRouter(productoId) {
      if (this.modalContext === 'agregar') {
        return this.agregarProductoTemporalAdd(productoId);
      }
      return this.agregarProductoTemporal(productoId);
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

    //Actualiza el total en el resumen del pedido
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

    //Muestra el resumen del pedido antes de crearlo
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

    //Incrementa la cantidad de un producto en el resumen
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

    //Decrementa la cantidad de un producto en el resumen
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

    //Actualiza el total en el resumen del pedido
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

    //Refresca la UI del modal de creación de pedido
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

    //Muestra el selector de presentaciones para un producto
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

    //Agrega una presentación seleccionada al resumen
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

    // Resta una presentación seleccionada del resumen
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

    // Renderiza el resumen de presentaciones seleccionadas
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

    // Borra todas las presentaciones seleccionadas para un producto
    borrarPresentacionesSeleccionadas(productoId) {
        if (Orders.presentacionesSeleccionadas?.[productoId]) {
            delete Orders.presentacionesSeleccionadas[productoId];
        }

        Orders.renderResumenPresentaciones(productoId, true);
    },

    // Cancela la selección de presentaciones y cierra el modal
    cancelarSeleccionPresentaciones(productoId) {
    Orders.borrarPresentacionesSeleccionadas(productoId);
    Utils.hideModal();
    // Reabrir modal padre si corresponde
    setTimeout(() => {
      try {
        if (Orders.modalContext === 'agregar' && Orders.activeOrderId()) {
          Orders.showAddProductsModal(Orders.activeOrderId());
        } else if (Orders.modalContext === 'nuevo' && Orders.mesaIdActual != null) {
          Orders.showCreateOrderModal(Orders.mesaIdActual);
        }
      } catch (e) { console.error(e); }
    }, 150);
    },

    // Confirma las presentaciones seleccionadas y las agrega al pedido
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

    // Datos temporales para agregar productos a pedido existente
      _updateAddOrderTotal() {
      const bucket = Orders.selectedProductsAdd || {};
      let total = 0;
      for (const [key, item] of Object.entries(bucket)) {
        if (typeof item === 'object') {
          const precio = Number(item.precio ?? item.precio_unitario ?? item.price ?? 0) || 0;
          const cantidad = Number(item.cantidad ?? 0) || 0;
          total += precio * cantidad;
        } else {
          const pid = parseInt(key);
          const p = (Menu.products || []).find(prod => prod.id === pid);
          if (p) total += (Number(p.precio) || 0) * (Number(item || 0) || 0);
        }
      }
      const totalEl = document.getElementById('order-total');
      if (totalEl) totalEl.textContent = Utils.formatCurrency(total);
      const totalEl2 = document.getElementById('add-order-summary-total');
      if (totalEl2) totalEl2.textContent = Utils.formatCurrency(total);
    },

    // Refresca el footer del modal de agregar a pedido
    _refreshAddFooter(orderCtx) {
    const footer = document.querySelector('.modal-footer');
    if (!footer) return;
    const ctx = orderCtx || Orders.activeOrderCtx || {};
    const tipoZona = (ctx.zona || '').toLowerCase() === 'bar'
      ? ((ctx.tipo_asiento || '').toLowerCase() === 'banco' ? 'Banco' : 'Mesa')
      : 'Mesa';

    const bucket = Orders.selectedProductsAdd || {};
    const cantidad = Object.values(bucket).reduce((acc, val) => {
      const c = (typeof val === 'object') ? parseInt(val.cantidad || 0) : parseInt(val || 0);
      return acc + (isNaN(c) ? 0 : c);
    }, 0);

    footer.innerHTML = '';
    const row = document.createElement('div');
    row.className = 'd-flex w-100 align-items-center justify-content-between flex-wrap gap-2';

    const left = document.createElement('div');
    left.className = 'd-flex align-items-center gap-2 flex-wrap';

    const btnAdd = document.createElement('button');
    btnAdd.className = 'btn btn-success';
    btnAdd.innerHTML = (cantidad > 0)
      ? `Agregar a ${tipoZona} ${ctx.mesa_numero || ''} (${cantidad})`
      : `Agregar a ${tipoZona} ${ctx.mesa_numero || ''}`;
    btnAdd.onclick = () => Orders.showAddSummaryModal(ctx.id);
    left.appendChild(btnAdd);

    const btnView = document.createElement('button');
    btnView.className = 'btn btn-warning text-white';
    btnView.innerHTML = '<i class="fas fa-eye"></i> Ver Pedido';
    btnView.onclick = () => Orders.viewOrder(ctx.id);
    left.appendChild(btnView);

    const btnCancel = document.createElement('button');
    btnCancel.className = 'btn btn-light';
    btnCancel.innerText = 'Cancelar';
    btnCancel.onclick = () => Orders._cleanupAddModalOverrides(Orders.__addModalOrigRefs || {});
    row.appendChild(left);
    row.appendChild(btnCancel);

    footer.appendChild(row);
  },

  // Confirma y envía los productos seleccionados para agregar al pedido
    async _confirmAddToOrder(orderId) {
  const bucket = Orders.selectedProductsAdd || {};
  const merge = new Map();

  for (const [key, item] of Object.entries(bucket)) {
    if (typeof item === 'object') {
      const pid = Number(item.producto_id || String(key).split('_')[0]) || 0;
      const presId = (item.presentacion_id ?? item.presentacion_producto_id);
      const pres = (presId !== null && presId !== undefined) ? Number(presId) : null;
      const cant = Number(item.cantidad || 0) || 0;
      const precio = Number(item.precio ?? item.precio_unitario ?? 0) || 0;
      if (!pid || !cant) continue;
      // Clave compuesta: producto + presentacion + precio
      const mkey = `${pid}_${pres ?? 'null'}_${precio}`;
      const prev = merge.get(mkey) || { producto_id: pid, cantidad: 0 };
      prev.cantidad += cant;
      if (pres !== null) {
        prev.presentacion_id = pres;
        prev.presentacion_producto_id = pres;
      }
      if (precio) {
        prev.precio = precio;
        prev.precio_unitario = precio;
      }
      merge.set(mkey, prev);
    } else {
      const pid = Number(key) || 0;
      const cant = Number(item) || 0;
      if (!pid || !cant) continue;
      const mkey = `${pid}_null_0`;
      const prev = merge.get(mkey) || { producto_id: pid, cantidad: 0 };
      prev.cantidad += cant;
      merge.set(mkey, prev);
    }
  }

  const productos = Array.from(merge.values());
  if (!productos.length) {
    Utils.showNotification('Por favor agregue al menos un producto', 'warning');
    return;
  }

  try {
    const response = await Utils.request(`/orders/${orderId}/products`, {
      method: 'POST',
      body: JSON.stringify({ productos })
    });

    Utils.hideModal();
    Orders._cleanupAddModalOverrides(Orders.__addModalOrigRefs || {}, { keepContext: true });
    Utils.showNotification('Productos agregados exitosamente', 'success');

    Orders.selectedProductsAdd = {};
    if (typeof Dashboard?.refreshData === 'function') {
      Dashboard.refreshData(response?.data?.mesa_id ?? null);
    }
    Orders.load && Orders.load();
  } catch (err) {
    console.error('❌ Error POST /orders/:id/products', err);
    Utils.showNotification(err?.message || 'Error agregando productos', 'error');
  }
    },

  // Limpia overrides y estado temporal del modal de agregar a pedido
    _cleanupAddModalOverrides() {
      try {
        this.selectedProductsAdd = {};
        this.modalContext = 'nuevo';
        Utils.hideModal();
      } catch(e) {}
    },

    // Imprimir comanda
    printComanda(comandaId) {
        // Aquí se implementaría la lógica de impresión de comanda
        Utils.showNotification('Comanda enviada a cocina', 'info');
    },

    // Imprimir recibo
    printReceipt(paymentData) {
  try {
    // Muestra notificación e incluye breakdown si viene
    const metodo = paymentData?.metodo_pago || paymentData?.metodo || '';
    const recibido = paymentData?.efectivo_recibido ?? paymentData?.recibido ?? null;
    const cambio   = paymentData?.efectivo_cambio   ?? paymentData?.cambio   ?? null;

    let extra = '';
    if (metodo === 'efectivo') {
      extra = ` | Recibido: ${Utils.formatCurrency(recibido || 0)} | Cambio: ${Utils.formatCurrency(cambio || 0)}`;
    }
    Utils.showNotification(`Recibo generado (${metodo || 'pago'})${extra}`, 'info');
  } catch(e) {
    Utils.showNotification('No se pudo generar el recibo', 'error');
  }
},
// ================== BLOQUE INDEPENDIENTE PARA 'AGREGAR A PEDIDO' ==================
  showPresentacionesSelectorAdd(producto) {
    const productoId = producto.id;
    if (!this.presentacionesSeleccionadasAdd) this.presentacionesSeleccionadasAdd = {};
    this.presentacionesSeleccionadasAdd[productoId] = { nombreProducto: producto.nombre, presentaciones: {} };
    Utils.request(`/menu/products/${productoId}/presentaciones`).then(response => {
      const { presentaciones } = response.data;
      const asignadas = (presentaciones || []).filter(p => p.asignada);
      if (asignadas.length === 0) {
        Utils.showNotification("Este producto no tiene presentaciones asignadas.", "info");
        return;
      }
      const cardsHTML = asignadas.map(p => {
        const nombreSafe = encodeURIComponent(p.nombre);
        const cantidadSafe = encodeURIComponent(p.cantidad);
        return `
          <div class="producto-card" onclick="Orders.agregarPresentacionAdd(
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
      Utils.showModal(
        `Seleccionar presentaciones para: ${producto.nombre}`,
        `
          <div id="selector-presentaciones-grid" class="productos-grid mb-3">${cardsHTML}</div>
          <div id="resumen-presentaciones-add">${Orders.renderResumenPresentacionesAdd(productoId)}</div>
        `,
        [
          { text: 'Agregar', class: 'btn-success', onclick: `Orders.confirmarPresentacionesAdd(${productoId})` },
          { text: 'Borrar', class: 'btn-secondary', align: 'left', onclick: `Orders.borrarPresentacionesSeleccionadasAdd(${productoId})` },
          { text: 'Cancelar', class: 'btn-light', align: 'right', onclick: `Orders.cancelarSeleccionPresentacionesAdd(${productoId})` }
        ],
        'modal-lg'
      );
    }).catch(err => {
      console.error("Error cargando presentaciones:", err);
      Utils.showNotification("Error cargando presentaciones del producto", "error");
    });
  },

  agregarPresentacionAdd(productoId, presentacionProductoId, nombrePresentacion, precio, cantidadTexto) {
    if (!this.presentacionesSeleccionadasAdd) this.presentacionesSeleccionadasAdd = {};
    if (!this.presentacionesSeleccionadasAdd[productoId]) {
      const producto = Menu.products.find(p => p.id === productoId);
      this.presentacionesSeleccionadasAdd[productoId] = { nombreProducto: producto?.nombre || 'Producto', presentaciones: {} };
    }
    const seleccion = this.presentacionesSeleccionadasAdd[productoId];
    if (seleccion.presentaciones[presentacionProductoId]) {
      seleccion.presentaciones[presentacionProductoId].cantidad += 1;
    } else {
      seleccion.presentaciones[presentacionProductoId] = {
        nombrePresentacion, precio: parseFloat(precio), cantidadTexto, cantidad: 1, presentacion_id: presentacionProductoId
      };
    }
    this.renderResumenPresentacionesAdd(productoId, true);
  },

  restarPresentacionAdd(productoId, presentacionId) {
    const seleccion = this.presentacionesSeleccionadasAdd?.[productoId];
    if (!seleccion || !seleccion.presentaciones[presentacionId]) return;
    const pres = seleccion.presentaciones[presentacionId];
    if (pres.cantidad > 1) pres.cantidad -= 1; else delete seleccion.presentaciones[presentacionId];
    if (Object.keys(seleccion.presentaciones).length === 0) delete this.presentacionesSeleccionadasAdd[productoId];
    this.renderResumenPresentacionesAdd(productoId, true);
  },

  renderResumenPresentacionesAdd(productoId, forceRender=false) {
    const seleccion = this.presentacionesSeleccionadasAdd?.[productoId];
    if (!seleccion || Object.keys(seleccion.presentaciones).length === 0) {
      if (forceRender && document.getElementById('resumen-presentaciones-add')) {
        document.getElementById('resumen-presentaciones-add').innerHTML = '';
      }
      return '';
    }
    const presentaciones = seleccion.presentaciones;
    let total = 0;
    const filas = Object.entries(presentaciones).map(([presentacionId, data]) => {
      const subtotal = data.cantidad * data.precio; total += subtotal;
      return `
        <tr>
          <td>${data.nombrePresentacion || 'Sin nombre'}</td>
          <td>${data.cantidadTexto || '-'}</td>
          <td>${data.cantidad}</td>
          <td>₡${data.precio.toFixed(2)}</td>
          <td>₡${subtotal.toFixed(2)}</td>
          <td>
            <button class="btn btn-sm btn-danger" onclick="Orders.restarPresentacionAdd(${productoId}, ${presentacionId})">
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
            <tr><th>Nombre</th><th>Presentación</th><th>Cantidad</th><th>Precio</th><th>Subtotal</th><th>Quitar</th></tr>
          </thead>
          <tbody>${filas}</tbody>
        </table>
      </div>
      <div class="text-end me-2"><strong>Total: ₡${total.toFixed(2)}</strong></div>
    `;
    if (forceRender && document.getElementById('resumen-presentaciones-add')) {
      document.getElementById('resumen-presentaciones-add').innerHTML = tabla;
    }
    return tabla;
  },

  borrarPresentacionesSeleccionadasAdd(productoId) {
    if (this.presentacionesSeleccionadasAdd?.[productoId]) delete this.presentacionesSeleccionadasAdd[productoId];
    this.renderResumenPresentacionesAdd(productoId, true);
  },

  cancelarSeleccionPresentacionesAdd(productoId) {
    if (Orders.presentacionesSeleccionadasAdd?.[productoId]) {
      delete Orders.presentacionesSeleccionadasAdd[productoId];
    }
    Utils.hideModal();
    setTimeout(() => {
      try {
        if (Orders.modalContext === 'agregar' && Orders.activeOrderId && Orders.activeOrderId()) {
          Orders.showAddProductsModal(Orders.activeOrderId(), { preserve: true });
        }
      } catch (e) { console.error(e); }
    }, 100);
  },

  showAddSummaryModal(orderId) {
  const bucket = Orders.selectedProductsAdd || {};
  if (!Object.keys(bucket).length) {
    Utils.showNotification('No hay productos seleccionados', 'warning');
    return;
  }

  // Construir filas
  let total = 0;
  const rows = Object.entries(bucket).map(([key, item]) => {
    let nombre = '';
    let cantidad = 0;
    let precio = 0;

    if (typeof item === 'object') {
      nombre = item.nombre || '';
      cantidad = Number(item.cantidad || 0) || 0;
      precio = Number(item.precio ?? item.precio_unitario ?? 0) || 0;
    } else {
      const pid = parseInt(key);
      const p = (Menu.products || []).find(prod => prod.id === pid);
      nombre = p?.nombre || `Producto ${pid}`;
      cantidad = Number(item || 0) || 0;
      precio = Number(p?.precio || 0) || 0;
    }

    const subtotal = precio * cantidad;
    total += subtotal;

    return `
      <tr id="row-add-${key}">
        <td>${nombre || '-'}</td>
        <td class="text-end"><strong class="cantidad">${cantidad}</strong></td>
        <td class="text-end">${Utils.formatCurrency(precio)}</td>
        <td class="text-end subtotal">${Utils.formatCurrency(subtotal)}</td>
        <td class="text-center">
          <div class="btn-group btn-group-sm" role="group">
            <button type="button" class="btn btn-outline-secondary" onclick="Orders.addRestarProductoAdd('${key}')">
              <i class="fas fa-minus"></i>
            </button>
            <button type="button" class="btn btn-outline-secondary" onclick="Orders.addSumarProductoAdd('${key}')">
              <i class="fas fa-plus"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  const contenido = `
    <div class="table-responsive">
      <table class="table table-bordered table-sm">
        <thead>
          <tr>
            <th>Producto</th>
            <th class="text-end">Cantidad</th>
            <th class="text-end">Precio Unit.</th>
            <th class="text-end">Subtotal</th>
            <th class="text-center">Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
    <div class="mt-3 text-end">
      <h5>Total adicional: <span id="add-order-summary-total">${Utils.formatCurrency(total)}</span></h5>
    </div>
  `;

  Utils.showModal(`Resumen — Agregar a Pedido #${orderId}`, contenido, [
    {
      text: 'Seguir Agregando',
      class: 'btn-light',
      align: 'left',
      onclick: () => {
        Utils.hideModal();
        setTimeout(() => Orders.showAddProductsModal(orderId, { preserve: true }), 50);
      }
    },
    {
      text: 'Cancelar',
      class: 'btn-danger',
      align: 'left',
      onclick: async () => {
        const ok = await Utils.confirm('¿Desea limpiar los productos seleccionados?', 'Cancelar agregado');
        if (!ok) return;
        Orders.selectedProductsAdd = {};
        Orders._updateAddOrderTotal();
        Utils.hideModal();
      }
    },
    {
      text: 'Agregar a Pedido',
      class: 'btn-success',
      align: 'right',
      onclick: () => Orders._confirmAddToOrder(orderId)
    }
  ]);
  },

  _addSumarProductoAdd(key) {
  if (!Orders.selectedProductsAdd || Orders.selectedProductsAdd[key] == null) return;
  if (typeof Orders.selectedProductsAdd[key] === 'object') {
    Orders.selectedProductsAdd[key].cantidad = Number(Orders.selectedProductsAdd[key].cantidad || 0) + 1;
  } else {
    Orders.selectedProductsAdd[key] = Number(Orders.selectedProductsAdd[key] || 0) + 1;
  }
  Orders._updateAddOrderTotal();
  Orders.showAddSummaryModal(Orders.activeOrderId && Orders.activeOrderId());
  },

  _addRestarProductoAdd(key) {
    if (!Orders.selectedProductsAdd || Orders.selectedProductsAdd[key] == null) return;
    if (typeof Orders.selectedProductsAdd[key] === 'object') {
      const n = Number(Orders.selectedProductsAdd[key].cantidad || 0) - 1;
      if (n > 0) Orders.selectedProductsAdd[key].cantidad = n; else delete Orders.selectedProductsAdd[key];
    } else {
      const n = Number(Orders.selectedProductsAdd[key] || 0) - 1;
      if (n > 0) Orders.selectedProductsAdd[key] = n; else delete Orders.selectedProductsAdd[key];
    }
    Orders._updateAddOrderTotal();
    Orders.showAddSummaryModal(Orders.activeOrderId && Orders.activeOrderId());
  },



  confirmarPresentacionesAdd(productoId) {
    const seleccion = Orders.presentacionesSeleccionadasAdd?.[productoId];
    if (!seleccion || Object.keys(seleccion.presentaciones).length === 0) {
      Utils.showNotification('No hay presentaciones seleccionadas.', 'warning');
      return;
    }
    const producto = (Menu.products || []).find(p => p.id === productoId);
    const nombreProducto = producto?.nombre || 'Producto';
    if (!Orders.selectedProductsAdd) Orders.selectedProductsAdd = {};

    for (const [presentacionProductoId, data] of Object.entries(seleccion.presentaciones)) {
      const key = `${productoId}_${presentacionProductoId}`;
      const precioNum = Number(data.precio) || 0;
      if (!Orders.selectedProductsAdd[key]) {
        Orders.selectedProductsAdd[key] = {
          producto_id: Number(productoId),
          presentacion_id: Number(presentacionProductoId),
          presentacion_producto_id: Number(presentacionProductoId), // alias
          nombre: `${nombreProducto} - ${data.nombrePresentacion} (${data.cantidadTexto})`,
          cantidad: Number(data.cantidad) || 0,
          precio: precioNum,
          precio_unitario: precioNum // alias
        };
      } else {
        Orders.selectedProductsAdd[key].cantidad += Number(data.cantidad) || 0;
        if (!Orders.selectedProductsAdd[key].precio && precioNum) {
          Orders.selectedProductsAdd[key].precio = precioNum;
          Orders.selectedProductsAdd[key].precio_unitario = precioNum;
        }
      }
    }

    delete Orders.presentacionesSeleccionadasAdd?.[productoId];
    Orders._updateAddOrderTotal();
    Orders._refreshAddFooter(Orders.activeOrderCtx);

    Utils.hideModal();
    setTimeout(() => {
      try {
        if (Orders.modalContext === 'agregar' && Orders.activeOrderId && Orders.activeOrderId()) {
          Orders.showAddProductsModal(Orders.activeOrderId(), { preserve: true });
        }
      } catch(e){ console.error(e); }
    }, 80);
  },

  agregarProductoTemporalAdd(productoId) {
    if (!this.selectedProductsAdd) this.selectedProductsAdd = {};
    const producto = (Menu.products || []).find(p => p.id === productoId);
    if (!producto) return;
    if (producto.tiene_presentaciones) {
      this.showPresentacionesSelectorAdd(producto);
      return;
    }
    const key = String(productoId);
    this.selectedProductsAdd[key] = (this.selectedProductsAdd[key] || 0) + 1;
    this._updateAddOrderTotal();
    this._refreshAddFooter(this.activeOrderCtx);
  },

};


  


/* ==========================================================================
 * OVERRIDES SEGUROS PARA "AGREGAR PRODUCTOS A PEDIDO EXISTENTE"
 * - Emulan la lógica estable de "Crear Pedido"
 * - No rompen funciones existentes: se asignan al final sobre Orders.*
 * - Incluyen: resumen antes de enviar, sumatoria robusta y payload correcto
 * ========================================================================== */

(function(){
  if (typeof window === 'undefined') return;
  if (typeof Orders !== 'object') return;

  // Helper: ID de pedido activo
  if (typeof Orders.activeOrderId !== 'function') {
    Orders.activeOrderId = function() {
      return (this.activeOrderCtx && this.activeOrderCtx.id) ? this.activeOrderCtx.id : null;
    };
  }

  // === Helper total (equivalente al de Crear Pedido, pero para selectedProductsAdd)
  Orders.getTotalSeleccionadoAdd = function() {
    let total = 0;
    const bucket = this.selectedProductsAdd || {};
    for (const [key, item] of Object.entries(bucket)) {
      if (typeof item === 'object') {
        const precio   = Number(item.precio ?? item.precio_unitario ?? 0) || 0;
        const cantidad = Number(item.cantidad ?? 0) || 0;
        total += precio * cantidad;
      } else {
        const productoId = parseInt(key);
        const p = (Menu.products || []).find(pr => pr.id === productoId);
        if (p) total += (Number(p.precio) || 0) * (Number(item || 0) || 0);
      }
    }
    return total;
  };

  // === Mostrar modal para agregar productos (preserva bucket al volver del submodal)
  Orders.showAddProductsModal = async function(orderId, opts = {}) {
    const { preserve = false } = opts;
    try {
      const resp = await Utils.request(`/orders/${orderId}`);
      const raw = resp?.data?.data ?? resp?.data ?? resp;
      const order = {
        id: raw.id ?? raw.pedido?.id ?? raw.order?.id ?? orderId,
        mesa_numero: raw.mesa_numero ?? raw.mesa?.numero ?? '',
        zona: raw.zona ?? raw.mesa?.zona ?? '',
        tipo_asiento: raw.tipo_asiento ?? raw.mesa?.tipo_asiento ?? ''
      };
      if (!order.id) throw new Error('Pedido no encontrado');

      const sameOrder = this.activeOrderCtx && this.activeOrderCtx.id === order.id;
      if (!preserve && !sameOrder) {
        this.selectedProductsAdd = {};
      }

      this.activeOrderCtx = order;
      this.modalContext = 'agregar';

      Utils.showModal(
        `Agregar productos — ${ (order.zona || '').toLowerCase() === 'bar'
          ? ((order.tipo_asiento || '').toLowerCase() === 'banco' ? 'Banco' : 'Mesa')
          : 'Mesa'
        } ${order.mesa_numero || ''}`,
        `
          <div id="pedido-tabs" class="tabs"></div>
          <div id="pedido-subcategorias" class="subcategorias"></div>
          <div id="pedido-productos" class="productos-grid" style="min-height:200px;"></div>
          <div class="order-total mt-3 mb-1">
            <strong>Total Adicional: <span id="order-total">₡0,00</span></strong>
          </div>
        `,
        [
          { text: 'Cerrar', class: 'btn-light', onclick: () => Orders._cleanupAddModalOverrides && Orders._cleanupAddModalOverrides() }
        ],
        'modal-lg'
      );

      await Menu.load();
      this.loadTabsUI && this.loadTabsUI();
      this._updateAddOrderTotal();
      this._refreshAddFooter(order);
    } catch (e) {
      console.error('Error en showAddProductsModal:', e);
      Utils.showNotification(e?.message || 'Error cargando pedido', 'error');
    }
  };

  // === Submodal de presentaciones (modo "Agregar a pedido")
  Orders.showPresentacionesSelectorAdd = function(producto) {
    const productoId = producto.id;
    if (!this.presentacionesSeleccionadasAdd) this.presentacionesSeleccionadasAdd = {};
    this.presentacionesSeleccionadasAdd[productoId] = { nombreProducto: producto.nombre, presentaciones: {} };

    Utils.request(`/menu/products/${productoId}/presentaciones`).then(response => {
      const { presentaciones } = response.data;
      const asignadas = (presentaciones || []).filter(p => p.asignada);
      if (asignadas.length === 0) {
        Utils.showNotification("Este producto no tiene presentaciones asignadas.", "info");
        return;
      }
      const cardsHTML = asignadas.map(p => {
        const nombreSafe = encodeURIComponent(p.nombre);
        const cantidadSafe = encodeURIComponent(p.cantidad);
        return `
          <div class="producto-card" onclick="Orders.agregarPresentacionAdd(
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

      Utils.showModal(
        `Seleccionar presentaciones para: ${producto.nombre}`,
        `
          <div id="selector-presentaciones-grid" class="productos-grid mb-3">${cardsHTML}</div>
          <div id="resumen-presentaciones-add">${Orders.renderResumenPresentacionesAdd ? Orders.renderResumenPresentacionesAdd(productoId) : ''}</div>
        `,
        [
          { text: 'Agregar', class: 'btn-success', onclick: `Orders.confirmarPresentacionesAdd(${productoId})` },
          { text: 'Borrar', class: 'btn-secondary', align: 'left', onclick: `Orders.borrarPresentacionesSeleccionadasAdd && Orders.borrarPresentacionesSeleccionadasAdd(${productoId})` },
          { text: 'Cancelar', class: 'btn-light', align: 'right', onclick: `Orders.cancelarSeleccionPresentacionesAdd(${productoId})` }
        ],
        'modal-lg'
      );
    }).catch(err => {
      console.error("Error cargando presentaciones:", err);
      Utils.showNotification("Error cargando presentaciones del producto", "error");
    });
  };

  Orders.agregarPresentacionAdd = function(productoId, presentacionProductoId, nombrePresentacion, precio, cantidadTexto) {
    if (!this.presentacionesSeleccionadasAdd) this.presentacionesSeleccionadasAdd = {};
    if (!this.presentacionesSeleccionadasAdd[productoId]) {
      const producto = (Menu.products || []).find(p => p.id === productoId);
      this.presentacionesSeleccionadasAdd[productoId] = { nombreProducto: producto?.nombre || 'Producto', presentaciones: {} };
    }
    const seleccion = this.presentacionesSeleccionadasAdd[productoId];
    if (seleccion.presentaciones[presentacionProductoId]) {
      seleccion.presentaciones[presentacionProductoId].cantidad += 1;
    } else {
      seleccion.presentaciones[presentacionProductoId] = {
        nombrePresentacion,
        precio: Number(precio) || 0,
        cantidadTexto,
        cantidad: 1,
        presentacion_id: presentacionProductoId
      };
    }
    this.renderResumenPresentacionesAdd && this.renderResumenPresentacionesAdd(productoId, true);
  };

  Orders.cancelarSeleccionPresentacionesAdd = function(productoId) {
    if (this.presentacionesSeleccionadasAdd?.[productoId]) {
      delete this.presentacionesSeleccionadasAdd[productoId];
    }
    Utils.hideModal();
    setTimeout(() => {
      try {
        if (this.modalContext === 'agregar' && this.activeOrderId()) {
          this.showAddProductsModal(this.activeOrderId(), { preserve: true });
        }
      } catch (e) { console.error(e); }
    }, 100);
  };

  Orders.confirmarPresentacionesAdd = function(productoId) {
    const seleccion = this.presentacionesSeleccionadasAdd?.[productoId];
    if (!seleccion || Object.keys(seleccion.presentaciones).length === 0) {
      Utils.showNotification('No hay presentaciones seleccionadas.', 'warning');
      return;
    }
    const producto = (Menu.products || []).find(p => p.id === productoId);
    const nombreProducto = producto?.nombre || 'Producto';
    if (!this.selectedProductsAdd) this.selectedProductsAdd = {};

    for (const [presentacionProductoId, data] of Object.entries(seleccion.presentaciones)) {
      const key = `${productoId}_${presentacionProductoId}`;
      const precioNum = Number(data.precio) || 0;
      if (!this.selectedProductsAdd[key]) {
        this.selectedProductsAdd[key] = {
          producto_id: Number(productoId),
          presentacion_id: Number(presentacionProductoId),
          presentacion_producto_id: Number(presentacionProductoId),
          nombre: `${nombreProducto} - ${data.nombrePresentacion} (${data.cantidadTexto})`,
          cantidad: Number(data.cantidad) || 0,
          precio: precioNum,
          precio_unitario: precioNum
        };
      } else {
        this.selectedProductsAdd[key].cantidad += Number(data.cantidad) || 0;
        if (!this.selectedProductsAdd[key].precio && precioNum) {
          this.selectedProductsAdd[key].precio = precioNum;
          this.selectedProductsAdd[key].precio_unitario = precioNum;
        }
      }
    }

    delete this.presentacionesSeleccionadasAdd[productoId];
    this._updateAddOrderTotal();
    this._refreshAddFooter(this.activeOrderCtx);
    Utils.hideModal();
    setTimeout(() => {
      try {
        if (this.modalContext === 'agregar' && this.activeOrderId()) {
          this.showAddProductsModal(this.activeOrderId(), { preserve: true });
        }
      } catch(e){ console.error(e); }
    }, 80);
  };

  // === Agregar producto desde card (modo agregar a pedido)
  Orders.agregarProductoTemporalAdd = function(productoId) {
    if (!this.selectedProductsAdd) this.selectedProductsAdd = {};
    const producto = (Menu.products || []).find(p => p.id === productoId);
    if (!producto) return;
    if (producto.tiene_presentaciones) {
      this.showPresentacionesSelectorAdd(producto);
      return;
    }
    const key = String(productoId);
    this.selectedProductsAdd[key] = (this.selectedProductsAdd[key] || 0) + 1;
    this._updateAddOrderTotal();
    this._refreshAddFooter(this.activeOrderCtx);
  };

  // === Total robusto (actualiza #order-total y #add-order-summary-total)
  Orders._updateAddOrderTotal = function() {
    const total = this.getTotalSeleccionadoAdd();
    const el1 = document.getElementById('order-total');
    if (el1) el1.textContent = Utils.formatCurrency(total);
    const el2 = document.getElementById('add-order-summary-total');
    if (el2) el2.textContent = Utils.formatCurrency(total);
  };

  // === Footer: abre resumen; si no existe resumen, confirma directo
  Orders._refreshAddFooter = function(orderCtx) {
    const footer = document.querySelector('.modal-footer');
    if (!footer) return;
    const ctx = orderCtx || this.activeOrderCtx || {};
    const tipoZona = (ctx.zona || '').toLowerCase() === 'bar'
      ? ((ctx.tipo_asiento || '').toLowerCase() === 'banco' ? 'Banco' : 'Mesa')
      : 'Mesa';

    const bucket = this.selectedProductsAdd || {};
    const cantidad = Object.values(bucket).reduce((acc, val) => {
      const c = (typeof val === 'object') ? parseInt(val.cantidad || 0) : parseInt(val || 0);
      return acc + (isNaN(c) ? 0 : c);
    }, 0);

    footer.innerHTML = '';
    const row = document.createElement('div');
    row.className = 'd-flex w-100 align-items-center justify-content-between flex-wrap gap-2';

    const left = document.createElement('div');
    left.className = 'd-flex align-items-center gap-2 flex-wrap';

    const btnAdd = document.createElement('button');
    btnAdd.className = 'btn btn-success';
    btnAdd.innerHTML = (cantidad > 0)
      ? `Agregar a ${tipoZona} ${ctx.mesa_numero || ''} (${cantidad})`
      : `Agregar a ${tipoZona} ${ctx.mesa_numero || ''}`;

    const safeOrderId = ctx.id || (this.activeOrderCtx && this.activeOrderCtx.id);
    btnAdd.onclick = () => {
      try {
        if (typeof this.showAddSummaryModal === 'function') {
          this.showAddSummaryModal(safeOrderId);
        } else {
          this._confirmAddToOrder(safeOrderId);
        }
      } catch (e) {
        console.error('[Add Footer] click error:', e);
        try { this._confirmAddToOrder(safeOrderId); } catch(_) {}
      }
    };
    left.appendChild(btnAdd);

    const btnView = document.createElement('button');
    btnView.className = 'btn btn-warning text-white';
    btnView.innerHTML = '<i class="fas fa-eye"></i> Ver Pedido';
    btnView.onclick = () => this.viewOrder(safeOrderId);
    left.appendChild(btnView);

    const btnCancel = document.createElement('button');
    btnCancel.className = 'btn btn-light';
    btnCancel.innerText = 'Cancelar';
    btnCancel.onclick = () => this._cleanupAddModalOverrides && this._cleanupAddModalOverrides(this.__addModalOrigRefs || {});
    row.appendChild(left);
    row.appendChild(btnCancel);
    footer.appendChild(row);
  };

  // === Resumen antes de confirmar (idéntico UX a Crear Pedido)
  Orders.showAddSummaryModal = function(orderId) {
    const bucket = this.selectedProductsAdd || {};
    if (!Object.keys(bucket).length) {
      Utils.showNotification('No hay productos seleccionados', 'warning');
      return;
    }

    let total = 0;
    const rows = Object.entries(bucket).map(([key, item]) => {
      let nombre = '';
      let cantidad = 0;
      let precio = 0;

      if (typeof item === 'object') {
        nombre = item.nombre || '';
        cantidad = Number(item.cantidad || 0) || 0;
        precio = Number(item.precio ?? item.precio_unitario ?? 0) || 0;
      } else {
        const pid = parseInt(key);
        const p = (Menu.products || []).find(prod => prod.id === pid);
        nombre = p?.nombre || `Producto ${pid}`;
        cantidad = Number(item || 0) || 0;
        precio = Number(p?.precio || 0) || 0;
      }

      const subtotal = precio * cantidad;
      total += subtotal;

      return `
        <tr id="row-add-${key}">
          <td>${nombre || '-'}</td>
          <td class="text-end"><strong class="cantidad">${cantidad}</strong></td>
          <td class="text-end">${Utils.formatCurrency(precio)}</td>
          <td class="text-end subtotal">${Utils.formatCurrency(subtotal)}</td>
          <td class="text-center">
            <div class="btn-group btn-group-sm" role="group">
              <button type="button" class="btn btn-outline-secondary" onclick="Orders.addRestarProductoAdd('${key}')">
                <i class="fas fa-minus"></i>
              </button>
              <button type="button" class="btn btn-outline-secondary" onclick="Orders.addSumarProductoAdd('${key}')">
                <i class="fas fa-plus"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    const contenido = `
      <div class="table-responsive">
        <table class="table table-bordered table-sm">
          <thead>
            <tr>
              <th>Producto</th>
              <th class="text-end">Cantidad</th>
              <th class="text-end">Precio Unit.</th>
              <th class="text-end">Subtotal</th>
              <th class="text-center">Acciones</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="mt-3 text-end">
        <h5>Total adicional: <span id="add-order-summary-total">${Utils.formatCurrency(total)}</span></h5>
      </div>
    `;

    Utils.showModal(`Resumen — Agregar a Pedido #${orderId}`, contenido, [
      {
        text: 'Seguir Agregando',
        class: 'btn-light',
        align: 'left',
        onclick: () => {
          Utils.hideModal();
          setTimeout(() => Orders.showAddProductsModal(orderId, { preserve: true }), 50);
        }
      },
      {
        text: 'Cancelar',
        class: 'btn-danger',
        align: 'left',
        onclick: async () => {
          const ok = await Utils.confirm('¿Desea limpiar los productos seleccionados?', 'Cancelar agregado');
          if (!ok) return;
          Orders.selectedProductsAdd = {};
          Orders._updateAddOrderTotal();
          Utils.hideModal();
        }
      },
      {
        text: 'Agregar a Pedido',
        class: 'btn-success',
        align: 'right',
        onclick: () => Orders._confirmAddToOrder(orderId)
      }
    ]);
  };

  // === Handlers +/- para el resumen
  Orders.addSumarProductoAdd = function(key) {
    if (!this.selectedProductsAdd || this.selectedProductsAdd[key] == null) return;
    if (typeof this.selectedProductsAdd[key] === 'object') {
      this.selectedProductsAdd[key].cantidad = Number(this.selectedProductsAdd[key].cantidad || 0) + 1;
    } else {
      this.selectedProductsAdd[key] = Number(this.selectedProductsAdd[key] || 0) + 1;
    }
    this._updateAddOrderTotal();
    const oid = this.activeOrderId && this.activeOrderId();
    if (oid) this.showAddSummaryModal(oid);
  };
  Orders.addRestarProductoAdd = function(key) {
    if (!this.selectedProductsAdd || this.selectedProductsAdd[key] == null) return;
    if (typeof this.selectedProductsAdd[key] === 'object') {
      const n = Number(this.selectedProductsAdd[key].cantidad || 0) - 1;
      if (n > 0) this.selectedProductsAdd[key].cantidad = n; else delete this.selectedProductsAdd[key];
    } else {
      const n = Number(this.selectedProductsAdd[key] || 0) - 1;
      if (n > 0) this.selectedProductsAdd[key] = n; else delete this.selectedProductsAdd[key];
    }
    this._updateAddOrderTotal();
    const oid = this.activeOrderId && this.activeOrderId();
    if (oid) this.showAddSummaryModal(oid);
  };

  // === Confirmación: agrupa por producto + presentacion + precio (evita mezclar 350/750)
  Orders._confirmAddToOrder = async function(orderId) {
    const bucket = this.selectedProductsAdd || {};
    const merge = new Map();

    for (const [key, item] of Object.entries(bucket)) {
      if (typeof item === 'object') {
        const pid    = Number(item.producto_id || String(key).split('_')[0]) || 0;
        const presId = (item.presentacion_id ?? item.presentacion_producto_id);
        const pres   = (presId !== null && presId !== undefined) ? Number(presId) : null;
        const cant   = Number(item.cantidad || 0) || 0;
        const precio = Number(item.precio ?? item.precio_unitario ?? 0) || 0;
        if (!pid || !cant) continue;
        const mkey = `${pid}_${pres ?? 'null'}_${precio}`;
        const prev = merge.get(mkey) || { producto_id: pid, cantidad: 0 };
        prev.cantidad += cant;
        if (pres !== null) {
          prev.presentacion_id = pres;
          prev.presentacion_producto_id = pres;
        }
        if (precio) {
          prev.precio = precio;
          prev.precio_unitario = precio;
        }
        merge.set(mkey, prev);
      } else {
        const pid = Number(key) || 0;
        const cant = Number(item) || 0;
        if (!pid || !cant) continue;
        const mkey = `${pid}_null_0`;
        const prev = merge.get(mkey) || { producto_id: pid, cantidad: 0 };
        prev.cantidad += cant;
        merge.set(mkey, prev);
      }
    }

    const productos = Array.from(merge.values());
    if (!productos.length) {
      Utils.showNotification('Por favor agregue al menos un producto', 'warning');
      return;
    }

    try {
      const response = await Utils.request(`/orders/${orderId}/products`, {
        method: 'POST',
        body: JSON.stringify({ productos })
      });

      Utils.hideModal();
      this._cleanupAddModalOverrides && this._cleanupAddModalOverrides(this.__addModalOrigRefs || {}, { keepContext: true });
      Utils.showNotification('Productos agregados exitosamente', 'success');

      this.selectedProductsAdd = {};
      if (typeof Dashboard?.refreshData === 'function') {
        Dashboard.refreshData(response?.data?.mesa_id ?? null);
      }
      this.load && this.load();
    } catch (err) {
      console.error('❌ Error POST /orders/:id/products', err);
      Utils.showNotification(err?.message || 'Error agregando productos', 'error');
    }
  };

})(); // fin overrides
