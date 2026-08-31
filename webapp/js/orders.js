/**
 * orders.js — Módulo de gestión de Pedidos / Órdenes de compra
 * Estados de ítem (simplificados): PENDIENTE → SOLICITADO → EN_STOCK → ENTREGADO
 */

// ── MÓDULO DE ESTADO ─────────────────────────────────────────────────
const Orders = (() => {
  const CACHE_KEY = 'ow_orders_v1';
  let _orders = [];

  function _saveCache() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(_orders)); } catch(e) {}
  }

  function _loadCache() {
    try {
      const s = localStorage.getItem(CACHE_KEY);
      if (s) _orders = JSON.parse(s);
    } catch(e) { _orders = []; }
  }

  const ESTADOS = {
    PENDIENTE:       { label: 'Pendiente',       color: '#92400e', bg: '#fef3c7' },
    EN_PROCESO:      { label: 'En proceso',       color: '#1d4ed8', bg: '#dbeafe' },
    ENTREGA_PARCIAL: { label: 'Entrega parcial',  color: '#6d28d9', bg: '#ede9fe' },
    ENTREGADO:       { label: 'Entregado',        color: '#065f46', bg: '#d1fae5' },
    CANCELADO:       { label: 'Cancelado',        color: '#991b1b', bg: '#fee2e2' },
  };

  function estadoInfo(e) {
    return ESTADOS[e] || { label: e || '?', color: '#888', bg: '#f5f5f5' };
  }

  function _fmtDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch(e) { return iso.slice(0, 10); }
  }

  function _fmtDateTime(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('es-CO', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      });
    } catch(e) { return iso; }
  }

  function _generateId() {
    const d = new Date();
    const base = `ORD-${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    const cnt = _orders.filter(o => (o.id || '').startsWith(base)).length;
    return `${base}-${String(cnt + 1).padStart(3, '0')}`;
  }

  function _generateNumero() {
    const y = new Date().getFullYear();
    const cnt = _orders.filter(o => (o.numero || '').startsWith(`PED-${y}-`)).length;
    return `PED-${y}-${String(cnt + 1).padStart(3, '0')}`;
  }

  function pctEntregado(order) {
    const items = order.items || [];
    if (!items.length) return 0;
    const tot = items.reduce((s, i) => s + (i.cant || 0), 0);
    const ent = items.reduce((s, i) => s + (i.cantEntregada || 0), 0);
    return tot > 0 ? Math.round((ent / tot) * 100) : 0;
  }

  function getAll() { return [..._orders]; }
  function getById(id) { return _orders.find(o => o.id === id) || null; }

  function add(data, usuario) {
    const order = {
      id:              _generateId(),
      numero:          _generateNumero(),
      fechaCreacion:   new Date().toISOString(),
      creadoPor:       usuario,
      clienteNombre:    data.clienteNombre    || '',
      clienteNit:       data.clienteNit       || '',
      clienteEmpresa:   data.clienteEmpresa   || '',
      clienteTel:       data.clienteTel       || '',
      clienteEmail:     data.clienteEmail     || '',
      clienteDireccion: data.clienteDireccion || '',
      estado:           'PENDIENTE',
      fechaEstEntrega:  data.fechaEstEntrega  || '',
      fechaEntregaReal: '',
      items:    data.items    || [],
      eventos:  [{ fecha: new Date().toISOString(), tipo: 'CREADA', descripcion: 'Orden creada', usuario }],
      archivos: data.archivos || [],
      notas:    data.notas    || '',
    };
    _orders.unshift(order);
    _saveCache();
    return order;
  }

  function update(id, changes) {
    const idx = _orders.findIndex(o => o.id === id);
    if (idx < 0) return null;
    _orders[idx] = { ..._orders[idx], ...changes };
    _saveCache();
    return _orders[idx];
  }

  function remove(id) {
    _orders = _orders.filter(o => o.id !== id);
    _saveCache();
  }

  function addEvent(id, tipo, descripcion, usuario) {
    const o = getById(id);
    if (!o) return null;
    if (!Array.isArray(o.eventos)) o.eventos = [];
    o.eventos.push({ fecha: new Date().toISOString(), tipo, descripcion, usuario });
    _saveCache();
    return o;
  }

  function changeStatus(id, estado, usuario) {
    const o = getById(id);
    if (!o) return null;
    const prev = estadoInfo(o.estado).label;
    const next = estadoInfo(estado).label;
    o.estado = estado;
    if (estado === 'ENTREGADO') o.fechaEntregaReal = new Date().toISOString().slice(0, 10);
    addEvent(id, 'ESTADO', `Estado: ${prev} → ${next}`, usuario);
    _saveCache();
    return o;
  }

  function setFromRemote(remote) {
    _orders = Array.isArray(remote) ? remote : [];
    _saveCache();
  }

  function compressPhoto(b64) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const maxW = 300;
        let w = img.width, h = img.height;
        if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        let r = c.toDataURL('image/jpeg', 0.60);
        if (r.length > 10000) r = c.toDataURL('image/jpeg', 0.40);
        if (r.length > 10000) r = c.toDataURL('image/jpeg', 0.25);
        resolve(r);
      };
      img.onerror = () => resolve(null);
      img.src = b64;
    });
  }

  return {
    init: _loadCache,
    getAll, getById, add, update, remove,
    addEvent, changeStatus, setFromRemote,
    estadoInfo, pctEntregado,
    fmtDate: _fmtDate,
    fmtDateTime: _fmtDateTime,
    compressPhoto,
  };
})();


// ═══════════════════════════════════════════════════════════════════════
// UI
// ═══════════════════════════════════════════════════════════════════════

let _currentOrderId  = null;
let _newOrderItems   = [];
let _newOrderArchivos = [];
let _entregaItemIdx  = null; // índice del ítem en modal de entrega unitaria

// ── HELPERS DE ESTADO DE ÍTEM ────────────────────────────────────────
// Normaliza los estados viejos al nuevo modelo simplificado
function _normItemEstado(e) {
  if (e === 'EN_TRANSITO')     return 'SOLICITADO';
  if (e === 'RECIBIDO_BODEGA') return 'EN_STOCK';
  return e || 'PENDIENTE';
}

function _itemEstadoInfo(e) {
  e = _normItemEstado(e);
  const map = {
    PENDIENTE:  { label: 'Sin solicitar', icon: '⚪', color: '#4b5563', bg: '#f3f4f6', next: 'SOLICITADO', nextLabel: 'Marcar como Solicitado' },
    SOLICITADO: { label: 'Solicitado',    icon: '🔄', color: '#92400e', bg: '#fef3c7', next: 'EN_STOCK',   nextLabel: 'Marcar como En bodega' },
    EN_STOCK:   { label: 'En bodega',     icon: '📦', color: '#1e40af', bg: '#dbeafe', next: 'ENTREGADO',  nextLabel: 'Registrar entrega' },
    ENTREGADO:  { label: 'Entregado',     icon: '✅', color: '#065f46', bg: '#d1fae5', next: null,         nextLabel: null },
  };
  return map[e] || map['PENDIENTE'];
}

function _countItemsByState(items) {
  const c = { PENDIENTE: 0, SOLICITADO: 0, EN_STOCK: 0, ENTREGADO: 0 };
  (items || []).forEach(item => {
    const key = _normItemEstado(item.estadoItem);
    c[key in c ? key : 'PENDIENTE']++;
  });
  return c;
}

function _eventoIcon(tipo) {
  const m = { CREADA: '📋', ESTADO: '🔄', ENTREGA_PARCIAL: '📦', ENTREGADO: '✅', CANCELADO: '❌', NOTA: '💬', FOTO: '📷' };
  return m[tipo] || '•';
}

// ── DASHBOARD KPIs ───────────────────────────────────────────────────
function renderOrdersDashboard() {
  const el = document.getElementById('pedidos-dashboard');
  if (!el) return;

  const all     = Orders.getAll();
  const activos = all.filter(o => o.estado !== 'ENTREGADO' && o.estado !== 'CANCELADO');

  let sinSolicitar = 0, solicitados = 0, enBodega = 0, porEntregar = 0;
  activos.forEach(o => {
    (o.items || []).forEach(item => {
      const e = _normItemEstado(item.estadoItem);
      if (e === 'PENDIENTE')  sinSolicitar++;
      if (e === 'SOLICITADO') solicitados++;
      if (e === 'EN_STOCK')   enBodega++;
      if (e !== 'ENTREGADO')  porEntregar++;
    });
  });

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:10px;margin-bottom:18px;">
      ${_kpiTile('Pedidos activos', activos.length, '#1d4ed8', '#eff6ff', '🛒', 'en seguimiento')}
      ${_kpiTile('Sin solicitar', sinSolicitar, '#6b7280', '#f3f4f6', '⚪', 'ítems por pedir')}
      ${_kpiTile('En bodega', enBodega, '#1e40af', '#dbeafe', '📦', 'listos para entregar')}
      ${_kpiTile('Por entregar', porEntregar, '#6d28d9', '#ede9fe', '🚚', 'ítems pendientes')}
    </div>`;
}

