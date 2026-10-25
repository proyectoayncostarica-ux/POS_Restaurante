'use strict';

// PROTOTIPO / DATOS TEMPORALES. Solo memoria de esta página; recargar reinicia
// el catálogo DEMO. Sin HTTP, almacenamiento persistente ni conexión al POS.
const Products = (() => {
  const TYPES = ['Insumo', 'Compra y venta directa', 'Producto elaborado', 'Consumible no vendible'];
  const UNITS = ['Unidad', 'Botella', 'Gramo', 'Kilogramo', 'Mililitro', 'Litro', 'Porción'];
  const SECTIONS = ['Resumen', 'Productos', 'Inventario', 'Compras', 'Proveedores'];
  const TABS = ['Resumen', 'Inventario', 'Costos y precio', 'Compras', 'Historial'];
  const sellable = type => ['Compra y venta directa', 'Producto elaborado'].includes(type);
  const products = [
    { id: 'imperial', name: 'Cerveza Imperial 350 ml', type: TYPES[1], unit: 'Botella', presentation: 'Caja', quantity: 24, cost: 19200, target: 55, price: 1800, state: 'Activo' },
    { id: 'carne', name: 'Carne molida', type: TYPES[0], unit: 'Gramo', presentation: 'Kilogramo', quantity: 1000, cost: 5200, target: null, price: null, state: 'Activo' },
    { id: 'hamburguesa', name: 'Hamburguesa Clásica', type: TYPES[2], unit: 'Porción', presentation: 'Porción', quantity: 1, cost: 1800, target: 60, price: 4500, state: 'Activo' },
    { id: 'servilletas', name: 'Servilletas blancas', type: TYPES[3], unit: 'Unidad', presentation: 'Paquete', quantity: 100, cost: 950, target: null, price: null, state: 'Inactivo' }
  ];
  let nextId = 1;
  let search = '';
  let feedback = '';
  let submitted = false;
  const numberFormat = new Intl.NumberFormat('es-CR', { maximumFractionDigits: 2 });
  // Mantiene el separador de miles visible del shell (₡1.800) incluso en
  // navegadores cuyo locale es-CR utiliza espacios no separables.
  const formatNumber = value => numberFormat.formatToParts(value).map(part => part.type === 'group' ? '.' : part.value).join('');
  const money = value => Number.isFinite(value) ? `₡${formatNumber(value)}` : 'No aplica';
  const percent = value => Number.isFinite(value) ? `${formatNumber(value)} %` : 'No aplica';
  const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const link = (section = 'Productos', extra = {}) => `#productos?${new URLSearchParams({ destino: section, ...extra })}`;

  // Funciones puras: margen bruto sobre venta, nunca markup. Los cálculos
  // conservan precisión; solo se redondea al mostrar o al usar el sugerido.
  function calculate(product) {
    const unitCost = Number.isFinite(product.cost) && product.cost >= 0 && Number.isFinite(product.quantity) && product.quantity > 0
      ? product.cost / product.quantity : null;
    const suggested = sellable(product.type) && Number.isFinite(unitCost) && Number.isFinite(product.target) && product.target >= 0 && product.target < 100
      ? unitCost / (1 - product.target / 100) : null;
    const margin = sellable(product.type) && Number.isFinite(unitCost) && Number.isFinite(product.price) && product.price > 0
      ? (product.price - unitCost) / product.price * 100 : null;
    return { unitCost, suggested, margin };
  }

  function validate(product) {
    const errors = {};
    if (!product.name.trim()) errors.name = 'Escribe el nombre del producto.';
    if (!TYPES.includes(product.type)) errors.type = 'Selecciona un tipo de producto.';
    if (!UNITS.includes(product.unit)) errors.unit = 'Selecciona la unidad base.';
    if (!product.presentation.trim()) errors.presentation = 'Indica la presentación de compra.';
    if (!Number.isFinite(product.quantity) || product.quantity <= 0) errors.quantity = 'El contenido debe ser mayor que 0, en unidades base.';
    if (!Number.isFinite(product.cost) || product.cost < 0) errors.cost = 'Indica un costo mayor o igual a 0.';
    if (sellable(product.type)) {
      if (!Number.isFinite(product.target) || product.target < 0 || product.target >= 100) errors.target = 'Usa un margen desde 0 y menor que 100 %.';
      if (!Number.isFinite(product.price) || product.price < 0) errors.price = 'Indica un precio mayor o igual a 0.';
    }
    if (!['Activo', 'Inactivo'].includes(product.state)) errors.state = 'Selecciona un estado válido.';
    const values = calculate(product);
    if (Number.isFinite(product.cost) && product.quantity > 0 && !Number.isFinite(values.unitCost)) errors.quantity = 'El contenido no permite calcular un costo válido.';
    if (sellable(product.type) && Number.isFinite(values.unitCost) && product.target >= 0 && product.target < 100 && !Number.isFinite(values.suggested)) errors.target = 'El margen no permite calcular un precio válido.';
    return errors;
  }

  const badge = state => `<span class="badge product-state ${state === 'Activo' ? 'is-active' : 'is-inactive'}">${state}</span>`;
  const options = values => `<option value="">Seleccionar…</option>${values.map(value => `<option>${value}</option>`).join('')}`;
  const presentationText = product => `${escapeHTML(product.presentation)} × ${formatNumber(product.quantity)} · ${escapeHTML(product.unit)}`;
  const recipeNote = product => product.type === TYPES[2] ? '<p class="product-note">Receta pendiente de implementación. El costo de esta ficha es una referencia manual de demostración.</p>' : '';

  function render(params) {
    const entity = params.get('entidad');
    const product = entity && products.find(item => item.id === entity || item.name === entity);
    const requested = params.get('destino');
    const section = entity ? 'Productos' : SECTIONS.includes(requested) ? requested : 'Productos';
    main.innerHTML = `<nav class="breadcrumbs" aria-label="Ubicación"><a href="#inicio">Inicio</a><span aria-hidden="true">/</span><span>Productos e Inventario</span></nav>
      <div class="page-heading"><div><span class="eyebrow">CATÁLOGO Y ABASTECIMIENTO</span><h1>Productos e Inventario</h1><p>Una ficha por producto, desde su compra hasta su precio.</p></div><span class="version-label">Prototipo <span>v0.1</span></span></div>
      <nav class="department-nav" aria-label="Secciones de Productos e Inventario">${SECTIONS.map(item => `<a href="${link(item)}"${section === item ? ' aria-current="page"' : ''}>${item}</a>`).join('')}</nav>
      <div class="demo-notice product-demo">${icon('info')}<span><strong>Datos temporales de demostración.</strong> Se reinician al recargar. Sin stock real ni conexión al POS.</span></div>
      <div id="product-content"></div>`;
    const content = document.getElementById('product-content');
    if (section !== 'Productos') {
      content.innerHTML = `<section class="surface product-placeholder"><span class="badge">Pendiente de implementación</span><h2>${section}</h2><p>Esta sección todavía no está disponible. Puedes explorar el catálogo de productos.</p><a class="secondary-button" href="${link()}">Ver productos ${icon('arrow')}</a></section>`;
    } else if (entity) {
      if (product) renderDetail(content, product, params.get('pestana'));
      else content.innerHTML = `<section class="surface product-placeholder"><h2>Producto no disponible</h2><p>Los productos creados en el prototipo se pierden al recargar la página.</p><a class="secondary-button" href="${link()}">Volver a productos</a></section>`;
    } else if (params.get('vista') === 'nuevo') renderForm(content);
    else renderList(content);
  }

  function renderList(content) {
    content.innerHTML = `<div class="section-heading product-heading"><div><h2>Productos <span class="count">${products.length}</span></h2><p>Consulta insumos, productos de venta y consumibles.</p></div><a class="primary-button" href="${link('Productos', { vista: 'nuevo' })}">+ Nuevo producto</a></div>
      ${feedback ? `<p class="product-success" role="status">${icon('check')}${escapeHTML(feedback)}</p>` : ''}
      <section class="surface product-list" aria-label="Listado de productos"><div class="product-toolbar"><div class="product-search">${icon('search')}<label class="sr-only" for="product-search">Buscar productos</label><input id="product-search" type="search" placeholder="Buscar por nombre, tipo o presentación…" value="${escapeHTML(search)}" autocomplete="off" maxlength="160"></div><span id="product-count" role="status"></span></div>
      <div class="product-table-scroll" tabindex="0" role="region" aria-label="Tabla de productos; desplazamiento horizontal disponible"><table class="product-table"><caption class="sr-only">Productos de demostración y sus costos y precios en colones costarricenses</caption><thead><tr><th scope="col">Producto / presentación</th><th scope="col">Estado</th><th scope="col">Tipo</th><th scope="col">Unidad base</th><th scope="col" class="numeric">Costo unit.</th><th scope="col" class="numeric">Precio venta</th><th scope="col" class="numeric">Margen actual</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead><tbody id="product-rows"></tbody></table></div><p class="table-note">Margen bruto sobre venta · Costos y precios de demostración · Sin existencias reales</p></section>`;
    feedback = '';
    renderRows();
  }

  function renderRows() {
    const filtered = products.filter(product => normalize(`${product.name} ${product.type} ${product.presentation}`).includes(normalize(search.trim())));
    document.getElementById('product-count').textContent = `${filtered.length} de ${products.length} productos`;
    document.getElementById('product-rows').innerHTML = filtered.length ? filtered.map(product => {
      const values = calculate(product);
      return `<tr><th scope="row"><a class="product-name" href="${link('Productos', { entidad: product.id })}">${escapeHTML(product.name)}</a><small>${presentationText(product)}</small></th><td>${badge(product.state)}</td><td class="product-type">${escapeHTML(product.type)}</td><td>${escapeHTML(product.unit)}</td><td class="numeric">${money(values.unitCost)}</td><td class="numeric">${money(product.price)}</td><td class="numeric${values.margin < 0 ? ' negative-margin' : ''}">${percent(values.margin)}</td><td><a class="row-action" href="${link('Productos', { entidad: product.id })}" aria-label="Ver ${escapeHTML(product.name)}">Ver ${icon('arrow')}</a></td></tr>`;
    }).join('') : '<tr><td colspan="8" class="product-empty">No encontramos productos con ese criterio.</td></tr>';
  }

  function renderForm(content) {
    submitted = false;
    const field = (name, label, control, hint = '') => `<div class="product-field"><label for="product-${name}">${label}</label>${control}${hint ? `<small id="hint-${name}">${hint}</small>` : ''}<span class="field-error" id="error-${name}"></span></div>`;
    const input = (name, attrs, hint = false) => `<input id="product-${name}" name="${name}" ${attrs} aria-describedby="${hint ? `hint-${name} ` : ''}error-${name}">`;
    const select = (name, values) => `<select id="product-${name}" name="${name}" required aria-describedby="error-${name}">${options(values)}</select>`;
    content.innerHTML = `<div class="section-heading product-heading"><div><a class="back-link" href="${link()}">← Volver a productos</a><h2>Nuevo producto</h2><p>Define su unidad base, costo y precio. Todos los campos habilitados son obligatorios.</p></div></div>
      <form id="product-form" class="surface product-form" novalidate><div class="product-form-layout"><div class="product-form-fields">
      <fieldset><legend>Información del producto</legend><div class="product-fields-grid">
        ${field('name', 'Nombre', input('name', 'type="text" maxlength="120" required autocomplete="off"'))}
        ${field('type', 'Tipo de producto', select('type', TYPES))}
        ${field('unit', 'Unidad base', select('unit', UNITS))}
        ${field('state', 'Estado', `<select id="product-state" name="state" aria-describedby="error-state"><option>Activo</option><option>Inactivo</option></select>`)}
      </div></fieldset>
      <fieldset><legend>Presentación habitual de compra</legend><div class="product-fields-grid">
        ${field('presentation', 'Presentación', input('presentation', 'type="text" maxlength="80" placeholder="Ej.: Caja, Kilogramo, Paquete" required'))}
        ${field('quantity', 'Cantidad contenida', input('quantity', 'type="number" min="0.000001" step="any" placeholder="24" required', true), 'En unidades base: caja = 24 botellas; kilogramo = 1.000 gramos.')}
        ${field('cost', 'Costo de presentación (₡)', input('cost', 'type="number" min="0" step="any" placeholder="19200" required', true), 'Escribe el importe sin separadores de miles. Ej.: 19200.')}
      </div></fieldset>
      <fieldset><legend>Costos y precio</legend><p id="sale-hint" class="field-section-hint">Elige el tipo. El precio de venta aplica a compra y venta directa y a productos elaborados.</p><div class="product-fields-grid">
        ${field('target', 'Margen objetivo (%)', input('target', 'type="number" min="0" max="99.99" step="any" placeholder="55" disabled', true), 'Margen bruto sobre venta: desde 0 y menor que 100 %.')}
        ${field('price', 'Precio de venta (₡)', input('price', 'type="number" min="0" step="any" placeholder="1800" disabled', true), 'Lo decides tú. El sugerido no sustituye este precio.')}
      </div></fieldset></div>
      <aside class="product-calculation" aria-label="Cálculo de costo y precio"><span class="eyebrow">CÁLCULO EN VIVO</span><h3>Del costo al precio</h3><dl><div><dt>Costo unitario</dt><dd id="calc-unit">—</dd></div><div><dt>Precio sugerido</dt><dd id="calc-suggested">—</dd></div></dl><button type="button" class="secondary-button" id="use-suggested" disabled>Usar sugerido</button><p>Solo esta acción copia el sugerido al precio de venta.</p><dl><div><dt>Precio de venta</dt><dd id="calc-price">—</dd></div><div><dt>Margen actual</dt><dd id="calc-margin">—</dd></div></dl><small>Margen bruto sobre venta = (precio − costo unitario) / precio.<br>Con precio 0, el margen no se puede calcular.</small><p id="form-recipe-note" hidden>Receta pendiente de implementación. El costo ingresado es una referencia manual.</p></aside></div>
      <div class="product-form-actions"><span id="product-form-status" role="status">Se guardará solo en esta sesión.</span><a class="secondary-button" href="${link()}">Cancelar</a><button class="primary-button" type="submit">Guardar producto</button></div></form>`;
  }

  function readForm(form) {
    const value = name => form.elements.namedItem(name).value.trim();
    const numeric = name => value(name) === '' ? NaN : Number(value(name));
    const type = value('type');
    return { name: value('name'), type, unit: value('unit'), presentation: value('presentation'), quantity: numeric('quantity'), cost: numeric('cost'), target: sellable(type) ? numeric('target') : null, price: sellable(type) ? numeric('price') : null, state: value('state') };
  }

  function showErrors(form, errors) {
    for (const name of ['name', 'type', 'unit', 'presentation', 'quantity', 'cost', 'target', 'price', 'state']) {
      form.elements.namedItem(name).setAttribute('aria-invalid', errors[name] ? 'true' : 'false');
      document.getElementById(`error-${name}`).textContent = errors[name] || '';
    }
    document.getElementById('product-form-status').textContent = Object.keys(errors).length ? 'Revisa los campos indicados antes de guardar.' : 'Se guardará solo en esta sesión.';
  }

  function updateCalculation(form) {
    const product = readForm(form);
    const canSell = sellable(product.type);
    for (const name of ['target', 'price']) {
      form.elements.namedItem(name).disabled = !canSell;
      form.elements.namedItem(name).required = canSell;
    }
    document.getElementById('sale-hint').textContent = canSell ? 'Margen bruto sobre venta. El sugerido es una referencia; tú decides el precio final.' : 'El precio de venta y el margen no aplican a insumos ni a consumibles no vendibles.';
    document.getElementById('form-recipe-note').hidden = product.type !== TYPES[2];
    const values = calculate(product);
    document.getElementById('calc-unit').textContent = Number.isFinite(values.unitCost) ? money(values.unitCost) : '—';
    document.getElementById('calc-suggested').textContent = canSell ? Number.isFinite(values.suggested) ? money(values.suggested) : '—' : 'No aplica';
    document.getElementById('calc-price').textContent = canSell ? Number.isFinite(product.price) && product.price >= 0 ? money(product.price) : '—' : 'No aplica';
    document.getElementById('calc-margin').textContent = canSell ? Number.isFinite(values.margin) ? percent(values.margin) : 'Sin calcular' : 'No aplica';
    document.getElementById('use-suggested').disabled = !Number.isFinite(values.suggested);
    if (submitted) showErrors(form, validate(product));
  }

  function renderDetail(content, product, requestedTab) {
    const tab = TABS.includes(requestedTab) ? requestedTab : 'Resumen';
    const values = calculate(product);
    const item = (label, value) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
    const costs = `${item('Costo de presentación', money(product.cost))}${item('Costo unitario', money(values.unitCost))}${item('Margen objetivo', percent(product.target))}${item('Precio sugerido', money(values.suggested))}${item('Precio de venta', money(product.price))}${item('Margen actual', percent(values.margin))}`;
    content.innerHTML = `<a class="back-link" href="${link()}">← Volver a productos</a><div class="product-entity-heading"><div><span class="eyebrow">FICHA DE PRODUCTO · DEMO</span><h2>${escapeHTML(product.name)}</h2><p>${escapeHTML(product.type)}</p></div>${badge(product.state)}</div>
      <section class="surface product-detail"><nav class="entity-nav" aria-label="Secciones de la ficha">${TABS.map(item => `<a href="${link('Productos', { entidad: product.id, pestana: item })}"${tab === item ? ' aria-current="page"' : ''}>${item}</a>`).join('')}</nav>
      ${tab === 'Resumen' ? `<h3>Resumen del producto</h3><dl class="product-facts">${item('Nombre', escapeHTML(product.name))}${item('Estado', badge(product.state))}${item('Tipo', escapeHTML(product.type))}${item('Unidad base', escapeHTML(product.unit))}${item('Presentación habitual', presentationText(product))}${costs}</dl>${recipeNote(product)}` : tab === 'Costos y precio' ? `<h3>Costos y precio</h3><p class="field-section-hint">${presentationText(product)} · Importes en colones costarricenses</p><dl class="product-facts cost-facts">${costs}</dl><p class="product-note">El precio sugerido es una referencia independiente del precio de venta.<br>Margen bruto sobre venta = (precio − costo unitario) / precio. Si el precio es 0, el margen no se puede calcular.<br>Sin historial real de costos.</p>${recipeNote(product)}` : `<div class="product-placeholder"><span class="badge">Pendiente de implementación</span><h3>${tab}</h3><p>${tab === 'Inventario' ? 'El inventario pertenecerá a esta misma ficha. Todavía no hay stock ni movimientos reales.' : 'Esta sección todavía no está disponible. No se han realizado operaciones.'}</p></div>`}</section>`;
  }

  function bind(container) {
    container.addEventListener('input', event => {
      if (event.target.id === 'product-search') { search = event.target.value; renderRows(); }
      const form = event.target.closest('#product-form');
      if (form) updateCalculation(form);
    });
    container.addEventListener('change', event => {
      const form = event.target.closest('#product-form');
      if (form) updateCalculation(form);
    });
    container.addEventListener('click', event => {
      if (!event.target.closest('#use-suggested')) return;
      const form = document.getElementById('product-form');
      const suggested = calculate(readForm(form)).suggested;
      if (Number.isFinite(suggested)) {
        form.elements.namedItem('price').value = suggested.toFixed(2);
        updateCalculation(form);
        form.elements.namedItem('price').focus();
      }
    });
    container.addEventListener('submit', event => {
      if (event.target.id !== 'product-form') return;
      event.preventDefault();
      const form = event.target;
      const product = readForm(form);
      const errors = validate(product);
      submitted = true;
      showErrors(form, errors);
      if (Object.keys(errors).length) { form.elements.namedItem(Object.keys(errors)[0]).focus(); return; }
      products.unshift({ ...product, id: `temporal-${nextId++}` });
      search = '';
      feedback = `Producto «${product.name}» creado en esta sesión de demostración.`;
      location.hash = link();
    });
  }

  return Object.freeze({ render, bind, calculate, validate });
})();
