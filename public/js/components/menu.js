// Menu Component
const Menu = {
    categories: [],
    products: [],
    presentations: [],
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

        return `<button class="btn btn-success" onclick="Menu.showCreatePresentationModal()">
                    <i class="fas fa-plus"></i> Nueva Presentación
                </button>`;
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

    // Cargar datos del menú
    async load(options = {}) {
            try {
                const includeInactive = this.canAdministerMenu() && (options.includeInactive === true || (typeof currentSection !== 'undefined' && currentSection === 'menu'));
                const inactiveQuery = includeInactive ? '?include_inactive=1' : '';
                const [categoriesResponse, productsResponse, presentationsResponse] = await Promise.all([
                        Utils.request(`/menu/categories${inactiveQuery}`),
                        Utils.request(`/menu/products${inactiveQuery}`),
                        Utils.request(`/menu/presentaciones-globales${inactiveQuery}`)
                ]);

                
                this.categories = categoriesResponse.data;
                this.products = productsResponse.data;
                this.presentations = presentationsResponse.data;
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
                <select id="product-categoria" name="categoria_id" required onchange="Menu.onCategoriaChange(this)">
                    <option value="">Seleccione una categoría</option>
                    ${mainCategories.map(cat => `<option value="${cat.id}">${cat.nombre}</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label for="product-subcategoria">Subcategoría</label>
                <select id="product-subcategoria" name="subcategoria_id">
                    <option value="">Seleccione una subcategoría</option>
                </select>
            </div>
            <div class="form-group">
                <label>
                    <input type="checkbox" id="product-tiene-presentaciones" onchange="Menu.toggleSelectPresentaciones()"> ¿Tiene presentaciones?
                </label>
            </div>
            <div class="form-group" id="contenedor-select-presentaciones" style="display: none;">
                <label>Seleccionar presentaciones:</label>
                <div id="product-presentaciones-checkboxes" class="presentaciones-checkboxes bordered-box">
                    <!-- Checkboxes se insertan aquí -->
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

    Menu.loadPresentacionesGlobales();
    Menu.onCategoriaChange(document.getElementById('product-categoria'));
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
        const contenedorSelectPresentaciones = document.getElementById("contenedor-select-presentaciones");

        if (esComidas) {
            // Mostrar checkbox cocina
            if (contenedorCocina) contenedorCocina.style.display = "block";
            if (checkCocina) checkCocina.checked = false;

            // Ocultar presentaciones
            if (checkPresentaciones) checkPresentaciones.checked = false;
            if (checkPresentaciones && checkPresentaciones.closest(".form-group"))
                checkPresentaciones.closest(".form-group").style.display = "none";
            if (contenedorSelectPresentaciones) contenedorSelectPresentaciones.style.display = "none";
        } else {
            // Ocultar checkbox cocina
            if (contenedorCocina) contenedorCocina.style.display = "none";
            if (checkCocina) checkCocina.checked = false;

            // Mostrar presentaciones
            if (checkPresentaciones && checkPresentaciones.closest(".form-group"))
                checkPresentaciones.closest(".form-group").style.display = "block";
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
    const imagenFile = formData.get("imagen");

    let presentaciones_seleccionadas = [];

    if (tiene_presentaciones) {
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

    if (tienePresentaciones) {
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

    if (!this.presentations || this.presentations.length === 0) {
        return `
            <div class="alert alert-info">
                <i class="fas fa-info-circle"></i> No hay presentaciones configuradas aún.
            </div>
        `;
    }

    return `
        <div class="table-responsive">
            <table class="table table-bordered table-hover">
                <thead class="table-light">
                    <tr>
                        <th>Nombre</th>
                        <th>Tipo</th>
                        <th>Cantidad</th>
                        <th>Estado</th>
                        ${canAdmin ? '<th style="width: 120px;">Acciones</th>' : ''}
                    </tr>
                </thead>
                <tbody>
                    ${this.presentations.map(pres => `
                        <tr${this.rowInactiveClass(pres.activo)}>
                            <td>${pres.nombre}</td>
                            <td>${pres.tipo}</td>
                            <td>${pres.cantidad || '-'}</td>
                            <td>${this.renderStatusBadge(pres.activo)}</td>
                            ${canAdmin ? `
                                <td>
                                    <button class="btn btn-sm ${this.isActive(pres.activo) ? 'btn-warning' : 'btn-success'}" onclick="Menu.togglePresentationActive(${pres.id})" title="${this.isActive(pres.activo) ? 'Desactivar presentación' : 'Activar presentación'}">
                                        <i class="fas ${this.isActive(pres.activo) ? 'fa-eye-slash' : 'fa-eye'}"></i>
                                    </button>
                                </td>
                            ` : ''}
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
},

    // Mostrar modal para crear presentación
showCreatePresentationModal() {
    if (!this.canAdministerMenu()) return this.showAdminRequired();
    Utils.showModal('Nueva Presentación', `
        <form id="create-presentation-form">
            <div class="form-group">
                <label for="presentation-nombre">Nombre *</label>
                <input type="text" id="presentation-nombre" name="nombre" required>
            </div>
            <div class="form-group">
                <label for="presentation-tipo">Tipo</label>
                <input type="text" id="presentation-tipo" name="tipo" value="Tamaño" readonly class="form-control-plaintext">
            </div>
            <div class="form-group">
                <label for="presentation-cantidad">Cantidad *</label>
                <input type="text" id="presentation-cantidad" name="cantidad" placeholder="Ej: 750ml" required>
            </div>
        </form>
    `, [
        {
            text: 'Cancelar',
            class: 'btn-light'
        },
        {
            text: 'Crear Presentación',
            class: 'btn-primary',
            onclick: 'Menu.savePresentation()'
        }
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
        cantidad: formData.get('cantidad')
    };

    try {
        await Utils.request('/menu/presentaciones-globales', {
            method: 'POST',
            body: JSON.stringify(data)
        });

        Utils.hideModal();
        Utils.showNotification('Presentación creada exitosamente', 'success');
        this.load();
    } catch (error) {
        Utils.showNotification(error.message || 'Error al guardar', 'error');
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
        const asignadas = response.data.presentaciones || [];

        // Obtener todas las presentaciones globales
        const todas = await Utils.request("/menu/presentaciones-globales");
        if (!todas || !Array.isArray(todas.data)) {
            console.warn("No se pudieron cargar presentaciones globales.");
            return;
        }

        const contenedor = document.getElementById("edit-product-presentaciones-checkboxes");
        contenedor.innerHTML = "";

        todas.data.forEach(pres => {
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.value = pres.id;
            checkbox.id = `edit-pres-${pres.id}`;
            checkbox.name = "presentaciones[]";

            const label = document.createElement("label");
            label.textContent = `${pres.nombre} (${pres.cantidad})`;
            label.htmlFor = `edit-pres-${pres.id}`;

            const inputPrecio = document.createElement("input");
            inputPrecio.type = "number";
            inputPrecio.min = 0;
            inputPrecio.step = 0.01;
            inputPrecio.placeholder = "₡";
            inputPrecio.classList.add("input-precio-presentacion");
            inputPrecio.name = `precio_presentacion_${pres.id}`;
            inputPrecio.id = `precio-presentacion-${pres.id}`; // 👈✅ Esta línea es clave


            // Verifica si ya está asignada
            const asignada = asignadas.find(a => a.presentacion_id === pres.id);
            if (asignada) {
                checkbox.checked = true;
                inputPrecio.value = asignada.precio;
                inputPrecio.style.display = "inline-block";
            } else {
                inputPrecio.style.display = "none";
            }

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
        console.error("Error al cargar presentaciones asignadas:", error);
    }
},

async toggleSelectPresentaciones() {
    const checkbox = document.getElementById("product-tiene-presentaciones");
    const contenedorPresentaciones = document.getElementById("contenedor-select-presentaciones");
    const fieldPrecio = document.getElementById("field-product-precio");

    if (!checkbox || !contenedorPresentaciones || !fieldPrecio) {
        console.error("❌ Error: Faltan elementos en el DOM para alternar presentaciones");
        return;
    }

    if (checkbox.checked) {
        contenedorPresentaciones.style.display = "block";
        fieldPrecio.style.display = "none";

        const presentacionesContainer = document.getElementById("product-presentaciones-checkboxes");
        if (!presentacionesContainer.hasChildNodes()) {
            await Menu.loadPresentacionesGlobales();
        }
    } else {
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
        const presentaciones = response.presentaciones || [];

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

async loadPresentacionesGlobales() {
    try {
        const response = await Utils.request("/menu/presentaciones-globales");
        const presentaciones = response.data || [];

        const contenedor = document.getElementById("product-presentaciones-checkboxes");
        contenedor.innerHTML = "";

        if (presentaciones.length === 0) {
            contenedor.innerHTML = '<p class="text-muted">No hay presentaciones disponibles.</p>';
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
                           onchange="Menu.onTogglePresentacionCheck(this)">
                    ${pres.nombre} (${pres.cantidad})
                </label>
                <input type="number"
                       step="0.01"
                       min="0"
                       placeholder="₡"
                       class="input-precio-presentacion"
                       name="precio_presentacion_${pres.id}"
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