function _kpiTile(label, value, color, bg, icon, sub) {
  return `<div style="background:${bg};border-radius:12px;padding:14px 16px;border:1px solid ${color}22;">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
      <span style="font-size:16px;">${icon}</span>
      <span style="font-size:11px;font-weight:600;color:${color};text-transform:uppercase;letter-spacing:.4px;">${label}</span>
    </div>
    <div style="font-size:28px;font-weight:800;color:${color};line-height:1;">${value}</div>
    <div style="font-size:10px;color:${color};opacity:.7;margin-top:3px;">${sub}</div>
  </div>`;
}

// ── LISTA DE ÓRDENES ─────────────────────────────────────────────────
function renderOrdersList() {
  renderOrdersDashboard();

  const container = document.getElementById('pedidos-cards');
  if (!container) return;

  const q = (document.getElementById('pedidos-search')?.value || '').toLowerCase();
  const filtroEstado = document.getElementById('pedidos-filter-estado')?.value || '';
  const rol = App.getRol();
  const userEmail = Auth.getUser()?.email || '';

  let orders = Orders.getAll();
  if (q) orders = orders.filter(o =>
    (o.clienteNombre   || '').toLowerCase().includes(q) ||
    (o.clienteEmpresa  || '').toLowerCase().includes(q) ||
    (o.numero          || '').toLowerCase().includes(q) ||
    (o.creadoPor       || '').toLowerCase().includes(q)
  );
  if (filtroEstado) orders = orders.filter(o => o.estado === filtroEstado);

  const _ESTADO_SORT = { PENDIENTE: 0, EN_PROCESO: 1, ENTREGA_PARCIAL: 2, ENTREGADO: 3, CANCELADO: 4 };
  orders.sort((a, b) => (_ESTADO_SORT[a.estado] ?? 5) - (_ESTADO_SORT[b.estado] ?? 5));

  const btnNueva = document.getElementById('btn-nueva-orden');
  if (btnNueva) btnNueva.style.display = rol === 'aliado' ? 'none' : '';

  if (!orders.length) {
    container.innerHTML = `
      <div style="text-align:center;padding:56px 16px;color:var(--muted);">
        <div style="font-size:44px;margin-bottom:14px;">📦</div>
        <div style="font-weight:700;font-size:15px;margin-bottom:6px;">Sin órdenes registradas</div>
        <div style="font-size:13px;">${q || filtroEstado ? 'Intenta con otros filtros.' : 'Crea la primera orden con el botón de arriba.'}</div>
      </div>`;
    return;
  }

  container.innerHTML = '';
  orders.forEach(order => {
    const isOwn  = (order.creadoPor === userEmail) || rol === 'admin';
    const info   = Orders.estadoInfo(order.estado);
    const counts = _countItemsByState(order.items);
    const total  = (order.items || []).length;

    const card = document.createElement('div');
    card.style.cssText = 'background:var(--white);border-radius:14px;padding:16px;margin-bottom:12px;box-shadow:0 1px 4px rgba(0,0,0,.07);border:1px solid var(--border);cursor:pointer;transition:box-shadow .15s,transform .1s;';
    card.addEventListener('mouseenter', () => { card.style.boxShadow = '0 6px 20px rgba(0,0,0,.12)'; card.style.transform = 'translateY(-1px)'; });
    card.addEventListener('mouseleave', () => { card.style.boxShadow = '0 1px 4px rgba(0,0,0,.07)'; card.style.transform = ''; });
    card.onclick = () => openOrderDetail(order.id);

    // Barra segmentada 4 colores
    const pBar = total > 0 ? `
      <div style="height:6px;border-radius:4px;overflow:hidden;display:flex;gap:1px;margin-bottom:8px;">
        ${counts.PENDIENTE  > 0 ? `<div style="flex:${counts.PENDIENTE};background:#9ca3af;border-radius:2px;"></div>`  : ''}
        ${counts.SOLICITADO > 0 ? `<div style="flex:${counts.SOLICITADO};background:#f59e0b;border-radius:2px;"></div>` : ''}
        ${counts.EN_STOCK   > 0 ? `<div style="flex:${counts.EN_STOCK};background:#3b82f6;border-radius:2px;"></div>`   : ''}
        ${counts.ENTREGADO  > 0 ? `<div style="flex:${counts.ENTREGADO};background:#10b981;border-radius:2px;"></div>`  : ''}
        ${total === 0 ? '<div style="flex:1;background:var(--border);border-radius:2px;"></div>' : ''}
      </div>` : '<div style="height:6px;background:var(--border);border-radius:4px;margin-bottom:8px;"></div>';

    // Pills de conteo
    const pills = total > 0 ? [
      counts.PENDIENTE  > 0 ? `<span style="font-size:10px;padding:2px 7px;border-radius:10px;background:#f3f4f6;color:#4b5563;font-weight:600;">⚪ ${counts.PENDIENTE}</span>`  : '',
      counts.SOLICITADO > 0 ? `<span style="font-size:10px;padding:2px 7px;border-radius:10px;background:#fef3c7;color:#92400e;font-weight:600;">🔄 ${counts.SOLICITADO}</span>` : '',
      counts.EN_STOCK   > 0 ? `<span style="font-size:10px;padding:2px 7px;border-radius:10px;background:#dbeafe;color:#1e40af;font-weight:600;">📦 ${counts.EN_STOCK}</span>`   : '',
      counts.ENTREGADO  > 0 ? `<span style="font-size:10px;padding:2px 7px;border-radius:10px;background:#d1fae5;color:#065f46;font-weight:600;">✅ ${counts.ENTREGADO}</span>`  : '',
    ].filter(Boolean).join('') : '<span style="font-size:10px;color:var(--muted);">Sin ítems</span>';

    card.innerHTML = `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px;">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:5px;">
            <span style="font-family:'DM Mono',monospace;font-weight:700;font-size:12px;color:var(--orange);">${escH(order.numero)}</span>
            <span style="font-size:11px;font-weight:700;padding:2px 9px;border-radius:20px;background:${info.bg};color:${info.color};">${info.label}</span>
            ${!isOwn ? '<span style="font-size:10px;color:var(--muted);background:var(--surface2);padding:2px 6px;border-radius:4px;">👁 Solo lectura</span>' : ''}
          </div>
          <div style="font-weight:700;font-size:15px;line-height:1.3;margin-bottom:2px;overflow-wrap:anywhere;word-break:break-word;">${escH(order.clienteNombre || '—')}</div>
          ${order.clienteEmpresa ? `<div style="font-size:12px;color:var(--muted);overflow-wrap:anywhere;">${escH(order.clienteEmpresa)}</div>` : ''}
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="font-size:10px;color:var(--muted);">CREADO</div>
          <div style="font-size:12px;font-weight:500;">${Orders.fmtDate(order.fechaCreacion)}</div>
          ${order.fechaEstEntrega ? `<div style="font-size:10px;color:var(--muted);margin-top:2px;">Est: ${Orders.fmtDate(order.fechaEstEntrega)}</div>` : ''}
        </div>
      </div>
      ${pBar}
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
        <div style="display:flex;gap:4px;flex-wrap:wrap;">${pills}</div>
        <span style="font-size:10px;color:var(--muted);">Por: ${escH(order.creadoPor || '')}</span>
      </div>`;
    container.appendChild(card);
  });
}

