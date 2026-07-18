// Menu Component
const Menu = {
    categories: [],
    products: [],
    presentations: [],
    presentationTypes: [],
    templateDraft: null,
    templateStep: 'structure',
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

        const templateButton = `
            <button class="btn btn-template-wizard" onclick="Menu.showTemplateWizard()" title="Crear plantilla Excel asistida de Menú">
                <i class="fas fa-file-excel"></i> Plantilla asistida
            </button>
        `;
        const importButton = `
            <button class="btn btn-template-import" onclick="Menu.showTemplateImportModal()" title="Importar Menú desde plantilla oficial">
                <i class="fas fa-file-import"></i> Importar plantilla
            </button>
        `;

        if (this.currentView === 'products') {
            return `
                <button class="btn btn-success" onclick="Menu.showCreateProductModal()">
                    <i class="fas fa-plus"></i> Nuevo Producto
                </button>
                ${templateButton}
                ${importButton}
            `;
        }

        if (this.currentView === 'categories') {
            return `
                <button class="btn btn-success" onclick="Menu.showCreateCategoryModal()">
                    <i class="fas fa-plus"></i> Nueva Categoría
                </button>
                ${templateButton}
                ${importButton}
            `;
        }

        return `
            <button class="btn btn-success" onclick="Menu.showCreatePresentationTypeModal()">
                <i class="fas fa-layer-group"></i> Nuevo Tipo/Grupo
            </button>
            <button class="btn btn-primary" onclick="Menu.showCreatePresentationModal()">
                <i class="fas fa-plus"></i> Nueva Presentación
            </button>
            ${templateButton}
            ${importButton}
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
    // Cambiar vista
    switchView(view) {
            this.currentView = view;
            this.render();
            Navigation.syncInternalSubnav('menu');
    },

    // Renderizar vista de productos

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
            <div class="form-group" id="contenedor-checkbox-cocina">
                <label for="product-destino-preparacion">Destino de preparación</label>
                <select id="product-destino-preparacion" name="destino_preparacion" onchange="Menu.validateCocinaCheckbox()">
                    <option value="ninguno">No requiere preparación</option>
                    <option value="cocina">Cocina</option>
                    <option value="bar">Bar</option>
                </select>
                <small class="text-muted">Define a qué área se enviarán las solicitudes de este producto.</small>
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
    ], 'modal-menu modal-menu-product');

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
        const destinoPreparacion = document.getElementById("product-destino-preparacion");
        const contenedorCocina = document.getElementById("contenedor-checkbox-cocina");

        const checkPresentaciones = document.getElementById("product-tiene-presentaciones");
        const contenedorTipoPresentacion = document.getElementById("contenedor-tipo-presentacion");
        const contenedorSelectPresentaciones = document.getElementById("contenedor-select-presentaciones");

        if (esComidas) {
            // Mostrar checkbox cocina
            if (contenedorCocina) contenedorCocina.style.display = "block";
            if (destinoPreparacion && !destinoPreparacion.value) destinoPreparacion.value = 'ninguno';

            // Ocultar presentaciones
            if (checkPresentaciones) checkPresentaciones.checked = false;
            if (checkPresentaciones && checkPresentaciones.closest(".form-group"))
                checkPresentaciones.closest(".form-group").style.display = "none";
            if (contenedorTipoPresentacion) contenedorTipoPresentacion.style.display = "none";
            if (contenedorSelectPresentaciones) contenedorSelectPresentaciones.style.display = "none";
        } else {
            // Ocultar checkbox cocina
            if (contenedorCocina) contenedorCocina.style.display = "block";
            if (destinoPreparacion && destinoPreparacion.value === 'cocina') destinoPreparacion.value = 'ninguno';

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
        const destinoSelect = document.getElementById('product-destino-preparacion');
        const validationMessage = document.getElementById('cocina-validation-message');

        if (!categoriaSelect || !destinoSelect) return;

        const categoria = this.categories.find(cat => cat.id == categoriaSelect.value);
        const subcategoria = subcategoriaSelect ? this.categories.find(cat => cat.id == subcategoriaSelect.value) : null;

        const categoriaPermiteCocina = categoria && categoria.permite_cocina;
        const subcategoriaPermiteCocina = subcategoria && subcategoria.permite_cocina;

        const requiereCocina = destinoSelect.value === 'cocina';
        if (requiereCocina) {
            const isValidForKitchen = Boolean(categoriaPermiteCocina)
                && (!subcategoria || Boolean(subcategoriaPermiteCocina));

            if (!isValidForKitchen) {
                destinoSelect.value = 'ninguno';
                validationMessage.textContent = 'Esta categoría o subcategoría no permite productos de cocina.';
                validationMessage.style.display = 'block';
            } else {
                validationMessage.style.display = 'none';
            }
        } else {
            // El destino Bar se define por producto y no reutiliza la regla legacy permite_cocina.
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
    const destino_preparacion = String(formData.get("destino_preparacion") || 'ninguno');
    const es_cocina = destino_preparacion !== 'ninguno';
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
        payload.append("destino_preparacion", destino_preparacion);
        payload.append("tiene_presentaciones", tiene_presentaciones);
        if (tipo_presentacion_id) payload.append("tipo_presentacion_id", tipo_presentacion_id);
        payload.append("activo", 1);

        if (imagenFile && imagenFile.size > 0) {
            payload.append("imagen", imagenFile);
        }

        if (tiene_presentaciones) {
            payload.append("presentaciones_seleccionadas", JSON.stringify(presentaciones_seleccionadas));
            presentaciones_seleccionadas.forEach(presentacion => {
                const imageInput = document.getElementById(`imagen-presentacion-${presentacion.id}`);
                const imageFile = imageInput?.files?.[0];
                if (imageFile) {
                    payload.append(`imagen_presentacion_${presentacion.id}`, imageFile);
                }
            });
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
    const destinoPreparacion = product.destino_preparacion || (Number(product.es_cocina) === 1 ? 'cocina' : 'ninguno');
    const isCocina = destinoPreparacion === 'cocina';
    const tienePresentaciones = product.tiene_presentaciones;

    const readonlyAttr = (cond) => cond ? 'readonly' : '';
    const disabledAttr = (cond) => cond ? 'disabled' : '';

    // Imagen por defecto si no hay una definida
    const imagenActual = this.normalizeImageUrl(product.imagen || product.imagen_url);

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

            ` : ''}

            <div class="form-group">
                <label for="edit-product-destino-preparacion">Destino de preparación</label>
                <select id="edit-product-destino-preparacion" name="destino_preparacion">
                    <option value="ninguno" ${destinoPreparacion === 'ninguno' ? 'selected' : ''}>No requiere preparación</option>
                    <option value="cocina" ${destinoPreparacion === 'cocina' ? 'selected' : ''}>Cocina</option>
                    <option value="bar" ${destinoPreparacion === 'bar' ? 'selected' : ''}>Bar</option>
                </select>
                <small class="text-muted">Los cambios posteriores generarán un ajuste operativo para Kitchen.</small>
            </div>

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
    ], 'modal-menu modal-menu-product');

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
    const destinoPreparacion = document.getElementById('edit-product-destino-preparacion')?.value || 'ninguno';
    const esCocina = destinoPreparacion !== 'ninguno';

    formData.set('categoria_id', categoriaId);
    formData.set('subcategoria_id', subcategoriaId);
    formData.set('es_cocina', esCocina ? 1 : 0);
    formData.set('destino_preparacion', destinoPreparacion);
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
            ], 'modal-menu modal-menu-narrow');
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
            ], 'modal-menu modal-menu-narrow');
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
        ], 'modal-menu');
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
        ], 'modal-menu');
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

    // Mostrar presentaciones asignadas
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
            const presentacionId = pres.presentacion_id || pres.id;
            const checked = Number(pres.asignada) === 1;
            const wrapper = document.createElement("div");
            wrapper.className = "presentacion-item presentacion-item-with-image";
            const imageUrl = this.normalizeImageUrl(pres.imagen || pres.imagen_url);

            wrapper.innerHTML = `
                <label class="presentacion-check-label" for="edit-pres-${presentacionId}">
                    <input type="checkbox"
                           value="${presentacionId}"
                           id="edit-pres-${presentacionId}"
                           name="presentaciones[]"
                           data-label="${this.escapeHtml(pres.nombre || '')}"
                           ${checked ? 'checked' : ''}
                           onchange="Menu.onTogglePresentacionCheck(this)">
                    <span>${this.escapeHtml(pres.nombre || '')} (${this.escapeHtml(pres.cantidad || '-')})</span>
                </label>
                <input type="number"
                       min="0"
                       step="0.01"
                       placeholder="₡"
                       class="input-precio-presentacion"
                       name="precio_presentacion_${presentacionId}"
                       id="precio-presentacion-${presentacionId}"
                       value="${checked ? (pres.precio || '') : ''}"
                       ${checked ? '' : 'disabled'}>
                <div class="presentacion-image-field">
                    <div class="presentacion-image-preview">
                        <img src="${imageUrl}" alt="${this.escapeHtml(pres.nombre || 'Presentación')}" onerror="this.src='/uploads/ImagenGenerica.jpg'">
                        <small>${pres.imagen_origen === 'presentacion' ? 'Imagen propia' : 'Usa imagen del producto'}</small>
                    </div>
                    <label for="imagen-presentacion-${presentacionId}">Cambiar imagen</label>
                    <input type="file"
                           class="input-imagen-presentacion"
                           name="imagen_presentacion_${presentacionId}"
                           id="imagen-presentacion-${presentacionId}"
                           accept="image/*"
                           ${checked ? '' : 'disabled'}>
                </div>
            `;

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

    onTogglePresentacionCheck(checkbox) {
    const wrapper = checkbox.closest('.presentacion-item');
    const precioInput = wrapper?.querySelector('.input-precio-presentacion');
    const imagenInput = wrapper?.querySelector('.input-imagen-presentacion');

    if (checkbox.checked) {
        if (precioInput) {
            precioInput.disabled = false;
            precioInput.style.display = 'inline-block';
            precioInput.focus();
        }
        if (imagenInput) {
            imagenInput.disabled = false;
        }
    } else {
        if (precioInput) {
            precioInput.disabled = true;
            precioInput.value = '';
            precioInput.style.display = '';
        }
        if (imagenInput) {
            imagenInput.disabled = true;
            imagenInput.value = '';
        }
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
                <label class="presentacion-check-label">
                    <input type="checkbox"
                           name="presentaciones[]"
                           value="${pres.id}"
                           data-label="${pres.nombre}"
                           onchange="Menu.onTogglePresentacionCheck(this)">
                    <span>${pres.nombre} (${pres.cantidad || '-'})</span>
                </label>
                <input type="number"
                       step="0.01"
                       min="0"
                       placeholder="₡"
                       class="input-precio-presentacion"
                       name="precio_presentacion_${pres.id}"
                       id="precio-presentacion-${pres.id}"
                       disabled>
                <div class="presentacion-image-field">
                    <label for="imagen-presentacion-${pres.id}">Imagen opcional</label>
                    <input type="file"
                           class="input-imagen-presentacion"
                           name="imagen_presentacion_${pres.id}"
                           id="imagen-presentacion-${pres.id}"
                           accept="image/*"
                           disabled>
                </div>
            `;

            contenedor.appendChild(item);
        });
    } catch (error) {
        console.error("❌ Error cargando presentaciones globales:", error);
        Utils.showNotification("Error cargando presentaciones", "error");
    }
},


    // ===== v2.2.5M.7 · Normalización visual final de Menú =====
    escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    },


    getTemplateStorageKey() {
        return 'mundipos.menu.templateDraft.v2.2.5M.11';
    },

    createEmptyTemplateDraft() {
        return {
            metadata: {
                negocio: '',
                moneda: 'CRC',
                creado_por: currentUser?.nombre || 'Administrador',
                notas: ''
            },
            categories: [],
            subcategories: [],
            presentationTypes: [],
            presentations: [],
            products: [],
            productPresentations: []
        };
    },

    cloneTemplateDraft(draft) {
        return JSON.parse(JSON.stringify(draft || this.createEmptyTemplateDraft()));
    },

    loadTemplateDraft() {
        if (this.templateDraft) return this.templateDraft;

        try {
            const saved = localStorage.getItem(this.getTemplateStorageKey());
            this.templateDraft = saved ? JSON.parse(saved) : this.createEmptyTemplateDraft();
        } catch (error) {
            console.warn('No se pudo cargar el borrador de plantilla:', error);
            this.templateDraft = this.createEmptyTemplateDraft();
        }

        return this.templateDraft;
    },

    saveTemplateDraft(showMessage = true) {
        this.syncTemplateDraftFromDom();
        localStorage.setItem(this.getTemplateStorageKey(), JSON.stringify(this.templateDraft));
        if (showMessage) Utils.showNotification('Borrador de plantilla guardado en este dispositivo.', 'success');
    },

    clearTemplateDraft() {
        this.templateDraft = this.createEmptyTemplateDraft();
        localStorage.removeItem(this.getTemplateStorageKey());
        this.refreshTemplateWizard();
        Utils.showNotification('Borrador de plantilla reiniciado.', 'info');
    },

    loadTemplateDemo() {
        this.templateDraft = {
            metadata: {
                negocio: 'Restaurante Demo',
                moneda: 'CRC',
                creado_por: currentUser?.nombre || 'Administrador',
                notas: 'Datos demo generados desde el asistente MundiPOS.'
            },
            categories: [
                { clave_categoria: 'CAT-BEBIDAS', nombre: 'Bebidas', permite_cocina: 'NO', activa: 'SI' },
                { clave_categoria: 'CAT-COMIDAS', nombre: 'Comidas', permite_cocina: 'SI', activa: 'SI' }
            ],
            subcategories: [
                { clave_categoria: 'CAT-BEBIDAS', clave_subcategoria: 'SUB-GASEOSAS', nombre: 'Gaseosas', permite_cocina: 'NO', activa: 'SI' },
                { clave_categoria: 'CAT-COMIDAS', clave_subcategoria: 'SUB-HAMBURGUESAS', nombre: 'Hamburguesas', permite_cocina: 'SI', activa: 'SI' }
            ],
            presentationTypes: [
                { clave_tipo: 'TIP-GASEOSAS', nombre: 'Bebidas / Gaseosas', clave_categoria: 'CAT-BEBIDAS', clave_subcategoria: 'SUB-GASEOSAS', descripcion: 'Tamaños para bebidas gaseosas', activo: 'SI' }
            ],
            presentations: [
                { clave_presentacion: 'PRE-350ML', nombre: '350 ml', tipo: 'Tamaño', cantidad: '350 ml', clave_tipo: 'TIP-GASEOSAS', activo: 'SI' },
                { clave_presentacion: 'PRE-600ML', nombre: '600 ml', tipo: 'Tamaño', cantidad: '600 ml', clave_tipo: 'TIP-GASEOSAS', activo: 'SI' },
                { clave_presentacion: 'PRE-3L', nombre: '3 litros', tipo: 'Tamaño', cantidad: '3 litros', clave_tipo: 'TIP-GASEOSAS', activo: 'SI' }
            ],
            products: [
                { clave_producto: 'PROD-COCACOLA', nombre: 'Coca Cola', descripcion: 'Gaseosa Coca Cola', clave_categoria: 'CAT-BEBIDAS', clave_subcategoria: 'SUB-GASEOSAS', precio_base: '', tiene_presentaciones: 'SI', clave_tipo: 'TIP-GASEOSAS', destino_preparacion: 'bar', es_cocina: 'SI', activo: 'SI' },
                { clave_producto: 'PROD-HAMB-CLASICA', nombre: 'Hamburguesa Clásica', descripcion: 'Hamburguesa de la casa', clave_categoria: 'CAT-COMIDAS', clave_subcategoria: 'SUB-HAMBURGUESAS', precio_base: 3500, tiene_presentaciones: 'NO', clave_tipo: '', destino_preparacion: 'cocina', es_cocina: 'SI', activo: 'SI' }
            ],
            productPresentations: [
                { clave_producto: 'PROD-COCACOLA', clave_presentacion: 'PRE-350ML', precio: 700, activo: 'SI' },
                { clave_producto: 'PROD-COCACOLA', clave_presentacion: 'PRE-600ML', precio: 1000, activo: 'SI' },
                { clave_producto: 'PROD-COCACOLA', clave_presentacion: 'PRE-3L', precio: 2500, activo: 'SI' }
            ]
        };

        this.templateStep = 'structure';
        this.saveTemplateDraft(false);
        this.refreshTemplateWizard();
        Utils.showNotification('Demo de plantilla cargado.', 'success');
    },

    showTemplateWizard(step = 'structure') {
        if (!this.canAdministerMenu()) return this.showAdminRequired();

        this.loadTemplateDraft();
        this.templateStep = step;

        Utils.showModal('Generador asistido de Plantilla Excel de Menú', this.renderTemplateWizard(), [
            { text: 'Cerrar', class: 'btn-light', onclick: 'Utils.hideModal()' },
            { text: '<i class="fas fa-save"></i> Guardar avance', class: 'btn-secondary', onclick: 'Menu.saveTemplateDraft()' },
            { text: '<i class="fas fa-wand-magic-sparkles"></i> Cargar demo', class: 'btn-info', onclick: 'Menu.loadTemplateDemo()' },
            { text: '<i class="fas fa-file-excel"></i> Descargar Excel', class: 'btn-success', align: 'right', onclick: 'Menu.downloadMenuTemplate()' }
        ], 'modal-menu modal-menu-template');
    },

    refreshTemplateWizard() {
        const body = document.querySelector('#modal-content .modal-body');
        if (body) body.innerHTML = this.renderTemplateWizard();
    },

    switchTemplateStep(step) {
        this.syncTemplateDraftFromDom();
        this.templateStep = step;
        this.refreshTemplateWizard();
    },

    addTemplateRow(section) {
        this.syncTemplateDraftFromDom();
        const draft = this.loadTemplateDraft();
        const next = (draft[section]?.length || 0) + 1;
        const defaults = {
            categories: { clave_categoria: `CAT-${next}`, nombre: '', permite_cocina: 'NO', activa: 'SI' },
            subcategories: { clave_categoria: '', clave_subcategoria: `SUB-${next}`, nombre: '', permite_cocina: 'NO', activa: 'SI' },
            presentationTypes: { clave_tipo: `TIP-${next}`, nombre: '', clave_categoria: '', clave_subcategoria: '', descripcion: '', activo: 'SI' },
            presentations: { clave_presentacion: `PRE-${next}`, nombre: '', tipo: 'Tamaño', cantidad: '', clave_tipo: '', activo: 'SI' },
            products: { clave_producto: `PROD-${next}`, nombre: '', descripcion: '', clave_categoria: '', clave_subcategoria: '', precio_base: '', tiene_presentaciones: 'NO', clave_tipo: '', destino_preparacion: 'ninguno', es_cocina: 'NO', activo: 'SI' },
            productPresentations: { clave_producto: '', clave_presentacion: '', precio: '', activo: 'SI' }
        };

        if (!draft[section]) draft[section] = [];
        draft[section].push(defaults[section]);
        this.refreshTemplateWizard();
    },

    removeTemplateRow(section, index) {
        this.syncTemplateDraftFromDom();
        const draft = this.loadTemplateDraft();
        if (!draft[section]) return;
        draft[section].splice(index, 1);
        this.refreshTemplateWizard();
    },

    syncTemplateDraftFromDom() {
        const root = document.getElementById('menu-template-wizard');
        if (!root || !this.templateDraft) return;

        const metadata = this.templateDraft.metadata || {};
        ['negocio', 'moneda', 'creado_por', 'notas'].forEach(field => {
            const input = root.querySelector(`[data-template-meta="${field}"]`);
            if (input) metadata[field] = input.value.trim();
        });
        this.templateDraft.metadata = metadata;

        root.querySelectorAll('[data-template-section]').forEach(container => {
            const section = container.dataset.templateSection;
            const rows = [];

            container.querySelectorAll('[data-template-row]').forEach(rowEl => {
                const row = {};
                rowEl.querySelectorAll('[data-field]').forEach(input => {
                    row[input.dataset.field] = input.value.trim();
                });
                rows.push(row);
            });

            this.templateDraft[section] = rows;
        });
    },

    renderTemplateWizard() {
        const draft = this.loadTemplateDraft();
        const validation = this.validateTemplateDraftClient();
        const steps = [
            { key: 'structure', label: '1. Estructura', icon: 'fa-tags' },
            { key: 'products', label: '2. Productos', icon: 'fa-utensils' },
            { key: 'presentations', label: '3. Presentaciones', icon: 'fa-layer-group' },
            { key: 'review', label: '4. Revisión', icon: 'fa-check-circle' }
        ];

        return `
            <div id="menu-template-wizard" class="menu-template-wizard">
                <div class="menu-template-hero">
                    <div>
                        <span class="menu-template-eyebrow">v2.2.5M.11</span>
                        <h4>Crear plantilla oficial para carga inicial de Menú</h4>
                        <p>Construye el Excel en el mismo orden operativo de la app. Esta fase solo genera la plantilla; la importación real se implementa en M.12.</p>
                    </div>
                    <i class="fas fa-file-excel"></i>
                </div>

                <div class="menu-template-steps">
                    ${steps.map(step => `
                        <button type="button" class="menu-template-step ${this.templateStep === step.key ? 'active' : ''}" onclick="Menu.switchTemplateStep('${step.key}')">
                            <i class="fas ${step.icon}"></i> ${step.label}
                        </button>
                    `).join('')}
                </div>

                <div class="menu-template-body">
                    ${this.templateStep === 'structure' ? this.renderTemplateStructureStep(draft) : ''}
                    ${this.templateStep === 'products' ? this.renderTemplateProductsStep(draft) : ''}
                    ${this.templateStep === 'presentations' ? this.renderTemplatePresentationsStep(draft) : ''}
                    ${this.templateStep === 'review' ? this.renderTemplateReviewStep(draft, validation) : ''}
                </div>

                <div class="menu-template-inline-actions">
                    <button type="button" class="btn btn-light" onclick="Menu.clearTemplateDraft()"><i class="fas fa-eraser"></i> Reiniciar</button>
                    <button type="button" class="btn btn-secondary" onclick="Menu.saveTemplateDraft()"><i class="fas fa-save"></i> Guardar avance</button>
                    <button type="button" class="btn btn-primary" onclick="Menu.switchTemplateStep('${this.getNextTemplateStep()}')"><i class="fas fa-arrow-right"></i> Siguiente</button>
                </div>
            </div>
        `;
    },

    getNextTemplateStep() {
        const steps = ['structure', 'products', 'presentations', 'review'];
        const index = steps.indexOf(this.templateStep);
        return steps[Math.min(index + 1, steps.length - 1)] || 'review';
    },

    renderTemplateStructureStep(draft) {
        return `
            <div class="menu-template-help">
                <i class="fas fa-lightbulb"></i>
                <div><strong>Primero define la estructura.</strong><p>Crea categorías principales y luego subcategorías opcionales. Usa claves simples; serán la referencia para productos y grupos.</p></div>
            </div>
            <div class="menu-template-metadata">
                <div class="form-group"><label>Nombre del negocio</label><input type="text" data-template-meta="negocio" value="${this.escapeHtml(draft.metadata?.negocio || '')}" placeholder="Ej. Bar La Esquina"></div>
                <div class="form-group"><label>Moneda</label><input type="text" data-template-meta="moneda" value="${this.escapeHtml(draft.metadata?.moneda || 'CRC')}"></div>
                <div class="form-group"><label>Creado por</label><input type="text" data-template-meta="creado_por" value="${this.escapeHtml(draft.metadata?.creado_por || '')}"></div>
                <div class="form-group"><label>Notas</label><input type="text" data-template-meta="notas" value="${this.escapeHtml(draft.metadata?.notas || '')}" placeholder="Notas internas de carga"></div>
            </div>
            ${this.renderTemplateTable('categories', 'Categorías', ['clave_categoria', 'nombre', 'permite_cocina', 'activa'], draft.categories)}
            ${this.renderTemplateTable('subcategories', 'Subcategorías', ['clave_categoria', 'clave_subcategoria', 'nombre', 'permite_cocina', 'activa'], draft.subcategories)}
        `;
    },

    renderTemplateProductsStep(draft) {
        return `
            <div class="menu-template-help">
                <i class="fas fa-utensils"></i>
                <div><strong>Luego crea productos.</strong><p>Si un producto no tiene presentaciones, coloca precio_base. Define también si no requiere preparación o si se dirige a Cocina o Bar.</p></div>
            </div>
            ${this.renderTemplateTable('products', 'Productos', ['clave_producto', 'nombre', 'descripcion', 'clave_categoria', 'clave_subcategoria', 'precio_base', 'tiene_presentaciones', 'clave_tipo', 'destino_preparacion', 'activo'], draft.products)}
        `;
    },

    renderTemplatePresentationsStep(draft) {
        return `
            <div class="menu-template-help">
                <i class="fas fa-layer-group"></i>
                <div><strong>Completa grupos y presentaciones.</strong><p>El tipo/grupo filtra qué presentaciones verá el admin al crear productos. Después asigna precios por producto-presentación.</p></div>
            </div>
            ${this.renderTemplateTable('presentationTypes', 'Tipos/Grupos de presentación', ['clave_tipo', 'nombre', 'clave_categoria', 'clave_subcategoria', 'descripcion', 'activo'], draft.presentationTypes)}
            ${this.renderTemplateTable('presentations', 'Presentaciones', ['clave_presentacion', 'nombre', 'tipo', 'cantidad', 'clave_tipo', 'activo'], draft.presentations)}
            ${this.renderTemplateTable('productPresentations', 'Precios por producto-presentación', ['clave_producto', 'clave_presentacion', 'precio', 'activo'], draft.productPresentations)}
        `;
    },

    renderTemplateReviewStep(draft, validation) {
        const totals = [
            ['Categorías', draft.categories.length],
            ['Subcategorías', draft.subcategories.length],
            ['Tipos/Grupos', draft.presentationTypes.length],
            ['Presentaciones', draft.presentations.length],
            ['Productos', draft.products.length],
            ['Precios por presentación', draft.productPresentations.length]
        ];

        return `
            <div class="menu-template-review-grid">
                ${totals.map(([label, value]) => `<div class="menu-template-review-card"><span>${label}</span><strong>${value}</strong></div>`).join('')}
            </div>
            <div class="menu-template-validation ${validation.errors.length ? 'has-errors' : ''}">
                <h4><i class="fas ${validation.errors.length ? 'fa-triangle-exclamation' : 'fa-check-circle'}"></i> Validación previa</h4>
                ${validation.errors.length === 0 && validation.warnings.length === 0 ? '<p>La plantilla está lista para descargarse.</p>' : ''}
                ${validation.errors.length ? `<strong>Errores:</strong><ul>${validation.errors.map(error => `<li>${this.escapeHtml(error)}</li>`).join('')}</ul>` : ''}
                ${validation.warnings.length ? `<strong>Advertencias:</strong><ul>${validation.warnings.map(warning => `<li>${this.escapeHtml(warning)}</li>`).join('')}</ul>` : ''}
            </div>
            <button type="button" class="btn btn-success btn-template-download" onclick="Menu.downloadMenuTemplate()">
                <i class="fas fa-file-excel"></i> Descargar plantilla Excel oficial
            </button>
        `;
    },

    renderTemplateTable(section, title, fields, rows = []) {
        return `
            <div class="menu-template-table-block">
                <div class="menu-template-table-title">
                    <h4>${this.escapeHtml(title)}</h4>
                    <button type="button" class="btn btn-success btn-sm" onclick="Menu.addTemplateRow('${section}')"><i class="fas fa-plus"></i> Agregar</button>
                </div>
                <div class="table-container menu-template-table-wrap" data-template-section="${section}">
                    <table class="table menu-template-table">
                        <thead><tr>${fields.map(field => `<th>${this.escapeHtml(this.getTemplateFieldLabel(field))}</th>`).join('')}<th></th></tr></thead>
                        <tbody>
                            ${(rows || []).length ? rows.map((row, index) => `
                                <tr data-template-row="${index}">
                                    ${fields.map(field => `<td>${this.renderTemplateField(field, row[field])}</td>`).join('')}
                                    <td><button type="button" class="btn btn-danger btn-sm" onclick="Menu.removeTemplateRow('${section}', ${index})" title="Quitar fila"><i class="fas fa-trash"></i></button></td>
                                </tr>
                            `).join('') : `<tr><td colspan="${fields.length + 1}" class="text-center text-muted">Sin filas. Usa Agregar o Cargar demo.</td></tr>`}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    },

    getTemplateFieldLabel(field) {
        const labels = {
            clave_categoria: 'Clave categoría',
            clave_subcategoria: 'Clave subcategoría',
            clave_tipo: 'Clave tipo/grupo',
            clave_presentacion: 'Clave presentación',
            clave_producto: 'Clave producto',
            nombre: 'Nombre',
            descripcion: 'Descripción',
            tipo: 'Tipo',
            cantidad: 'Cantidad',
            precio_base: 'Precio base',
            precio: 'Precio',
            tiene_presentaciones: 'Tiene presentación',
            permite_cocina: 'Permite cocina',
            destino_preparacion: 'Destino preparación',
            es_cocina: 'Preparación legacy',
            activa: 'Activa',
            activo: 'Activo'
        };
        return labels[field] || field;
    },

    renderTemplateField(field, value = '') {
        const safeValue = this.escapeHtml(value);
        if (field === 'destino_preparacion') {
            const destination = ['ninguno', 'cocina', 'bar'].includes(String(value || '').toLowerCase())
                ? String(value).toLowerCase()
                : 'ninguno';
            return `
                <select data-field="${field}">
                    <option value="ninguno" ${destination === 'ninguno' ? 'selected' : ''}>Ninguno</option>
                    <option value="cocina" ${destination === 'cocina' ? 'selected' : ''}>Cocina</option>
                    <option value="bar" ${destination === 'bar' ? 'selected' : ''}>Bar</option>
                </select>
            `;
        }
        const yesNoFields = ['permite_cocina', 'activa', 'activo', 'tiene_presentaciones', 'es_cocina'];
        if (yesNoFields.includes(field)) {
            return `
                <select data-field="${field}">
                    <option value="SI" ${String(value).toUpperCase() === 'SI' ? 'selected' : ''}>SI</option>
                    <option value="NO" ${String(value).toUpperCase() === 'NO' ? 'selected' : ''}>NO</option>
                </select>
            `;
        }

        const numericFields = ['precio_base', 'precio'];
        if (numericFields.includes(field)) {
            return `<input type="number" step="0.01" min="0" data-field="${field}" value="${safeValue}">`;
        }

        return `<input type="text" data-field="${field}" value="${safeValue}">`;
    },

    validateTemplateDraftClient() {
        const draft = this.loadTemplateDraft();
        const errors = [];
        const warnings = [];
        const categoryKeys = new Set((draft.categories || []).map(row => String(row.clave_categoria || '').toLowerCase()).filter(Boolean));
        const typeKeys = new Set((draft.presentationTypes || []).map(row => String(row.clave_tipo || '').toLowerCase()).filter(Boolean));
        const presentationKeys = new Set((draft.presentations || []).map(row => String(row.clave_presentacion || '').toLowerCase()).filter(Boolean));
        const productKeys = new Set((draft.products || []).map(row => String(row.clave_producto || '').toLowerCase()).filter(Boolean));

        if ((draft.categories || []).length === 0) warnings.push('Agrega al menos una categoría para una carga real.');
        (draft.categories || []).forEach((row, index) => {
            if (!row.clave_categoria || !row.nombre) errors.push(`Categoría fila ${index + 1}: clave y nombre son requeridos.`);
        });
        (draft.subcategories || []).forEach((row, index) => {
            if (!row.clave_categoria || !row.clave_subcategoria || !row.nombre) errors.push(`Subcategoría fila ${index + 1}: faltan datos requeridos.`);
            if (row.clave_categoria && !categoryKeys.has(row.clave_categoria.toLowerCase())) warnings.push(`Subcategoría fila ${index + 1}: categoría no definida todavía.`);
        });
        (draft.presentationTypes || []).forEach((row, index) => {
            if (!row.clave_tipo || !row.nombre || !row.clave_categoria) errors.push(`Tipo/grupo fila ${index + 1}: clave, nombre y categoría son requeridos.`);
        });
        (draft.presentations || []).forEach((row, index) => {
            if (!row.clave_presentacion || !row.nombre || !row.clave_tipo) errors.push(`Presentación fila ${index + 1}: clave, nombre y tipo/grupo son requeridos.`);
            if (row.clave_tipo && !typeKeys.has(row.clave_tipo.toLowerCase())) warnings.push(`Presentación fila ${index + 1}: tipo/grupo no definido todavía.`);
        });
        (draft.products || []).forEach((row, index) => {
            if (!row.clave_producto || !row.nombre || !row.clave_categoria) errors.push(`Producto fila ${index + 1}: clave, nombre y categoría son requeridos.`);
            if (row.tiene_presentaciones === 'SI' && !row.clave_tipo) errors.push(`Producto fila ${index + 1}: requiere clave_tipo si tiene presentaciones.`);
        });
        (draft.productPresentations || []).forEach((row, index) => {
            if (!row.clave_producto || !row.clave_presentacion || Number(row.precio) <= 0) errors.push(`Precio por presentación fila ${index + 1}: producto, presentación y precio mayor a cero son requeridos.`);
            if (row.clave_producto && !productKeys.has(row.clave_producto.toLowerCase())) warnings.push(`Precio por presentación fila ${index + 1}: producto no definido todavía.`);
            if (row.clave_presentacion && !presentationKeys.has(row.clave_presentacion.toLowerCase())) warnings.push(`Precio por presentación fila ${index + 1}: presentación no definida todavía.`);
        });

        return { errors, warnings };
    },

    async downloadMenuTemplate() {
        if (!this.canAdministerMenu()) return this.showAdminRequired();
        this.syncTemplateDraftFromDom();
        const validation = this.validateTemplateDraftClient();
        if (validation.errors.length > 0) {
            this.templateStep = 'review';
            this.refreshTemplateWizard();
            Utils.showNotification('Corrige los errores antes de descargar la plantilla.', 'warning');
            return;
        }

        try {
            const response = await fetch(`${API_BASE}/menu/template/generate`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'X-MundiPOS-Client': typeof MUNDIPOS_CLIENT_ID !== 'undefined' ? MUNDIPOS_CLIENT_ID : 'menu-template-wizard'
                },
                body: JSON.stringify({ draft: this.templateDraft })
            });

            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.error || 'No se pudo generar la plantilla');
            }

            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            const disposition = response.headers.get('Content-Disposition') || '';
            const match = disposition.match(/filename="?([^";]+)"?/i);
            link.href = url;
            link.download = match ? match[1] : 'mundipos-menu-template.xlsx';
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
            this.saveTemplateDraft(false);
            Utils.showNotification('Plantilla Excel generada correctamente.', 'success');
        } catch (error) {
            console.error('Error descargando plantilla:', error);
            Utils.showNotification(error.message || 'Error generando plantilla', 'error');
        }
    },

    showTemplateImportModal() {
        if (!this.canAdministerMenu()) return this.showAdminRequired();
        this.templateImportState = null;

        Utils.showModal('Importar Menú desde Plantilla Oficial', `
            <div class="menu-template-import">
                <div class="menu-template-help">
                    <i class="fas fa-shield-alt"></i>
                    <div>
                        <strong>Importación segura desde plantilla MundiPOS</strong>
                        <p>Solo se aceptan archivos .xlsx generados por el asistente oficial. Primero valida la plantilla, revisa el resumen y luego confirma la importación.</p>
                    </div>
                </div>

                <div class="form-group">
                    <label for="menu-template-import-file">Archivo Excel de plantilla *</label>
                    <input type="file" id="menu-template-import-file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
                    <small class="text-muted">No se eliminan productos existentes. El importador crea o actualiza por coincidencia segura.</small>
                </div>

                <div id="menu-template-import-result" class="menu-template-import-result">
                    <div class="menu-empty-state">
                        <i class="fas fa-file-circle-check"></i>
                        <strong>Selecciona una plantilla y valida antes de importar.</strong>
                    </div>
                </div>
            </div>
        `, [
            { text: 'Cerrar', class: 'btn-light', onclick: 'Utils.hideModal()' },
            { text: '<i class="fas fa-search"></i> Validar plantilla', class: 'btn-secondary', onclick: 'Menu.validateMenuTemplateFile()' },
            { text: '<i class="fas fa-file-import"></i> Importar Menú', class: 'btn-success', align: 'right', onclick: 'Menu.importMenuTemplateFile()' }
        ], 'modal-menu modal-menu-template-import');
    },

    getTemplateImportFile() {
        const input = document.getElementById('menu-template-import-file');
        const file = input?.files?.[0];
        if (!file) throw new Error('Selecciona un archivo .xlsx de plantilla.');
        if (!file.name.toLowerCase().endsWith('.xlsx')) throw new Error('Solo se aceptan archivos .xlsx.');
        return file;
    },

    readTemplateFileAsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = String(reader.result || '');
                resolve(result.includes(',') ? result.split(',')[1] : result);
            };
            reader.onerror = () => reject(new Error('No se pudo leer el archivo seleccionado.'));
            reader.readAsDataURL(file);
        });
    },

    async validateMenuTemplateFile() {
        if (!this.canAdministerMenu()) return this.showAdminRequired();

        try {
            const file = this.getTemplateImportFile();
            const fileBase64 = await this.readTemplateFileAsBase64(file);
            const resultContainer = document.getElementById('menu-template-import-result');
            if (resultContainer) {
                resultContainer.innerHTML = '<div class="menu-empty-state"><i class="fas fa-spinner fa-spin"></i><strong>Validando plantilla...</strong></div>';
            }

            const response = await fetch(`${API_BASE}/menu/template/validate`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'X-MundiPOS-Client': typeof MUNDIPOS_CLIENT_ID !== 'undefined' ? MUNDIPOS_CLIENT_ID : 'menu-template-import'
                },
                body: JSON.stringify({ filename: file.name, file_base64: fileBase64 })
            });

            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'No se pudo validar la plantilla.');

            this.templateImportState = { filename: file.name, file_base64: fileBase64, validation: data };
            if (resultContainer) resultContainer.innerHTML = this.renderTemplateImportResult(data);
            Utils.showNotification(data.can_import ? 'Plantilla válida para importar.' : 'La plantilla tiene errores críticos.', data.can_import ? 'success' : 'warning');
            return data;
        } catch (error) {
            console.error('Error validando plantilla:', error);
            const resultContainer = document.getElementById('menu-template-import-result');
            if (resultContainer) {
                resultContainer.innerHTML = `<div class="alert alert-danger"><i class="fas fa-triangle-exclamation"></i> ${this.escapeHtml(error.message || 'Error validando plantilla')}</div>`;
            }
            Utils.showNotification(error.message || 'Error validando plantilla', 'error');
            return null;
        }
    },

    renderTemplateImportResult(data = {}) {
        const summary = data.summary || {};
        const errors = data.errors || [];
        const warnings = data.warnings || [];
        const cards = [
            ['Categorías', summary.categorias || 0],
            ['Subcategorías', summary.subcategorias || 0],
            ['Tipos/Grupos', summary.tipos_presentacion || 0],
            ['Presentaciones', summary.presentaciones || 0],
            ['Productos', summary.productos || 0],
            ['Prod. con presentación', summary.productos_con_presentacion || 0],
            ['Relaciones precio', summary.producto_presentaciones || 0]
        ];

        return `
            <div class="menu-template-import-summary ${data.can_import ? 'is-valid' : 'has-errors'}">
                <div class="menu-template-import-status">
                    <i class="fas ${data.can_import ? 'fa-circle-check' : 'fa-triangle-exclamation'}"></i>
                    <div>
                        <strong>${data.can_import ? 'Plantilla lista para importar' : 'Plantilla con errores críticos'}</strong>
                        <p>${this.escapeHtml(data.filename || '')}</p>
                    </div>
                </div>
                <div class="menu-template-import-grid">
                    ${cards.map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join('')}
                </div>
                ${errors.length ? `<div class="alert alert-danger"><strong>Errores:</strong><ul>${errors.map(error => `<li>${this.escapeHtml(error)}</li>`).join('')}</ul></div>` : ''}
                ${warnings.length ? `<div class="alert alert-warning"><strong>Advertencias:</strong><ul>${warnings.map(warning => `<li>${this.escapeHtml(warning)}</li>`).join('')}</ul></div>` : ''}
                ${data.can_import ? '<p class="text-muted">Al importar, MundiPOS creará o actualizará registros. No eliminará elementos existentes.</p>' : ''}
            </div>
        `;
    },

    async importMenuTemplateFile() {
        if (!this.canAdministerMenu()) return this.showAdminRequired();

        try {
            if (!this.templateImportState) {
                const validated = await this.validateMenuTemplateFile();
                if (!validated) return;
            }

            if (!this.templateImportState?.validation?.can_import) {
                Utils.showNotification('Corrige los errores de la plantilla antes de importar.', 'warning');
                return;
            }

            const confirmed = confirm('¿Importar esta plantilla al Menú? Se crearán o actualizarán registros, pero no se eliminarán elementos existentes.');
            if (!confirmed) return;

            const response = await fetch(`${API_BASE}/menu/template/import`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'X-MundiPOS-Client': typeof MUNDIPOS_CLIENT_ID !== 'undefined' ? MUNDIPOS_CLIENT_ID : 'menu-template-import'
                },
                body: JSON.stringify({
                    filename: this.templateImportState.filename,
                    file_base64: this.templateImportState.file_base64
                })
            });

            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'No se pudo importar la plantilla.');

            Utils.hideModal();
            await this.load({ includeInactive: true });
            Utils.showNotification('Menú importado correctamente desde plantilla.', 'success');
        } catch (error) {
            console.error('Error importando plantilla:', error);
            Utils.showNotification(error.message || 'Error importando plantilla', 'error');
        }
    },


    normalizeImageUrl(image) {
        if (!image) return '/uploads/ImagenGenerica.jpg';
        if (/^https?:\/\//i.test(image)) return image;
        return image.startsWith('/') ? image : `/${image}`;
    },

    countInactive(items, field = 'activo') {
        return (items || []).filter(item => !this.isActive(item?.[field])).length;
    },

    renderEmptyTable(message, colspan, icon = 'fa-inbox') {
        return `
            <tr>
                <td colspan="${colspan}" class="text-center">
                    <div class="menu-empty-state menu-empty-state-inline">
                        <i class="fas ${icon}"></i>
                        <strong>${this.escapeHtml(message)}</strong>
                    </div>
                </td>
            </tr>
        `;
    },

    getSummaryStats() {
        const productos = this.products || [];
        const categorias = this.categories || [];
        const tipos = this.presentationTypes || [];
        const presentaciones = this.presentations || [];
        const categoriasPrincipales = categorias.filter(cat => cat.tipo === 'principal');
        const subcategorias = categorias.filter(cat => cat.tipo === 'subcategoria');
        const productosConPresentacion = productos.filter(product => Number(product.tiene_presentaciones) === 1 || Number(product.tipo_presentacion_id || 0) > 0).length;
        const productosCocina = productos.filter(product => (product.destino_preparacion || (Number(product.es_cocina) === 1 ? 'cocina' : 'ninguno')) === 'cocina').length;
        const productosBar = productos.filter(product => product.destino_preparacion === 'bar').length;
        const inactiveProducts = this.countInactive(productos, 'activo');
        const inactiveCategories = this.countInactive(categorias, 'activa');
        const inactiveTypes = this.countInactive(tipos, 'activo');
        const inactivePresentations = this.countInactive(presentaciones, 'activo');

        return {
            productos: {
                key: 'products',
                icon: 'fa-utensils',
                label: 'Productos',
                value: productos.length,
                desktopDetail: `${productosConPresentacion} con presentación · ${productosCocina} cocina · ${productosBar} bar`,
                mobileTitle: 'Productos',
                mobileDetail: `${productos.length} producto${productos.length === 1 ? '' : 's'} registrados.`,
                mobileBreakdown: [
                    `${productosConPresentacion} con presentación`,
                    `${productosCocina} de cocina`,
                    `${productosBar} de bar`
                ]
            },
            estructura: {
                key: 'structure',
                icon: 'fa-tags',
                label: 'Estructura',
                value: categoriasPrincipales.length,
                desktopDetail: `${subcategorias.length} subcategoría${subcategorias.length === 1 ? '' : 's'}`,
                mobileTitle: 'Estructura',
                mobileDetail: `${categoriasPrincipales.length} categoría${categoriasPrincipales.length === 1 ? '' : 's'} principales.`,
                mobileBreakdown: [
                    `${subcategorias.length} subcategoría${subcategorias.length === 1 ? '' : 's'}`
                ]
            },
            tipos: {
                key: 'presentation-groups',
                icon: 'fa-layer-group',
                label: 'Tipos/Grupos',
                value: tipos.length,
                desktopDetail: `${presentaciones.length} presentación${presentaciones.length === 1 ? '' : 'es'}`,
                mobileTitle: 'Tipos y Presentaciones',
                mobileDetail: `${tipos.length} tipo/grupo${tipos.length === 1 ? '' : 's'} configurados.`,
                mobileBreakdown: [
                    `${presentaciones.length} presentación${presentaciones.length === 1 ? '' : 'es'}`
                ]
            },
            inactivos: {
                key: 'inactive',
                icon: 'fa-toggle-off',
                label: 'Inactivos',
                value: inactiveProducts + inactiveCategories + inactiveTypes + inactivePresentations,
                desktopDetail: this.canAdministerMenu() ? 'visibles para admin' : 'ocultos en operación',
                mobileTitle: 'Elementos inactivos',
                mobileDetail: `${inactiveProducts + inactiveCategories + inactiveTypes + inactivePresentations} elemento${(inactiveProducts + inactiveCategories + inactiveTypes + inactivePresentations) === 1 ? '' : 's'} inactivo${(inactiveProducts + inactiveCategories + inactiveTypes + inactivePresentations) === 1 ? '' : 's'}.`,
                mobileBreakdown: [
                    `${inactiveProducts} productos`,
                    `${inactiveCategories} categorías/subcategorías`,
                    `${inactiveTypes} tipos/grupos`,
                    `${inactivePresentations} presentaciones`
                ]
            }
        };
    },

    showSummaryCardModal(summaryKey) {
        if (window.innerWidth > 768) return;

        const stats = this.getSummaryStats();
        const summary = Object.values(stats).find(item => item.key === summaryKey);
        if (!summary) return;

        const breakdown = (summary.mobileBreakdown || []).map(item => `<li>${this.escapeHtml(item)}</li>`).join('');

        Utils.showModal(summary.mobileTitle, `
            <div class="menu-summary-modal-content">
                <div class="menu-summary-modal-head">
                    <span class="menu-summary-icon"><i class="fas ${summary.icon}"></i></span>
                    <div>
                        <strong>${summary.value}</strong>
                        <p>${this.escapeHtml(summary.mobileDetail)}</p>
                    </div>
                </div>
                <div class="menu-summary-modal-body">
                    <ul class="menu-summary-modal-list">
                        ${breakdown}
                    </ul>
                </div>
            </div>
        `, [
            {
                text: 'Cerrar',
                class: 'btn-primary'
            }
        ], 'modal-menu modal-menu-narrow');
    },

    renderMenuSummary() {
        const stats = this.getSummaryStats();
        const cards = [stats.productos, stats.estructura, stats.tipos, stats.inactivos];

        return `
            <div class="menu-summary-grid" aria-label="Resumen del menú">
                ${cards.map(card => `
                    <button type="button" class="menu-summary-card menu-summary-card-clickable" onclick="Menu.showSummaryCardModal('${card.key}')">
                        <span class="menu-summary-icon"><i class="fas ${card.icon}"></i></span>
                        <span class="menu-summary-label">${card.label}</span>
                        <strong>${card.value}</strong>
                        <small>${card.desktopDetail}</small>
                    </button>
                `).join('')}
            </div>
        `;
    },

    render() {
        const section = document.getElementById('menu-section');
        if (!section) return;

        section.innerHTML = `
            <div class="section-header menu-section-header">
                <div>
                    <h2>${this.canAdministerMenu() ? 'Gestión de Menú' : 'Consulta de Menú'}</h2>
                    <p>${this.canAdministerMenu() ? 'Administra catálogo, grupos de presentación, precios y disponibilidad operativa' : 'Consulta productos, categorías y presentaciones activas para la operación'}</p>
                </div>
            </div>

            <div class="menu-view-shell">
                <div class="menu-tabs-row internal-tabs" aria-label="Vistas del menú">
                    <button class="btn ${this.currentView === 'products' ? 'btn-primary active' : 'btn-light'}" data-subnav-item="products" onclick="Navigation.selectInternal('menu', 'products')">
                        <i class="fas fa-utensils"></i> Productos
                    </button>
                    <button class="btn ${this.currentView === 'categories' ? 'btn-primary active' : 'btn-light'}" data-subnav-item="categories" onclick="Navigation.selectInternal('menu', 'categories')">
                        <i class="fas fa-tags"></i> Categorías
                    </button>
                    <button class="btn ${this.currentView === 'presentations' ? 'btn-primary active' : 'btn-light'}" data-subnav-item="presentations" onclick="Navigation.selectInternal('menu', 'presentations')">
                        <i class="fas fa-layer-group"></i> Presentaciones
                    </button>
                </div>

                <div class="internal-view-panel menu-panel" data-internal-panel="menu">
                    <div class="menu-actions-bar">
                        <div class="menu-actions-main">
                            ${this.renderCreateAction()}
                        </div>
                    </div>

                    ${this.renderAdminOnlyNotice()}
                    ${this.renderMenuSummary()}

                    ${
                        this.currentView === 'products'
                            ? this.renderProductsView()
                            : this.currentView === 'categories'
                                ? this.renderCategoriesView()
                                : this.renderPresentationsView()
                    }
                </div>
            </div>
        `;
    },

    renderProductsView() {
        return `
            <div class="menu-toolbar">
                <div class="menu-search">
                    <label for="product-search" class="sr-only">Buscar productos</label>
                    <i class="fas fa-search"></i>
                    <input type="text" id="product-search" placeholder="Buscar por nombre o descripción..." onkeyup="Menu.searchProducts(this.value)">
                </div>
            </div>

            <div class="table-container menu-table-card">
                <table class="table menu-table menu-products-table">
                    <thead>
                        <tr>
                            <th>Producto</th>
                            <th>Precio / Presentación</th>
                            <th>Categoría</th>
                            <th>Subcategoría</th>
                            <th>Grupo</th>
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

    renderProductsTable(filteredProducts = null) {
        const products = filteredProducts || this.products || [];
        const canAdmin = this.canAdministerMenu();
        const colspan = canAdmin ? 8 : 7;

        if (products.length === 0) {
            return this.renderEmptyTable('No hay productos configurados', colspan, 'fa-utensils');
        }

        return products.map(product => {
            const imageUrl = this.normalizeImageUrl(product.imagen || product.imagen_url);
            const productName = this.escapeHtml(product.nombre);
            const descripcion = this.escapeHtml(product.descripcion || 'Sin descripción');
            const categoria = this.escapeHtml(product.categoria_nombre || '-');
            const subcategoria = this.escapeHtml(product.subcategoria_nombre || '-');
            const grupo = this.escapeHtml(product.tipo_presentacion_nombre || '-');
            const tienePresentaciones = Number(product.tiene_presentaciones) === 1 || Number(product.tipo_presentacion_id || 0) > 0;

            return `
                <tr${this.rowInactiveClass(product.activo)}>
                    <td>
                        <div class="menu-product-cell">
                            <img src="${imageUrl}" alt="${productName}" class="menu-product-thumb" onerror="this.src='/uploads/ImagenGenerica.jpg'">
                            <div>
                                <strong>${productName}</strong>
                                <small>${descripcion}</small>
                            </div>
                        </div>
                    </td>
                    <td>
                        ${tienePresentaciones
                            ? `<button class="btn-presentaciones" title="Ver presentaciones" onclick="Menu.showPresentacionesModal(${product.id})">
                                    <i class="fas fa-layer-group"></i> Ver presentaciones
                               </button>`
                            : `<span class="menu-price-pill">${Utils.formatCurrency(product.precio)}</span>`
                        }
                    </td>
                    <td>${categoria}</td>
                    <td>${subcategoria}</td>
                    <td>${grupo}</td>
                    <td>
                        ${(product.destino_preparacion || (Number(product.es_cocina) === 1 ? 'cocina' : 'ninguno')) === 'cocina'
                            ? '<span class="badge badge-warning"><i class="fas fa-fire"></i> Cocina</span>'
                            : product.destino_preparacion === 'bar'
                                ? '<span class="badge badge-info"><i class="fas fa-martini-glass"></i> Bar</span>'
                                : '<span class="badge badge-secondary">Ninguno</span>'
                        }
                    </td>
                    <td>${this.renderStatusBadge(product.activo)}</td>
                    ${canAdmin ? `
                        <td>
                            <div class="menu-action-group">
                                <button class="btn btn-secondary btn-sm" onclick="Menu.showEditProductModal(${product.id})" title="Editar producto">
                                    <i class="fas fa-edit"></i>
                                </button>
                                <button class="btn ${this.isActive(product.activo) ? 'btn-warning' : 'btn-success'} btn-sm" onclick="Menu.toggleProductActive(${product.id})" title="${this.isActive(product.activo) ? 'Desactivar producto' : 'Activar producto'}">
                                    <i class="fas ${this.isActive(product.activo) ? 'fa-eye-slash' : 'fa-eye'}"></i>
                                </button>
                            </div>
                        </td>
                    ` : ''}
                </tr>
            `;
        }).join('');
    },

    async searchProducts(query) {
        if (query.length < 2) {
            document.getElementById('products-table-body').innerHTML = this.renderProductsTable();
            return;
        }

        try {
            const inactiveQuery = this.canAdministerMenu() ? '&include_inactive=1' : '';
            const response = await Utils.request(`/menu/products/search?q=${encodeURIComponent(query)}${inactiveQuery}`);
            document.getElementById('products-table-body').innerHTML = this.renderProductsTable(response.data || []);
        } catch (error) {
            console.error('Error buscando productos:', error);
            Utils.showNotification('Error buscando productos', 'error');
        }
    },

    renderCategoriesView() {
        const mainCategories = (this.categories || []).filter(cat => cat.tipo === 'principal');
        const subCategories = (this.categories || []).filter(cat => cat.tipo === 'subcategoria');
        const canAdmin = this.canAdministerMenu();

        const mainRows = mainCategories.length === 0
            ? this.renderEmptyTable('No hay categorías principales configuradas', canAdmin ? 5 : 4, 'fa-tags')
            : mainCategories.map(category => {
                const subCount = subCategories.filter(sub => Number(sub.parent_id) === Number(category.id)).length;
                return `
                    <tr${this.rowInactiveClass(category.activa)}>
                        <td><strong>${this.escapeHtml(category.nombre)}</strong></td>
                        <td>${Number(category.permite_cocina) === 1 ? '<span class="badge badge-success">Sí</span>' : '<span class="badge badge-danger">No</span>'}</td>
                        <td>
                            <div class="menu-subcategory-cell">
                                <span class="menu-subcategory-count">${subCount}</span>
                                ${canAdmin ? `
                                    <button class="btn btn-success btn-sm" onclick="Menu.showCreateSubcategoryModal(${category.id})" ${this.isActive(category.activa) ? '' : 'disabled'} title="Nueva subcategoría">
                                        <i class="fas fa-plus"></i> Sub
                                    </button>
                                ` : ''}
                            </div>
                        </td>
                        <td>${this.renderStatusBadge(category.activa)}</td>
                        ${canAdmin ? `
                            <td>
                                <div class="menu-action-group">
                                    <button class="btn btn-secondary btn-sm" onclick="Menu.showEditCategoryModal(${category.id})" title="Editar categoría">
                                        <i class="fas fa-edit"></i>
                                    </button>
                                    <button class="btn ${this.isActive(category.activa) ? 'btn-warning' : 'btn-success'} btn-sm" onclick="Menu.toggleCategoryActive(${category.id})" title="${this.isActive(category.activa) ? 'Desactivar categoría' : 'Activar categoría'}">
                                        <i class="fas ${this.isActive(category.activa) ? 'fa-eye-slash' : 'fa-eye'}"></i>
                                    </button>
                                </div>
                            </td>
                        ` : ''}
                    </tr>
                `;
            }).join('');

        const subRows = subCategories.length === 0
            ? this.renderEmptyTable('No hay subcategorías configuradas', canAdmin ? 5 : 4, 'fa-sitemap')
            : subCategories.map(subcategory => `
                <tr${this.rowInactiveClass(subcategory.activa)}>
                    <td><strong>${this.escapeHtml(subcategory.nombre)}</strong></td>
                    <td>${this.escapeHtml(subcategory.categoria_padre || '-')}</td>
                    <td>${Number(subcategory.permite_cocina) === 1 ? '<span class="badge badge-success">Sí</span>' : '<span class="badge badge-danger">No</span>'}</td>
                    <td>${this.renderStatusBadge(subcategory.activa)}</td>
                    ${canAdmin ? `
                        <td>
                            <div class="menu-action-group">
                                <button class="btn btn-secondary btn-sm" onclick="Menu.showEditCategoryModal(${subcategory.id})" title="Editar subcategoría">
                                    <i class="fas fa-edit"></i>
                                </button>
                                <button class="btn ${this.isActive(subcategory.activa) ? 'btn-warning' : 'btn-success'} btn-sm" onclick="Menu.toggleCategoryActive(${subcategory.id})" title="${this.isActive(subcategory.activa) ? 'Desactivar subcategoría' : 'Activar subcategoría'}">
                                    <i class="fas ${this.isActive(subcategory.activa) ? 'fa-eye-slash' : 'fa-eye'}"></i>
                                </button>
                            </div>
                        </td>
                    ` : ''}
                </tr>
            `).join('');

        return `
            <div class="categories-grid menu-categories-grid">
                <div class="category-section menu-card-section">
                    <h3><i class="fas fa-tags"></i> Categorías Principales</h3>
                    <div class="table-container menu-table-card">
                        <table class="table menu-table">
                            <thead>
                                <tr>
                                    <th>Nombre</th>
                                    <th>Permite Cocina</th>
                                    <th>Subcategorías</th>
                                    <th>Estado</th>
                                    ${canAdmin ? '<th>Acciones</th>' : ''}
                                </tr>
                            </thead>
                            <tbody>${mainRows}</tbody>
                        </table>
                    </div>
                </div>

                <div class="category-section menu-card-section">
                    <h3><i class="fas fa-sitemap"></i> Subcategorías</h3>
                    <div class="table-container menu-table-card">
                        <table class="table menu-table">
                            <thead>
                                <tr>
                                    <th>Nombre</th>
                                    <th>Categoría Padre</th>
                                    <th>Permite Cocina</th>
                                    <th>Estado</th>
                                    ${canAdmin ? '<th>Acciones</th>' : ''}
                                </tr>
                            </thead>
                            <tbody>${subRows}</tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    },

    renderPresentationsView() {
        const canAdmin = this.canAdministerMenu();
        const tipos = this.presentationTypes || [];
        const presentaciones = this.presentations || [];

        const tiposHtml = tipos.length === 0
            ? this.renderEmptyTable('No hay tipos/grupos de presentación configurados', canAdmin ? 7 : 6, 'fa-layer-group')
            : tipos.map(tipo => `
                <tr${this.rowInactiveClass(tipo.activo)}>
                    <td><strong>${this.escapeHtml(tipo.nombre)}</strong></td>
                    <td>${this.escapeHtml(tipo.categoria_nombre || '-')}</td>
                    <td>${this.escapeHtml(tipo.subcategoria_nombre || '-')}</td>
                    <td>${this.escapeHtml(tipo.descripcion || '-')}</td>
                    <td>${Number(tipo.total_presentaciones || 0)}</td>
                    <td>${this.renderStatusBadge(tipo.activo)}</td>
                    ${canAdmin ? `
                        <td>
                            <div class="menu-action-group">
                                <button class="btn btn-secondary btn-sm" onclick="Menu.showEditPresentationTypeModal(${tipo.id})" title="Editar tipo/grupo">
                                    <i class="fas fa-edit"></i>
                                </button>
                                <button class="btn btn-sm ${this.isActive(tipo.activo) ? 'btn-warning' : 'btn-success'}" onclick="Menu.togglePresentationTypeActive(${tipo.id})" title="${this.isActive(tipo.activo) ? 'Desactivar tipo/grupo' : 'Activar tipo/grupo'}">
                                    <i class="fas ${this.isActive(tipo.activo) ? 'fa-eye-slash' : 'fa-eye'}"></i>
                                </button>
                            </div>
                        </td>
                    ` : ''}
                </tr>
            `).join('');

        const presentacionesHtml = presentaciones.length === 0
            ? this.renderEmptyTable('No hay presentaciones configuradas aún', canAdmin ? 6 : 5, 'fa-box-open')
            : presentaciones.map(pres => `
                <tr${this.rowInactiveClass(pres.activo)}>
                    <td><strong>${this.escapeHtml(pres.nombre)}</strong></td>
                    <td>${this.escapeHtml(pres.cantidad || '-')}</td>
                    <td>${pres.tipo_presentacion_nombre ? this.escapeHtml(pres.tipo_presentacion_nombre) : '<span class="text-muted">Sin grupo / legado</span>'}</td>
                    <td>${this.escapeHtml(pres.tipo || '-')}</td>
                    <td>${this.renderStatusBadge(pres.activo)}</td>
                    ${canAdmin ? `
                        <td>
                            <div class="menu-action-group">
                                <button class="btn btn-secondary btn-sm" onclick="Menu.showEditPresentationModal(${pres.id})" title="Editar presentación">
                                    <i class="fas fa-edit"></i>
                                </button>
                                <button class="btn btn-sm ${this.isActive(pres.activo) ? 'btn-warning' : 'btn-success'}" onclick="Menu.togglePresentationActive(${pres.id})" title="${this.isActive(pres.activo) ? 'Desactivar presentación' : 'Activar presentación'}">
                                    <i class="fas ${this.isActive(pres.activo) ? 'fa-eye-slash' : 'fa-eye'}"></i>
                                </button>
                            </div>
                        </td>
                    ` : ''}
                </tr>
            `).join('');

        return `
            <div class="menu-info-banner">
                <i class="fas fa-layer-group"></i>
                <div>
                    <strong>Tipos/Grupos de presentación</strong>
                    <p>Ordenan las presentaciones por categoría y subcategoría para que cada producto muestre solo opciones válidas.</p>
                </div>
            </div>

            <div class="category-section menu-card-section mb-4">
                <h3><i class="fas fa-layer-group"></i> Tipos/Grupos de presentación</h3>
                <div class="table-container menu-table-card">
                    <table class="table menu-table">
                        <thead>
                            <tr>
                                <th>Grupo</th>
                                <th>Categoría</th>
                                <th>Subcategoría</th>
                                <th>Descripción</th>
                                <th>Presentaciones</th>
                                <th>Estado</th>
                                ${canAdmin ? '<th>Acciones</th>' : ''}
                            </tr>
                        </thead>
                        <tbody>${tiposHtml}</tbody>
                    </table>
                </div>
            </div>

            <div class="category-section menu-card-section">
                <h3><i class="fas fa-box-open"></i> Presentaciones</h3>
                <div class="table-container menu-table-card">
                    <table class="table menu-table">
                        <thead>
                            <tr>
                                <th>Nombre</th>
                                <th>Cantidad / Medida</th>
                                <th>Tipo/Grupo</th>
                                <th>Tipo interno</th>
                                <th>Estado</th>
                                ${canAdmin ? '<th>Acciones</th>' : ''}
                            </tr>
                        </thead>
                        <tbody>${presentacionesHtml}</tbody>
                    </table>
                </div>
            </div>
        `;
    },

    showEditCategoryModal(categoryId) {
        if (!this.canAdministerMenu()) return this.showAdminRequired();
        const category = this.categories.find(cat => Number(cat.id) === Number(categoryId));
        if (!category) return;

        const tipo = category.tipo === 'principal' ? 'Categoría' : 'Subcategoría';
        Utils.showModal(`Editar ${tipo}`, `
            <form id="edit-category-form" class="menu-modern-form">
                <div class="menu-form-grid single">
                    <div class="form-group">
                        <label for="edit-category-nombre">Nombre *</label>
                        <input type="text" id="edit-category-nombre" name="nombre" value="${this.escapeHtml(category.nombre)}" required>
                    </div>
                    ${category.tipo !== 'principal' ? `
                        <div class="form-group">
                            <label>Categoría Padre</label>
                            <input type="text" value="${this.escapeHtml(category.categoria_padre || '')}" readonly>
                        </div>
                    ` : ''}
                    <div class="form-group menu-checkbox-row">
                        <label>
                            <input type="checkbox" id="edit-category-permite-cocina" name="permite_cocina" ${Number(category.permite_cocina) === 1 ? 'checked' : ''}>
                            Permite productos de cocina
                        </label>
                    </div>
                    <div class="form-group menu-checkbox-row">
                        <label>
                            <input type="checkbox" id="edit-category-activa" name="activa" ${this.isActive(category.activa) ? 'checked' : ''}>
                            Activa
                        </label>
                    </div>
                </div>
            </form>
        `, [
            { text: 'Cancelar', class: 'btn-light' },
            { text: 'Guardar Cambios', class: 'btn-primary', onclick: `Menu.updateCategory(${categoryId})` }
        ], 'modal-menu modal-menu-narrow');
    },

    async updateCategory(categoryId) {
        if (!this.canAdministerMenu()) return this.showAdminRequired();
        const form = document.getElementById('edit-category-form');
        if (!Utils.validateForm(form)) {
            Utils.showNotification('Por favor complete todos los campos requeridos', 'warning');
            return;
        }

        const formData = new FormData(form);
        const data = {
            nombre: formData.get('nombre'),
            permite_cocina: formData.get('permite_cocina') === 'on',
            activa: formData.get('activa') === 'on'
        };

        try {
            await Utils.request(`/menu/categories/${categoryId}`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });
            Utils.hideModal();
            Utils.showNotification('Categoría actualizada correctamente', 'success');
            this.load();
        } catch (error) {
            Utils.showNotification(error.message || 'Error al actualizar categoría', 'error');
        }
    },

    showEditPresentationTypeModal(id) {
        if (!this.canAdministerMenu()) return this.showAdminRequired();
        const tipo = this.presentationTypes.find(item => Number(item.id) === Number(id));
        if (!tipo) return;
        const mainCategories = this.categories.filter(cat => cat.tipo === 'principal' && (this.isActive(cat.activa) || Number(cat.id) === Number(tipo.categoria_id)));
        const subcategories = this.categories.filter(cat => Number(cat.parent_id) === Number(tipo.categoria_id) && (this.isActive(cat.activa) || Number(cat.id) === Number(tipo.subcategoria_id)));

        Utils.showModal('Editar Tipo/Grupo de Presentación', `
            <form id="edit-presentation-type-form" class="menu-modern-form">
                <div class="menu-form-grid">
                    <div class="form-group">
                        <label for="edit-presentation-type-nombre">Nombre *</label>
                        <input type="text" id="edit-presentation-type-nombre" name="nombre" value="${this.escapeHtml(tipo.nombre)}" required>
                    </div>
                    <div class="form-group">
                        <label for="edit-presentation-type-categoria">Categoría *</label>
                        <select id="edit-presentation-type-categoria" name="categoria_id" required onchange="Menu.loadSubcategories(this.value, 'edit-presentation-type-subcategoria')">
                            <option value="">Seleccione una categoría</option>
                            ${mainCategories.map(cat => `<option value="${cat.id}" ${Number(cat.id) === Number(tipo.categoria_id) ? 'selected' : ''}>${this.escapeHtml(cat.nombre)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="edit-presentation-type-subcategoria">Subcategoría</label>
                        <select id="edit-presentation-type-subcategoria" name="subcategoria_id">
                            <option value="">Aplica a toda la categoría</option>
                            ${subcategories.map(sub => `<option value="${sub.id}" ${Number(sub.id) === Number(tipo.subcategoria_id) ? 'selected' : ''}>${this.escapeHtml(sub.nombre)}</option>`).join('')}
                        </select>
                        <small class="text-muted">Déjalo vacío si aplica a toda la categoría.</small>
                    </div>
                    <div class="form-group">
                        <label for="edit-presentation-type-descripcion">Descripción</label>
                        <textarea id="edit-presentation-type-descripcion" name="descripcion" rows="2">${this.escapeHtml(tipo.descripcion || '')}</textarea>
                    </div>
                    <div class="form-group menu-checkbox-row">
                        <label>
                            <input type="checkbox" id="edit-presentation-type-activo" name="activo" ${this.isActive(tipo.activo) ? 'checked' : ''}>
                            Activo
                        </label>
                    </div>
                </div>
            </form>
        `, [
            { text: 'Cancelar', class: 'btn-light' },
            { text: 'Guardar Cambios', class: 'btn-primary', onclick: `Menu.updatePresentationType(${id})` }
        ], 'modal-menu');
    },

    async updatePresentationType(id) {
        if (!this.canAdministerMenu()) return this.showAdminRequired();
        const form = document.getElementById('edit-presentation-type-form');
        if (!Utils.validateForm(form)) {
            Utils.showNotification('Por favor complete todos los campos requeridos', 'warning');
            return;
        }

        const formData = new FormData(form);
        const data = {
            nombre: formData.get('nombre'),
            descripcion: formData.get('descripcion') || '',
            categoria_id: parseInt(formData.get('categoria_id')),
            subcategoria_id: formData.get('subcategoria_id') ? parseInt(formData.get('subcategoria_id')) : null,
            activo: formData.get('activo') === 'on'
        };

        try {
            await Utils.request(`/menu/presentation-types/${id}`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });
            Utils.hideModal();
            Utils.showNotification('Tipo/grupo actualizado correctamente', 'success');
            this.load();
        } catch (error) {
            Utils.showNotification(error.message || 'Error al actualizar tipo/grupo', 'error');
        }
    },

    showEditPresentationModal(id) {
        if (!this.canAdministerMenu()) return this.showAdminRequired();
        const pres = this.presentations.find(item => Number(item.id) === Number(id));
        if (!pres) return;
        const activeTypes = (this.presentationTypes || []).filter(tipo => this.isActive(tipo.activo) || Number(tipo.id) === Number(pres.tipo_presentacion_id));

        Utils.showModal('Editar Presentación', `
            <form id="edit-presentation-form" class="menu-modern-form">
                <div class="menu-form-grid">
                    <div class="form-group">
                        <label for="edit-presentation-tipo-presentacion">Tipo/Grupo *</label>
                        <select id="edit-presentation-tipo-presentacion" name="tipo_presentacion_id" required>
                            <option value="">Seleccione un tipo/grupo</option>
                            ${activeTypes.map(tipo => `<option value="${tipo.id}" ${Number(tipo.id) === Number(pres.tipo_presentacion_id) ? 'selected' : ''}>${this.escapeHtml(this.formatPresentationTypeLabel(tipo))}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="edit-presentation-nombre">Nombre *</label>
                        <input type="text" id="edit-presentation-nombre" name="nombre" value="${this.escapeHtml(pres.nombre)}" required>
                    </div>
                    <div class="form-group">
                        <label for="edit-presentation-tipo">Tipo interno</label>
                        <input type="text" id="edit-presentation-tipo" name="tipo" value="${this.escapeHtml(pres.tipo || 'Tamaño')}">
                    </div>
                    <div class="form-group">
                        <label for="edit-presentation-cantidad">Cantidad / Medida *</label>
                        <input type="text" id="edit-presentation-cantidad" name="cantidad" value="${this.escapeHtml(pres.cantidad || '')}" required>
                    </div>
                    <div class="form-group menu-checkbox-row">
                        <label>
                            <input type="checkbox" id="edit-presentation-activo" name="activo" ${this.isActive(pres.activo) ? 'checked' : ''}>
                            Activa
                        </label>
                    </div>
                </div>
            </form>
        `, [
            { text: 'Cancelar', class: 'btn-light' },
            { text: 'Guardar Cambios', class: 'btn-primary', onclick: `Menu.updatePresentation(${id})` }
        ], 'modal-menu');
    },

    async updatePresentation(id) {
        if (!this.canAdministerMenu()) return this.showAdminRequired();
        const form = document.getElementById('edit-presentation-form');
        if (!Utils.validateForm(form)) {
            Utils.showNotification('Por favor complete todos los campos requeridos', 'warning');
            return;
        }

        const formData = new FormData(form);
        const data = {
            nombre: formData.get('nombre'),
            tipo: formData.get('tipo') || 'tamaño',
            cantidad: formData.get('cantidad'),
            tipo_presentacion_id: parseInt(formData.get('tipo_presentacion_id')),
            activo: formData.get('activo') === 'on'
        };

        try {
            await Utils.request(`/menu/presentaciones-globales/${id}`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });
            Utils.hideModal();
            Utils.showNotification('Presentación actualizada correctamente', 'success');
            this.load();
        } catch (error) {
            Utils.showNotification(error.message || 'Error al actualizar presentación', 'error');
        }
    },

    async showPresentacionesModal(productId) {
        try {
            const response = await Utils.request(`/menu/products/${productId}/presentaciones`);
            const data = response.data || response;
            const productoNombre = data.producto_nombre || response.producto_nombre || 'Producto';
            const presentaciones = data.presentaciones || response.presentaciones || [];
            const asignadas = presentaciones.filter(p => Number(p.asignada) === 1);

            if (asignadas.length === 0) {
                Utils.showNotification('Este producto no tiene presentaciones asignadas.', 'info');
                return;
            }

            const contenido = `
                <div class="presentaciones-modal menu-presentations-detail">
                    <div class="menu-info-banner compact">
                        <i class="fas fa-box-open"></i>
                        <div>
                            <strong>${this.escapeHtml(productoNombre)}</strong>
                            <p>${asignadas.length} presentación${asignadas.length === 1 ? '' : 'es'} asignada${asignadas.length === 1 ? '' : 's'}.</p>
                        </div>
                    </div>
                    <table class="table menu-table">
                        <thead>
                            <tr>
                                <th>Imagen</th>
                                <th>Presentación</th>
                                <th>Cantidad</th>
                                <th>Grupo</th>
                                <th>Precio</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${asignadas.map(p => `
                                <tr>
                                    <td><img src="${this.normalizeImageUrl(p.imagen || p.imagen_url)}" alt="${this.escapeHtml(p.nombre)}" class="menu-presentation-thumb" onerror="this.src='/uploads/ImagenGenerica.jpg'"></td>
                                    <td><strong>${this.escapeHtml(p.nombre)}</strong></td>
                                    <td>${this.escapeHtml(p.cantidad || '-')}</td>
                                    <td>${this.escapeHtml(p.tipo_presentacion_nombre || '-')}</td>
                                    <td>${Utils.formatCurrency ? Utils.formatCurrency(p.precio) : `₡${parseFloat(p.precio || 0).toFixed(2)}`}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;

            Utils.showModal('Presentaciones del producto', contenido, [
                { text: 'Cerrar', class: 'btn-primary' }
            ], 'modal-menu');
        } catch (error) {
            console.error('Error al cargar presentaciones:', error);
            Utils.showNotification('Error al cargar presentaciones del producto.', 'error');
        }
    },

};
