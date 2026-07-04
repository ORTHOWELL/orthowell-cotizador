/**
 * orders.js — Módulo de gestión de Pedidos / Órdenes de compra
 * Datos: Google Sheets (hoja "Pedidos") + caché en localStorage
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

  // ── CATÁLOGO DE ESTADOS ───────────────────────────────────────────
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

  // ── CRUD ─────────────────────────────────────────────────────────
  function getAll() { return [..._orders]; }
  function getById(id) { return _orders.find(o => o.id === id) || null; }

  function add(data, usuario) {
    const order = {
      id:              _generateId(),
      numero:          _generateNumero(),
      fechaCreacion:   new Date().toISOString(),
      creadoPor:       usuario,
      clienteNombre:    data.clienteNombre    || '',
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

  // Comprime foto a thumbail pequeño para almacenar en Sheets (máx ~10K chars/foto)
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
// UI — funciones globales (llamadas desde onclick en el HTML)
// ═══════════════════════════════════════════════════════════════════════

let _currentOrderId  = null;
let _newOrderItems   = [];
let _newOrderArchivos = [];

// ── HELPERS UI ───────────────────────────────────────────────────────
function _itemEstadoInfo(e) {
  const map = {
    PENDIENTE:       { label: 'Pendiente',   color: '#92400e', bg: '#fef3c7' },
    SOLICITADO:      { label: 'Solicitado',  color: '#1d4ed8', bg: '#dbeafe' },
    EN_TRANSITO:     { label: 'En tránsito', color: '#6d28d9', bg: '#ede9fe' },
    RECIBIDO_BODEGA: { label: 'En bodega',   color: '#065f46', bg: '#d1fae5' },
    ENTREGADO:       { label: 'Entregado',   color: '#14532d', bg: '#bbf7d0' },
  };
  return map[e] || { label: e || '?', color: '#888', bg: '#f5f5f5' };
}

function _eventoIcon(tipo) {
  const m = { CREADA: '📋', ESTADO: '🔄', ENTREGA_PARCIAL: '📦', ENTREGADO: '✅', CANCELADO: '❌', NOTA: '💬', FOTO: '📷' };
  return m[tipo] || '•';
}

// ── LISTA DE ÓRDENES ─────────────────────────────────────────────────
function renderOrdersList() {
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
    const isOwn = (order.creadoPor === userEmail) || rol === 'admin';
    const info  = Orders.estadoInfo(order.estado);
    const pct   = Orders.pctEntregado(order);

    const card = document.createElement('div');
    card.style.cssText = 'background:#fff;border-radius:12px;padding:16px;margin-bottom:12px;box-shadow:0 1px 4px rgba(0,0,0,.08);border:1px solid var(--border);cursor:pointer;transition:box-shadow .15s;';
    card.addEventListener('mouseenter', () => { card.style.boxShadow = '0 4px 16px rgba(0,0,0,.13)'; });
    card.addEventListener('mouseleave', () => { card.style.boxShadow = '0 1px 4px rgba(0,0,0,.08)'; });
    card.onclick = () => openOrderDetail(order.id);
    card.innerHTML = `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
            <span style="font-family:'DM Mono',monospace;font-weight:700;font-size:12px;color:var(--orange);">${escH(order.numero)}</span>
            <span style="font-size:11px;font-weight:700;padding:2px 9px;border-radius:20px;background:${info.bg};color:${info.color};">${info.label}</span>
            ${!isOwn ? '<span style="font-size:10px;color:var(--muted);background:var(--surface2);padding:2px 6px;border-radius:4px;">👁 Solo lectura</span>' : ''}
          </div>
          <div style="font-weight:600;font-size:15px;line-height:1.3;margin-bottom:2px;">${escH(order.clienteNombre || '—')}</div>
          ${order.clienteEmpresa ? `<div style="font-size:12px;color:var(--muted);">${escH(order.clienteEmpresa)}</div>` : ''}
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="font-size:10px;color:var(--muted);">CREADO</div>
          <div style="font-size:12px;font-weight:500;">${Orders.fmtDate(order.fechaCreacion)}</div>
          ${order.fechaEstEntrega ? `<div style="font-size:10px;color:var(--muted);margin-top:2px;">Est: ${Orders.fmtDate(order.fechaEstEntrega)}</div>` : ''}
        </div>
      </div>
      <div style="margin-top:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <span style="font-size:11px;color:var(--muted);">${(order.items || []).length} ítem(s) · ${pct}% entregado</span>
          <span style="font-size:11px;color:var(--muted);">Por: ${escH(order.creadoPor || '')}</span>
        </div>
        <div style="height:5px;background:var(--border);border-radius:4px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:${pct === 100 ? '#10b981' : 'var(--orange)'};border-radius:4px;"></div>
        </div>
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

  const rol      = App.getRol();
  const email    = Auth.getUser()?.email || '';
  const isOwn    = (order.creadoPor === email) || rol === 'admin';
  const isAdmin  = rol === 'admin';
  const info     = Orders.estadoInfo(order.estado);
  const pct      = Orders.pctEntregado(order);
  const activo   = order.estado !== 'ENTREGADO' && order.estado !== 'CANCELADO';
  const estados  = ['PENDIENTE', 'EN_PROCESO', 'ENTREGA_PARCIAL', 'ENTREGADO', 'CANCELADO'];

  container.innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--border);">
      <div>
        <div style="font-family:'DM Mono',monospace;font-size:12px;color:var(--muted);margin-bottom:4px;">${escH(order.numero)}</div>
        <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;">${escH(order.clienteNombre || '—')}</h2>
        <span style="font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;background:${info.bg};color:${info.color};">${info.label}</span>
      </div>
      ${isOwn && activo ? `
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <select id="sel-cambiar-estado" onchange="pedidoCambiarEstado(this.value)"
          style="padding:7px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;background:#fff;cursor:pointer;">
          <option value="">Cambiar estado…</option>
          ${estados.filter(e => e !== order.estado).map(e =>
            `<option value="${e}">${Orders.estadoInfo(e).label}</option>`).join('')}
        </select>
        <button onclick="pedidoRegistrarEntrega()" style="padding:7px 14px;background:var(--orange);color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">📦 Registrar entrega</button>
        ${isAdmin ? `<button onclick="pedidoEliminar()" style="padding:7px 14px;background:#fff;color:#dc2626;border:1px solid #dc2626;border-radius:8px;font-size:12px;cursor:pointer;">🗑 Eliminar</button>` : ''}
      </div>` : ''}
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;margin-bottom:14px;">
      <div style="background:#fff;border-radius:12px;padding:14px;border:1px solid var(--border);">
        <div style="font-weight:700;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;">📋 Cliente</div>
        ${_dRow('Nombre', order.clienteNombre)}
        ${_dRow('Empresa', order.clienteEmpresa)}
        ${order.clienteTel ? `<div style="display:flex;gap:8px;padding:3px 0;">
          <span style="font-size:12px;color:var(--muted);min-width:70px;flex-shrink:0;">Tel</span>
          <a href="tel:${escH(order.clienteTel)}" style="font-size:13px;color:var(--orange);">${escH(order.clienteTel)}</a>
        </div>` : ''}
        ${order.clienteEmail ? `<div style="display:flex;gap:8px;padding:3px 0;">
          <span style="font-size:12px;color:var(--muted);min-width:70px;flex-shrink:0;">Email</span>
          <a href="mailto:${escH(order.clienteEmail)}" style="font-size:13px;color:var(--orange);word-break:break-all;">${escH(order.clienteEmail)}</a>
        </div>` : ''}
        ${_dRow('Dirección', order.clienteDireccion)}
      </div>
      <div style="background:#fff;border-radius:12px;padding:14px;border:1px solid var(--border);">
        <div style="font-weight:700;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;">📅 Fechas</div>
        ${_dRow('Creado', Orders.fmtDate(order.fechaCreacion))}
        ${_dRow('Por', order.creadoPor)}
        ${_dRow('Entrega est.', order.fechaEstEntrega ? Orders.fmtDate(order.fechaEstEntrega) : '')}
        ${order.fechaEntregaReal ? _dRow('Entregado', Orders.fmtDate(order.fechaEntregaReal)) : ''}
        ${order.notas ? _dRow('Notas', order.notas) : ''}
      </div>
    </div>

    <div style="background:#fff;border-radius:12px;padding:14px;border:1px solid var(--border);margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <div style="font-weight:700;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;">📦 Ítems del pedido</div>
        <span style="font-size:12px;font-weight:700;color:${pct === 100 ? '#10b981' : 'var(--orange)'};">${pct}% entregado</span>
      </div>
      <div style="height:5px;background:var(--border);border-radius:4px;overflow:hidden;margin-bottom:12px;">
        <div style="height:100%;width:${pct}%;background:${pct === 100 ? '#10b981' : 'var(--orange)'};border-radius:4px;"></div>
      </div>
      ${_renderItemsTable(order.items || [])}
    </div>

    ${(order.archivos || []).length ? `
    <div style="background:#fff;border-radius:12px;padding:14px;border:1px solid var(--border);margin-bottom:14px;">
      <div style="font-weight:700;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;">📎 Archivos adjuntos</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        ${(order.archivos || []).map(a => `
          <div onclick="abrirLightbox('${escH(a.thumb)}',null)"
            style="width:80px;height:80px;border-radius:8px;overflow:hidden;cursor:zoom-in;border:1px solid var(--border);flex-shrink:0;">
            <img src="${escH(a.thumb)}" style="width:100%;height:100%;object-fit:cover;" alt="${escH(a.nombre || '')}">
          </div>`).join('')}
      </div>
    </div>` : ''}

    ${isOwn ? `
    <div style="background:#fff;border-radius:12px;padding:14px;border:1px solid var(--border);margin-bottom:14px;">
      <div style="font-weight:700;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;">📷 Adjuntar foto</div>
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <label style="display:inline-flex;align-items:center;gap:8px;padding:8px 16px;background:var(--surface);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:13px;">
          📷 Subir foto
          <input type="file" accept="image/*" capture="environment" style="display:none;" onchange="pedidoAgregarFoto(event)">
        </label>
        <span style="font-size:11px;color:var(--muted);">Máx. 3 fotos · ${(order.archivos || []).length}/3 adjuntadas</span>
      </div>
    </div>
    <div style="background:#fff;border-radius:12px;padding:14px;border:1px solid var(--border);margin-bottom:14px;">
      <div style="font-weight:700;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;">💬 Agregar nota</div>
      <div style="display:flex;gap:8px;">
        <input type="text" id="pedido-nota-inp" placeholder="Escribe un comentario o nota de seguimiento…"
          style="flex:1;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-family:inherit;"
          onkeydown="if(event.key==='Enter')pedidoAgregarNota()">
        <button onclick="pedidoAgregarNota()"
          style="padding:8px 16px;background:var(--orange);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">Agregar</button>
      </div>
    </div>` : ''}

    <div style="background:#fff;border-radius:12px;padding:14px;border:1px solid var(--border);">
      <div style="font-weight:700;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px;">📜 Historial</div>
      ${_renderTimeline(order.eventos || [])}
    </div>
  `;
}

function _dRow(label, val) {
  if (!val) return '';
  return `<div style="display:flex;gap:8px;padding:3px 0;">
    <span style="font-size:12px;color:var(--muted);min-width:70px;flex-shrink:0;">${escH(label)}</span>
    <span style="font-size:13px;word-break:break-word;">${escH(val)}</span>
  </div>`;
}

function _renderItemsTable(items) {
  if (!items.length) return '<p style="color:var(--muted);font-size:13px;margin:0;">Sin ítems registrados.</p>';
  return `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
  <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:440px;">
    <thead>
      <tr style="background:var(--surface2);">
        <th style="padding:7px 8px;text-align:left;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.3px;">Descripción</th>
        <th style="padding:7px 8px;text-align:left;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.3px;">Proveedor</th>
        <th style="padding:7px 8px;text-align:center;font-weight:700;font-size:11px;">Pedido</th>
        <th style="padding:7px 8px;text-align:center;font-weight:700;font-size:11px;">Entregado</th>
        <th style="padding:7px 8px;text-align:center;font-weight:700;font-size:11px;">Estado</th>
      </tr>
    </thead>
    <tbody>
      ${items.map(item => {
        const si = _itemEstadoInfo(item.estadoItem || 'PENDIENTE');
        const completo = (item.cantEntregada || 0) >= (item.cant || 0) && (item.cant || 0) > 0;
        return `<tr style="border-bottom:1px solid var(--border-light);">
          <td style="padding:7px 8px;">
            <div style="font-weight:500;">${escH(item.desc || '')}</div>
            ${item.ref ? `<div style="font-size:10px;color:var(--muted);font-family:'DM Mono',monospace;">${escH(item.ref)}</div>` : ''}
            ${item.notas ? `<div style="font-size:10px;color:var(--muted);font-style:italic;">${escH(item.notas)}</div>` : ''}
          </td>
          <td style="padding:7px 8px;color:var(--muted);">${escH(item.proveedor || '—')}</td>
          <td style="padding:7px 8px;text-align:center;font-weight:700;">${item.cant || 0}</td>
          <td style="padding:7px 8px;text-align:center;font-weight:700;color:${completo ? '#10b981' : 'var(--text)'};">${item.cantEntregada || 0}</td>
          <td style="padding:7px 8px;text-align:center;">
            <span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;background:${si.bg};color:${si.color};">${si.label}</span>
          </td>
        </tr>`;
      }).join('')}
    </tbody>
  </table></div>`;
}

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

// ── ACCIONES EN DETALLE ──────────────────────────────────────────────
function pedidoCambiarEstado(estado) {
  if (!estado || !_currentOrderId) return;
  const usuario = Auth.getUser()?.email || '';
  Orders.changeStatus(_currentOrderId, estado, usuario);
  const order = Orders.getById(_currentOrderId);
  Sync.saveOrder(order).catch(e => console.warn('saveOrder:', e));
  renderOrderDetail(_currentOrderId);
  toast('Estado actualizado: ' + Orders.estadoInfo(estado).label, 'success');
}

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
  if ((order.archivos || []).length >= 3) { toast('Máximo 3 fotos por orden', 'error'); return; }
  const reader = new FileReader();
  reader.onload = async ev => {
    const thumb = await Orders.compressPhoto(ev.target.result);
    if (!thumb) { toast('No se pudo comprimir la imagen', 'error'); return; }
    if (!order.archivos) order.archivos = [];
    order.archivos.push({ id: Date.now().toString(), nombre: file.name, thumb, fecha: new Date().toISOString() });
    Orders.addEvent(_currentOrderId, 'FOTO', 'Foto adjuntada: ' + file.name, Auth.getUser()?.email || '');
    Orders.update(_currentOrderId, { archivos: order.archivos });
    Sync.saveOrder(Orders.getById(_currentOrderId)).catch(e => console.warn('saveOrder:', e));
    renderOrderDetail(_currentOrderId);
    toast('✓ Foto adjuntada', 'success');
  };
  reader.readAsDataURL(file);
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

// ── REGISTRAR ENTREGA ────────────────────────────────────────────────
function pedidoRegistrarEntrega() {
  const order = Orders.getById(_currentOrderId);
  if (!order || !(order.items || []).length) { toast('Sin ítems para registrar', 'error'); return; }

  const body = document.getElementById('modal-entrega-body');
  body.innerHTML = order.items.map((item, i) => {
    const pend = (item.cant || 0) - (item.cantEntregada || 0);
    return `<div style="padding:10px 0;border-bottom:1px solid var(--border);">
      <div style="font-weight:600;font-size:13px;margin-bottom:7px;">
        ${escH(item.desc || '')}
        <span style="font-size:11px;font-weight:400;color:var(--muted);">(Pendiente: ${pend})</span>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <label style="font-size:12px;color:var(--muted);">Entregar ahora:</label>
        <input type="number" min="0" max="${pend}" value="0" data-idx="${i}" class="entrega-qty-inp"
          style="width:70px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;text-align:center;">
        <label style="font-size:12px;color:var(--muted);">Estado ítem:</label>
        <select data-idx="${i}" class="entrega-estado-sel"
          style="font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;cursor:pointer;">
          <option value="PENDIENTE">Pendiente</option>
          <option value="SOLICITADO">Solicitado a proveedor</option>
          <option value="EN_TRANSITO">En tránsito</option>
          <option value="RECIBIDO_BODEGA">Recibido en bodega</option>
          <option value="ENTREGADO" ${pend <= 0 ? 'selected' : ''}>Entregado</option>
        </select>
      </div>
    </div>`;
  }).join('');

  document.getElementById('modal-entrega').classList.add('open');
}

function confirmarEntrega() {
  const order = Orders.getById(_currentOrderId);
  if (!order) return;
  const usuario = Auth.getUser()?.email || '';

  document.querySelectorAll('.entrega-qty-inp').forEach(inp => {
    const idx = parseInt(inp.dataset.idx);
    const qty = parseInt(inp.value) || 0;
    const selE = document.querySelector('.entrega-estado-sel[data-idx="' + idx + '"]');
    if (qty > 0) order.items[idx].cantEntregada = (order.items[idx].cantEntregada || 0) + qty;
    if (selE) order.items[idx].estadoItem = selE.value;
  });

  const tot = order.items.reduce((s, i) => s + (i.cant || 0), 0);
  const ent = order.items.reduce((s, i) => s + (i.cantEntregada || 0), 0);
  const pct = tot > 0 ? Math.round((ent / tot) * 100) : 0;

  let nuevoEstado = order.estado;
  if (pct === 100) nuevoEstado = 'ENTREGADO';
  else if (pct > 0) nuevoEstado = 'ENTREGA_PARCIAL';

  Orders.update(_currentOrderId, {
    items: order.items,
    estado: nuevoEstado,
    fechaEntregaReal: pct === 100 ? new Date().toISOString().slice(0, 10) : order.fechaEntregaReal,
  });
  Orders.addEvent(_currentOrderId, 'ENTREGA_PARCIAL', `Entrega: ${ent}/${tot} ítems (${pct}%)`, usuario);

  Sync.saveOrder(Orders.getById(_currentOrderId)).catch(e => console.warn('saveOrder:', e));
  document.getElementById('modal-entrega').classList.remove('open');
  renderOrderDetail(_currentOrderId);
  toast('✓ Entrega registrada — ' + pct + '% completado', 'success');
}

// ── NUEVA ORDEN ──────────────────────────────────────────────────────
function abrirNuevoPedido() {
  _newOrderItems   = [];
  _newOrderArchivos = [];
  ['np-cliente-nombre','np-cliente-empresa','np-cliente-tel','np-cliente-email',
   'np-cliente-dir','np-fecha-entrega','np-notas','np-item-desc','np-item-ref','np-item-proveedor']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const cantEl = document.getElementById('np-item-cant'); if (cantEl) cantEl.value = '1';
  const ctrEl  = document.getElementById('np-foto-count'); if (ctrEl) ctrEl.textContent = '0/3 fotos';
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

async function npAgregarFoto(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (_newOrderArchivos.length >= 3) { toast('Máximo 3 fotos', 'error'); return; }
  const reader = new FileReader();
  reader.onload = async ev => {
    const thumb = await Orders.compressPhoto(ev.target.result);
    if (!thumb) { toast('Error al comprimir la imagen', 'error'); return; }
    _newOrderArchivos.push({ id: Date.now().toString(), nombre: file.name, thumb, fecha: new Date().toISOString() });
    const ctr = document.getElementById('np-foto-count');
    if (ctr) ctr.textContent = _newOrderArchivos.length + '/3 foto(s)';
    toast('✓ Foto agregada', 'success');
  };
  reader.readAsDataURL(file);
  e.target.value = '';
}

async function guardarNuevoPedido() {
  const nombre = (document.getElementById('np-cliente-nombre')?.value || '').trim();
  if (!nombre) { toast('Ingresa el nombre del cliente', 'error'); document.getElementById('np-cliente-nombre')?.focus(); return; }
  if (!_newOrderItems.length) { toast('Agrega al menos un ítem al pedido', 'error'); return; }

  const usuario = Auth.getUser()?.email || '';
  const order = Orders.add({
    clienteNombre:    nombre,
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