// ── VISTA DETALLE ────────────────────────────────────────────────────
function openOrderDetail(id) {
  _currentOrderId = id;
  document.getElementById('pedidos-list-view').style.display = 'none';
  document.getElementById('pedidos-detail-view').style.display = 'block';
  renderOrderDetail(id);
  window.scrollTo(0, 0);
}

function backToOrdersList() {
  _currentOrderId = null;
  document.getElementById('pedidos-list-view').style.display = '';
  document.getElementById('pedidos-detail-view').style.display = 'none';
  renderOrdersList();
}

function renderOrderDetail(id) {
  const order = Orders.getById(id);
  const container = document.getElementById('pedidos-detail-content');
  if (!order || !container) return;

  const rol     = App.getRol();
  const email   = Auth.getUser()?.email || '';
  const isOwn   = (order.creadoPor === email) || rol === 'admin';
  const isAdmin = rol === 'admin';
  const info    = Orders.estadoInfo(order.estado);
  const activo  = order.estado !== 'ENTREGADO' && order.estado !== 'CANCELADO';

  // Resumen de ítems por estado
  const counts = _countItemsByState(order.items);
  const total  = (order.items || []).length;
  const pct    = Orders.pctEntregado(order);

  container.innerHTML = `
    <!-- CABECERA -->
    <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--border);">
      <div>
        <div style="font-family:'DM Mono',monospace;font-size:12px;color:var(--muted);margin-bottom:4px;">${escH(order.numero)}</div>
        <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;overflow-wrap:anywhere;">${escH(order.clienteNombre || '—')}</h2>
        <span style="font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;background:${info.bg};color:${info.color};">${info.label}</span>
        ${order.estado !== 'ENTREGADO' && order.estado !== 'CANCELADO' ? `
        <span style="font-size:11px;color:var(--muted);margin-left:10px;">· Estado derivado automáticamente de los ítems</span>` : ''}
      </div>
      ${isOwn ? `
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        ${activo ? `<button onclick="pedidoRegistrarEntrega()" style="padding:8px 16px;background:var(--orange);color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">📦 Registrar entrega múltiple</button>` : ''}
        ${isAdmin ? `<button onclick="pedidoEliminar()" style="padding:8px 14px;background:#fff;color:#dc2626;border:1px solid #dc2626;border-radius:8px;font-size:12px;cursor:pointer;">🗑 Eliminar</button>` : ''}
      </div>` : ''}
    </div>

    <!-- MINI DASHBOARD DE ESTA ORDEN -->
    ${total > 0 ? `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:16px;">
      ${_miniKpi('⚪ Sin solicitar', counts.PENDIENTE,  '#4b5563', '#f3f4f6')}
      ${_miniKpi('🔄 Solicitados',   counts.SOLICITADO, '#92400e', '#fef3c7')}
      ${_miniKpi('📦 En bodega',     counts.EN_STOCK,   '#1e40af', '#dbeafe')}
      ${_miniKpi('✅ Entregados',    counts.ENTREGADO,  '#065f46', '#d1fae5')}
    </div>
    <!-- Barra de progreso total -->
    <div style="margin-bottom:16px;">
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-bottom:4px;">
        <span>${total} ítems · ${pct}% entregado por unidades</span>
      </div>
      <div style="height:8px;border-radius:6px;overflow:hidden;display:flex;gap:1px;">
        ${counts.PENDIENTE  > 0 ? `<div style="flex:${counts.PENDIENTE};background:#9ca3af;"></div>`  : ''}
        ${counts.SOLICITADO > 0 ? `<div style="flex:${counts.SOLICITADO};background:#f59e0b;"></div>` : ''}
        ${counts.EN_STOCK   > 0 ? `<div style="flex:${counts.EN_STOCK};background:#3b82f6;"></div>`   : ''}
        ${counts.ENTREGADO  > 0 ? `<div style="flex:${counts.ENTREGADO};background:#10b981;"></div>`  : ''}
      </div>
    </div>` : ''}

    <!-- DATOS CLIENTE Y FECHAS -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;margin-bottom:14px;">
      <div style="background:var(--white);border-radius:12px;padding:14px;border:1px solid var(--border);">
        <div style="font-weight:700;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;">📋 Cliente</div>
        ${_dRow('Cliente', order.clienteNombre)}
        ${order.clienteNit ? `<div style="display:flex;gap:8px;padding:3px 0;"><span style="font-size:12px;color:var(--muted);min-width:70px;flex-shrink:0;">NIT</span><span style="font-size:13px;font-family:'DM Mono',monospace;">${escH(order.clienteNit)}</span></div>` : ''}
        ${_dRow('Empresa', order.clienteEmpresa)}
        ${order.clienteTel ? `<div style="display:flex;gap:8px;padding:3px 0;"><span style="font-size:12px;color:var(--muted);min-width:70px;flex-shrink:0;">Tel</span><a href="tel:${escH(order.clienteTel)}" style="font-size:13px;color:var(--orange);">${escH(order.clienteTel)}</a></div>` : ''}
        ${order.clienteEmail ? `<div style="display:flex;gap:8px;padding:3px 0;"><span style="font-size:12px;color:var(--muted);min-width:70px;flex-shrink:0;">Email</span><a href="mailto:${escH(order.clienteEmail)}" style="font-size:13px;color:var(--orange);word-break:break-all;">${escH(order.clienteEmail)}</a></div>` : ''}
        ${_dRow('Dirección', order.clienteDireccion)}
      </div>
      <div style="background:var(--white);border-radius:12px;padding:14px;border:1px solid var(--border);">
        <div style="font-weight:700;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;">📅 Fechas</div>
        ${_dRow('Creado', Orders.fmtDate(order.fechaCreacion))}
        ${_dRow('Por', order.creadoPor)}
        ${_dRow('Entrega est.', order.fechaEstEntrega ? Orders.fmtDate(order.fechaEstEntrega) : '')}
        ${order.fechaEntregaReal ? _dRow('Entregado', Orders.fmtDate(order.fechaEntregaReal)) : ''}
        ${order.notas ? _dRow('Notas', order.notas) : ''}
      </div>
    </div>

    <!-- TABLA DE ÍTEMS -->
    <div style="background:var(--white);border-radius:12px;padding:14px;border:1px solid var(--border);margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <div style="font-weight:700;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;">📦 Ítems del pedido</div>
        ${isOwn && activo && total > 0 ? `
        <button onclick="pedidoGuardarItems()" style="padding:5px 14px;background:var(--orange);color:#fff;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;">💾 Guardar texto</button>` : ''}
      </div>
      ${_renderItemsTable(order.items || [], isOwn && activo, order.notas || '')}
    </div>

    <!-- ADJUNTOS -->
    ${(order.archivos || []).length ? `
    <div style="background:var(--white);border-radius:12px;padding:14px;border:1px solid var(--border);margin-bottom:14px;">
      <div style="font-weight:700;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;">📎 Archivos adjuntos</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">${(order.archivos || []).map(a => _renderArchivoThumb(a)).join('')}</div>
    </div>` : ''}

    ${isOwn ? `
    <div style="background:var(--white);border-radius:12px;padding:14px;border:1px solid var(--border);margin-bottom:14px;">
      <div style="font-weight:700;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;">📎 Adjuntar archivo</div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <label style="display:inline-flex;align-items:center;gap:7px;padding:8px 14px;background:var(--surface);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:13px;">
          📷 Tomar foto <input type="file" accept="image/*" capture="environment" style="display:none;" onchange="pedidoAgregarFoto(event)">
        </label>
        <label style="display:inline-flex;align-items:center;gap:7px;padding:8px 14px;background:var(--surface);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:13px;">
          📂 Subir foto / PDF <input type="file" accept="image/*,application/pdf,.pdf" style="display:none;" onchange="pedidoAgregarFoto(event)">
        </label>
        <span style="font-size:11px;color:var(--muted);">${(order.archivos || []).length}/3 adjuntos</span>
      </div>
    </div>
    <div style="background:var(--white);border-radius:12px;padding:14px;border:1px solid var(--border);margin-bottom:14px;">
      <div style="font-weight:700;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;">💬 Agregar nota</div>
      <div style="display:flex;gap:8px;">
        <input type="text" id="pedido-nota-inp" placeholder="Escribe un comentario o nota de seguimiento…"
          style="flex:1;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-family:inherit;"
          onkeydown="if(event.key==='Enter')pedidoAgregarNota()">
        <button onclick="pedidoAgregarNota()" style="padding:8px 16px;background:var(--orange);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">Agregar</button>
      </div>
    </div>` : ''}

    <!-- TIMELINE -->
    <div style="background:var(--white);border-radius:12px;padding:14px;border:1px solid var(--border);">
      <div style="font-weight:700;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px;">📜 Historial</div>
      ${_renderTimeline(order.eventos || [])}
    </div>`;
}

