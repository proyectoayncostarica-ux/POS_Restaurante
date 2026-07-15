// Menu Component
const Menu = {
    categories: [],
    products: [],
    presentations: [],
    presentationTypes: [],
    currentView: 'products', // 'products' o 'categories'

    canAdministerMenu() {
        const userType = String(currentUser?.tipo || '').trim().toLowerCase();
        return userType === 'administrador' || userType === 'admin';
    },

    showAdminRequired() {
        Utils.showNotification('Solo los administradores pueden administrar productos, categorías, precios y presentaciones del Menú.', 'warning');
        return false;
    },

    renderAdminOnlyNotice() {
        if (this.canAdministerMenu()) return '';
        return `
            <div class="alert alert-info mb-3">
                <i class="fas fa-lock"></i> Modo consulta: tu usuario puede ver el menú operativo, pero solo un administrador puede crear, editar, cambiar precios, activar o desactivar elementos.
            </div>
        `;
    },

    renderCreateAction() {
        if (!this.canAdministerMenu()) return '';

        if (this.currentView === 'products') {
            return `<button class="btn btn-success" onclick="Menu.showCreateProductModal()">
                        <i class="fas fa-plus"></i> Nuevo Producto
                    </button>`;
        }

        if (this.currentView === 'categories') {
            return `<button class="btn btn-success" onclick="Menu.showCreateCategoryModal()">
                        <i class="fas fa-plus"></i> Nueva Categoría
                    </button>`;
        }

        return `
            <button class="btn btn-success" onclick="Menu.showCreatePresentationTypeModal()">
                <i class="fas fa-layer-group"></i> Nuevo Tipo/Grupo
            </button>
            <button class="btn btn-primary" onclick="Menu.showCreatePresentationModal()">
                <i class="fas fa-plus"></i> Nueva Presentación
            </button>
        `;
    },

    isActive(value) {
        return Number(value ?? 1) === 1;
    },

    renderStatusBadge(value) {
        return this.isActive(value)
            ? '<span class="badge badge-success">Activo</span>'
            : '<span class="badge badge-danger">Inactivo</span>';
    },

    rowInactiveClass(value) {
        return this.isActive(value) ? '' : ' class="menu-row-inactive"';
    },

    formatPresentationTypeLabel(tipo) {
        if (!tipo) return 'Sin tipo/grupo';
        const categoria = tipo.categoria_nombre || 'Sin categoría';
        const subcategoria = tipo.subcategoria_nombre ? ` / ${tipo.subcategoria_nombre}` : '';
        return `${tipo.nombre} · ${categoria}${subcategoria}`;
    },

    getPresentationTypesForContext(categoriaId, subcategoriaId = null) {
        const categoryId = Number(categoriaId || 0);
        const subcategoryId = Number(subcategoriaId || 0);

        if (!categoryId) return [];

        return (this.presentationTypes || []).filter(tipo => {
            if (!this.isActive(tipo.activo)) return false;
            if (Number(tipo.categoria_id) !== categoryId) return false;

            const tipoSubcategoriaId = Number(tipo.subcategoria_id || 0);

            // Un grupo ligado solo a categoría sirve para productos con o sin subcategoría.
            if (!tipoSubcategoriaId) return true;

            // Un grupo ligado a subcategoría exige coincidencia exacta.
            return subcategoryId && tipoSubcategoriaId === subcategoryId;
        });
    },

    refreshProductPresentationTypes(prefix = 'product', selectedId = null) {
        const categoriaSelect = document.getElementById(`${prefix}-categoria`);
        const subcategoriaSelect = document.getElementById(`${prefix}-subcategoria`);
        const tipoSelect = document.getElementById(`${prefix}-tipo-presentacion`);
        const checkPresentaciones = document.getElementById(`${prefix}-tiene-presentaciones`);
        const contenedorCheckboxes = document.getElementById(`${prefix}-presentaciones-checkboxes`);

        if (!tipoSelect) return;

        const tipos = this.getPresentationTypesForContext(categoriaSelect?.value, subcategoriaSelect?.value);
        tipoSelect.innerHTML = '<option value="">Seleccione un tipo/grupo</option>';

        tipos.forEach(tipo => {
            const option = document.createElement('option');
            option.value = tipo.id;
            option.textContent = this.formatPresentationTypeLabel(tipo);
            if (selectedId && Number(selectedId) === Number(tipo.id)) {
                option.selected = true;
            }
            tipoSelect.appendChild(option);
        });

        if (checkPresentaciones?.checked && tipos.length === 0) {
            if (contenedorCheckboxes) {
                contenedorCheckboxes.innerHTML = '<p class="text-muted">No hay tipos/grupos de presentación activos para esta categoría/subcategoría.</p>';
            }
        } else if (checkPresentaciones?.checked && tipoSelect.value) {
            this.loadPresentacionesGlobales(tipoSelect.value, `${prefix}-presentaciones-checkboxes`);
        } else if (contenedorCheckboxes) {
            contenedorCheckboxes.innerHTML = '<p class="text-muted">Seleccione primero un tipo/grupo de presentación.</p>';
        }
    },

    onPresentationTypeChange(tipoPresentacionId, containerId = 'product-presentaciones-checkboxes') {
        this.loadPresentacionesGlobales(tipoPresentacionId, containerId);
    },

    // Cargar datos del menú
    async load(options = {}) {
            try {
                const includeInactive = this.canAdministerMenu() && (options.includeInactive === true || (typeof currentSection !== 'undefined' && currentSection === 'menu'));
                const inactiveQuery = includeInactive ? '?include_inactive=1' : '';
                const [categoriesResponse, productsResponse, presentationsResponse, presentationTypesResponse] = await Promise.all([
                        Utils.request(`/menu/categories${inactiveQuery}`),
                        Utils.request(`/menu/products${inactiveQuery}`),
                        Utils.request(`/menu/presentaciones-globales${inactiveQuery}`),
                        Utils.request(`/menu/presentation-types${inactiveQuery}`)
                ]);


                this.categories = categoriesResponse.data;
                this.products = productsResponse.data;
                this.presentations = presentationsResponse.data;
                this.presentationTypes = presentationTypesResponse.data || [];
                this.render();
            } catch (error) {
                console.error('Error cargando menú:', error);
                Utils.showNotification('Error cargando datos del menú', 'error');
            }
    },

    // Renderizar sección de menú
    render() {
            const section = document.getElementById('menu-section');
            
            section.innerHTML = `
                <div class="section-header">
                    <h2>${this.canAdministerMenu() ? 'Gestión de Menú' : 'Consulta de Menú'}</h2>
                    <p>${this.canAdministerMenu() ? 'Administra categorías, productos, precios y presentaciones del menú' : 'Consulta productos, categorías y presentaciones activas para la operación'}</p>
                </div>

                <div class="mb-3">
                    <!-- Línea 1: botones de vista -->
                    <div class="d-flex gap-2 mb-2 flex-wrap internal-tabs" aria-label="Vistas del menú">
                        <button class="btn ${this.currentView === 'products' ? 'btn-primary active' : 'btn-light'}" data-subnav-item="products" onclick="Navigation.selectInternal('menu', 'products')">
                            <i class="fas fa-utensils"></i> Productos
                        </button>
                        <button class="btn ${this.currentView === 'categories' ? 'btn-primary active' : 'btn-light'}" data-subnav-item="categories" onclick="Navigation.selectInternal('menu', 'categories')">
                            <i class="fas fa-tags"></i> Categorías
                        </button>
                        <button class="btn ${this.currentView === 'presentations' ? 'btn-primary active' : 'btn-light'}" data-subnav-item="presentations" onclick="Navigation.selectInternal('menu', 'presentations')">
                            <i class="fas fa-box-open"></i> Presentaciones
                        </button>
                    </div>
                </div>

                <div class="internal-view-panel" data-internal-panel="menu">
                    <!-- Línea 2: botón crear + botón actualizar + botón Presentaciones-->
                    <div class="d-flex gap-2 flex-wrap mb-3">
                        ${this.renderCreateAction()}

                        <button class="btn btn-secondary btn-sm" onclick="Menu.load()" title="Actualizar menú">
                            <i class="fas fa-sync text-white"></i>
                        </button>
                    </div>

                    ${this.renderAdminOnlyNotice()}

                    ${
                        this.currentView === 'products'
                            ? this.renderProductsView()
                            : this.currentView === 'categories'
                                ? this.renderCategoriesView()
                                : this.renderPresentationsView()
                    }
                </div>
            `;
    },

    // Cambiar vista
    switchView(view) {
            this.currentView = view;
            this.render();
            Navigation.syncInternalSubnav('menu');
    },

    // Renderizar vista de productos
    renderProductsView() {
            return `
                <div class="menu-search mb-3">
                    <div class="form-group">
                        <input type="text" id="product-search" placeholder="Buscar productos..." onkeyup="Menu.searchProducts(this.value)">
                    </div>
                </div>

                <div class="table-container">
                    <table class="table">
                        <thead>
                            <tr>
                                <th>Nombre</th>
                                <th>Descripción</th>
                                <th>Precio</th>
                                <th>Categoría</th>
                                <th>Subcategoría</th>
                                <th>Cocina</th>
                                <th>Estado</th>
                                ${this.canAdministerMenu() ? '<th>Acciones</th>' : ''}
                            </tr>
                        </thead>
                        <tbody id="products-table-body">
                            ${this.renderProductsTable()}
                        </tbody>
                    </table>
                </div>
            `;
    },

    // Renderizar tabla de productos
    renderProductsTable(filteredProducts = null) {
        const products = filteredProducts || this.products;
        const canAdmin = this.canAdministerMenu();

        if (products.length === 0) {
            return `<tr><td colspan="${canAdmin ? 8 : 7}" class="text-center">No hay productos configurados</td></tr>`;
        }

        return products.map(product => `
            <tr${this.rowInactiveClass(product.activo)}>
                <td><strong>${product.nombre}</strong></td>
                <td>${product.descripcion || '-'}</td>
                <td>
                    ${
                        product.tiene_presentaciones
                        ? `<button class="btn-presentaciones badge badge-info" 
                                    title="Ver presentaciones"
                                    onclick="Menu.showPresentacionesModal(${product.id})">
                                <i class="fas fa-layer-group"></i> C/Pres.
                            </button>`
                        : Utils.formatCurrency(product.precio)
                    }
                </td>
                <td>${product.categoria_nombre}</td>
                <td>${product.subcategoria_nombre || '-'}</td>
                <td>
                    ${
                        product.es_cocina 
                            ? '<span class="badge badge-warning"><i class="fas fa-fire"></i> Sí</span>' 
                            : '<span class="badge badge-info">No</span>'
                    }
                </td>
                <td>${this.renderStatusBadge(product.activo)}</td>
                ${canAdmin ? `
                    <td>
                        <div class="d-flex gap-1">
                            <button class="btn btn-secondary btn-sm" onclick="Menu.showEditProductModal(${product.id})">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn ${this.isActive(product.activo) ? 'btn-warning' : 'btn-success'} btn-sm" onclick="Menu.toggleProductActive(${product.id})" title="${this.isActive(product.activo) ? 'Desactivar producto' : 'Activar producto'}">
                                <i class="fas ${this.isActive(product.activo) ? 'fa-eye-slash' : 'fa-eye'}"></i>
                            </button>
                        </div>
                    </td>
                ` : ''}
            </tr>
        `).join('');
    },

    // Renderizar vista de categorías
    renderCategoriesView() {
            const mainCategories = this.categories.filter(cat => cat.tipo === 'principal');
            const subCategories = this.categories.filter(cat => cat.tipo === 'subcategoria');
            const canAdmin = this.canAdministerMenu();
            

            return `
                <div class="categories-grid">
                    <div class="category-section">
                        <h3>Categorías Principales</h3>
                        <div class="table-container">
                            <table class="table">
                                <thead>
                                    <tr>
                                        <th>Nombre</th>
                                        <th>Permite Cocina</th>
                                        <th>Subcategorías</th>
                                        <th>Estado</th>
                                        ${canAdmin ? '<th>Acciones</th>' : ''}
                                    </tr>
                                </thead>
                                <tbody>
                                    ${mainCategories.map(category => `
                                        <tr${this.rowInactiveClass(category.activa)}>
                                            <td><strong>${category.nombre}</strong></td>
                                            <td>
                                                ${category.permite_cocina ? 
                                                    '<span class="badge badge-success">Sí</span>' : 
                                                    '<span class="badge badge-danger">No</span>'
                                                }
                                            </td>
                                            <td>
                                                ${subCategories.filter(sub => sub.parent_id === category.id).length}
                                            </td>
                                            <td>${this.renderStatusBadge(category.activa)}</td>
                                            ${canAdmin ? `
                                                <td>
                                                    <div class="d-flex gap-1">
                                                        <button class="btn btn-success btn-sm" onclick="Menu.showCreateSubcategoryModal(${category.id})" ${this.isActive(category.activa) ? '' : 'disabled'}>
                                                            <i class="fas fa-plus"></i> Sub
                                                        </button>
                                                        <button class="btn btn-secondary btn-sm" onclick="Menu.showEditCategoryModal(${category.id})">
                                                            <i class="fas fa-edit"></i>
                                                        </button>
                                                        <button class="btn ${this.isActive(category.activa) ? 'btn-warning' : 'btn-success'} btn-sm"
                                                                onclick="Menu.toggleCategoryActive(${category.id})"
                                                                title="${this.isActive(category.activa) ? 'Desactivar categoría' : 'Activar categoría'}">
                                                            <i class="fas ${this.isActive(category.activa) ? 'fa-eye-slash' : 'fa-eye'}"></i>
                                                        </button>

                                                    </div>
                                                </td>
                                            ` : ''}

                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div class="category-section">
                        <h3>Subcategorías</h3>
                        <div class="table-container">
                            <table class="table">
                                <thead>
                                    <tr>
                                        <th>Nombre</th>
                                        <th>Categoría Padre</th>
                                        <th>Permite Cocina</th>
                                        <th>Estado</th>
                                        ${canAdmin ? '<th>Acciones</th>' : ''}
                                    </tr>
                                </thead>
                                <tbody>
                                    ${subCategories.map(subcategory => `
                                        <tr${this.rowInactiveClass(subcategory.activa)}>
                                            <td><strong>${subcategory.nombre}</strong></td>
                                            <td>${subcategory.categoria_padre}</td>
                                            <td>
                                                ${subcategory.permite_cocina ? 
                                                    '<span class="badge badge-success">Sí</span>' : 
                                                    '<span class="badge badge-danger">No</span>'
                                                }
                                            </td>
                                            <td>${this.renderStatusBadge(subcategory.activa)}</td>
                                            ${canAdmin ? `
                                                <td>
                                                    <div class="d-flex gap-1">
                                                        <button class="btn btn-secondary btn-sm" onclick="Menu.showEditCategoryModal(${subcategory.id})">
                                                            <i class="fas fa-edit"></i>
                                                        </button>
                                                        <button class="btn ${this.isActive(subcategory.activa) ? 'btn-warning' : 'btn-success'} btn-sm" onclick="Menu.toggleCategoryActive(${subcategory.id})" title="${this.isActive(subcategory.activa) ? 'Desactivar subcategoría' : 'Activar subcategoría'}">
                                                            <i class="fas ${this.isActive(subcategory.activa) ? 'fa-eye-slash' : 'fa-eye'}"></i>
                                                        </button>
                                                    </div>
                                                </td>
                                            ` : ''}
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            `;
    },

    // Buscar productos
    async searchProducts(query) {
            if (query.length < 2) {
                document.getElementById('products-table-body').innerHTML = this.renderProductsTable();
                return;
            }

            try {
                const inactiveQuery = this.canAdministerMenu() ? '&include_inactive=1' : '';
                const response = await Utils.request(`/menu/products/search?q=${encodeURIComponent(query)}${inactiveQuery}`);
                console.log("🔍 Respuesta cruda del backend:", response);
                document.getElementById('products-table-body').innerHTML = this.renderProductsTable(response.data);
            } catch (error) {
                console.error('Error buscando productos:', error);
            }
    },

    //Modal de Creacion de Productos
    showCreateProductModal() {
    if (!this.canAdministerMenu()) return this.showAdminRequired();
    const mainCategories = this.categories.filter(cat => cat.tipo === 'principal' && this.isActive(cat.activa));

    Utils.showModal('Nuevo Producto', `
        <form id="create-product-form">
            <div class="form-group">
                <label for="product-nombre">Nombre *</label>
                <input type="text" id="product-nombre" name="nombre" required>
            </div>
            <div class="form-group">
                <label for="product-descripcion">Descripción</label>
                <textarea id="product-descripcion" name="descripcion" rows="3"></textarea>
            </div>
            <div class="form-group" id="field-product-precio">
                <label for="product-precio">Precio *</label>
                <input type="number" id="product-precio" name="precio" step="0.01" min="0" required>
            </div>
            <div class="form-group">
                <label for="product-categoria">Categoría *</label>
                <select id="product-categoria" name="categoria_id" required onchange="Menu.onCategoriaChange(this); Menu.refreshProductPresentationTypes('product')">
                    <option value="">Seleccione una categoría</option>
                    ${mainCategories.map(cat => `<option value="${cat.id}">${cat.nombre}</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label for="product-subcategoria">Subcategoría</label>
                <select id="product-subcategoria" name="subcategoria_id" onchange="Menu.refreshProductPresentationTypes('product')">
                    <option value="">Seleccione una subcategoría</option>
                </select>
            </div>
            <div class="form-group">
                <label>
                    <input type="checkbox" id="product-tiene-presentaciones" onchange="Menu.toggleSelectPresentaciones()"> ¿Tiene presentaciones?
                </label>
            </div>
            <div class="form-group" id="contenedor-tipo-presentacion" style="display: none;">
                <label for="product-tipo-presentacion">Tipo/Grupo de presentación *</label>
                <select id="product-tipo-presentacion" name="tipo_presentacion_id" onchange="Menu.onPresentationTypeChange(this.value, 'product-presentaciones-checkboxes')">
                    <option value="">Seleccione un tipo/grupo</option>
                </select>
                <small class="text-muted">El grupo filtra las presentaciones disponibles para este producto.</small>
            </div>
            <div class="form-group" id="contenedor-select-presentaciones" style="display: none;">
                <label>Seleccionar presentaciones:</label>
                <div id="product-presentaciones-checkboxes" class="presentaciones-checkboxes bordered-box">
                    <p class="text-muted">Seleccione primero un tipo/grupo de presentación.</p>
                </div>
            </div>
            <div class="form-group" id="contenedor-checkbox-cocina" style="display: none;">
                <label>
                    <input type="checkbox" id="product-es-cocina" name="es_cocina" onchange="Menu.validateCocinaCheckbox()">
                    Es producto de cocina
                </label>
                <small class="text-muted">Solo productos de categoría "Comidas" y subcategorías relacionadas pueden marcarse como cocina</small>
                <div id="cocina-validation-message" class="error-message" style="display: none;"></div>
            </div>
            <div class="form-group">
                <label for="product-imagen">Imagen del producto</label>
                <input type="file" id="product-imagen" name="imagen" accept="image/*">
            </div>
        </form>
    `, [
        {
            text: 'Cancelar',
            class: 'btn-light'
        },
        {
            text: 'Crear Producto',
            class: 'btn-success',
            onclick: 'Menu.createProduct()'
        }
    ]);

    Menu.onCategoriaChange(document.getElementById('product-categoria'));
    Menu.refreshProductPresentationTypes('product');
    },

    onCategoriaChange(selectElement) {
        const categoriaId = selectElement.value;
        const categoriaSeleccionada = this.categories.find(cat => cat.id == categoriaId);
        const esComidas = categoriaSeleccionada && categoriaSeleccionada.nombre.toLowerCase() === "comidas";

        // Cargar subcategorías
        this.loadSubcategories(categoriaId, 'product-subcategoria');

        // Elementos del DOM
        const checkCocina = document.getElementById("product-es-cocina");
        const contenedorCocina = document.getElementById("contenedor-checkbox-cocina");

        const checkPresentaciones = document.getElementById("product-tiene-presentaciones");
        const contenedorTipoPresentacion = document.getElementById("contenedor-tipo-presentacion");
        const contenedorSelectPresentaciones = document.getElementById("contenedor-select-presentaciones");

        if (esComidas) {
            // Mostrar checkbox cocina
            if (contenedorCocina) contenedorCocina.style.display = "block";
            if (checkCocina) checkCocina.checked = false;

            // Ocultar presentaciones
            if (checkPresentaciones) checkPresentaciones.checked = false;
            if (checkPresentaciones && checkPresentaciones.closest(".form-group"))
                checkPresentaciones.closest(".form-group").style.display = "none";
            if (contenedorTipoPresentacion) contenedorTipoPresentacion.style.display = "none";
            if (contenedorSelectPresentaciones) contenedorSelectPresentaciones.style.display = "none";
        } else {
            // Ocultar checkbox cocina
            if (contenedorCocina) contenedorCocina.style.display = "none";
            if (checkCocina) checkCocina.checked = false;

            // Mostrar presentaciones
            if (checkPresentaciones && checkPresentaciones.closest(".form-group"))
                checkPresentaciones.closest(".form-group").style.display = "block";
            if (contenedorTipoPresentacion) contenedorTipoPresentacion.style.display = "none";
            if (contenedorSelectPresentaciones) contenedorSelectPresentaciones.style.display = "none";
            if (checkPresentaciones) checkPresentaciones.checked = false;
        }
    },

    // Cargar subcategorías
    loadSubcategories(categoryId, selectId) {
            const select = document.getElementById(selectId);
            const subcategories = this.categories.filter(cat => cat.parent_id == categoryId && this.isActive(cat.activa));
            
            select.innerHTML = '<option value="">Seleccione una subcategoría</option>';
            subcategories.forEach(sub => {
                select.innerHTML += `<option value="${sub.id}">${sub.nombre}</option>`;
            });

            // Validar checkbox de cocina cuando cambia la categoría
            this.validateCocinaCheckbox();
    },

    // Validar checkbox de cocina
    validateCocinaCheckbox() {
        const categoriaSelect = document.getElementById('product-categoria');
        const subcategoriaSelect = document.getElementById('product-subcategoria');
        const cocinaCheckbox = document.getElementById('product-es-cocina');
        const validationMessage = document.getElementById('cocina-validation-message');

        if (!categoriaSelect || !cocinaCheckbox) return;

        const categoria = this.categories.find(cat => cat.id == categoriaSelect.value);
        const subcategoria = subcategoriaSelect ? this.categories.find(cat => cat.id == subcategoriaSelect.value) : null;

        const categoriaPermiteCocina = categoria && categoria.permite_cocina;
        const subcategoriaPermiteCocina = subcategoria && subcategoria.permite_cocina;

        if (cocinaCheckbox.checked) {
            const isValidForCocina = categoriaPermiteCocina && subcategoriaPermiteCocina;

            if (!isValidForCocina) {
                cocinaCheckbox.checked = false;
                validationMessage.textContent = 'Esta combinación de categoría y subcategoría no permite productos de cocina.';
                validationMessage.style.display = 'block';
            } else {
                validationMessage.style.display = 'none';
            }
        } else {
            validationMessage.style.display = 'none';
        }
    },

    // MODIFICADA: Crear producto incluyendo imagen (si se proporciona)
    async createProduct() {
    if (!this.canAdministerMenu()) return this.showAdminRequired();
    const form = document.getElementById("create-product-form");
    const formData = new FormData(form);

    const nombre = formData.get("nombre").trim();
    const descripcion = formData.get("descripcion") || "";
    const precio = parseFloat(formData.get("precio"));
    const categoria_id = parseInt(formData.get("categoria_id"));
    const subcategoria_id = parseInt(formData.get("subcategoria_id")) || null;
    const es_cocina = formData.get("es_cocina") === "on";
    const tiene_presentaciones = document.getElementById("product-tiene-presentaciones").checked;
    const tipo_presentacion_id = tiene_presentaciones
        ? parseInt(document.getElementById("product-tipo-presentacion")?.value || 0)
        : null;
    const imagenFile = formData.get("imagen");

    let presentaciones_seleccionadas = [];

    if (tiene_presentaciones) {
        if (!tipo_presentacion_id) {
            Utils.showNotification("Debes seleccionar un tipo/grupo de presentación.");
            return;
        }

        const checkboxes = document.querySelectorAll("input[name='presentaciones[]']:checked");

        presentaciones_seleccionadas = Array.from(checkboxes).map(checkbox => {
            const id = parseInt(checkbox.value);
            const nombre = checkbox.getAttribute("data-label") || '';

            const wrapper = checkbox.closest(".presentacion-item");
            const precioInput = wrapper?.querySelector(".input-precio-presentacion");
            const precio = parseFloat(precioInput?.value || 0);

            return {
                id,
                nombre,
                precio
            };
        });

        const algunaValida = presentaciones_seleccionadas.some(p => p.precio > 0);
        if (presentaciones_seleccionadas.length === 0 || !algunaValida) {
            Utils.showNotification("Debes seleccionar al menos una presentación con precio mayor a ₡0.");
            return;
        }
    }

    if (!nombre || isNaN(categoria_id) || (!tiene_presentaciones && isNaN(precio))) {
        Utils.showNotification("Debe completar todos los campos obligatorios.");
        return;
    }

    try {
        const payload = new FormData();
        payload.append("nombre", nombre);
        payload.append("descripcion", descripcion);
        payload.append("precio", tiene_presentaciones ? "" : precio);
        payload.append("categoria_id", categoria_id);
        if (subcategoria_id) payload.append("subcategoria_id", subcategoria_id);
        payload.append("es_cocina", es_cocina);
        payload.append("tiene_presentaciones", tiene_presentaciones);
        if (tipo_presentacion_id) payload.append("tipo_presentacion_id", tipo_presentacion_id);
        payload.append("activo", 1);

        if (imagenFile && imagenFile.size > 0) {
            payload.append("imagen", imagenFile);
        }

        if (tiene_presentaciones) {
            payload.append("presentaciones_seleccionadas", JSON.stringify(presentaciones_seleccionadas));
        }

        const response = await Utils.request("/menu/products", {
            method: "POST",
            body: payload
        });

        if (response && response.success) {
            Utils.showNotification("Producto creado correctamente", "success");
            Utils.hideModal();
            Menu.load();
        } else {
            Utils.showNotification("Error al crear producto", "error");
        }
    } catch (error) {
        console.error("Error al crear producto:", error);
        Utils.showNotification("Ocurrió un error inesperado.", "error");
    }
    },

    // Mostrar modal para editar producto
    showEditProductModal(productId) {
    if (!this.canAdministerMenu()) return this.showAdminRequired();
    const product = this.products.find(p => p.id === productId);
    if (!product) return;

    const mainCategories = this.categories.filter(cat => cat.tipo === 'principal' && (this.isActive(cat.activa) || cat.id === product.categoria_id));
    const subcategoria = this.categories.find(cat => cat.id === product.subcategoria_id);
    const isCocina = product.es_cocina;
    const tienePresentaciones = product.tiene_presentaciones;

    const readonlyAttr = (cond) => cond ? 'readonly' : '';
    const disabledAttr = (cond) => cond ? 'disabled' : '';

    // Imagen por defecto si no hay una definida
    const imagenActual = product.imagen || `${window.location.origin}/uploads/ImagenGenerica.jpg`;

    Utils.showModal('Editar Producto', `
        <form id="edit-product-form" enctype="multipart/form-data">
            <div class="form-group">
                <label for="edit-product-nombre">Nombre *</label>
                <input type="text" id="edit-product-nombre" name="nombre" value="${product.nombre}" required ${readonlyAttr(true)}>
            </div>

            <div class="form-group">
                <label for="edit-product-descripcion">Descripción</label>
                <textarea id="edit-product-descripcion" name="descripcion" rows="3">${product.descripcion || ''}</textarea>
            </div>

            ${!tienePresentaciones ? `
            <div class="form-group" id="edit-field-product-precio">
                <label for="edit-product-precio">Precio *</label>
                <input type="number" id="edit-product-precio" name="precio" step="0.01" min="0" value="${product.precio}" required>
            </div>` : ''}

            <div class="form-group">
                <label for="edit-product-categoria">Categoría *</label>
                <select id="edit-product-categoria" name="categoria_id" required 
                    onchange="Menu.loadSubcategories(this.value, 'edit-product-subcategoria')"
                    ${disabledAttr(tienePresentaciones || isCocina)}>
                    <option value="">Seleccione una categoría</option>
                    ${mainCategories.map(cat => `
                        <option value="${cat.id}" ${cat.id === product.categoria_id ? 'selected' : ''}>${cat.nombre}</option>
                    `).join('')}
                </select>
            </div>

            <div class="form-group">
                <label for="edit-product-subcategoria">Subcategoría</label>
                <select id="edit-product-subcategoria" name="subcategoria_id" ${disabledAttr(tienePresentaciones || isCocina)}>
                    <option value="">Seleccione una subcategoría</option>
                </select>
            </div>

            <!-- Imagen del producto -->
            <div class="form-group">
                <label>Imagen actual:</label><br>
                <img src="${imagenActual}" alt="Imagen del producto" id="edit-product-preview" class="img-thumbnail" style="max-width: 120px; margin-bottom: 10px;">
                <br>
                <label for="edit-product-imagen">Cambiar imagen:</label>
                <input type="file" id="edit-product-imagen" name="imagen" accept="image/*" onchange="Menu.previewEditImage(event)">
            </div>

            ${tienePresentaciones ? `
            <div class="form-group">
                <label>
                    <input type="checkbox" id="edit-product-tiene-presentaciones" checked disabled>
                    ¿Tiene presentaciones?
                </label>
            </div>

            <div class="form-group" id="edit-contenedor-tipo-presentacion">
                <label for="edit-product-tipo-presentacion">Tipo/Grupo de presentación</label>
                <select id="edit-product-tipo-presentacion" name="tipo_presentacion_id" onchange="Menu.onPresentationTypeChange(this.value, 'edit-product-presentaciones-checkboxes')" ${product.tipo_presentacion_id ? 'disabled' : ''}>
                    <option value="">Sin grupo asignado / legado</option>
                    ${(this.presentationTypes || []).map(tipo => `
                        <option value="${tipo.id}" ${Number(tipo.id) === Number(product.tipo_presentacion_id || 0) ? 'selected' : ''}>${this.formatPresentationTypeLabel(tipo)}</option>
                    `).join('')}
                </select>
                <small class="text-muted">El grupo se conserva para mantener consistencia con las presentaciones del producto.</small>
            </div>

            <div class="form-group" id="edit-contenedor-select-presentaciones">
                <label>Seleccionar presentaciones:</label>
                <div id="edit-product-presentaciones-checkboxes" class="presentaciones-checkboxes bordered-box"></div>
            </div>

            <div class="form-group">
                <label>
                    <input type="checkbox" id="edit-agregar-mas-presentaciones" onchange="Menu.toggleAgregarMasPresentaciones()">
                    ¿Desea agregar más presentaciones?
                </label>
            </div>

            <div class="form-group" id="edit-contenedor-nuevas-presentaciones" style="display:none;">
                <label>Nuevas presentaciones disponibles:</label>
                <div id="edit-nuevas-presentaciones-checkboxes" class="presentaciones-checkboxes bordered-box"></div>
            </div>
            ` : ''}

            ${isCocina ? `
            <div class="form-group">
                <label>
                    <input type="checkbox" id="edit-product-es-cocina" checked disabled>
                    Es producto de cocina
                </label>
                <small class="text-muted">Este producto ya está marcado como cocina</small>
            </div>` : ''}

            <div class="form-group">
                <label>
                    <input type="checkbox" id="edit-product-activo" name="activo" ${this.isActive(product.activo) ? 'checked' : ''}>
                    Producto activo para operación
                </label>
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
            onclick: `Menu.updateProduct(${productId})`
        }
    ]);

    // Cargar subcategorías
    setTimeout(() => {
        this.loadSubcategories(product.categoria_id, 'edit-product-subcategoria');
        if (product.subcategoria_id) {
            document.getElementById('edit-product-subcategoria').value = product.subcategoria_id;
        }
        if (tienePresentaciones) {
            this.refreshProductPresentationTypes('edit-product', product.tipo_presentacion_id);
            const tipoSelect = document.getElementById('edit-product-tipo-presentacion');
            if (tipoSelect && product.tipo_presentacion_id) {
                tipoSelect.value = product.tipo_presentacion_id;
            }
        }
    }, 100);

    if (tienePresentaciones) {
        this.loadPresentacionesAsignadas(productId);
    }
    },

    //Previsualizar imagen en edit
    previewEditImage(event) {
    const input = event.target;
    const preview = document.getElementById("edit-product-preview");

    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function (e) {
            preview.src = e.target.result;
            preview.style.display = 'block'; // Asegura que se vea
        };
        reader.readAsDataURL(input.files[0]);
    }
},

    // Validar checkbox de cocina en edición
    validateEditCocinaCheckbox() {
        const categoriaSelect = document.getElementById('edit-product-categoria');
        const subcategoriaSelect = document.getElementById('edit-product-subcategoria');
        const cocinaCheckbox = document.getElementById('edit-product-es-cocina');
        const validationMessage = document.getElementById('edit-cocina-validation-message');

        if (!categoriaSelect || !cocinaCheckbox) return;

        const categoria = this.categories.find(cat => cat.id == categoriaSelect.value);
        const subcategoria = subcategoriaSelect ? this.categories.find(cat => cat.id == subcategoriaSelect.value) : null;

        const categoriaPermiteCocina = categoria && categoria.permite_cocina;
        const subcategoriaPermiteCocina = subcategoria && subcategoria.permite_cocina;

        if (cocinaCheckbox.checked) {
            const isValidForCocina = categoriaPermiteCocina && subcategoriaPermiteCocina;

            if (!isValidForCocina) {
                cocinaCheckbox.checked = false;
                validationMessage.textContent = 'Esta combinación de categoría y subcategoría no permite productos de cocina.';
                validationMessage.style.display = 'block';
            } else {
                validationMessage.style.display = 'none';
            }
        } else {
            validationMessage.style.display = 'none';
        }
    },

    // Actualizar producto
    async updateProduct(productId) {
    if (!this.canAdministerMenu()) return this.showAdminRequired();
    const form = document.getElementById('edit-product-form');
    if (!Utils.validateForm(form)) {
        Utils.showNotification('Por favor complete todos los campos requeridos', 'warning');
        return;
    }

    const formData = new FormData(form);

    // Recoger datos básicos
    const categoriaId = parseInt(document.getElementById('edit-product-categoria')?.value || 0);
    const subcategoriaId = document.getElementById('edit-product-subcategoria')?.value
        ? parseInt(document.getElementById('edit-product-subcategoria').value)
        : null;
    const esCocina = document.getElementById('edit-product-es-cocina')?.checked || false;

    formData.set('categoria_id', categoriaId);
    formData.set('subcategoria_id', subcategoriaId);
    formData.set('es_cocina', esCocina ? 1 : 0); // Guardamos como 1 o 0
    formData.set('activo', document.getElementById('edit-product-activo')?.checked ? 1 : 0);

    const tienePresentaciones = document.getElementById('edit-product-tiene-presentaciones')?.checked;
    const tipoPresentacionId = tienePresentaciones
        ? parseInt(document.getElementById('edit-product-tipo-presentacion')?.value || 0)
        : null;

    if (tienePresentaciones) {
        if (!tipoPresentacionId) {
            Utils.showNotification('Debe asignar un tipo/grupo de presentación al producto.', 'warning');
            return;
        }

        const checkboxes = document.querySelectorAll('input[name="presentaciones[]"]:checked');
        const presentaciones = [];

        checkboxes.forEach(checkbox => {
            const presentacionId = parseInt(checkbox.value);
            const precioInput = document.getElementById(`precio-presentacion-${presentacionId}`);
            const precio = parseFloat(precioInput?.value || 0);

            if (!isNaN(precio) && precio > 0) {
                presentaciones.push({
                    presentacion_id: presentacionId,
                    precio
                });
            }
        });

        if (presentaciones.length === 0) {
            Utils.showNotification('Debe asignar al menos una presentación con precio válido.', 'warning');
            return;
        }

        formData.set('presentaciones', JSON.stringify(presentaciones));
        formData.set('tipo_presentacion_id', tipoPresentacionId);
        formData.set('precio', 0); // Precio global = 0 si hay presentaciones
    } else {
        const precio = parseFloat(formData.get('precio'));
        if (isNaN(precio) || precio <= 0) {
            Utils.showNotification("Debe ingresar un precio válido.", "warning");
            return;
        }
        formData.set('precio', precio);
    }

    try {
        await Utils.request(`/menu/products/${productId}`, {
            method: 'PUT', // Usa POST si el servidor no soporta PUT con FormData
            body: formData
        });

        Utils.hideModal();
        Utils.showNotification('Producto actualizado exitosamente', 'success');
        this.load();
    } catch (error) {
        Utils.showNotification(error.message || 'Error al actualizar el producto', 'error');
    }
    },

    async toggleProductActive(productId) {
        if (!this.canAdministerMenu()) return this.showAdminRequired();
        const product = this.products.find(p => p.id === productId);
        if (!product) return;

        const nextActive = this.isActive(product.activo) ? 0 : 1;
        const confirmed = await Utils.confirm(
            `¿Desea ${nextActive ? 'activar' : 'desactivar'} el producto "${product.nombre}"?`,
            `${nextActive ? 'Activar' : 'Desactivar'} producto`
        );
        if (!confirmed) return;

        try {
            await Utils.request(`/menu/products/${productId}/active`, {
                method: 'PUT',
                body: JSON.stringify({ activo: nextActive })
            });
            Utils.showNotification(`Producto ${nextActive ? 'activado' : 'desactivado'} correctamente`, 'success');
            this.load();
        } catch (error) {
            Utils.showNotification(error.message || 'Error al cambiar estado del producto', 'error');
        }
    },

    // Eliminar producto
    async deleteProduct(productId) {
        if (!this.canAdministerMenu()) return this.showAdminRequired();
        const product = this.products.find(p => p.id === productId);
        if (!product) return;

        const confirmed = await Utils.confirm(
            `¿Está seguro de eliminar el producto "${product.nombre}"?`,
            'Confirmar Eliminación'
        );

        if (!confirmed) return;

        try {
            await Utils.request(`/menu/products/${productId}`, {
                method: 'DELETE'
            });

            Utils.showNotification('Producto eliminado exitosamente', 'success');
            this.load();
        } catch (error) {
            Utils.showNotification(error.message, 'error');
        }
    },

    // Mostrar modal para crear categoría
    showCreateCategoryModal() {
            if (!this.canAdministerMenu()) return this.showAdminRequired();
            const mainCategories = this.categories.filter(cat => cat.tipo === 'principal' && this.isActive(cat.activa));
            
            Utils.showModal('Nueva Categoría', `
                <form id="create-category-form">
                    <div class="form-group">
                        <label for="category-nombre">Nombre *</label>
                        <input type="text" id="category-nombre" name="nombre" required>
                    </div>
                    <div class="form-group">
                        <label for="category-parent">Categoría Padre</label>
                        <select id="category-parent" name="parent_id">
                            <option value="">Categoría Principal</option>
                            ${mainCategories.map(cat => `<option value="${cat.id}">${cat.nombre}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>
                            <input type="checkbox" id="category-permite-cocina" name="permite_cocina">
                            Permite productos de cocina
                        </label>
                    </div>
                </form>
            `, [
                {
                    text: 'Cancelar',
                    class: 'btn-light'
                },
                {
                    text: 'Crear Categoría',
                    class: 'btn-success',
                    onclick: 'Menu.createCategory()'
                }
            ]);
    },

    // Mostrar modal para crear subcategoría
    showCreateSubcategoryModal(parentId) {
            if (!this.canAdministerMenu()) return this.showAdminRequired();
            const parentCategory = this.categories.find(cat => cat.id === parentId);
            
            Utils.showModal('Nueva Subcategoría', `
                <form id="create-subcategory-form">
                    <div class="form-group">
                        <label>Categoría Padre: <strong>${parentCategory.nombre}</strong></label>
                    </div>
                    <div class="form-group">
                        <label for="subcategory-nombre">Nombre *</label>
                        <input type="text" id="subcategory-nombre" name="nombre" required>
                    </div>
                    <div class="form-group">
                        <label>
                            <input type="checkbox" id="subcategory-permite-cocina" name="permite_cocina">
                            Permite productos de cocina
                        </label>
                    </div>
                    <input type="hidden" name="parent_id" value="${parentId}">
                </form>
            `, [
                {
                    text: 'Cancelar',
                    class: 'btn-light'
                },
                {
                    text: 'Crear Subcategoría',
                    class: 'btn-success',
                    onclick: 'Menu.createSubcategory()'
                }
            ]);
    },

    // Crear categoría
async createCategory() {
    if (!this.canAdministerMenu()) return this.showAdminRequired();
        const form = document.getElementById('create-category-form');
        if (!Utils.validateForm(form)) {
            Utils.showNotification('Por favor complete todos los campos requeridos', 'warning');
            return;
        }

        const formData = new FormData(form);
        const data = {
            nombre: formData.get('nombre'),
            parent_id: formData.get('parent_id') ? parseInt(formData.get('parent_id')) : null,
            permite_cocina: formData.get('permite_cocina') === 'on'
        };

        try {
            await Utils.request('/menu/categories', {
                method: 'POST',
                body: JSON.stringify(data)
            });

            Utils.hideModal();
            Utils.showNotification('Categoría creada exitosamente', 'success');
            this.load();
        } catch (error) {
            Utils.showNotification(error.message, 'error');
        }
},

    async toggleCategoryActive(categoryId) {
        if (!this.canAdministerMenu()) return this.showAdminRequired();
        const categoria = this.categories.find(cat => cat.id === categoryId);
        if (!categoria) return;

        const nextActive = this.isActive(categoria.activa) ? 0 : 1;
        const tipo = categoria.tipo === 'principal' ? 'categoría' : 'subcategoría';
        const confirmed = await Utils.confirm(
            `¿Desea ${nextActive ? 'activar' : 'desactivar'} la ${tipo} "${categoria.nombre}"?`,
            `${nextActive ? 'Activar' : 'Desactivar'} ${tipo}`
        );
        if (!confirmed) return;

        try {
            await Utils.request(`/menu/categories/${categoryId}`, {
                method: 'PUT',
                body: JSON.stringify({ activa: nextActive })
            });
            Utils.showNotification(`${tipo.charAt(0).toUpperCase() + tipo.slice(1)} ${nextActive ? 'activada' : 'desactivada'} correctamente`, 'success');
            this.load();
        } catch (error) {
            Utils.showNotification(error.message || `Error al cambiar estado de la ${tipo}`, 'error');
        }
    },

    //Eliminar Categoría
async deleteCategory(categoryId) {
    if (!this.canAdministerMenu()) return this.showAdminRequired();
    const categoria = this.categories.find(cat => cat.id === categoryId);
    if (!categoria) return;

    const tipo = categoria.tipo === 'principal' ? 'categoría' : 'subcategoría';

    // 🔍 Validar si está en uso por productos
    const usadaPorProductos = this.products.some(p =>
        p.categoria_id === categoryId || p.subcategoria_id === categoryId
    );

    if (usadaPorProductos) {
        Utils.showNotification(`No se puede eliminar esta ${tipo}: tiene productos asociados.`, 'warning');
        return;
    }

    // 🔍 Validar si tiene subcategorías (si es categoría principal)
    if (categoria.tipo === 'principal') {
        const tieneSubcategorias = this.categories.some(sub => sub.parent_id === categoryId);
        if (tieneSubcategorias) {
            Utils.showNotification('No se puede eliminar esta categoría: tiene subcategorías asociadas.', 'warning');
            return;
        }
    }

    const confirmado = await Utils.confirm(
        `¿Desea eliminar la ${tipo} "${categoria.nombre}"? Esta acción no se puede deshacer.`,
        'Eliminar ' + tipo
    );
    if (!confirmado) return;

    try {
        const response = await Utils.request(`/menu/categories/${categoryId}`, {
            method: 'DELETE'
        });

        if (response.success) {
            Utils.showNotification(`${tipo.charAt(0).toUpperCase() + tipo.slice(1)} eliminada correctamente`, 'success');
            this.load(); // recargar menú
        } else {
            Utils.showNotification(response.error || `No se pudo eliminar la ${tipo}`, 'error');
        }
    } catch (error) {
        console.error(`Error eliminando ${tipo}:`, error);
        Utils.showNotification(error.message || `Error al eliminar la ${tipo}`, 'error');
    }
},

    // Crear subcategoría
async createSubcategory() {
    if (!this.canAdministerMenu()) return this.showAdminRequired();
        const form = document.getElementById('create-subcategory-form');
        if (!Utils.validateForm(form)) {
            Utils.showNotification('Por favor complete todos los campos requeridos', 'warning');
            return;
        }

        const formData = new FormData(form);
        const data = {
            nombre: formData.get('nombre'),
            parent_id: parseInt(formData.get('parent_id')),
            permite_cocina: formData.get('permite_cocina') === 'on'
        };

        try {
            await Utils.request('/menu/categories', {
                method: 'POST',
                body: JSON.stringify(data)
            });

            Utils.hideModal();
            Utils.showNotification('Subcategoría creada exitosamente', 'success');
            this.load();
        } catch (error) {
            Utils.showNotification(error.message, 'error');
        }
},


    // Renderizar vista de Presentaciones
    renderPresentationsView() {
        const canAdmin = this.canAdministerMenu();
        const tipos = this.presentationTypes || [];
        const presentaciones = this.presentations || [];

        const tiposHtml = tipos.length === 0
            ? `<tr><td colspan="${canAdmin ? 7 : 6}" class="text-center">No hay tipos/grupos de presentación configurados</td></tr>`
            : tipos.map(tipo => `
                <tr${this.rowInactiveClass(tipo.activo)}>
                    <td><strong>${tipo.nombre}</strong></td>
                    <td>${tipo.categoria_nombre || '-'}</td>
                    <td>${tipo.subcategoria_nombre || '-'}</td>
                    <td>${tipo.descripcion || '-'}</td>
                    <td>${tipo.total_presentaciones || 0}</td>
                    <td>${this.renderStatusBadge(tipo.activo)}</td>
                    ${canAdmin ? `
                        <td>
                            <div class="d-flex gap-1">
                                <button class="btn btn-sm ${this.isActive(tipo.activo) ? 'btn-warning' : 'btn-success'}"
                                        onclick="Menu.togglePresentationTypeActive(${tipo.id})"
                                        title="${this.isActive(tipo.activo) ? 'Desactivar tipo/grupo' : 'Activar tipo/grupo'}">
                                    <i class="fas ${this.isActive(tipo.activo) ? 'fa-eye-slash' : 'fa-eye'}"></i>
                                </button>
                            </div>
                        </td>
                    ` : ''}
                </tr>
            `).join('');

        const presentacionesHtml = presentaciones.length === 0
            ? `<tr><td colspan="${canAdmin ? 6 : 5}" class="text-center">No hay presentaciones configuradas aún</td></tr>`
            : presentaciones.map(pres => `
                <tr${this.rowInactiveClass(pres.activo)}>
                    <td>${pres.nombre}</td>
                    <td>${pres.cantidad || '-'}</td>
                    <td>${pres.tipo_presentacion_nombre || '<span class="text-muted">Sin grupo / legado</span>'}</td>
                    <td>${pres.tipo || '-'}</td>
                    <td>${this.renderStatusBadge(pres.activo)}</td>
                    ${canAdmin ? `
                        <td>
                            <button class="btn btn-sm ${this.isActive(pres.activo) ? 'btn-warning' : 'btn-success'}"
                                    onclick="Menu.togglePresentationActive(${pres.id})"
                                    title="${this.isActive(pres.activo) ? 'Desactivar presentación' : 'Activar presentación'}">
                                <i class="fas ${this.isActive(pres.activo) ? 'fa-eye-slash' : 'fa-eye'}"></i>
                            </button>
                        </td>
                    ` : ''}
                </tr>
            `).join('');

        return `
            <div class="alert alert-info mb-3">
                <i class="fas fa-layer-group"></i>
                Los tipos/grupos separan las presentaciones por contexto: categoría y subcategoría. Al crear un producto con presentaciones, primero se elige el grupo y luego solo aparecen sus presentaciones.
            </div>

            <div class="category-section mb-4">
                <h3>Tipos/Grupos de presentación</h3>
                <div class="table-responsive">
                    <table class="table table-bordered table-hover">
                        <thead class="table-light">
                            <tr>
                                <th>Grupo</th>
                                <th>Categoría</th>
                                <th>Subcategoría</th>
                                <th>Descripción</th>
                                <th>Presentaciones</th>
                                <th>Estado</th>
                                ${canAdmin ? '<th style="width: 120px;">Acciones</th>' : ''}
                            </tr>
                        </thead>
                        <tbody>${tiposHtml}</tbody>
                    </table>
                </div>
            </div>

            <div class="category-section">
                <h3>Presentaciones por grupo</h3>
                <div class="table-responsive">
                    <table class="table table-bordered table-hover">
                        <thead class="table-light">
                            <tr>
                                <th>Presentación</th>
                                <th>Cantidad/Medida</th>
                                <th>Tipo/Grupo</th>
                                <th>Tipo interno</th>
                                <th>Estado</th>
                                ${canAdmin ? '<th style="width: 120px;">Acciones</th>' : ''}
                            </tr>
                        </thead>
                        <tbody>${presentacionesHtml}</tbody>
                    </table>
                </div>
            </div>
        `;
    },

    showCreatePresentationTypeModal() {
        if (!this.canAdministerMenu()) return this.showAdminRequired();

        const mainCategories = this.categories.filter(cat => cat.tipo === 'principal' && this.isActive(cat.activa));

        Utils.showModal('Nuevo Tipo/Grupo de Presentación', `
            <form id="create-presentation-type-form">
                <div class="form-group">
                    <label for="presentation-type-nombre">Nombre *</label>
                    <input type="text" id="presentation-type-nombre" name="nombre" placeholder="Ej: Bebidas / Gaseosas" required>
                </div>
                <div class="form-group">
                    <label for="presentation-type-categoria">Categoría *</label>
                    <select id="presentation-type-categoria" name="categoria_id" required onchange="Menu.loadSubcategories(this.value, 'presentation-type-subcategoria')">
                        <option value="">Seleccione una categoría</option>
                        ${mainCategories.map(cat => `<option value="${cat.id}">${cat.nombre}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label for="presentation-type-subcategoria">Subcategoría</label>
                    <select id="presentation-type-subcategoria" name="subcategoria_id">
                        <option value="">Sin subcategoría / aplica a la categoría</option>
                    </select>
                    <small class="text-muted">Déjalo vacío si el grupo aplica a productos de la categoría sin importar subcategoría.</small>
                </div>
                <div class="form-group">
                    <label for="presentation-type-descripcion">Descripción</label>
                    <textarea id="presentation-type-descripcion" name="descripcion" rows="2" placeholder="Ej: Tamaños disponibles para gaseosas"></textarea>
                </div>
            </form>
        `, [
            { text: 'Cancelar', class: 'btn-light' },
            { text: 'Crear Tipo/Grupo', class: 'btn-success', onclick: 'Menu.savePresentationType()' }
        ]);
    },

    async savePresentationType() {
        if (!this.canAdministerMenu()) return this.showAdminRequired();

        const form = document.getElementById('create-presentation-type-form');
        if (!Utils.validateForm(form)) {
            Utils.showNotification('Por favor complete todos los campos requeridos', 'warning');
            return;
        }

        const formData = new FormData(form);
        const data = {
            nombre: formData.get('nombre'),
            descripcion: formData.get('descripcion') || '',
            categoria_id: parseInt(formData.get('categoria_id')),
            subcategoria_id: formData.get('subcategoria_id') ? parseInt(formData.get('subcategoria_id')) : null
        };

        try {
            await Utils.request('/menu/presentation-types', {
                method: 'POST',
                body: JSON.stringify(data)
            });

            Utils.hideModal();
            Utils.showNotification('Tipo/grupo creado exitosamente', 'success');
            this.load();
        } catch (error) {
            Utils.showNotification(error.message || 'Error al crear tipo/grupo', 'error');
        }
    },

    async togglePresentationTypeActive(id) {
        if (!this.canAdministerMenu()) return this.showAdminRequired();
        const tipo = this.presentationTypes.find(item => item.id === id);
        if (!tipo) return;

        const nextActive = this.isActive(tipo.activo) ? 0 : 1;
        const confirmed = await Utils.confirm(
            `¿Desea ${nextActive ? 'activar' : 'desactivar'} el tipo/grupo "${tipo.nombre}"?`,
            `${nextActive ? 'Activar' : 'Desactivar'} tipo/grupo`
        );
        if (!confirmed) return;

        try {
            await Utils.request(`/menu/presentation-types/${id}/active`, {
                method: 'PUT',
                body: JSON.stringify({ activo: nextActive })
            });
            Utils.showNotification(`Tipo/grupo ${nextActive ? 'activado' : 'desactivado'} correctamente`, 'success');
            this.load();
        } catch (error) {
            Utils.showNotification(error.message || 'Error al cambiar estado del tipo/grupo', 'error');
        }
    },

    // Mostrar modal para crear presentación
    showCreatePresentationModal() {
        if (!this.canAdministerMenu()) return this.showAdminRequired();

        const activeTypes = (this.presentationTypes || []).filter(tipo => this.isActive(tipo.activo));

        Utils.showModal('Nueva Presentación', `
            <form id="create-presentation-form">
                <div class="form-group">
                    <label for="presentation-tipo-presentacion">Tipo/Grupo *</label>
                    <select id="presentation-tipo-presentacion" name="tipo_presentacion_id" required>
                        <option value="">Seleccione un tipo/grupo</option>
                        ${activeTypes.map(tipo => `<option value="${tipo.id}">${this.formatPresentationTypeLabel(tipo)}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label for="presentation-nombre">Nombre *</label>
                    <input type="text" id="presentation-nombre" name="nombre" placeholder="Ej: 350 ml, Shot, Especial" required>
                </div>
                <div class="form-group">
                    <label for="presentation-tipo">Tipo interno</label>
                    <input type="text" id="presentation-tipo" name="tipo" value="Tamaño">
                </div>
                <div class="form-group">
                    <label for="presentation-cantidad">Cantidad / Medida *</label>
                    <input type="text" id="presentation-cantidad" name="cantidad" placeholder="Ej: 350 ml" required>
                </div>
            </form>
        `, [
            { text: 'Cancelar', class: 'btn-light' },
            { text: 'Crear Presentación', class: 'btn-primary', onclick: 'Menu.savePresentation()' }
        ]);
    },

    // Guardar presentación
    async savePresentation() {
        if (!this.canAdministerMenu()) return this.showAdminRequired();
        const form = document.getElementById('create-presentation-form');
        if (!Utils.validateForm(form)) {
            Utils.showNotification('Por favor complete todos los campos requeridos', 'warning');
            return;
        }

        const formData = new FormData(form);
        const data = {
            nombre: formData.get('nombre'),
            tipo: formData.get('tipo') || 'tamaño',
            cantidad: formData.get('cantidad'),
            tipo_presentacion_id: parseInt(formData.get('tipo_presentacion_id'))
        };

        if (!data.tipo_presentacion_id) {
            Utils.showNotification('Debe seleccionar un tipo/grupo de presentación', 'warning');
            return;
        }

        try {
            await Utils.request('/menu/presentaciones-globales', {
                method: 'POST',
                body: JSON.stringify(data)
            });

            Utils.hideModal();
            Utils.showNotification('Presentación creada exitosamente', 'success');
            this.load();
        } catch (error) {
            Utils.showNotification(error.message || 'Error al guardar presentación', 'error');
        }
    },

    async togglePresentationActive(id) {
        if (!this.canAdministerMenu()) return this.showAdminRequired();
        const presentation = this.presentations.find(p => p.id === id);
        if (!presentation) return;

        const nextActive = this.isActive(presentation.activo) ? 0 : 1;
        const confirmed = await Utils.confirm(
            `¿Desea ${nextActive ? 'activar' : 'desactivar'} la presentación "${presentation.nombre}"?`,
            `${nextActive ? 'Activar' : 'Desactivar'} presentación`
        );
        if (!confirmed) return;

        try {
            await Utils.request(`/menu/presentaciones-globales/${id}/active`, {
                method: 'PUT',
                body: JSON.stringify({ activo: nextActive })
            });
            Utils.showNotification(`Presentación ${nextActive ? 'activada' : 'desactivada'} correctamente`, 'success');
            this.load();
        } catch (error) {
            Utils.showNotification(error.message || 'Error al cambiar estado de la presentación', 'error');
        }
    },

    // Borrar presentación
async deletePresentation(id) {
    if (!this.canAdministerMenu()) return this.showAdminRequired();
    if (!confirm('¿Estás seguro de eliminar esta presentación?')) return;

    try {
        const response = await Utils.request(`/menu/presentaciones-globales/${id}`, {
            method: 'DELETE'
        });

        if (response.success) {
            Utils.showNotification('Presentación eliminada', 'success');
            this.load(); // recargar menú
        } else {
            Utils.showNotification(response.error || 'No se pudo eliminar', 'error');
        }
    } catch (error) {
        console.error('Error eliminando presentación:', error);
        Utils.showNotification('Error al eliminar presentación', 'error');
    }
},
    //Mostras presentación Asignada
async loadPresentacionesAsignadas(productId) {
    try {
        const response = await Utils.request(`/menu/products/${productId}/presentaciones`);
        const presentaciones = response.data?.presentaciones || [];

        const contenedor = document.getElementById("edit-product-presentaciones-checkboxes");
        if (!contenedor) return;

        contenedor.innerHTML = "";

        if (presentaciones.length === 0) {
            contenedor.innerHTML = '<p class="text-muted">No hay presentaciones disponibles para el tipo/grupo asignado a este producto.</p>';
            return;
        }

        presentaciones.forEach(pres => {
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.value = pres.presentacion_id || pres.id;
            checkbox.id = `edit-pres-${pres.presentacion_id || pres.id}`;
            checkbox.name = "presentaciones[]";
            checkbox.checked = Number(pres.asignada) === 1;

            const label = document.createElement("label");
            label.textContent = `${pres.nombre} (${pres.cantidad || '-'})`;
            label.htmlFor = checkbox.id;

            const inputPrecio = document.createElement("input");
            inputPrecio.type = "number";
            inputPrecio.min = 0;
            inputPrecio.step = 0.01;
            inputPrecio.placeholder = "₡";
            inputPrecio.classList.add("input-precio-presentacion");
            inputPrecio.name = `precio_presentacion_${checkbox.value}`;
            inputPrecio.id = `precio-presentacion-${checkbox.value}`;

            if (checkbox.checked) {
                inputPrecio.value = pres.precio || '';
                inputPrecio.style.display = "inline-block";
            } else {
                inputPrecio.style.display = "none";
            }

            checkbox.addEventListener("change", () => {
                inputPrecio.style.display = checkbox.checked ? "inline-block" : "none";
                if (!checkbox.checked) inputPrecio.value = "";
            });

            const wrapper = document.createElement("div");
            wrapper.className = "presentacion-item";
            wrapper.appendChild(checkbox);
            wrapper.appendChild(label);
            wrapper.appendChild(inputPrecio);

            contenedor.appendChild(wrapper);
        });
    } catch (error) {
        console.error("Error al cargar presentaciones asignadas:", error);
        Utils.showNotification("Error cargando presentaciones del producto", "error");
    }
},
async toggleSelectPresentaciones() {
    const checkbox = document.getElementById("product-tiene-presentaciones");
    const contenedorTipoPresentacion = document.getElementById("contenedor-tipo-presentacion");
    const contenedorPresentaciones = document.getElementById("contenedor-select-presentaciones");
    const fieldPrecio = document.getElementById("field-product-precio");

    if (!checkbox || !contenedorPresentaciones || !fieldPrecio) {
        console.error("❌ Error: Faltan elementos en el DOM para alternar presentaciones");
        return;
    }

    if (checkbox.checked) {
        if (contenedorTipoPresentacion) contenedorTipoPresentacion.style.display = "block";
        contenedorPresentaciones.style.display = "block";
        fieldPrecio.style.display = "none";
        this.refreshProductPresentationTypes('product');
    } else {
        if (contenedorTipoPresentacion) contenedorTipoPresentacion.style.display = "none";
        contenedorPresentaciones.style.display = "none";
        fieldPrecio.style.display = "block";
    }
},

async toggleEditPresentaciones() {
    const checkbox = document.getElementById('edit-product-tiene-presentaciones');
    if (checkbox.disabled) return; // Evita ejecución si está bloqueado

    const isChecked = checkbox.checked;
    const contenedor = document.getElementById('edit-contenedor-select-presentaciones');
    
    if (isChecked) {
        contenedor.style.display = 'block';
        this.loadPresentacionesSelect('edit');
    } else {
        contenedor.style.display = 'none';
    }

    document.getElementById('edit-product-precio').closest('.form-group').style.display = isChecked ? 'none' : 'block';
},

async loadPresentacionesDisponibles(productId) {
    const contenedor = document.getElementById("edit-nuevas-presentaciones-checkboxes");
    contenedor.innerHTML = ''; // limpiar

    try {
        const response = await Utils.request(`/menu/products/${productId}/presentaciones`);
        const presentaciones = response.data?.presentaciones || [];

        // Filtrar solo las NO asignadas
        const disponibles = presentaciones.filter(p => !p.asignada);

        if (disponibles.length === 0) {
            const mensaje = document.createElement("p");
            mensaje.textContent = "✅ Todas las presentaciones ya están asociadas a este producto.";
            mensaje.className = "text-muted";
            contenedor.appendChild(mensaje);
            return;
        }

        // Renderizar solo las no asignadas
        disponibles.forEach(pres => {
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.value = pres.presentacion_id;
            checkbox.id = `nueva-pres-${pres.presentacion_id}`;
            checkbox.name = "presentaciones[]";

            const label = document.createElement("label");
            label.textContent = `${pres.nombre} (${pres.cantidad})`;
            label.htmlFor = `nueva-pres-${pres.presentacion_id}`;

            const inputPrecio = document.createElement("input");
            inputPrecio.type = "number";
            inputPrecio.min = 0;
            inputPrecio.step = 0.01;
            inputPrecio.placeholder = "₡";
            inputPrecio.classList.add("input-precio-presentacion");
            inputPrecio.name = `precio_presentacion_${pres.presentacion_id}`;
            inputPrecio.id = `precio-presentacion-${pres.presentacion_id}`;
            inputPrecio.style.display = "none";

            checkbox.addEventListener("change", () => {
                inputPrecio.style.display = checkbox.checked ? "inline-block" : "none";
            });

            const wrapper = document.createElement("div");
            wrapper.className = "presentacion-item";
            wrapper.appendChild(checkbox);
            wrapper.appendChild(label);
            wrapper.appendChild(inputPrecio);

            contenedor.appendChild(wrapper);
        });

    } catch (error) {
        console.error("❌ Error al cargar nuevas presentaciones:", error);
        Utils.showNotification("Error cargando nuevas presentaciones", "error");
    }
},

eliminarPresentacionAsignada(btn) {
    const presentacionDiv = btn.closest('.presentacion-item');
    presentacionDiv.remove();
},

togglePrecioInput(checkbox) {
    const input = checkbox.parentElement.nextElementSibling;
    input.disabled = !checkbox.checked;
    if (!checkbox.checked) input.value = '';
},

onTogglePresentacionCheck(checkbox) {
    const precioInput = checkbox.closest('.presentacion-item').querySelector('.input-precio-presentacion');
    if (checkbox.checked) {
        precioInput.disabled = false;
        precioInput.focus();
    } else {
        precioInput.disabled = true;
        precioInput.value = '';
    }
},

async loadPresentacionesGlobales(tipoPresentacionId = null, containerId = "product-presentaciones-checkboxes") {
    try {
        const contenedor = document.getElementById(containerId);
        if (!contenedor) return;

        contenedor.innerHTML = "";

        if (!tipoPresentacionId) {
            contenedor.innerHTML = '<p class="text-muted">Seleccione primero un tipo/grupo de presentación.</p>';
            return;
        }

        const response = await Utils.request(`/menu/presentaciones-globales?tipo_presentacion_id=${encodeURIComponent(tipoPresentacionId)}`);
        const presentaciones = response.data || [];

        if (presentaciones.length === 0) {
            contenedor.innerHTML = '<p class="text-muted">No hay presentaciones disponibles para este tipo/grupo.</p>';
            return;
        }

        presentaciones.forEach(pres => {
            const item = document.createElement("div");
            item.className = "presentacion-item";

            item.innerHTML = `
                <label>
                    <input type="checkbox"
                           name="presentaciones[]"
                           value="${pres.id}"
                           data-label="${pres.nombre}"
                           onchange="Menu.onTogglePresentacionCheck(this)">
                    ${pres.nombre} (${pres.cantidad || '-'})
                </label>
                <input type="number"
                       step="0.01"
                       min="0"
                       placeholder="₡"
                       class="input-precio-presentacion"
                       name="precio_presentacion_${pres.id}"
                       id="precio-presentacion-${pres.id}"
                       disabled>
            `;

            contenedor.appendChild(item);
        });
    } catch (error) {
        console.error("❌ Error cargando presentaciones globales:", error);
        Utils.showNotification("Error cargando presentaciones", "error");
    }
},

async toggleAgregarMasPresentaciones() {
    const contenedor = document.getElementById("edit-contenedor-nuevas-presentaciones");
    const checkbox = document.getElementById("edit-agregar-mas-presentaciones");

    if (!checkbox || !contenedor) {
        console.error("❌ No se encontraron elementos para toggle de nuevas presentaciones");
        return;
    }

    if (checkbox.checked) {
        contenedor.style.display = "block";

        // Obtener el ID del producto desde el botón de acción del modal
        const guardarBtn = document.querySelector(".modal-footer .btn-primary");
        const onclickAttr = guardarBtn?.getAttribute("onclick");
        const match = onclickAttr?.match(/Menu\.updateProduct\((\d+)\)/);
        const productId = match ? parseInt(match[1]) : null;

        if (productId) {
            await Menu.loadPresentacionesDisponibles(productId);
        } else {
            console.warn("⚠️ No se pudo obtener el productId desde el modal para cargar nuevas presentaciones");
        }
    } else {
        contenedor.style.display = "none";
        document.getElementById("edit-nuevas-presentaciones-checkboxes").innerHTML = '';
    }
},
async showPresentacionesModal(productId) {
    try {
        const response = await Utils.request(`/menu/products/${productId}/presentaciones`);
        const { producto_nombre, presentaciones } = response.data;

        const asignadas = (presentaciones || []).filter(p => p.asignada);

        if (asignadas.length === 0) {
            Utils.showNotification("Este producto no tiene presentaciones asignadas.", "info");
            return;
        }

        const contenido = `
            <div class="presentaciones-modal">
                <p>Presentaciones del producto: <strong>${producto_nombre}</strong></p>
                <table>
                    <thead>
                        <tr>
                            <th>Presentación</th>
                            <th>Cantidad</th>
                            <th>Precio</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${asignadas.map(p => `
                            <tr>
                                <td>${p.nombre}</td>
                                <td>${p.cantidad}</td>
                                <td>₡${parseFloat(p.precio).toFixed(2)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;

        Utils.showModal("Presentaciones del producto", contenido, [
            { text: "Cerrar", class: "btn-primary" }
        ]);

    } catch (error) {
        console.error("Error al cargar presentaciones:", error);
        Utils.showNotification("Error al cargar presentaciones del producto.", "error");
    }
},

};
