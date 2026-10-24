'use strict';

// DEMO / PROTOTIPO VISUAL: todos los datos ficticios se concentran aquí.
// No hay APIs, autenticación, persistencia ni acciones de negocio.
const DEMO = Object.freeze({
  overview: 'Una mirada al negocio, con lo importante primero.',
  alerts: [
    { tone: 'critical', state: 'Crítico', icon: 'box', title: 'Inventario bajo', entity: 'Carne molida', detail: '3,8 kg disponibles', note: 'Mínimo: 8 kg', department: 'productos', destination: 'Inventario', action: 'Revisar inventario' },
    { tone: 'warning', state: 'Advertencia', icon: 'wallet', title: 'Cierre de caja incompleto', entity: 'Caja principal', detail: 'Cierre de ayer pendiente', note: 'Diferencia: -₡1.500', department: 'finanzas', destination: 'Caja y cierres', action: 'Revisar cierre' },
    { tone: 'info', state: 'Informativo', icon: 'people', title: 'Planilla pendiente', entity: 'Periodo 1–15', detail: '3 incidencias pendientes', note: 'Revisión antes de procesar', department: 'personal', destination: 'Planilla', action: 'Revisar planilla' }
  ],
  indicators: [
    { label: 'Ventas hoy', value: '₡1.250.000', icon: 'trend', note: 'Resumen de ventas' },
    { label: 'Personal activo', value: '10 / 12', icon: 'people', note: 'Equipo de hoy' },
    { label: 'Mesas abiertas', value: '8', icon: 'table', note: 'Actividad del establecimiento' },
    { label: 'Cajas abiertas', value: '2', icon: 'wallet', note: 'Jornada actual' }
  ],
  upcoming: [
    { when: 'Mañana', title: 'Pago proveedor ABC', context: 'Finanzas · Proveedores' },
    { when: 'En 2 días', title: 'Cierre de planilla', context: 'Personal · Planilla' },
    { when: 'Viernes', title: 'Conteo de bodega', context: 'Productos e Inventario' }
  ],
  activity: [
    { title: 'Compra recibida', detail: 'Insumos de cocina · Recepción registrada', when: 'Hace 12 min', icon: 'box' },
    { title: 'Precio programado', detail: 'Actualización de catálogo para mañana', when: 'Hace 35 min', icon: 'tag' },
    { title: 'Planilla aprobada', detail: 'Periodo anterior · Revisión completada', when: 'Hace 1 h', icon: 'people' },
    { title: 'Caja cerrada', detail: 'Caja secundaria · Jornada anterior', when: 'Ayer', icon: 'wallet' }
  ],
  shortcuts: [
    { label: 'Nueva compra', icon: 'box', department: 'productos', destination: 'Compras' },
    { label: 'Registrar gasto', icon: 'wallet', department: 'finanzas', destination: 'Gastos' },
    { label: 'Revisar inventario', icon: 'layers', department: 'productos', destination: 'Inventario' },
    { label: 'Procesar planilla', icon: 'people', department: 'personal', destination: 'Planilla' }
  ]
});

const DEPARTMENTS = {
  inicio: { title: 'Inicio', icon: 'home' },
  productos: { title: 'Productos e Inventario', icon: 'box', description: 'Catálogo, existencias y compras del negocio.' },
  personal: { title: 'Personal', icon: 'people', description: 'Información administrativa del equipo y planilla.' },
  finanzas: { title: 'Finanzas', icon: 'wallet', description: 'Gestión financiera, gastos y cierres del negocio.' },
  negocio: { title: 'Negocio', icon: 'building', description: 'Información y herramientas de gestión del establecimiento.' },
  analisis: { title: 'Análisis', icon: 'trend', description: 'Reportes e indicadores para entender el negocio.' },
  configuracion: { title: 'Configuración', icon: 'settings', description: 'Preferencias del entorno administrativo.' }
};