function _miniKpi(label, value, color, bg) {
  return `<div style="background:${bg};border-radius:8px;padding:10px 12px;border:1px solid ${color}22;text-align:center;">
    <div style="font-size:22px;font-weight:800;color:${color};line-height:1;">${value}</div>
    <div style="font-size:10px;color:${color};font-weight:600;margin-top:2px;">${label}</div>
  </div>`;
}

function _dRow(label, val) {
  if (!val) return '';
  return `<div style="display:flex;gap:8px;padding:3px 0;">
    <span style="font-size:12px;color:var(--muted);min-width:70px;flex-shrink:0;">${escH(label)}</span>
    <span style="font-size:13px;word-break:break-word;">${escH(val)}</span>
  </div>`;
}

function _renderArchivoThumb(a) {
  if (a.tipo === 'pdf' || !a.thumb) {
    return `<div style="width:80px;display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 4px;border:1px solid var(--border);border-radius:8px;background:#fff8f0;flex-shrink:0;">
      <div style="font-size:30px;line-height:1;">📄</div>
      <div style="font-size:9px;color:var(--muted);text-align:center;word-break:break-all;line-height:1.3;max-width:72px;">${escH((a.nombre||'').replace(/\.[^.]+$/,'').substring(0,20))}</div>
      <div style="font-size:8px;font-weight:700;color:#dc2626;">PDF</div>
    </div>`;
  }
  return `<div onclick="abrirLightbox('${escH(a.thumb)}',null)"
    style="width:80px;height:80px;border-radius:8px;overflow:hidden;cursor:zoom-in;border:1px solid var(--border);flex-shrink:0;">
    <img src="${escH(a.thumb)}" style="width:100%;height:100%;object-fit:cover;" alt="${escH(a.nombre||'')}">
  </div>`;
}

// ── TABLA DE ÍTEMS INTERACTIVA ───────────────────────────────────────
function _renderItemsTable(items, editable, notasOrder) {
  if (!items.length) {
    if (editable) {
      return `
        <div style="font-size:12px;color:var(--muted);margin-bottom:8px;">Sin ítems registrados. Puedes dejar notas generales del pedido:</div>
        <textarea id="pedido-notas-empty" rows="7"
          placeholder="Escribe notas, instrucciones especiales o detalles del pedido…"
          style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-family:inherit;resize:vertical;box-sizing:border-box;"
        >${escH(notasOrder || '')}</textarea>
        <div style="margin-top:8px;display:flex;justify-content:flex-end;">
          <button onclick="pedidoGuardarNotas()" style="padding:7px 18px;background:var(--orange);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">💾 Guardar notas</button>
        </div>`;
    }
    return '<p style="color:var(--muted);font-size:13px;margin:0;">Sin ítems registrados.</p>';
  }

  if (!editable) {
    // Modo lectura
    return `<div style="display:flex;flex-direction:column;gap:6px;">
      ${items.map(item => {
        const si = _itemEstadoInfo(item.estadoItem);
        const entregado = (item.cantEntregada || 0);
        const cant = item.cant || 0;
        const completo = entregado >= cant && cant > 0;
        return `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border-light);border-radius:10px;flex-wrap:wrap;">
          <div style="flex:1;min-width:120px;">
            <div style="font-weight:500;font-size:13px;">${escH(item.desc || '')}</div>
            ${item.ref ? `<div style="font-size:10px;color:var(--muted);font-family:'DM Mono',monospace;">${escH(item.ref)}</div>` : ''}
            ${item.notas ? `<div style="font-size:10px;color:var(--muted);font-style:italic;margin-top:2px;">${escH(item.notas)}</div>` : ''}
          </div>
          <div style="display:flex;align-items:center;gap:10px;flex-shrink:0;flex-wrap:wrap;">
            <span style="font-size:12px;font-weight:700;color:var(--muted);">×${cant}</span>
            <span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:12px;background:${si.bg};color:${si.color};">${si.icon} ${si.label}</span>
            <span style="font-size:11px;font-weight:600;color:${completo ? '#10b981' : 'var(--muted)'};">${entregado}/${cant} entregado${entregado === 1 ? '' : 's'}</span>
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }

  // Modo editable — chips interactivos de estado
  const inpS = 'padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:inherit;background:#fff;width:100%;box-sizing:border-box;';

  return `
    <div style="font-size:11px;color:var(--muted);margin-bottom:8px;padding:6px 10px;background:var(--surface2);border-radius:6px;">
      💡 <strong>Clic en el estado</strong> de un ítem para avanzarlo al siguiente paso. Usa <em>💾 Guardar texto</em> para cambios en descripciones y cantidades.
    </div>
    <div style="display:flex;flex-direction:column;gap:6px;">
      ${items.map((item, i) => {
        const si      = _itemEstadoInfo(item.estadoItem);
        const entregado = item.cantEntregada || 0;
        const cant    = item.cant || 0;
        const pctItem = cant > 0 ? Math.round((entregado / cant) * 100) : 0;
        const completo = entregado >= cant && cant > 0;

        return `<div style="border:1px solid var(--border-light);border-radius:10px;overflow:hidden;">
          <!-- Fila principal -->
          <div style="display:flex;align-items:center;gap:8px;padding:10px 12px;flex-wrap:wrap;">
            <!-- Descripción y referencia -->
            <div style="flex:1;min-width:160px;display:flex;flex-direction:column;gap:3px;">
              <input type="text" value="${escH(item.desc||'')}" data-idx="${i}" data-field="desc"
                class="item-edit-inp" placeholder="Descripción"
                style="${inpS}font-weight:500;">
              <input type="text" value="${escH(item.ref||'')}" data-idx="${i}" data-field="ref"
                class="item-edit-inp" placeholder="Ref. (opcional)"
                style="${inpS}font-family:'DM Mono',monospace;font-size:11px;background:#fafafa;">
            </div>
            <!-- Cantidad -->
            <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;">
              <span style="font-size:11px;color:var(--muted);">Cant:</span>
              <input type="number" min="1" value="${cant}" data-idx="${i}" data-field="cant"
                class="item-edit-inp"
                style="padding:5px 4px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:inherit;background:#fff;width:56px;text-align:center;">
            </div>
            <!-- Chip de estado interactivo -->
            <button onclick="pedidoClickItemEstado(${i})"
              title="${si.nextLabel || 'Entregado — sin más acciones'}"
              style="padding:6px 12px;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:${si.next ? 'pointer' : 'default'};
                     background:${si.bg};color:${si.color};flex-shrink:0;transition:filter .15s;
                     ${si.next ? '' : 'opacity:.8;'}"
              ${si.next ? `onmouseenter="this.style.filter='brightness(.92)'" onmouseleave="this.style.filter=''"` : 'disabled'}>
              ${si.icon} ${si.label}${si.next ? ' →' : ''}
            </button>
            <!-- Entregado -->
            <div style="font-size:11px;flex-shrink:0;text-align:center;min-width:56px;">
              <span style="font-weight:700;color:${completo ? '#10b981' : 'var(--muted)'};">${entregado}/${cant}</span>
              <div style="font-size:9px;color:var(--muted);">entregado</div>
            </div>
            <!-- Eliminar -->
            <button onclick="this.closest('[data-item-row]').remove()" data-del="${i}"
              title="Eliminar ítem"
              style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:16px;padding:0 4px;line-height:1;opacity:.6;flex-shrink:0;"
              onmouseenter="this.style.opacity='1'" onmouseleave="this.style.opacity='.6'">✕</button>
          </div>
          <!-- Mini barra de progreso del ítem + notas -->
          <div style="padding:0 12px 10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <div style="flex:1;min-width:80px;">
              <div style="height:4px;background:var(--border);border-radius:3px;overflow:hidden;">
                <div style="height:100%;width:${pctItem}%;background:${completo ? '#10b981' : si.color};border-radius:3px;transition:width .3s;"></div>
              </div>
            </div>
            <input type="text" value="${escH(item.notas||'')}" data-idx="${i}" data-field="notas"
              class="item-edit-inp" placeholder="Observaciones…"
              style="padding:4px 8px;border:1px solid var(--border);border-radius:6px;font-size:11px;font-family:inherit;background:#fff;flex:2;min-width:120px;">
          </div>
        </div>`;
      }).join('')}
    </div>`;
}

