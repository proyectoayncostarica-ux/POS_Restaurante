'use strict';

// PROTOTIPO / DATOS TEMPORALES: saldo inicial DEMO + movimientos en memoria.
// Recargar reinicia niveles y movimientos. Sin persistencia, HTTP ni POS.
const Inventory = (() => {
  // Configuración explícita por ID del catálogo único de Products. El tipo
  // no determina el control de inventario. Productos nuevos: no controlados.
  const configurations = new Map([
    ['imperial', { inventoryTracked: true, initial: 48, minimum: 24, target: 72, maximum: 120, allowFractions: false }],
    ['carne', { inventoryTracked: true, initial: 5000, minimum: 6000, target: 10000, maximum: 15000, allowFractions: true }],
    ['hamburguesa', { inventoryTracked: false }],
    ['servilletas', { inventoryTracked: false }]
  ]);
  const movements = [];
  const MOVEMENT_TYPES = ['Entrada manual', 'Salida manual', 'Ajuste positivo', 'Ajuste negativo'];
  const STATES = ['Inconsistencia', 'Sin existencias', 'Bajo mínimo', 'Por reponer', 'En objetivo', 'Sobre máximo'];
  // Precisión del prototipo fraccionable: milésimas de unidad base. La suma
  // en enteros evita residuos como 0,1 + 0,2 - 0,3 en los saldos.
  const SCALE = 1000;
  const scaled = value => Math.round(value * SCALE);
  const representable = value => Number.isFinite(value) && Number.isSafeInteger(scaled(value)) && scaled(value) / SCALE === value;
  let sequence = 0;
  let search = '';
  let filter = 'Todos';
  let feedback = '';
  let submitted = false;
  const formatter = new Intl.NumberFormat('es-CR', { maximumFractionDigits: 3 });
  const formatQuantity = value => Number.isFinite(value) ? formatter.formatToParts(value).map(part => part.type === 'group' ? '.' : part.value).join('') : '—';
  const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const listLink = '#productos?destino=Inventario';
  const productLink = (id, extra = {}) => `#productos?${new URLSearchParams({ destino: 'Productos', entidad: id, pestana: 'Inventario', ...extra })}`;
  const entriesFor = id => movements.filter(entry => entry.productId === id);

  // Cálculos y validaciones separados del DOM. Nunca se recorta el negativo.
  const calculateBalance = (initial, entries) => entries.reduce((sum, entry) => sum + scaled(entry.delta), scaled(initial)) / SCALE;
  function calculateState(balance, levels) {
    if (balance < 0) return 'Inconsistencia';
    if (balance === 0) return 'Sin existencias';
    if (balance < levels.minimum) return 'Bajo mínimo';
    if (balance < levels.target) return 'Por reponer';
    if (balance <= levels.maximum) return 'En objetivo';
    return 'Sobre máximo';
  }
  function calculateDelta(type, quantity) {
    if (!MOVEMENT_TYPES.includes(type) || !Number.isFinite(quantity) || quantity <= 0) return NaN;
    return (type === 'Salida manual' || type === 'Ajuste negativo' ? -1 : 1) * quantity;
  }
  function validateLevels(levels, config) {
    const errors = {};
    for (const name of ['minimum', 'target', 'maximum']) {
      const value = levels[name];
      if (!representable(value) || value < 0) errors[name] = 'Usa un número no negativo, con hasta 3 decimales y dentro del rango admitido.';
      else if (!config.allowFractions && !Number.isInteger(value)) errors[name] = 'Esta unidad requiere un nivel entero.';
    }
    if (!errors.minimum && !errors.target && levels.target < levels.minimum) errors.target = 'El objetivo debe ser mayor o igual al mínimo.';
    if (!errors.target && !errors.maximum && levels.maximum < levels.target) errors.maximum = 'El máximo debe ser mayor o igual al objetivo.';
    return errors;
  }
  function validateMovement(input, config, current) {
    const errors = {};
    if (!MOVEMENT_TYPES.includes(input.type)) errors.type = 'Selecciona un tipo de movimiento.';
    if (!Number.isFinite(input.quantity) || input.quantity <= 0) errors.quantity = 'La cantidad debe ser un número finito mayor que 0.';
    else if (!config.allowFractions && !Number.isInteger(input.quantity)) errors.quantity = 'Esta unidad solo admite cantidades enteras; no se permiten fracciones de botella.';
    else if (!representable(input.quantity)) errors.quantity = 'Usa hasta 3 decimales y una cantidad dentro del rango admitido.';
    if (!input.note || !input.note.trim()) errors.note = 'Escribe el motivo o nota del movimiento.';
    if (!errors.quantity && !errors.type && !Number.isSafeInteger(scaled(current) + scaled(calculateDelta(input.type, input.quantity)))) errors.quantity = 'El saldo resultante excede el rango admitido.';
    return errors;
  }
  function getSnapshot(id) {
    const product = Products.getAll().find(item => item.id === id);
    if (!product) return null;
    const config = configurations.get(id) || { inventoryTracked: false };
    if (!config.inventoryTracked) return { product, ...config, state: 'No controlado' };
    const balance = calculateBalance(config.initial, entriesFor(id));
    return { product, ...config, balance, state: calculateState(balance, config) };
  }
  const snapshots = () => Products.getAll().map(product => getSnapshot(product.id));
  function recordMovement(id, input) {
    const snapshot = getSnapshot(id);
    if (!snapshot?.inventoryTracked) return { errors: { type: 'Este producto no tiene control de existencias configurado.' } };
    const errors = validateMovement(input, snapshot, snapshot.balance);
    if (Object.keys(errors).length) return { errors };
    movements.push(Object.freeze({ id: ++sequence, productId: id, type: input.type, quantity: input.quantity, delta: calculateDelta(input.type, input.quantity), note: input.note.trim(), createdAt: new Date().toISOString() }));
    return { errors: {}, snapshot: getSnapshot(id) };
  }
  function setLevels(id, levels) {
    const snapshot = getSnapshot(id);
    if (!snapshot?.inventoryTracked) return { errors: { minimum: 'Este producto no tiene control de existencias configurado.' } };
    const errors = validateLevels(levels, snapshot);
    if (Object.keys(errors).length) return { errors };
    configurations.set(id, { ...configurations.get(id), minimum: levels.minimum, target: levels.target, maximum: levels.maximum });
    return { errors: {}, snapshot: getSnapshot(id) };
  }
  function historyFor(id) {
    const initial = configurations.get(id)?.initial;
    let sum = scaled(initial);
    return entriesFor(id).map(entry => {
      sum += scaled(entry.delta);
      return { ...entry, resultingBalance: sum / SCALE };
    }).reverse();
  }
  function alerts() {
    return snapshots().filter(item => item.inventoryTracked && ['Inconsistencia', 'Sin existencias', 'Bajo mínimo'].includes(item.state)).map(item => ({
      tone: item.state === 'Bajo mínimo' ? 'warning' : 'critical', state: item.state, icon: 'box', title: item.state === 'Inconsistencia' ? 'Inconsistencia de inventario' : 'Inventario bajo',
      entity: item.product.name, detail: `${formatQuantity(item.balance)} · ${item.product.unit} (existencia teórica DEMO)`, note: `Mínimo: ${formatQuantity(item.minimum)} · ${item.product.unit}`,
      href: productLink(item.product.id), action: 'Revisar inventario'
    }));
  }

  // Vistas y eventos se mantienen en este módulo; comparten el modelo anterior.
  const badge = state => `<span class="badge inventory-state inventory-state-${STATES.indexOf(state)}"><span aria-hidden="true">${({ Inconsistencia: '!', 'Sin existencias': '○', 'Bajo mínimo': '↓', 'Por reponer': '↗', 'En objetivo': '✓', 'Sobre máximo': '↑' })[state] || '—'}</span> ${escapeHTML(state)}</span>`;
  const signed = value => `${value > 0 ? '+' : ''}${formatQuantity(value)}`;
  const actionButton = (id, view, label, returnTo = 'ficha') => `<button type="button" class="secondary-button inventory-action" data-inventory-product="${escapeHTML(id)}" data-inventory-view="${view}" data-inventory-return="${returnTo}">${label}</button>`;
  const notice = () => {
    const html = feedback ? `<p class="product-success" role="status">${icon('check')}${escapeHTML(feedback)}</p>` : '';
    feedback = '';
    return html;
  };

  function renderList(content) {
    const controlled = snapshots().filter(item => item.inventoryTracked);
    const indicators = [['Productos controlados', controlled.length], ...['Bajo mínimo', 'Sin existencias', 'Inconsistencia'].map(state => [state === 'Inconsistencia' ? 'Inconsistencias' : state, controlled.filter(item => item.state === state).length])];
    content.innerHTML = `<div class="section-heading product-heading"><div><h2>Inventario</h2><p>Existencias teóricas DEMO y niveles por producto. Las cantidades cambian mediante movimientos.</p></div></div>${notice()}
      <dl class="inventory-indicators" aria-label="Indicadores de inventario">${indicators.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>
      <section class="surface product-list" aria-label="Listado de inventario"><div class="product-toolbar inventory-toolbar"><div class="product-search">${icon('search')}<label class="sr-only" for="inventory-search">Buscar inventario</label><input id="inventory-search" type="search" placeholder="Buscar por producto, tipo o unidad…" value="${escapeHTML(search)}" maxlength="160" autocomplete="off"></div><div class="inventory-filter"><label for="inventory-filter">Estado de inventario</label><select id="inventory-filter">${['Todos', ...STATES, 'No controlado'].map(state => `<option${state === filter ? ' selected' : ''}>${state}</option>`).join('')}</select></div><button type="button" class="secondary-button" id="inventory-clear">Limpiar filtros</button><span id="inventory-count" role="status"></span></div>
      <div class="product-table-scroll" tabindex="0" role="region" aria-label="Tabla de inventario; desplazamiento horizontal disponible"><table class="product-table inventory-table"><caption class="sr-only">Existencias teóricas y niveles DEMO por producto</caption><thead><tr>${['Producto', 'Tipo', 'Existencia', 'Unidad', 'Mínimo', 'Objetivo', 'Máximo', 'Estado', 'Acciones'].map((label, index) => `<th scope="col"${[2, 4, 5, 6].includes(index) ? ' class="numeric"' : ''}>${label}</th>`).join('')}</tr></thead><tbody id="inventory-rows"></tbody></table></div><p class="table-note">Saldo inicial DEMO + movimientos de esta sesión · Sin conteo físico ni integración con el POS</p></section>`;
    renderRows();
  }
  function renderRows() {
    const all = snapshots();
    const filtered = all.filter(item => (filter === 'Todos' || item.state === filter) && normalize(`${item.product.name} ${item.product.type} ${item.product.unit}`).includes(normalize(search.trim())));
    document.getElementById('inventory-count').textContent = `${filtered.length} de ${all.length} productos`;
    document.getElementById('inventory-rows').innerHTML = filtered.length ? filtered.map(item => `<tr><th scope="row"><a class="product-name" href="${productLink(item.product.id)}">${escapeHTML(item.product.name)}</a><small>${item.inventoryTracked ? 'Control de existencias DEMO' : 'Sin configuración de control'}</small></th><td class="product-type">${escapeHTML(item.product.type)}</td><td class="numeric${item.balance < 0 ? ' negative-margin' : ''}"><strong>${formatQuantity(item.balance)}</strong></td><td>${escapeHTML(item.product.unit)}</td>${['minimum', 'target', 'maximum'].map(name => `<td class="numeric">${formatQuantity(item[name])}</td>`).join('')}<td>${badge(item.state)}</td><td class="inventory-row-actions"><a class="row-action" href="${productLink(item.product.id)}" aria-label="Ver inventario de ${escapeHTML(item.product.name)}">Ver</a>${item.inventoryTracked ? actionButton(item.product.id, 'movimiento', 'Registrar movimiento', 'lista') : ''}</td></tr>`).join('') : '<tr><td colspan="9" class="product-empty">No encontramos productos con esos criterios.</td></tr>';
  }
  function renderHistory(snapshot) {
    const history = historyFor(snapshot.product.id);
    return `<div class="section-heading inventory-history-heading"><h3>Historial temporal <span class="count">${history.length}</span></h3><span class="section-hint">Más reciente primero · Solo esta sesión</span></div>
      <p class="inventory-initial">Saldo inicial DEMO: <strong>${formatQuantity(snapshot.initial)} · ${escapeHTML(snapshot.product.unit)}</strong>. Punto de partida ilustrativo; no representa una compra ni un conteo físico.</p>
      <div class="product-table-scroll" tabindex="0" role="region" aria-label="Historial de movimientos"><table class="product-table inventory-history"><caption class="sr-only">Movimientos manuales de esta sesión</caption><thead><tr><th scope="col">Fecha / hora</th><th scope="col">Tipo</th><th scope="col" class="numeric">Cantidad / delta</th><th scope="col">Motivo / nota</th><th scope="col" class="numeric">Saldo resultante</th></tr></thead><tbody>${history.length ? history.map(entry => `<tr><td>${escapeHTML(new Date(entry.createdAt).toLocaleString('es-CR'))}</td><td>${entry.type}</td><td class="numeric">${signed(entry.delta)} · ${escapeHTML(snapshot.product.unit)}</td><td class="inventory-note-cell">${escapeHTML(entry.note)}</td><td class="numeric${entry.resultingBalance < 0 ? ' negative-margin' : ''}">${formatQuantity(entry.resultingBalance)} · ${escapeHTML(snapshot.product.unit)}</td></tr>`).join('') : '<tr><td colspan="5" class="product-empty">Todavía no hay movimientos en esta sesión.</td></tr>'}</tbody></table></div>`;
  }
  function renderProduct(content, product, params) {
    const snapshot = getSnapshot(product.id);
    if (!snapshot.inventoryTracked) {
      content.innerHTML = `<div class="product-placeholder">${badge('No controlado')}<h3>Inventario</h3><p>Este producto no tiene control de existencias configurado en este prototipo.</p></div>`;
      return;
    }
    const view = params.get('vista');
    if (view === 'movimiento' || view === 'niveles') { renderForm(content, snapshot, view, params.get('volver')); return; }
    content.innerHTML = `${notice()}<div class="section-heading inventory-detail-heading"><div><h3>Inventario del producto</h3><p>Existencia teórica de demostración · ${snapshot.allowFractions ? 'Admite fracciones (hasta 3 decimales)' : 'Solo unidades enteras'}</p></div><div class="inventory-detail-actions">${actionButton(product.id, 'niveles', 'Configurar niveles')}${actionButton(product.id, 'movimiento', 'Registrar movimiento')}</div></div>
      <dl class="product-facts inventory-facts"><div><dt>Existencia actual (teórica)</dt><dd class="inventory-balance${snapshot.balance < 0 ? ' negative-margin' : ''}">${formatQuantity(snapshot.balance)}</dd></div><div><dt>Unidad base</dt><dd>${escapeHTML(product.unit)}</dd></div><div><dt>Estado de inventario</dt><dd>${badge(snapshot.state)}</dd></div>${[['minimum', 'Mínimo'], ['target', 'Objetivo'], ['maximum', 'Máximo']].map(([name, label]) => `<div><dt>${label}</dt><dd>${formatQuantity(snapshot[name])}</dd></div>`).join('')}</dl>
      ${snapshot.balance < 0 ? '<p class="inventory-warning" role="alert"><strong>Inconsistencia administrativa.</strong> La existencia negativa se conserva para su revisión.</p>' : ''}${renderHistory(snapshot)}`;
  }
  function renderForm(content, snapshot, view, returnTo) {
    submitted = false;
    const movement = view === 'movimiento';
    const back = returnTo === 'lista' ? listLink : productLink(snapshot.product.id);
    const field = (name, label, control, hint = '') => `<div class="product-field"><label for="inventory-${name}">${label}</label>${control}${hint ? `<small id="inventory-hint-${name}">${hint}</small>` : ''}<span class="field-error" id="inventory-error-${name}"></span></div>`;
    const quantityHint = snapshot.allowFractions ? 'Cantidad mayor que 0. Hasta 3 decimales. Sin separadores de miles.' : 'Cantidad entera mayor que 0. No se permiten fracciones de botella.';
    const numeric = (name, value = '', hint = false) => `<input id="inventory-${name}" name="${name}" type="number" min="0" step="${snapshot.allowFractions ? '0.001' : '1'}" value="${value}" required aria-describedby="${hint ? `inventory-hint-${name} ` : ''}inventory-error-${name}">`;
    content.innerHTML = `<a class="back-link" href="${back}">← ${returnTo === 'lista' ? 'Volver al inventario' : 'Volver al inventario del producto'}</a><h3 class="inventory-form-title">${movement ? 'Registrar movimiento' : 'Configurar niveles'}</h3>
      <form id="inventory-form" class="product-form inventory-form" data-product="${escapeHTML(snapshot.product.id)}" data-view="${view}" data-return="${returnTo === 'lista' ? 'lista' : 'ficha'}" novalidate><div class="product-form-layout"><div class="product-form-fields"><div class="product-fields-grid">
      ${field('product', 'Producto', `<input id="inventory-product" value="${escapeHTML(snapshot.product.name)}" readonly>`)}
      ${field('unit', 'Unidad base', `<input id="inventory-unit" value="${escapeHTML(snapshot.product.unit)}" readonly>`)}
      ${movement ? `${field('type', 'Tipo de movimiento', `<select id="inventory-type" name="type" required aria-describedby="inventory-error-type"><option value="">Seleccionar…</option>${MOVEMENT_TYPES.map(type => `<option>${type}</option>`).join('')}</select>`)}${field('quantity', 'Cantidad', numeric('quantity', '', true), quantityHint)}<div class="inventory-field-wide">${field('note', 'Motivo / nota', '<textarea id="inventory-note" name="note" rows="3" maxlength="240" required aria-describedby="inventory-error-note"></textarea>')}</div>` : [['minimum', 'Mínimo'], ['target', 'Objetivo'], ['maximum', 'Máximo']].map(([name, label]) => field(name, label, numeric(name, snapshot[name]))).join('')}
      </div>${movement ? '' : '<p class="product-note">Mínimo ≥ 0 · Objetivo ≥ mínimo · Máximo ≥ objetivo. Guardar niveles no cambia la existencia ni registra un movimiento.</p>'}</div>
      <aside class="product-calculation inventory-preview" aria-label="${movement ? 'Previsualización del movimiento' : 'Existencia sin cambios'}"><span class="eyebrow">${movement ? 'ANTES DE REGISTRAR' : 'PARÁMETROS ADMINISTRATIVOS'}</span><h3>${movement ? 'Efecto en existencias' : 'Solo cambian los niveles'}</h3><dl><div><dt>Existencia actual</dt><dd>${formatQuantity(snapshot.balance)} <small>${escapeHTML(snapshot.product.unit)}</small></dd></div>${movement ? '<div><dt>Movimiento</dt><dd id="inventory-preview-delta">—</dd></div><div><dt>Nueva existencia</dt><dd id="inventory-preview-balance">—</dd></div>' : ''}</dl>${movement ? '<div id="inventory-preview-state"></div><p>La cantidad registrada se suma o resta al saldo inicial DEMO y los movimientos previos.</p>' : '<p>No se modifica el saldo inicial ni el historial.</p>'}</aside></div>
      ${movement ? '<div class="inventory-warning" id="inventory-negative-warning" role="alert" hidden><strong>Este movimiento dejará una existencia negativa.</strong><p>Se registrará como una inconsistencia administrativa. Puedes continuar.</p></div>' : ''}
      <div class="product-form-actions"><span id="inventory-form-status" role="status">${movement ? 'Movimiento temporal. Motivo obligatorio.' : 'Niveles temporales; sin movimiento de stock.'}</span><a class="secondary-button" href="${back}">Cancelar</a><button type="submit" class="primary-button">${movement ? 'Registrar movimiento' : 'Guardar niveles'}</button></div></form>`;
  }
  function readForm(form) {
    const numeric = name => form.elements.namedItem(name).value.trim() === '' ? NaN : Number(form.elements.namedItem(name).value);
    return form.dataset.view === 'movimiento' ? { type: form.elements.namedItem('type').value, quantity: numeric('quantity'), note: form.elements.namedItem('note').value } : { minimum: numeric('minimum'), target: numeric('target'), maximum: numeric('maximum') };
  }
  function showErrors(form, errors) {
    const fields = form.dataset.view === 'movimiento' ? ['type', 'quantity', 'note'] : ['minimum', 'target', 'maximum'];
    fields.forEach(name => {
      form.elements.namedItem(name).setAttribute('aria-invalid', errors[name] ? 'true' : 'false');
      document.getElementById(`inventory-error-${name}`).textContent = errors[name] || '';
    });
    document.getElementById('inventory-form-status').textContent = Object.keys(errors).length ? 'Revisa los campos indicados antes de guardar.' : 'Cambios temporales; se reinician al recargar.';
  }
  function updateForm(form) {
    const snapshot = getSnapshot(form.dataset.product);
    const input = readForm(form);
    const movement = form.dataset.view === 'movimiento';
    const errors = movement ? validateMovement(input, snapshot, snapshot.balance) : validateLevels(input, snapshot);
    if (movement) {
      const valid = !errors.type && !errors.quantity;
      const delta = valid ? calculateDelta(input.type, input.quantity) : NaN;
      const next = valid ? calculateBalance(snapshot.balance, [{ delta }]) : NaN;
      document.getElementById('inventory-preview-delta').textContent = valid ? `${signed(delta)} · ${snapshot.product.unit}` : '—';
      document.getElementById('inventory-preview-balance').textContent = valid ? `${formatQuantity(next)} · ${snapshot.product.unit}` : '—';
      document.getElementById('inventory-preview-state').innerHTML = valid ? badge(calculateState(next, snapshot)) : '';
      document.getElementById('inventory-negative-warning').hidden = !(next < 0);
    }
    if (submitted) showErrors(form, errors);
  }
  function bind(container) {
    container.addEventListener('input', event => {
      if (event.target.id === 'inventory-search') { search = event.target.value; renderRows(); }
      const form = event.target.closest('#inventory-form');
      if (form) updateForm(form);
    });
    container.addEventListener('change', event => {
      if (event.target.id === 'inventory-filter') { filter = event.target.value; renderRows(); }
      const form = event.target.closest('#inventory-form');
      if (form) updateForm(form);
    });
    container.addEventListener('click', event => {
      const action = event.target.closest('[data-inventory-view]');
      if (action) location.hash = productLink(action.dataset.inventoryProduct, { vista: action.dataset.inventoryView, volver: action.dataset.inventoryReturn });
      if (event.target.id === 'inventory-clear') {
        search = ''; filter = 'Todos';
        document.getElementById('inventory-search').value = '';
        document.getElementById('inventory-filter').value = filter;
        renderRows(); document.getElementById('inventory-search').focus();
      }
    });
    container.addEventListener('submit', event => {
      if (event.target.id !== 'inventory-form') return;
      event.preventDefault();
      const form = event.target;
      const movement = form.dataset.view === 'movimiento';
      submitted = true;
      updateForm(form);
      const result = movement ? recordMovement(form.dataset.product, readForm(form)) : setLevels(form.dataset.product, readForm(form));
      showErrors(form, result.errors);
      if (Object.keys(result.errors).length) { form.elements.namedItem(Object.keys(result.errors)[0]).focus(); return; }
      feedback = movement ? `Movimiento registrado en esta sesión. ${result.snapshot.product.name}: ${formatQuantity(result.snapshot.balance)} · ${result.snapshot.product.unit} (${result.snapshot.state}).` : 'Niveles actualizados en esta sesión. La existencia y el historial no cambiaron.';
      if (form.dataset.return === 'lista') { search = ''; filter = 'Todos'; }
      location.hash = form.dataset.return === 'lista' ? listLink : productLink(form.dataset.product);
    });
  }

  return Object.freeze({ renderList, renderProduct, bind, alerts, getSnapshot, historyFor, recordMovement, setLevels, calculateBalance, calculateState, calculateDelta, validateLevels, validateMovement, formatQuantity });
})();