const ICONS = {
  home: '<path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7"/>',
  box: '<path d="m3 7 9-4 9 4v10l-9 4-9-4Z"/><path d="m3 7 9 4 9-4M12 11v10M7 5l10 4"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v3"/>',
  wallet: '<rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 8V5a2 2 0 0 1 2-2h12M21 11h-6v4h6"/>',
  building: '<path d="M5 21V3h14v18M3 21h18M9 7h1m4 0h1M9 11h1m4 0h1M10 21v-6h4v6"/>',
  trend: '<path d="M3 3v18h18M6 15l5-5 4 3 6-8M16 5h5v5"/>',
  settings: '<path d="m9 3-1 3-3 1-2 4 2 2v4l4 2 3-1 3 1 4-2v-4l2-2-2-4-3-1-1-3Z"/><circle cx="12" cy="11" r="3"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  table: '<rect x="3" y="5" width="18" height="10" rx="2"/><path d="M6 15v5m12-5v5M3 10h18"/>',
  layers: '<path d="m2 7 10-5 10 5-10 5ZM2 12l10 5 10-5M2 17l10 5 10-5"/>',
  tag: '<path d="M3 3h8l10 10-8 8L3 11Z"/><circle cx="7.5" cy="7.5" r="1"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
  alert: '<path d="m12 3 10 18H2Z"/><path d="M12 9v5m0 3v1"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  tools: '<path d="m5 3 4 4-2 3-4-4a6 6 0 0 0 7 7l7 7a2 2 0 0 0 3-3l-7-7a6 6 0 0 0-7-7"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.info}</svg>`;
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const route = (department, destination = '', entity = '') => `#${department}${destination ? `?destino=${encodeURIComponent(destination)}${entity ? `&entidad=${encodeURIComponent(entity)}` : ''}` : ''}`;
const main = document.getElementById('main');
const demoLabel = '<span class="demo-label">DEMO</span>';

function renderNavigation(current) {
  document.getElementById('navigation').innerHTML = Object.entries(DEPARTMENTS).map(([id, item]) => `<a class="nav-link${id === current ? ' active' : ''}${id === 'configuracion' ? ' nav-settings' : ''}" href="#${id}"${id === current ? ' aria-current="page"' : ''}>${icon(item.icon)}<span>${item.title}</span>${id === current ? '<span class="active-dot" aria-hidden="true"></span>' : ''}</a>`).join('');
}

