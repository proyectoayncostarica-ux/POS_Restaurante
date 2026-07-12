// Dashboard Component
const Dashboard = {
    data: null,

    // Cargar datos del dashboard
    async load() {
        try {
            const response = await Utils.request('/dashboard');
            this.data = response.data;
            this.render();
            if (typeof Tables !== 'undefined') await Tables.load();
            this.setupEventListeners();
        } catch (error) {
            console.error('Error cargando dashboard:', error);
            Utils.showNotification('Error cargando datos del dashboard', 'error');
        }
    },

    // Renderizar dashboard
    render() {
        if (!this.data) return;
        this.filtroTipo = this.filtroTipo || 'todos';

        document.getElementById("greeting-message").textContent = getGreetingMessage();

        // Actualizar estadísticas de mesas
        document.getElementById('mesas-libres').textContent = this.data.mesasLibres || 0;
        document.getElementById('mesas-ocupadas').textContent = this.data.mesasOcupadas || 0;
        document.getElementById('mesas-reservadas').textContent = this.data.mesasReservadas || 0;
        
        // Actualizar estadísticas de cuentas
        document.getElementById("cuentas-pendientes").innerHTML = `<i class="fas fa-hourglass-half" style="color: var(--warning-color);"></i> <b>${this.data.cuentasPendientes || 0}</b>`;
        document.getElementById("cuentas-pagadas").innerHTML = `<i class="fas fa-check-circle" style="color: var(--success-color);"></i> <b>${this.data.cuentasPagadas || 0}</b>`;
        document.getElementById("creditos-pagados").innerHTML = `<i class="fas fa-money-check-alt" style="color: var(--danger-color);"></i> <b>${this.data.creditosPagados || 0}</b>`;
        
        // Actualizar créditos
        document.getElementById("creditos-disponibles").textContent = this.data.creditosDisponibles || 0;
        document.getElementById("monto-total-creditos").textContent = Utils.formatCurrency(this.data.montoTotalCreditos || 0);
        
        // Actualizar ventas del día
        document.getElementById("ventas-contado").innerHTML = `<i class="fas fa-money-bill-wave" style="color: var(--success-color);"></i> <b>${Utils.formatCurrency(this.data.ventasContado || 0)}</b>`;
        document.getElementById("ventas-credito").innerHTML = `<i class="fas fa-credit-card" style="color: var(--info-color);"></i> <b>${Utils.formatCurrency(this.data.ventasCredito || 0)}</b>`;
        document.getElementById("ventas-hoy").innerHTML = `<b>${Utils.formatCurrency(this.data.ventasHoy || 0)}</b>`;

        // Renderizar grid de mesas (no cliqueable)
        this.renderMesasGrid();

        // Renderizar últimas cuentas pagadas
        this.renderUltimasCuentasPagadas();
    },

    // Configurar event listeners
    setupEventListeners() {
        // Hacer la tarjeta de ventas del día cliqueable
        const ventasCard = document.getElementById('ventas-del-dia-card');
        if (ventasCard) {
            ventasCard.addEventListener('click', () => this.mostrarDetalleVentas());
        }
    },

filtrarPorZona(zonaSeleccionada) {
    this.filtroTipo = zonaSeleccionada;

    // Quitar clase 'active' de todos los botones
    document.querySelectorAll('.btn-zona').forEach(btn => {
        btn.classList.remove('active');
    });

    // Activar el botón correspondiente
    const botonActivo = document.querySelector(`.btn-zona[data-tipo="${zonaSeleccionada}"]`);
    if (botonActivo) {
        botonActivo.classList.add('active');
    }

    // Renderizar
    this.renderMesasGrid();
    Navigation.syncInternalSubnav('dashboard');
},

    // Renderizar grid de mesas (no cliqueable)
renderMesasGrid() {
    const container = document.getElementById('mesas-grid');

    // Filtrar según tipo: 'salon', 'bar' o 'todos'
    let zonas = this.data.mesasDetalle;
    if (this.filtroTipo === 'salon') {
    zonas = zonas.filter(z => (z.zona || '').toLowerCase() === 'salon');
} else if (this.filtroTipo === 'bar-mesa') {
    zonas = zonas.filter(z =>
        (z.zona || '').toLowerCase() === 'bar' &&
        (z.tipo_asiento || '').toLowerCase() === 'mesa'
    );
} else if (this.filtroTipo === 'bar-banco') {
    zonas = zonas.filter(z =>
        (z.zona || '').toLowerCase() === 'bar' &&
        (z.tipo_asiento || '').toLowerCase() === 'banco'
    );
}


    container.innerHTML = zonas.map(mesa => {
        const tipoNombre = (mesa.tipo_asiento || '').toLowerCase() === 'banco' ? 'Banco' : 'Mesa';
        const tipoZona = (mesa.zona || '').toLowerCase() === 'bar' ? 'Bar' : 'Salón';

        // Etiqueta tipo badge azul claro
        let claseBadge = '';
        if (mesa.zona?.toLowerCase() === 'bar') {
            claseBadge = (mesa.tipo_asiento?.toLowerCase() === 'banco')
                ? 'badge-barra'
                : 'badge-barra-mesa';
        } else {
            claseBadge = 'badge-salon';
        }
        let tipoZona1 = '';
        if (mesa.zona?.toLowerCase() === 'bar') {
            tipoZona1 = mesa.tipo_asiento?.toLowerCase() === 'banco' ? 'Barra' : 'Bar';
        } else {
            tipoZona1 = 'Salón';
        }
        const badgeZona1 = `<span class="badge-zona ${claseBadge}">${tipoZona1}</span>`;
        let contenidoMesa = `
            ${badgeZona1}
            <div class="mesa-numero">${tipoNombre} ${mesa.numero}</div>
        `;
        let clickHandler = "";
        let doubleClickHandler = "";
        let cursorStyle = "cursor: pointer;";

        if (mesa.estado === 'libre') {
            clickHandler = `onclick="Tables.showAbrirMesaModal(${mesa.id})"`;
            contenidoMesa += `
                <div class="mesa-estado libre">Libre</div>
                <div class="mesa-info">
                    <small>Capacidad: ${mesa.capacidad} personas</small>
                </div>
            `;
        } else if (mesa.estado === 'ocupada') {
            if (!mesa.pedido_id || mesa.monto_consumido === 0) {
                clickHandler = `onclick="Dashboard.abrirNuevoPedido(${mesa.id})"`;
            } else {
                clickHandler = `onclick="Dashboard.abrirAgregarProductos(${mesa.id}, ${mesa.pedido_id})"`;
                doubleClickHandler = `ondblclick="Dashboard.abrirProcesarPago(${mesa.id}, ${mesa.pedido_id})"`;
            }

            contenidoMesa += `
                <div class="mesa-estado ocupada">Ocupada</div>
                <div class="mesa-info">
                    <small>Cliente: ${mesa.cliente_nombre || 'N/A'}</small>
                    <div class="mesa-monto-destacado">₡${Utils.formatNumber(mesa.monto_consumido || 0)}</div>
                </div>
            `;
        } else if (mesa.estado === 'reservada') {
            clickHandler = `onclick="Tables.showMesaReservadaModal(${mesa.id})"`;
            contenidoMesa += `
                <div class="mesa-estado reservada">Reservada</div>
                <div class="mesa-info">
                    <small>Cliente: ${mesa.cliente_nombre || 'N/A'}</small>
                    ${mesa.hora_estimada ? `<small>Hora: ${mesa.hora_estimada}</small>` : ''}
                    ${mesa.cantidad_personas ? `<small>Personas: ${mesa.cantidad_personas}</small>` : ''}
                </div>
            `;
        }

        return `<div class="mesa-card ${mesa.estado}" style="${cursorStyle}" ${clickHandler} ${doubleClickHandler}>${contenidoMesa}</div>`;
    }).join('');
},

    // Renderizar últimas cuentas pagadas del día
    renderUltimasCuentasPagadas() {
        const container = document.getElementById('cuentas-pagadas-recientes');
        
        if (!this.data.ultimasCuentasPagadas || this.data.ultimasCuentasPagadas.length === 0) {
            container.innerHTML = '<p class="text-center">No hay cuentas pagadas hoy</p>';
            return;
        }

        container.innerHTML = `
            <div class="table-container">
                <table class="table">
                    <thead>
                        <tr>
                            <th>Zona</th>
                            <th>Cliente</th>
                            <th>Total</th>
                            <th>Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${this.data.ultimasCuentasPagadas.slice(0, 5).map(cuenta => {
                            return `
                            <tr>
                                <td>${cuenta.tipo_asiento?.toLowerCase() === 'barra' ? 'Banco' : 'Mesa'} ${cuenta.mesa_numero}</td>
                                <td>${cuenta.cliente_nombre || 'Cliente anónimo'}</td>
                                <td>₡${Utils.formatNumber(cuenta.total)}</td>
                                <td>
                                    <button class="btn btn-primary btn-sm" onclick="Dashboard.verCuenta(${cuenta.id})">
                                        <i class="fas fa-eye"></i> Ver
                                    </button>
                                </td>
                            </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    },

    // Mostrar detalle de ventas del día
    async mostrarDetalleVentas() {
        try {
            const response = await Utils.request('/dashboard/ventas-detalle');
            const ventasDetalle = response.data;

            if (!ventasDetalle || ventasDetalle.length === 0) {
                Utils.showModal('Ventas del Día', '<p class="text-center">No hay ventas registradas hoy</p>', [
                    { text: 'Cerrar', class: 'btn-light' }
                ]);
                return;
            }

            const modalContent = `
                <div class="ventas-modal-content">
                    <h3>Desglose Detallado de Ventas del Día</h3>
                    <table class="ventas-detalle-table">
                        <thead>
                            <tr>
                                <th>Zona</th>
                                <th>Cliente</th>
                                <th>Hora de Venta</th>
                                <th>Total</th>
                                <th>Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${ventasDetalle.map(venta => {
                                return `
                                <tr>
                                    <td>${venta.tipo_asiento?.toLowerCase() === 'barra' ? 'Banco' : 'Mesa'} ${venta.mesa_numero}</td>
                                    <td>${venta.cliente_nombre || 'Cliente anónimo'}</td>
                                    <td>${Utils.formatDateTime(venta.fecha_venta)}</td>
                                    <td>₡${Utils.formatNumber(venta.total)}</td>
                                    <td>
                                        <i class="fas fa-search-plus search-icon" 
                                           onclick="Dashboard.verDetalleVenta(${venta.id}, '${venta.tipo_asiento}')" 
                                           title="Ver detalle" style="cursor: pointer; margin-right: 10px;"></i>
                                        <i class="fas fa-print print-icon" 
                                           onclick="Dashboard.reimprimirFactura(${venta.id})" 
                                           title="Reimprimir factura" style="cursor: pointer;"></i>
                                    </td>
                                </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            `;

            Utils.showModal('Ventas del Día', modalContent, [
                {
                    text: 'Cerrar',
                    class: 'btn-light'
                }
            ]);
        } catch (error) {
            Utils.showNotification('Error cargando detalle de ventas', 'error');
        }
    },

    // Ver detalle específico de una venta
async verDetalleVenta(ventaId, tipo) {
    try {
        const response = await Utils.request(`/accounts/${ventaId}`);
        const venta = response.data;

        const nombreZona = venta.tipo_asiento?.toLowerCase() === 'barra' ? 'Banco' : 'Mesa';

        const modalContent = `
            <div class="venta-detalle">
                <h3>Detalle de Venta #${venta.id}</h3>
                <div class="venta-info">
                    <p><strong>${nombreZona}:</strong> ${venta.mesa_numero}</p>
                    <p><strong>Cliente?:</strong> ${venta.cliente_nombre}</p>
                    <p><strong>Fecha:</strong> ${Utils.formatDateTime(venta.fecha)}</p>
                    <p><strong>Total:</strong> ₡${Utils.formatNumber(venta.total)}</p>
                </div>
                <div class="venta-items">
                    <h4>Productos:</h4>
                    <table class="table">
                        <thead>
                            <tr>
                                <th>Producto</th>
                                <th>Cantidad</th>
                                <th>Precio</th>
                                <th>Subtotal</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${venta.items.map(item => `
                                <tr>
                                    <td>${item.producto_nombre}</td>
                                    <td>${item.cantidad}</td>
                                    <td>₡${Utils.formatNumber(item.precio)}</td>
                                    <td>₡${Utils.formatNumber(item.subtotal)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        Utils.showModal('Detalle de Venta', modalContent, [
            {
                text: 'Reimprimir Factura',
                class: 'btn-primary',
                onclick: `Dashboard.reimprimirFactura(${ventaId})`
            },
            {
                text: 'Cerrar',
                class: 'btn-light'
            }
        ]);
    } catch (error) {
        Utils.showNotification('Error cargando detalle de venta', 'error');
    }
}
,

    // Ver cuenta específica
async verCuenta(cuentaId) {
    try {
        const response = await Utils.request(`/accounts/${cuentaId}`);
        const cuenta = response.data;

        // Determinar si es Mesa o Banco
        const nombreZona = cuenta.tipo_asiento?.toLowerCase() === 'barra' ? 'Banco' : 'Mesa';

        const modalContent = `
            <div class="cuenta-detalle">
                <h3>Detalle de Cuenta #${cuenta.id}</h3>
                <div class="cuenta-info">
                    <p><strong>${nombreZona}:</strong> ${cuenta.mesa_numero}</p>
                    <p><strong>Cliente:</strong> ${cuenta.cliente_nombre}</p>
                    <p><strong>Fecha:</strong> ${Utils.formatDateTime(cuenta.fecha)}</p>
                    <p><strong>Total:</strong> ₡${Utils.formatNumber(cuenta.total)}</p>
                </div>
                <div class="cuenta-items">
                    <h4>Productos:</h4>
                    <table class="table">
                        <thead>
                            <tr>
                                <th>Producto</th>
                                <th>Cantidad</th>
                                <th>Precio</th>
                                <th>Subtotal</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${cuenta.items.map(item => `
                                <tr>
                                    <td>${item.producto_nombre}</td>
                                    <td>${item.cantidad}</td>
                                    <td>₡${Utils.formatNumber(item.precio)}</td>
                                    <td>₡${Utils.formatNumber(item.subtotal)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        Utils.showModal('Detalle de Cuenta', modalContent, [
            {
                text: 'Reimprimir Factura',
                class: 'btn-primary',
                onclick: `Dashboard.reimprimirFactura(${cuentaId})`
            },
            {
                text: 'Cerrar',
                class: 'btn-light'
            }
        ]);
    } catch (error) {
        Utils.showNotification('Error cargando detalle de cuenta', 'error');
    }
}, 

    // Reimprimir factura
    async reimprimirFactura(cuentaId) {
        try {
            await Utils.request(`/accounts/${cuentaId}/reprint`, {
                method: 'POST'
            });
            Utils.showNotification('Factura enviada a impresión', 'success');
        } catch (error) {
            Utils.showNotification('Error al reimprimir factura', 'error');
        }
    },

    // Actualizar datos automáticamente
        startAutoRefresh() {
            // Guardamos el ID del intervalo para detenerlo luego
            this.autoRefreshInterval = setInterval(() => {
                if (currentSection === 'dashboard') {
                    this.refreshData();
                }
            }, 5000);
        },

stopAutoRefresh() {
    if (this.autoRefreshInterval) {
        clearInterval(this.autoRefreshInterval);
        this.autoRefreshInterval = null;
    }
},

    // Refrescar solo los datos sin recargar toda la vista
    async refreshData() {
        try {
            const response = await Utils.request('/dashboard');
            this.data = response.data;
            
            // Actualizar solo los contadores sin recargar toda la vista
            document.getElementById('mesas-libres').textContent = this.data.mesasLibres || 0;
            document.getElementById('mesas-ocupadas').textContent = this.data.mesasOcupadas || 0;
            document.getElementById('mesas-reservadas').textContent = this.data.mesasReservadas || 0;
            
            document.getElementById("cuentas-pendientes").innerHTML = `<i class="fas fa-hourglass-half" style="color: var(--warning-color);"></i> <b>${this.data.cuentasPendientes || 0}</b>`;
            document.getElementById("cuentas-pagadas").innerHTML = `<i class="fas fa-check-circle" style="color: var(--success-color);"></i> <b>${this.data.cuentasPagadas || 0}</b>`;
            document.getElementById("creditos-pagados").innerHTML = `<i class="fas fa-money-check-alt" style="color: var(--danger-color);"></i> <b>${this.data.creditosPagados || 0}</b>`;
            
            document.getElementById("creditos-disponibles").textContent = this.data.creditosDisponibles || 0;
            document.getElementById("monto-total-creditos").textContent = Utils.formatCurrency(this.data.montoTotalCreditos || 0);
            document.getElementById("ventas-contado").innerHTML = `<i class="fas fa-money-bill-wave" style="color: var(--success-color);"></i> <b>${Utils.formatCurrency(this.data.ventasContado || 0)}</b>`;
            document.getElementById("ventas-credito").innerHTML = `<i class="fas fa-credit-card" style="color: var(--info-color);"></i> <b>${Utils.formatCurrency(this.data.ventasCredito || 0)}</b>`;
            document.getElementById("ventas-hoy").innerHTML = `<b>${Utils.formatCurrency(this.data.ventasHoy || 0)}</b>`;

            // Actualizar grid de mesas y cuentas pagadas
            this.renderMesasGrid();
            this.renderUltimasCuentasPagadas();
        } catch (error) {
            console.error('Error refrescando datos del dashboard:', error);
        }
    },

    // Abrir modal de nuevo pedido desde el dashboard
    abrirNuevoPedido(mesaId) {
        Orders.mesaIdActual = mesaId;
        Orders.load().then(() => {
            Orders.showCreateOrderModal(mesaId);
        });
    },

    // Abrir modal de agregar productos desde el dashboard
    abrirAgregarProductos(mesaId, pedidoId) {
        Orders.load().then(() => {
            Orders.showAddProductsModal(pedidoId);
        });
    },

    // Abrir modal de procesar pago desde el dashboard
    abrirProcesarPago(mesaId, pedidoId) {
        Orders.load().then(() => {
            Orders.showPaymentModal(pedidoId);
        });
    }
};

// Iniciar auto-refresh cuando se carga el script
//document.addEventListener('DOMContentLoaded', function() {
    //Dashboard.startAutoRefresh();});

// Función para generar el saludo contextual
function getGreetingMessage() {
    const hour = new Date().getHours();
    let greeting;
    if (hour < 12) {
        greeting = "Buenos días";
    } else if (hour < 18) {
        greeting = "Buenas tardes";
    } else {
        greeting = "Buenas noches";
    }
    return `${greeting}, ${currentUser.nombre}!`;
}
window.Dashboard = Dashboard;