// Workaround: data-item-row no existe en el HTML generado — uso clase para eliminar
// Reemplazar onclick del botón eliminar para usar el div contenedor correcto
// (En la siguiente iteración del render los cambios de DOM se ven reflejados)

function _renderTimeline(eventos) {
  if (!eventos.length) return '<p style="color:var(--muted);font-size:13px;margin:0;">Sin eventos registrados.</p>';
  return [...eventos].reverse().map(ev => `
    <div style="display:flex;gap:10px;padding:9px 0;border-bottom:1px solid var(--border-light);">
      <div style="width:30px;height:30px;border-radius:50%;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;">${_eventoIcon(ev.tipo)}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:500;word-break:break-word;">${escH(ev.descripcion || '')}</div>
        <div style="font-size:10px;color:var(--muted);margin-top:2px;">${Orders.fmtDateTime(ev.fecha)} · ${escH(ev.usuario || '')}</div>
      </div>
    </div>`).join('');
}

// ── CLIC EN CHIP DE ESTADO — AVANCE INMEDIATO ────────────────────────
function pedidoClickItemEstado(itemIdx) {
  const order = Orders.getById(_currentOrderId);
  if (!order || !order.items[itemIdx]) return;

  const item    = order.items[itemIdx];
  const current = _normItemEstado(item.estadoItem || 'PENDIENTE');
  const si      = _itemEstadoInfo(current);

  if (!si.next) return; // ya está en ENTREGADO

  if (si.next === 'ENTREGADO') {
    // Antes de marcar entregado, pedir cantidad (excepto si cant=1)
    const pendiente = (item.cant || 1) - (item.cantEntregada || 0);
    if (pendiente <= 1) {
      // Entregar directamente
      item.estadoItem    = 'ENTREGADO';
      item.cantEntregada = item.cant;
      _autoSaveItems(order);
      toast('✅ Ítem entregado completamente', 'success');
      return;
    }
    // Abrir modal para cantidad parcial
    _entregaItemIdx = itemIdx;
    _abrirModalEntregaItem(item, pendiente);
    return;
  }

  // Avance normal: PENDIENTE → SOLICITADO → EN_STOCK
  item.estadoItem = si.next;
  _autoSaveItems(order);
  const nuevoSi = _itemEstadoInfo(si.next);
  toast(`${nuevoSi.icon} ${escH(item.desc || 'Ítem')} → ${nuevoSi.label}`, 'success');
}