function renderHome() {
  main.innerHTML = `
    <div class="page-heading"><div><span class="eyebrow">PANORAMA DEL NEGOCIO</span><h1>Inicio</h1><p>${DEMO.overview}</p></div><span class="version-label">Vista de demostración <span>v0.1</span></span></div>
    <div class="demo-notice">${icon('info')}<span><strong>Estás explorando un prototipo visual.</strong> Todos los datos son de demostración. Ninguna acción modifica el negocio.</span></div>
    <section class="attention-section" aria-labelledby="attention-title">
      <div class="section-heading"><h2 id="attention-title">Requiere atención <span class="count">${DEMO.alerts.length}</span></h2><span class="section-hint">Selecciona una alerta para revisar su destino ${demoLabel}</span></div>
      <div class="attention-grid">${DEMO.alerts.map(item => `<a class="attention-card ${item.tone}" href="${route(item.department, item.destination, item.entity)}"><div class="alert-top"><span class="card-icon">${icon(item.icon)}</span><span class="badge">${icon(item.tone === 'info' ? 'info' : 'alert')}${item.state}</span></div><h3>${item.title}</h3><strong class="entity">${item.entity}</strong><p>${item.detail}</p><small>${item.note}</small><div class="card-action">${item.action}${icon('arrow')}</div></a>`).join('')}</div>
    </section>
    <section class="today-section" aria-labelledby="today-title"><div class="section-heading"><h2 id="today-title">Hoy</h2><span class="section-hint">Indicadores de ejemplo ${demoLabel}</span></div><div class="kpi-grid">${DEMO.indicators.map(item => `<article class="kpi-card"><span class="kpi-icon">${icon(item.icon)}</span><div><h3>${item.label}</h3><strong>${item.value}</strong><small>${item.note}</small></div></article>`).join('')}</div></section>
    <div class="overview-grid">
      <section class="surface activity" aria-labelledby="activity-title"><div class="section-heading"><div><h2 id="activity-title">Actividad reciente</h2><p>Resumen ilustrativo de novedades; no es un registro de auditoría.</p></div>${demoLabel}</div><ul class="activity-list">${DEMO.activity.map(item => `<li><span class="activity-icon">${icon(item.icon)}</span><div><strong>${item.title}</strong><p>${item.detail}</p></div><span class="activity-time">${item.when}</span></li>`).join('')}</ul></section>
      <section class="surface upcoming" aria-labelledby="upcoming-title"><div class="section-heading"><h2 id="upcoming-title">Próximamente</h2>${demoLabel}</div><ul>${DEMO.upcoming.map(item => `<li><span class="schedule-marker" aria-hidden="true"></span><div><small>${item.when}</small><strong>${item.title}</strong><p>${item.context}</p></div></li>`).join('')}</ul><div class="quiet-note">${icon('clock')} Agenda ilustrativa del negocio</div></section>
    </div>
    <section class="quick-section" aria-labelledby="quick-title"><div class="section-heading"><h2 id="quick-title">Accesos rápidos</h2><span class="section-hint">Solo navegación de demostración ${demoLabel}</span></div><div class="quick-grid">${DEMO.shortcuts.map(item => `<a class="quick-link" href="${route(item.department, item.destination)}"><span>${icon(item.icon)}</span>${item.label}${icon('arrow')}</a>`).join('')}</div></section>`;
}

function renderPlaceholder(id, params) {
  const department = DEPARTMENTS[id];
  const destination = params.get('destino');
  const entity = params.get('entidad');
  main.innerHTML = `<nav class="breadcrumbs" aria-label="Ubicación"><a href="#inicio">Inicio</a><span aria-hidden="true">/</span><span aria-current="page">${department.title}</span></nav><div class="page-heading"><div><span class="eyebrow">MUNDIPOS ADMINISTRACIÓN</span><h1>${department.title}</h1><p>${department.description}</p></div><span class="version-label">Prototipo visual <span>v0.1</span></span></div><section class="surface construction"><span class="construction-icon">${icon('tools')}</span><span class="badge info">${icon('info')} En construcción</span><h2>Módulo en construcción</h2><p>Esta sección todavía no está implementada. Por ahora puedes explorar la navegación y la base visual de Administración.</p>${destination ? `<div class="destination"><span>Destino solicitado desde Inicio</span><strong>${escapeHTML(destination)}${entity ? ` <span aria-hidden="true">→</span> ${escapeHTML(entity)}` : ''}</strong><small>La función todavía no está implementada. No se ha realizado ninguna operación.</small></div>` : ''}<a class="primary-button" href="#inicio">${icon('home')} Volver a Inicio</a></section>`;
}

function render() {
  const [requested = 'inicio', query = ''] = location.hash.slice(1).split('?');
  const id = Object.hasOwn(DEPARTMENTS, requested) ? requested : 'inicio';
  renderNavigation(id);
  if (id === 'inicio') renderHome(); else renderPlaceholder(id, new URLSearchParams(query));
  document.title = `${DEPARTMENTS[id].title} · MundiPOS Administración`;
  document.getElementById('search-status').hidden = true;
}

document.getElementById('search-icon').innerHTML = icon('search');
document.getElementById('search-form').addEventListener('submit', event => {
  event.preventDefault();
  const status = document.getElementById('search-status');
  status.hidden = false;
  status.textContent = 'Búsqueda global todavía no implementada. No se consultaron datos.';
});
document.getElementById('global-search').addEventListener('input', () => {
  document.getElementById('search-status').hidden = true;
});
window.addEventListener('hashchange', () => { render(); main.focus(); window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); });
render();