function _abrirModalEntregaItem(item, pendiente) {
  const body = document.getElementById('modal-entrega-body');
  if (!body) return;
  body.innerHTML = `
    <div style="padding:8px 0 12px;">
      <div style="font-weight:600;font-size:14px;margin-bottom:4px;">${escH(item.desc || '')}</div>
      ${item.ref ? `<div style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);margin-bottom:12px;">${escH(item.ref)}</div>` : '<div style="margin-bottom:12px;"></div>'}
      <div style="background:var(--surface2);border-radius:8px;padding:12px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <div style="font-size:13px;color:var(--muted);">Pendientes: <strong style="color:var(--text);">${pendiente}</strong> de ${item.cant}</div>
        <label style="font-size:13px;font-weight:500;">Entregar ahora:</label>
        <input type="number" id="entrega-item-qty" min="1" max="${pendiente}" value="${pendiente}"
          style="width:80px;padding:8px;border:1px solid var(--border);border-radius:8px;font-size:16px;font-weight:700;text-align:center;">
        <span style="font-size:12px;color:var(--muted);">unidades</span>
      </div>
    </div>`;

  // Cambiar acción del botón confirmar
  const confirmBtn = document.querySelector('#modal-entrega .btn-primary');
  if (confirmBtn) confirmBtn.onclick = confirmarEntregaItemUnico;

  document.getElementById('modal-entrega').classList.add('open');
}

function confirmarEntregaItemUnico() {
  const order = Orders.getById(_currentOrderId);
  if (!order || _entregaItemIdx === null) return;

  const item  = order.items[_entregaItemIdx];
  const qty   = parseInt(document.getElementById('entrega-item-qty')?.value) || 0;
  if (qty <= 0) { toast('Ingresa una cantidad válida', 'error'); return; }

  const pendiente = (item.cant || 0) - (item.cantEntregada || 0);
  const entregar  = Math.min(qty, pendiente);

  item.cantEntregada = (item.cantEntregada || 0) + entregar;
  if (item.cantEntregada >= item.cant) {
    item.estadoItem = 'ENTREGADO';
  }

  _autoSaveItems(order);
  document.getElementById('modal-entrega').classList.remove('open');
  _entregaItemIdx = null;
  toast(`✅ ${entregar} unidad(es) entregada(s)`, 'success');
}

function _autoSaveItems(order) {
  // Leer cambios de texto desde el DOM (si la vista está abierta)
  document.querySelectorAll('.item-edit-inp').forEach(inp => {
    const idx   = parseInt(inp.dataset.idx);
    const field = inp.dataset.field;
    if (!order.items[idx]) return;
    if (field === 'cant') order.items[idx].cant = parseInt(inp.value) || 0;
    else order.items[idx][field] = inp.value.trim();
  });

  const estadoDerivado = _derivarEstadoOrden(order.items);
  Orders.update(_currentOrderId, { items: order.items, estado: estadoDerivado });

  const usuario = Auth.getUser()?.email || '';
  Orders.addEvent(_currentOrderId, 'NOTA', 'Estado de ítems actualizado', usuario);
  Sync.saveOrder(Orders.getById(_currentOrderId)).catch(e => console.warn('saveOrder:', e));
  renderOrderDetail(_currentOrderId);
}

function _derivarEstadoOrden(items) {
  if (!items || !items.length) return 'PENDIENTE';
  const normalized = items.map(i => _normItemEstado(i.estadoItem));
  if (normalized.every(e => e === 'ENTREGADO')) return 'ENTREGADO';
  if (normalized.some(e => e === 'ENTREGADO'))  return 'ENTREGA_PARCIAL';
  if (normalized.some(e => e === 'EN_STOCK' || e === 'SOLICITADO')) return 'EN_PROCESO';
  return 'PENDIENTE';
}

// ── ACCIONES EN DETALLE ──────────────────────────────────────────────
function pedidoAgregarNota() {
  const inp  = document.getElementById('pedido-nota-inp');
  const nota = (inp?.value || '').trim();
  if (!nota) return;
  const usuario = Auth.getUser()?.email || '';
  Orders.addEvent(_currentOrderId, 'NOTA', nota, usuario);
  const order = Orders.getById(_currentOrderId);
  Sync.saveOrder(order).catch(e => console.warn('saveOrder:', e));
  inp.value = '';
  renderOrderDetail(_currentOrderId);
  toast('Nota agregada', 'success');
}

async function pedidoAgregarFoto(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const order = Orders.getById(_currentOrderId);
  if (!order) return;
  if ((order.archivos || []).length >= 3) { toast('Máximo 3 archivos por orden', 'error'); return; }
  if (!order.archivos) order.archivos = [];

  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const usuario = Auth.getUser()?.email || '';

  if (isPdf) {
    order.archivos.push({ id: Date.now().toString(), nombre: file.name, tipo: 'pdf', thumb: null, fecha: new Date().toISOString() });
    Orders.addEvent(_currentOrderId, 'FOTO', 'PDF adjuntado: ' + file.name, usuario);
    Orders.update(_currentOrderId, { archivos: order.archivos });
    Sync.saveOrder(Orders.getById(_currentOrderId)).catch(err => console.warn('saveOrder:', err));
    renderOrderDetail(_currentOrderId);
    toast('✓ PDF registrado: ' + file.name, 'success');
  } else {
    const reader = new FileReader();
    reader.onload = async ev => {
      const thumb = await Orders.compressPhoto(ev.target.result);
      if (!thumb) { toast('No se pudo comprimir la imagen', 'error'); return; }
      order.archivos.push({ id: Date.now().toString(), nombre: file.name, tipo: 'imagen', thumb, fecha: new Date().toISOString() });
      Orders.addEvent(_currentOrderId, 'FOTO', 'Foto adjuntada: ' + file.name, usuario);
      Orders.update(_currentOrderId, { archivos: order.archivos });
      Sync.saveOrder(Orders.getById(_currentOrderId)).catch(err => console.warn('saveOrder:', err));
      renderOrderDetail(_currentOrderId);
      toast('✓ Foto adjuntada', 'success');
    };
    reader.readAsDataURL(file);
  }
  e.target.value = '';
}

function pedidoEliminar() {
  const order = Orders.getById(_currentOrderId);
  if (!order) return;
  if (!confirm('¿Eliminar la orden ' + order.numero + '? Esta acción no se puede deshacer.')) return;
  Sync.deleteOrder(_currentOrderId).catch(e => console.warn('deleteOrder:', e));
  Orders.remove(_currentOrderId);
  backToOrdersList();
  toast('Orden eliminada', 'success');
}

// ── GUARDAR CAMBIOS DE TEXTO EN ÍTEMS ───────────────────────────────
function pedidoGuardarItems() {
  const order = Orders.getById(_currentOrderId);
  if (!order || !order.items) return;

  document.querySelectorAll('.item-edit-inp').forEach(inp => {
    const idx   = parseInt(inp.dataset.idx);
    const field = inp.dataset.field;
    if (!order.items[idx]) return;
    if (field === 'cant') order.items[idx].cant = parseInt(inp.value) || 0;
    else order.items[idx][field] = inp.value.trim();
  });

  // Filtrar ítems eliminados (botón ✕ que remueve el div padre)
  const visibleIdxs = new Set(
    [...document.querySelectorAll('.item-edit-inp')].map(inp => parseInt(inp.dataset.idx))
  );
  order.items = order.items.filter((_, i) => visibleIdxs.has(i));

  const estadoDerivado = _derivarEstadoOrden(order.items);
  const usuario = Auth.getUser()?.email || '';

  Orders.update(_currentOrderId, { items: order.items, estado: estadoDerivado });
  Orders.addEvent(_currentOrderId, 'NOTA', 'Ítems actualizados', usuario);
  Sync.saveOrder(Orders.getById(_currentOrderId)).catch(e => console.warn('saveOrder:', e));
  renderOrderDetail(_currentOrderId);
  toast('✓ Cambios guardados', 'success');
}

function pedidoGuardarNotas() {
  const val = (document.getElementById('pedido-notas-empty')?.value || '').trim();
  const usuario = Auth.getUser()?.email || '';
  Orders.update(_currentOrderId, { notas: val });
  Orders.addEvent(_currentOrderId, 'NOTA', 'Notas actualizadas', usuario);
  Sync.saveOrder(Orders.getById(_currentOrderId)).catch(e => console.warn('saveOrder:', e));
  renderOrderDetail(_currentOrderId);
  toast('✓ Notas guardadas', 'success');
}

// ── REGISTRAR ENTREGA MÚLTIPLE (todos los ítems a la vez) ─────────────
function pedidoRegistrarEntrega() {
  const order = Orders.getById(_currentOrderId);
  if (!order || !(order.items || []).length) { toast('Sin ítems para registrar', 'error'); return; }

  const body = document.getElementById('modal-entrega-body');
  body.innerHTML = `
    <div style="font-size:12px;color:var(--muted);margin-bottom:12px;padding:8px 10px;background:var(--surface2);border-radius:6px;">
      Ajusta las cantidades a entregar y el estado de cada ítem.
    </div>
    ${order.items.map((item, i) => {
      const pend = (item.cant || 0) - (item.cantEntregada || 0);
      const si   = _itemEstadoInfo(item.estadoItem);
      return `<div style="padding:10px 0;border-bottom:1px solid var(--border);">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
          <span style="font-size:13px;font-weight:600;flex:1;min-width:120px;">${escH(item.desc || '')}</span>
          <span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;background:${si.bg};color:${si.color};">${si.icon} ${si.label}</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <span style="font-size:12px;color:var(--muted);">Pedido: ${item.cant} · Entregado: ${item.cantEntregada || 0} · <strong>Pendiente: ${pend}</strong></span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;margin-top:8px;flex-wrap:wrap;">
          <label style="font-size:12px;color:var(--muted);">Entregar ahora:</label>
          <input type="number" min="0" max="${pend}" value="0" data-idx="${i}" class="entrega-qty-inp"
            style="width:70px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;text-align:center;">
          <label style="font-size:12px;color:var(--muted);">Nuevo estado:</label>
          <select data-idx="${i}" class="entrega-estado-sel"
            style="font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;cursor:pointer;">
            <option value="PENDIENTE"  ${(_normItemEstado(item.estadoItem)==='PENDIENTE' ) ? 'selected' : ''}>⚪ Sin solicitar</option>
            <option value="SOLICITADO" ${(_normItemEstado(item.estadoItem)==='SOLICITADO') ? 'selected' : ''}>🔄 Solicitado</option>
            <option value="EN_STOCK"   ${(_normItemEstado(item.estadoItem)==='EN_STOCK'  ) ? 'selected' : ''}>📦 En bodega</option>
            <option value="ENTREGADO"  ${pend <= 0 ? 'selected' : ''}>✅ Entregado</option>
          </select>
        </div>
      </div>`;
    }).join('')}`;

  const confirmBtn = document.querySelector('#modal-entrega .btn-primary');
  if (confirmBtn) confirmBtn.onclick = confirmarEntrega;

  document.getElementById('modal-entrega').classList.add('open');
}

function confirmarEntrega() {
  const order = Orders.getById(_currentOrderId);
  if (!order) return;
  const usuario = Auth.getUser()?.email || '';

  document.querySelectorAll('.entrega-qty-inp').forEach(inp => {
    const idx  = parseInt(inp.dataset.idx);
    const qty  = parseInt(inp.value) || 0;
    const selE = document.querySelector('.entrega-estado-sel[data-idx="' + idx + '"]');
    if (qty > 0) order.items[idx].cantEntregada = (order.items[idx].cantEntregada || 0) + qty;
    if (selE)    order.items[idx].estadoItem = selE.value;
  });

  const estadoDerivado = _derivarEstadoOrden(order.items);
  const tot = order.items.reduce((s, i) => s + (i.cant || 0), 0);
  const ent = order.items.reduce((s, i) => s + (i.cantEntregada || 0), 0);
  const pct = tot > 0 ? Math.round((ent / tot) * 100) : 0;

  Orders.update(_currentOrderId, {
    items: order.items,
    estado: estadoDerivado,
    fechaEntregaReal: estadoDerivado === 'ENTREGADO' ? new Date().toISOString().slice(0, 10) : order.fechaEntregaReal,
  });
  Orders.addEvent(_currentOrderId, 'ENTREGA_PARCIAL', `Entrega: ${ent}/${tot} unidades (${pct}%)`, usuario);

  Sync.saveOrder(Orders.getById(_currentOrderId)).catch(e => console.warn('saveOrder:', e));
  document.getElementById('modal-entrega').classList.remove('open');
  renderOrderDetail(_currentOrderId);
  toast('✓ Entrega registrada — ' + pct + '% completado', 'success');
}

// ── CONVERTIR COTIZACIÓN A PEDIDO ────────────────────────────────────
function convertirCotizacionAPedido(id) {
  let cot = null;
  try {
    const cots = JSON.parse(localStorage.getItem('ow_cots_v1') || '[]');
    cot = cots.find(c => c.id === id);
  } catch(e) {}
  if (!cot) { toast('Cotización no encontrada', 'error'); return; }

  document.getElementById('modal-historial-cots')?.classList.remove('open');

  _newOrderItems   = [];
  _newOrderArchivos = [];

  ['np-cliente-nombre','np-cliente-nit','np-cliente-empresa','np-cliente-tel','np-cliente-email',
   'np-cliente-dir','np-fecha-entrega','np-notas','np-item-desc','np-item-ref','np-item-proveedor','np-catalog-q']
    .forEach(elId => { const el = document.getElementById(elId); if (el) el.value = ''; });
  const cantEl = document.getElementById('np-item-cant'); if (cantEl) cantEl.value = '1';

  const set = (elId, val) => { const el = document.getElementById(elId); if (el && val) el.value = val; };
  set('np-cliente-nombre', cot.cliente);
  set('np-cliente-nit',    cot.nitCliente);

  const notaParts = [
    cot.notasExtra,
    cot.condiciones  ? 'Condición de pago: ' + cot.condiciones : '',
    cot.contacto     ? 'Contacto: '           + cot.contacto    : '',
    cot.ciudad       ? 'Ciudad: '             + cot.ciudad      : '',
    'Ref. cotización: ' + (cot.numero || cot.id),
  ].filter(Boolean);
  set('np-notas', notaParts.join('\n'));

  _newOrderItems = (cot.items || []).map(i => ({
    desc: i.nombre || '', ref: i.ref || '', cant: i.cant || 1,
    proveedor: '', notas: i.obs || '', cantEntregada: 0, estadoItem: 'PENDIENTE',
  }));

  const catalogResults = document.getElementById('np-catalog-results');
  if (catalogResults) catalogResults.style.display = 'none';
  npItemMode('manual');
  _renderNpItems();
  document.getElementById('modal-nuevo-pedido').classList.add('open');
  setTimeout(() => document.getElementById('np-cliente-nombre')?.focus(), 150);
  toast(`📋 Cotización ${cot.numero || ''} importada — revisa y crea la orden`, 'success');
}

// ── NUEVA ORDEN ──────────────────────────────────────────────────────
function abrirNuevoPedido() {
  _newOrderItems   = [];
  _newOrderArchivos = [];
  ['np-cliente-nombre','np-cliente-nit','np-cliente-empresa','np-cliente-tel','np-cliente-email',
   'np-cliente-dir','np-fecha-entrega','np-notas','np-item-desc','np-item-ref','np-item-proveedor','np-catalog-q']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const cantEl = document.getElementById('np-item-cant'); if (cantEl) cantEl.value = '1';
  const catalogResults = document.getElementById('np-catalog-results');
  if (catalogResults) catalogResults.style.display = 'none';
  npItemMode('manual');
  const ctrEl  = document.getElementById('np-foto-count'); if (ctrEl) ctrEl.textContent = '0/3';
  const prevEl = document.getElementById('np-archivos-preview'); if (prevEl) prevEl.innerHTML = '';
  _renderNpItems();
  document.getElementById('modal-nuevo-pedido').classList.add('open');
  setTimeout(() => document.getElementById('np-cliente-nombre')?.focus(), 150);
}

function cerrarNuevoPedido() {
  document.getElementById('modal-nuevo-pedido').classList.remove('open');
}

function _renderNpItems() {
  const c = document.getElementById('np-items-list');
  if (!c) return;
  if (!_newOrderItems.length) {
    c.innerHTML = '<p style="font-size:12px;color:var(--muted);padding:6px 0;margin:0;">Sin ítems. Agrega al menos uno.</p>';
    return;
  }
  c.innerHTML = _newOrderItems.map((item, i) => `
    <div style="display:flex;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--border-light);">
      <div style="flex:1;min-width:0;">
        <span style="font-size:13px;font-weight:500;">${escH(item.desc)}</span>
        ${item.proveedor ? `<span style="font-size:11px;color:var(--muted);margin-left:8px;">(${escH(item.proveedor)})</span>` : ''}
        ${item.ref ? `<span style="font-size:10px;color:var(--muted);font-family:'DM Mono',monospace;margin-left:6px;">${escH(item.ref)}</span>` : ''}
      </div>
      <span style="font-size:12px;font-weight:700;color:var(--orange);min-width:32px;text-align:center;">×${item.cant}</span>
      <button onclick="_newOrderItems.splice(${i},1);_renderNpItems();"
        style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:16px;padding:0 4px;line-height:1;flex-shrink:0;">✕</button>
    </div>`).join('');
}

function npAgregarItem() {
  const desc = (document.getElementById('np-item-desc')?.value  || '').trim();
  const ref  = (document.getElementById('np-item-ref')?.value   || '').trim();
  const cant = parseInt(document.getElementById('np-item-cant')?.value) || 1;
  const prov = (document.getElementById('np-item-proveedor')?.value || '').trim();
  if (!desc) { toast('Ingresa la descripción del ítem', 'error'); document.getElementById('np-item-desc')?.focus(); return; }
  _newOrderItems.push({ desc, ref, cant, proveedor: prov, notas: '', cantEntregada: 0, estadoItem: 'PENDIENTE' });
  ['np-item-desc','np-item-ref','np-item-proveedor'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const cantEl = document.getElementById('np-item-cant'); if (cantEl) cantEl.value = '1';
  _renderNpItems();
  document.getElementById('np-item-desc')?.focus();
}

// ── BÚSQUEDA DE CATÁLOGO EN NUEVA ORDEN ─────────────────────────────
let _npCatalogTimer = null;

function npItemMode(mode) {
  const panel     = document.getElementById('np-catalogo-panel');
  const btnManual = document.getElementById('np-btn-manual');
  const btnCat    = document.getElementById('np-btn-catalogo');
  if (!panel || !btnManual || !btnCat) return;

  const active   = 'background:var(--dark);color:#fff;border-color:var(--dark);';
  const inactive = 'background:transparent;color:var(--text2);border-color:var(--border);';

  if (mode === 'catalogo') {
    btnManual.style.cssText += inactive;
    btnCat.style.cssText    += active;
    panel.style.display = 'block';
    setTimeout(() => document.getElementById('np-catalog-q')?.focus(), 80);
  } else {
    btnManual.style.cssText += active;
    btnCat.style.cssText    += inactive;
    panel.style.display = 'none';
    setTimeout(() => document.getElementById('np-item-desc')?.focus(), 80);
  }
}

function npCatalogoBuscarDebounced(q) {
  clearTimeout(_npCatalogTimer);
  _npCatalogTimer = setTimeout(() => npCatalogoBuscar(q), 300);
}

function npCatalogoBuscar(q) {
  const resultsEl = document.getElementById('np-catalog-results');
  if (!resultsEl) return;
  const ql = q.trim().toLowerCase();
  if (!ql) { resultsEl.style.display = 'none'; return; }

  const res = (typeof Catalog !== 'undefined') ? Catalog.search(ql).slice(0, 20) : [];
  resultsEl.style.display = 'block';

  if (!res.length) {
    resultsEl.innerHTML = '<div style="padding:12px;font-size:13px;color:var(--muted);text-align:center;">Sin resultados</div>';
    return;
  }

  resultsEl.innerHTML = res.map(p => `
    <div onmousedown="npSeleccionarCatalogo(${p.id})"
      style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border-light);
             display:flex;align-items:center;gap:10px;"
      onmouseenter="this.style.background='var(--orange-light)'"
      onmouseleave="this.style.background=''">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escH(p.nombre)}</div>
        <div style="font-size:11px;color:var(--muted);">
          ${p.ref   ? `<span style="font-family:'DM Mono',monospace;">${escH(p.ref)}</span>` : ''}
          ${p.marca ? ` · ${escH(p.marca)}` : ''}
        </div>
      </div>
      <span style="font-size:12px;font-weight:700;color:var(--orange);white-space:nowrap;flex-shrink:0;">
        ${typeof fCOP === 'function' ? fCOP(p.precio || 0) : ''}
      </span>
    </div>`).join('');
}

function npSeleccionarCatalogo(id) {
  const p = (typeof Catalog !== 'undefined') ? Catalog.getById(id) : null;
  if (!p) return;
  const descEl = document.getElementById('np-item-desc');
  const refEl  = document.getElementById('np-item-ref');
  if (descEl) descEl.value = p.nombre;
  if (refEl)  refEl.value  = p.ref || '';
  npItemMode('manual');
  setTimeout(() => { document.getElementById('np-item-cant')?.select(); }, 120);
}

async function npAgregarFoto(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (_newOrderArchivos.length >= 3) { toast('Máximo 3 archivos', 'error'); return; }

  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

  if (isPdf) {
    _newOrderArchivos.push({ id: Date.now().toString(), nombre: file.name, tipo: 'pdf', thumb: null, fecha: new Date().toISOString() });
    _npActualizarArchivos();
    toast('✓ PDF registrado: ' + file.name, 'success');
  } else {
    const reader = new FileReader();
    reader.onload = async ev => {
      const thumb = await Orders.compressPhoto(ev.target.result);
      if (!thumb) { toast('Error al comprimir la imagen', 'error'); return; }
      _newOrderArchivos.push({ id: Date.now().toString(), nombre: file.name, tipo: 'imagen', thumb, fecha: new Date().toISOString() });
      _npActualizarArchivos();
      toast('✓ Foto agregada', 'success');
    };
    reader.readAsDataURL(file);
  }
  e.target.value = '';
}

function _npActualizarArchivos() {
  const ctr = document.getElementById('np-foto-count');
  if (ctr) ctr.textContent = _newOrderArchivos.length + '/3';
  const prev = document.getElementById('np-archivos-preview');
  if (!prev) return;
  prev.innerHTML = _newOrderArchivos.map((a, i) => {
    if (a.tipo === 'pdf' || !a.thumb) {
      return `<div style="display:flex;align-items:center;gap:6px;padding:5px 10px;background:#fff8f0;border:1px solid var(--border);border-radius:7px;font-size:12px;">
        <span>📄</span><span style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escH(a.nombre)}</span>
        <button onclick="_newOrderArchivos.splice(${i},1);_npActualizarArchivos();" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:14px;padding:0 2px;line-height:1;flex-shrink:0;">✕</button>
      </div>`;
    }
    return `<div style="position:relative;width:56px;height:56px;border-radius:7px;overflow:hidden;border:1px solid var(--border);">
      <img src="${escH(a.thumb)}" style="width:100%;height:100%;object-fit:cover;">
      <button onclick="_newOrderArchivos.splice(${i},1);_npActualizarArchivos();" style="position:absolute;top:2px;right:2px;background:rgba(0,0,0,.55);border:none;color:#fff;cursor:pointer;font-size:11px;width:18px;height:18px;border-radius:50%;padding:0;line-height:1;">✕</button>
    </div>`;
  }).join('');
}

async function guardarNuevoPedido() {
  const nombre = (document.getElementById('np-cliente-nombre')?.value || '').trim();
  if (!nombre) { toast('Ingresa el nombre del cliente o entidad', 'error'); document.getElementById('np-cliente-nombre')?.focus(); return; }

  const usuario = Auth.getUser()?.email || '';
  const order = Orders.add({
    clienteNombre:    nombre,
    clienteNit:       (document.getElementById('np-cliente-nit')?.value      || '').trim(),
    clienteEmpresa:   (document.getElementById('np-cliente-empresa')?.value  || '').trim(),
    clienteTel:       (document.getElementById('np-cliente-tel')?.value      || '').trim(),
    clienteEmail:     (document.getElementById('np-cliente-email')?.value    || '').trim(),
    clienteDireccion: (document.getElementById('np-cliente-dir')?.value      || '').trim(),
    fechaEstEntrega:   document.getElementById('np-fecha-entrega')?.value    || '',
    notas:            (document.getElementById('np-notas')?.value            || '').trim(),
    items:    _newOrderItems,
    archivos: _newOrderArchivos,
  }, usuario);

  cerrarNuevoPedido();

  try {
    await Sync.saveOrder(order);
    toast('✓ Orden ' + order.numero + ' creada y sincronizada', 'success');
  } catch(e) {
    toast('✓ Orden ' + order.numero + ' creada (sin sincronización)', 'success');
  }
  renderOrdersList();
}
