/**
 * cotizar.js — Gestión de ítems de cotización y pestaña Consulta
 */

// Estado global de ítems de cotización
window._cotItems = [];

// ── BUSCAR PRODUCTO (dropdown en "Agregar Productos") ──────────────
function buscarProducto(q) {
  const el = document.getElementById('search-results');
  if (!q.trim()) { el.classList.remove('visible'); return; }
  const catalog = Catalog.getAll();
  const ql = q.toLowerCase();
  const res = catalog.filter(p =>
    p.nombre.toLowerCase().includes(ql) ||
    (p.ref   || '').toLowerCase().includes(ql) ||
    (p.marca || '').toLowerCase().includes(ql)
  ).slice(0, 20);

  if (!res.length) {
    el.innerHTML = '<div style="padding:14px;text-align:center;color:#aaa;font-size:13px;">Sin resultados</div>';
    el.classList.add('visible'); return;
  }

  const btnStyle = (active) => `cursor:pointer;font-size:11px;border-radius:5px;padding:3px 9px;font-weight:700;border:1.5px solid ${active?'#f26222':'#ddd'};background:${active?'#fff5ef':'#f8f8f6'};color:${active?'#c0522a':'#555'};transition:background .15s;`;
  el.innerHTML = res.map(p => `
    <div class="search-item" style="cursor:default;">
      <div style="display:flex;align-items:center;gap:10px;">
        <div class="search-item-thumb" style="flex-shrink:0;">
          ${p.imageUrl ? `<img src="${escH(p.imageUrl)}" alt="" loading="lazy">` : '<span style="font-size:18px;">📦</span>'}
        </div>
        <div style="flex:1;min-width:0;">
          <div class="search-item-name">${escH(p.nombre)}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:2px;">
            ${p.ref   ? `<span style="font-size:10px;color:#aaa;font-family:monospace;">${escH(p.ref)}</span>` : ''}
            ${p.marca ? `<span style="font-size:10px;color:var(--muted);">🏷️ ${escH(p.marca)}</span>` : ''}
          </div>
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;align-items:center;">
        <button style="${btnStyle(true)}" onclick="event.stopPropagation();addFromCatalog(${p.id},'precio')">＋ P1 · ${fCOP(p.precio||0)}</button>
        ${(p.precio2||0)>0?`<button style="${btnStyle(false)}" onclick="event.stopPropagation();addFromCatalog(${p.id},'precio2')">＋ P2 · ${fCOP(p.precio2)}</button>`:''}
        ${(p.precio3||0)>0?`<button style="${btnStyle(false)}" onclick="event.stopPropagation();addFromCatalog(${p.id},'precio3')">＋ P3 · ${fCOP(p.precio3)}</button>`:''}
        <span style="font-size:10px;background:#f0f4ff;border-radius:4px;padding:2px 6px;font-weight:700;color:#3b5bdb;">IVA ${p.iva||0}%</span>
        <span style="font-size:10px;background:#fff3e8;border-radius:4px;padding:2px 6px;color:#c0692a;">💰 ${fCOP(p.costo||0)}</span>
        <span style="font-size:10px;background:#f0fdf4;border-radius:4px;padding:2px 6px;color:var(--success);">Saldo: ${p.saldo||0}</span>
      </div>
    </div>`).join('');
  el.classList.add('visible');
}

// ── AGREGAR DESDE CATÁLOGO ────────────────────────────────────────
function addFromCatalog(id, precioKey) {
  const p = Catalog.getById(id);
  if (!p) return;
  const precio = (precioKey && p[precioKey]) ? p[precioKey] : p.precio;
  const precioLabel = precioKey === 'precio2' ? 'P2' : precioKey === 'precio3' ? 'P3' : 'P1';
  const ex = window._cotItems.find(i => i.nombre === p.nombre);
  if (ex) { ex.cant++; ex.precio = precio; }
  else window._cotItems.push({ nombre: p.nombre, ref: p.ref || '', cant: 1, precio, iva: p.iva || 0, obs: '', imageUrl: p.imageUrl || '', driveFileId: p.driveFileId || '' });
  document.getElementById('search-input').value = '';
  document.getElementById('search-results').classList.remove('visible');
  renderItems();
  toast(`✓ Agregado (${precioLabel}): ` + p.nombre.substring(0, 30), 'success');
}

// ── AGREGAR MANUAL ────────────────────────────────────────────────
function agregarManual(guardarEnCatalogo) {
  const nombre = document.getElementById('m-desc').value.trim();
  if (!nombre) { toast('Ingresa la descripción del producto', 'error'); return; }

  const precio  = parseFloat(document.getElementById('m-precio').value)  || 0;
  const precio2 = parseFloat(document.getElementById('m-precio2').value) || 0;
  const precio3 = parseFloat(document.getElementById('m-precio3').value) || 0;
  const costo   = parseFloat(document.getElementById('m-costo').value)   || 0;
  const iva     = parseFloat(document.getElementById('m-iva').value)     || 0;
  const saldo   = parseFloat(document.getElementById('m-saldo').value)   || 0;
  const cant    = parseInt(document.getElementById('m-cant').value)      || 1;
  const obs     = document.getElementById('m-obs').value.trim();
  const ref     = document.getElementById('m-ref').value.trim().toUpperCase();
  const marca   = document.getElementById('m-marca').value.trim();

  const ex = window._cotItems.find(i => i.nombre === nombre);
  if (ex) ex.cant += cant;
  else window._cotItems.push({ nombre, ref, cant, precio, iva, obs, imageUrl: '' });

  if (guardarEnCatalogo) {
    const catalog = Catalog.getAll();
    if (ref && catalog.find(p => p.ref === ref)) {
      toast('⚠ La referencia ya existe en el catálogo — ítem agregado solo a cotización', 'error');
    } else {
      let finalRef = ref;
      if (!finalRef) {
        const base = nombre.substring(0,12).toUpperCase().replace(/[^A-Z0-9]/g,'-').replace(/-+/g,'-');
        let cand = base, n = 1;
        while (catalog.find(p => p.ref === cand)) { cand = base + '-' + n; n++; }
        finalRef = cand;
      }
      Catalog.add({ nombre, ref: finalRef, marca, precio, precio2, precio3, costo, iva, saldo });
      toast(`✅ Agregado a cotización y catálogo · ref: ${finalRef}`, 'success');
    }
  } else {
    toast('✓ Ítem agregado a la cotización', 'success');
  }

  ['m-desc','m-ref','m-marca','m-precio','m-precio2','m-precio3','m-costo','m-iva','m-saldo','m-obs']
    .forEach(id => document.getElementById(id).value = '');
  document.getElementById('m-cant').value = '1';
  renderItems();
}

// ── NÚMERO DE COTIZACIÓN (consecutivo diario por usuario) ─────────
function generarNumeroCot(userInfo) {
  const name  = (userInfo?.name || userInfo?.email || '').toUpperCase().trim();
  const words = name.split(/\s+/);
  const initials = words.length >= 2
    ? (words[0][0] || 'X') + (words[1][0] || 'X')
    : (name.substring(0, 2) || 'XX');

  const now  = new Date();
  const dd   = String(now.getDate()).padStart(2, '0');
  const mm   = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();

  const key = `ow_cot_seq_${initials}_${dd}${mm}${yyyy}`;
  const seq = parseInt(localStorage.getItem(key) || '0') + 1;
  localStorage.setItem(key, String(seq));

  return `${initials}${dd}${mm}-${String(seq).padStart(3, '0')}`;
}

// ── RENDER TABLA DE ÍTEMS ─────────────────────────────────────────
function renderItems() {
  const c = document.getElementById('items-container');
  if (!window._cotItems.length) {
    c.innerHTML = '<div class="empty-state"><div class="icon">📋</div><p>Aún no has agregado productos.</p></div>';
    document.getElementById('items-count').textContent = '';
    updateSummary(); return;
  }
  const total = window._cotItems.reduce((s, i) => s + i.cant * i.precio, 0);
  document.getElementById('items-count').textContent = window._cotItems.length + ' ítem(s)';

  const table = document.createElement('table');
  table.className = 'items-table';
  table.innerHTML =
    '<thead><tr>' +
    '<th style="width:48px;">IMG</th>' +
    '<th style="width:26px;">#</th>' +
    '<th>Descripción / Observaciones</th>' +
    '<th style="width:80px;">Cant.</th>' +
    '<th style="width:130px;">Vr. Unit.</th>' +
    '<th style="width:110px;">Vr. Total</th>' +
    '<th style="width:30px;"></th>' +
    '</tr></thead>';

  const tbody = document.createElement('tbody');
  window._cotItems.forEach((item, idx) => {
    const tr = document.createElement('tr');

    // Thumb
    const thumbDiv = document.createElement('div');
    thumbDiv.className = 'item-thumb-btn';
    thumbDiv.dataset.idx = idx;
    thumbDiv.title = 'Clic para agregar imagen';
    thumbDiv.onclick = () => abrirImgModal('cot', null, idx);
    if (item.imageUrl) {
      const im = document.createElement('img');
      im.src = item.imageUrl; im.alt = '';
      im.onerror = () => { thumbDiv.innerHTML = '📷'; };
      thumbDiv.appendChild(im);
    } else {
      thumbDiv.textContent = '📷';
    }
    const tdThumb = document.createElement('td');
    tdThumb.setAttribute('data-label', 'Imagen');
    tdThumb.appendChild(thumbDiv);

    const tdNum = document.createElement('td');
    tdNum.setAttribute('data-label', '#');
    tdNum.style.cssText = 'text-align:center;color:#aaa;';
    tdNum.textContent = idx + 1;

    // Descripción + ref + observaciones en una sola celda
    const inpName = document.createElement('textarea');
    inpName.value = item.nombre; inpName.rows = 2;
    inpName.style.cssText = 'width:100%;min-width:140px;resize:vertical;min-height:40px;font-size:12.5px;padding:5px 7px;border:1px solid var(--border);border-radius:6px;font-family:inherit;line-height:1.4;';
    inpName.onchange = function() { window._cotItems[idx].nombre = this.value; updateSummary(); };
    const tdName = document.createElement('td');
    tdName.setAttribute('data-label', 'Descripción');
    tdName.appendChild(inpName);
    if (item.ref) {
      const refLabel = document.createElement('div');
      refLabel.style.cssText = 'font-size:10px;color:#aaa;font-family:monospace;margin-top:3px;';
      refLabel.textContent = item.ref;
      tdName.appendChild(refLabel);
    }
    const inpObs = document.createElement('textarea');
    inpObs.value = item.obs || '';
    inpObs.placeholder = 'Observación (opcional)...';
    inpObs.rows = 1;
    inpObs.style.cssText = 'width:100%;resize:vertical;min-height:30px;font-size:11.5px;padding:4px 7px;border:1px solid var(--border-light);border-radius:6px;font-family:inherit;line-height:1.4;margin-top:5px;color:var(--text2);background:var(--surface);';
    inpObs.onchange = function() { window._cotItems[idx].obs = this.value; };
    tdName.appendChild(inpObs);

    const inpCant = document.createElement('input');
    inpCant.type = 'number'; inpCant.value = item.cant; inpCant.min = 1;
    inpCant.style.cssText = 'font-size:14px;font-weight:600;text-align:center;';
    inpCant.onchange = function() {
      window._cotItems[idx].cant = parseFloat(this.value) || 0;
      tdTotal.textContent = fCOP(window._cotItems[idx].cant * window._cotItems[idx].precio);
      updateSummary();
    };
    const tdCant = document.createElement('td');
    tdCant.setAttribute('data-label', 'Cantidad');
    tdCant.appendChild(inpCant);

    const inpPrecio = document.createElement('input');
    inpPrecio.type = 'number'; inpPrecio.value = item.precio; inpPrecio.min = 0;
    inpPrecio.style.cssText = 'font-size:13px;';
    inpPrecio.onchange = function() {
      window._cotItems[idx].precio = parseFloat(this.value) || 0;
      tdTotal.textContent = fCOP(window._cotItems[idx].cant * window._cotItems[idx].precio);
      updateSummary();
    };
    const tdPrecio = document.createElement('td');
    tdPrecio.setAttribute('data-label', 'Vr. Unit.');
    tdPrecio.appendChild(inpPrecio);
    const ivaBadge = document.createElement('div');
    ivaBadge.style.cssText = 'font-size:9px;font-weight:700;margin-top:3px;text-align:center;letter-spacing:.3px;';
    if ((item.iva || 0) > 0) {
      ivaBadge.style.color = '#2d8a4e';
      ivaBadge.textContent = `IVA ${item.iva}% incl.`;
    } else {
      ivaBadge.style.color = '#aaa';
      ivaBadge.textContent = 'Sin IVA';
    }
    tdPrecio.appendChild(ivaBadge);

    const tdTotal = document.createElement('td');
    tdTotal.setAttribute('data-label', 'Vr. Total');
    tdTotal.style.cssText = 'font-weight:700;color:var(--orange);font-size:13px;';
    tdTotal.textContent = fCOP(item.cant * item.precio);

    const btnDel = document.createElement('button');
    btnDel.className = 'btn-del'; btnDel.textContent = '✕';
    btnDel.onclick = () => { window._cotItems.splice(idx, 1); renderItems(); };
    const tdDel = document.createElement('td');
    tdDel.setAttribute('data-label', '');
    tdDel.appendChild(btnDel);

    tr.append(tdThumb, tdNum, tdName, tdCant, tdPrecio, tdTotal, tdDel);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  const tfoot = document.createElement('tfoot');
  tfoot.innerHTML =
    '<tr class="total-row">' +
    '<td colspan="5" class="total-label">TOTAL (IVA INCLUIDO)</td>' +
    '<td colspan="3">$' + fNum(total) + '</td>' +
    '</tr>';
  table.appendChild(tfoot);
  const wrap = document.createElement('div');
  wrap.className = 'items-table-wrap';
  wrap.appendChild(table);
  c.innerHTML = ''; c.appendChild(wrap);
  updateSummary();
}

// ── SUMMARY ───────────────────────────────────────────────────────
function updateSummary() {
  document.getElementById('sum-cliente').textContent = document.getElementById('cliente')?.value || '—';
  document.getElementById('sum-num').textContent     = document.getElementById('num_cot')?.value || '—';
  document.getElementById('sum-cond').innerHTML      = `<span class="badge badge-dark">${document.getElementById('condiciones')?.value || ''}</span>`;
  document.getElementById('sum-items').textContent   = `${window._cotItems.length} producto(s)`;
  document.getElementById('sum-total').textContent   = '$' + fNum(window._cotItems.reduce((s,i)=>s+i.cant*i.precio,0));
}

function limpiarFormulario() {
  if (!confirm('¿Limpiar toda la cotización?')) return;
  window._cotItems = [];
  ['cliente','contacto','notas-extra'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const fecha = document.getElementById('fecha');
  if (fecha) fecha.valueAsDate = new Date();
  const numEl = document.getElementById('num_cot');
  if (numEl && typeof Auth !== 'undefined') numEl.value = generarNumeroCot(Auth.getUser());
  renderItems();
  toast('Formulario limpiado', 'success');
}

// ── HISTORIAL DE COTIZACIONES ─────────────────────────────────────
const _COT_CACHE_KEY = 'ow_cots_v1';
let _cotsRemoteLoaded = false;

function _getCotCache() {
  try { return JSON.parse(localStorage.getItem(_COT_CACHE_KEY) || '[]'); } catch(e) { return []; }
}
function _saveCotCache(cots) {
  localStorage.setItem(_COT_CACHE_KEY, JSON.stringify(cots.slice(-300)));
}

function guardarCotizacion() {
  const cliente = document.getElementById('cliente')?.value.trim();
  if (!cliente && !window._cotItems.length) {
    toast('Agrega al menos un cliente o producto antes de guardar', 'error'); return;
  }
  const user   = (typeof Auth !== 'undefined') ? Auth.getUser() : null;
  const numero = document.getElementById('num_cot')?.value.trim() || '—';

  // Guardar ítems sin imágenes base64 (solo URLs de catálogo)
  const items = window._cotItems.map(i => ({
    nombre: i.nombre, ref: i.ref || '', cant: i.cant, precio: i.precio,
    iva: i.iva || 0, obs: i.obs || '',
    imageUrl:    (i.imageUrl    && !i.imageUrl.startsWith('data:'))    ? i.imageUrl    : '',
    driveFileId: i.driveFileId || '',
  }));

  const cot = {
    id:               'COT-' + Date.now(),
    numero,
    fecha:            document.getElementById('fecha')?.value        || '',
    fechaCreacion:    new Date().toISOString(),
    creadoPor:        user?.email || '',
    creadoPorNombre:  user?.name  || user?.email || '',
    cliente:          document.getElementById('cliente')?.value.trim()     || '',
    contacto:         document.getElementById('contacto')?.value.trim()    || '',
    ciudad:           document.getElementById('ciudad')?.value.trim()      || '',
    condiciones:      document.getElementById('condiciones')?.value        || '',
    validez:          document.getElementById('validez')?.value            || '',
    notasExtra:       document.getElementById('notas-extra')?.value.trim() || '',
    items,
    total: items.reduce((s, i) => s + i.cant * i.precio, 0),
  };

  // Cache local inmediato (sin bloquear)
  const cots = _getCotCache();
  cots.push(cot);
  _saveCotCache(cots);

  // Sync a Sheets en segundo plano
  if (typeof Sync !== 'undefined') {
    Sync.saveCotizacion(cot).catch(e => console.warn('Sync cot failed:', e));
  }
  toast(`✅ Cotización ${numero} guardada`, 'success');
}

function abrirHistorial() {
  const modal = document.getElementById('modal-historial-cots');
  if (!modal) return;
  modal.classList.add('open');
  _renderHistorialCots();

  // Cargar de Sheets la primera vez que se abre
  if (!_cotsRemoteLoaded && typeof Sync !== 'undefined') {
    _cotsRemoteLoaded = true;
    Sync.loadCotizaciones().then(remote => {
      if (!remote?.length) return;
      // Fusionar: remote tiene prioridad, mantener locales que no estén en remote
      const remoteIds = new Set(remote.map(c => c.id));
      const localOnly = _getCotCache().filter(c => !remoteIds.has(c.id));
      _saveCotCache([...localOnly, ...remote]);
      _renderHistorialCots();
    }).catch(() => {});
  }
}

function cerrarHistorial() {
  document.getElementById('modal-historial-cots')?.classList.remove('open');
}

function _renderHistorialCots() {
  const listEl = document.getElementById('hist-cots-list');
  if (!listEl) return;

  const rol       = (typeof App !== 'undefined') ? App.getRol() : 'vendedor';
  const userEmail = (typeof Auth !== 'undefined') ? (Auth.getUser()?.email || '') : '';

  const q = (document.getElementById('hist-cots-search')?.value || '').toLowerCase().trim();

  let cots = _getCotCache().slice().reverse(); // más recientes primero
  if (rol !== 'admin') cots = cots.filter(c => c.creadoPor === userEmail);
  if (q) cots = cots.filter(c =>
    (c.numero  || '').toLowerCase().includes(q) ||
    (c.cliente || '').toLowerCase().includes(q) ||
    (c.creadoPorNombre || '').toLowerCase().includes(q)
  );

  if (!cots.length) {
    listEl.innerHTML =
      '<div style="text-align:center;padding:48px 20px;color:var(--muted);">' +
      '<div style="font-size:40px;margin-bottom:12px;">📄</div>' +
      '<div style="font-weight:700;font-size:15px;color:var(--text2);">Sin cotizaciones guardadas</div>' +
      '<div style="font-size:13px;margin-top:6px;">Usa el botón "💾 Guardar" al crear una cotización</div>' +
      '</div>';
    return;
  }

  const fmt = iso => {
    if (!iso) return '';
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  };

  listEl.innerHTML = cots.map(c => `
    <div class="hist-cot-card">
      <div class="hist-cot-top">
        <span class="hist-cot-num">${escH(c.numero || '—')}</span>
        <span class="hist-cot-date">${fmt(c.fechaCreacion)}</span>
      </div>
      <div class="hist-cot-cliente">${escH(c.cliente || 'Sin cliente')}</div>
      ${rol === 'admin' && c.creadoPorNombre
        ? `<div class="hist-cot-autor">👤 ${escH(c.creadoPorNombre)}</div>` : ''}
      <div class="hist-cot-meta">
        <span>${(c.items||[]).length} ítem(s)</span>
        <span style="font-weight:700;color:var(--orange);">${fCOP(c.total||0)}</span>
      </div>
      <div class="hist-cot-actions">
        <button class="btn btn-primary btn-sm" onclick="cargarCotizacionGuardada('${c.id}')">📂 Abrir</button>
        ${(rol === 'admin' || c.creadoPor === userEmail)
          ? `<button class="btn btn-sm" style="color:var(--danger);border:1.5px solid var(--danger);background:transparent;" onclick="eliminarCotizacionGuardada('${c.id}')">🗑️ Eliminar</button>`
          : ''}
      </div>
    </div>`).join('');
}

function cargarCotizacionGuardada(id) {
  const cot = _getCotCache().find(c => c.id === id);
  if (!cot) { toast('Cotización no encontrada', 'error'); return; }
  if (window._cotItems.length > 0 &&
      !confirm('Hay una cotización en progreso. ¿Cargarla y descartar los cambios actuales?')) return;

  const set = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val || ''; };
  set('cliente',    cot.cliente);
  set('num_cot',    cot.numero);
  set('fecha',      cot.fecha);
  set('condiciones',cot.condiciones);
  set('ciudad',     cot.ciudad);
  set('contacto',   cot.contacto);
  set('validez',    cot.validez);
  set('notas-extra',cot.notasExtra);

  window._cotItems = (cot.items || []).map(i => ({ ...i }));
  cerrarHistorial();
  renderItems();
  updateSummary();
  switchTab('cotizar');
  toast(`📂 Cotización ${cot.numero} cargada`, 'success');
}

function eliminarCotizacionGuardada(id) {
  if (!confirm('¿Eliminar esta cotización del historial? Esta acción no se puede deshacer.')) return;
  _saveCotCache(_getCotCache().filter(c => c.id !== id));
  if (typeof Sync !== 'undefined') {
    Sync.deleteCotizacion(id).catch(e => console.warn('Delete cot sync failed:', e));
  }
  _renderHistorialCots();
  toast('Cotización eliminada del historial', 'success');
}

// ── PESTAÑA CONSULTA ──────────────────────────────────────────────
let _consultaSelected = null;

function consultaBuscar(q) {
  const ql = q.trim().toLowerCase();
  const countEl  = document.getElementById('consulta-count');
  const bodyEl   = document.getElementById('consulta-body');
  const emptyEl  = document.getElementById('consulta-empty');
  const listEl   = document.getElementById('consulta-list');
  const titleEl  = document.getElementById('consulta-list-title');

  if (!ql) {
    bodyEl.style.display  = 'none';
    emptyEl.style.display = 'block';
    countEl.textContent   = '';
    return;
  }

  const res = Catalog.search(ql);
  countEl.textContent = res.length
    ? `${res.length} producto${res.length > 1 ? 's' : ''} encontrado${res.length > 1 ? 's' : ''}`
    : 'Sin resultados';

  if (!res.length) {
    bodyEl.style.display  = 'none';
    emptyEl.style.display = 'block';
    emptyEl.innerHTML = `<div class="icon">😕</div>
      <p style="font-size:15px;font-weight:600;color:var(--text2);">Sin resultados para "<em>${escH(q)}</em>"</p>
      <p style="font-size:12px;margin-top:6px;">Intenta con otro nombre, referencia o marca</p>`;
    return;
  }

  emptyEl.style.display = 'none';
  bodyEl.style.display  = 'flex';
  titleEl.textContent   = `${res.length} resultado${res.length > 1 ? 's' : ''}`;

  listEl.innerHTML = '';
  const frag = document.createDocumentFragment();
  res.forEach(p => {
    const item = document.createElement('div');
    item.className = 'consulta-list-item';
    item.dataset.id = p.id;
    item.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer;border-radius:8px;transition:background .12s;border:1.5px solid var(--border-light);background:var(--white);min-width:220px;max-width:320px;flex:1;';
    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'consulta-list-thumb';
    if (p.imageUrl || p.driveFileId) {
      const im = document.createElement('img');
      im.alt = ''; im.loading = 'lazy';
      Catalog.loadImage(im, p.imageUrl, p.driveFileId, thumbWrap);
      thumbWrap.appendChild(im);
    } else {
      thumbWrap.textContent = '📦';
    }
    item.appendChild(thumbWrap);
    const info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0;';
    info.innerHTML =
      `<div style="font-weight:700;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escH(p.nombre)}</div>` +
      `<div style="font-size:10px;color:var(--muted);font-family:'DM Mono',monospace;">${escH(p.ref||'')}</div>` +
      `<div style="font-size:12px;font-weight:700;color:var(--orange);">${fCOP(p.precio||0)}</div>`;
    item.appendChild(info);
    item.onmouseenter = () => { if (!item.classList.contains('active')) item.style.background = 'var(--orange-light)'; };
    item.onmouseleave = () => { if (!item.classList.contains('active')) item.style.background = 'var(--white)'; };
    item.onclick = () => consultaMostrarDetalle(p, item);
    frag.appendChild(item);
  });
  listEl.appendChild(frag);
  if (res.length) consultaMostrarDetalle(res[0], listEl.firstChild);
}

function consultaMostrarDetalle(p, itemEl) {
  _consultaSelected = p;
  document.querySelectorAll('.consulta-list-item').forEach(el => {
    el.classList.remove('active');
    el.style.background = 'var(--white)';
    el.style.borderColor = 'var(--border-light)';
  });
  if (itemEl) {
    itemEl.classList.add('active');
    itemEl.style.background = 'var(--orange-light)';
    itemEl.style.borderColor = 'var(--orange)';
    itemEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  const rol = (typeof App !== 'undefined') ? App.getRol() : 'vendedor';
  const isAliado = rol === 'aliado';

  const margen   = (p.precio > 0 && p.costo > 0) ? ((p.precio - p.costo) / p.precio * 100).toFixed(1) : null;
  const utilidad = (p.precio > 0 && p.costo > 0) ? fCOP(p.precio - p.costo) : null;

  const detailEl = document.getElementById('consulta-detail');
  detailEl.innerHTML = `
    <div class="consulta-result">
      <div class="consulta-hero">
        <div class="consulta-img" id="consulta-img-wrap" style="${(p.imageUrl||p.driveFileId)?'cursor:zoom-in;':''}" title="${(p.imageUrl||p.driveFileId)?'Clic para ampliar':''}">
          ${!(p.imageUrl||p.driveFileId) ? '📦' : ''}
        </div>
        <div style="flex:1;min-width:0;">
          <div class="consulta-name">${escH(p.nombre)}</div>
          ${p.ref ? `<div class="consulta-ref">${escH(p.ref)}</div>` : ''}
          ${!isAliado ? `<div class="consulta-marca">
            ${p.marca ? `🏷️ <strong>${escH(p.marca)}</strong>` : '<span style="color:var(--muted);">Sin marca registrada</span>'}
          </div>` : ''}
          ${!isAliado ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;">
            <button class="consulta-add-btn" onclick="consultaAgregarCot(${p.id})">+ Agregar a cotización</button>
            <button class="btn btn-outline btn-sm" onclick="switchTab('catalogo');Catalog.editProduct(${p.id})">✏️ Editar producto</button>
          </div>` : ''}
        </div>
      </div>
      <div class="consulta-grid">
        <div class="consulta-tile precio1">
          <div class="consulta-tile-label">💰 Precio 1 (Principal)</div>
          <div class="consulta-tile-value">${fCOP(p.precio||0)}</div>
          <div class="consulta-tile-sub">Precio de venta estándar</div>
        </div>
        ${!isAliado ? `<div class="consulta-tile">
          <div class="consulta-tile-label">Precio 2</div>
          <div class="consulta-tile-value">${fCOP(p.precio2||0)}</div>
          <div class="consulta-tile-sub">Clientes especiales</div>
        </div>` : ''}
        <div class="consulta-tile">
          <div class="consulta-tile-label">Precio 3</div>
          <div class="consulta-tile-value">${fCOP(p.precio3||0)}</div>
          <div class="consulta-tile-sub">Aliados / distribuidores</div>
        </div>
        ${!isAliado ? `<div class="consulta-tile costo">
          <div class="consulta-tile-label">🏭 Costo</div>
          <div class="consulta-tile-value">${fCOP(p.costo||0)}</div>
          <div class="consulta-tile-sub">Costo de adquisición</div>
        </div>` : ''}
        ${!isAliado ? `<div class="consulta-tile ${margen !== null ? (parseFloat(margen) >= 0 ? 'margen-pos' : 'margen-neg') : ''}">
          <div class="consulta-tile-label">📊 Margen</div>
          <div class="consulta-tile-value">${margen !== null ? margen + '%' : '—'}</div>
          <div class="consulta-tile-sub">${utilidad ? 'Utilidad: ' + utilidad : 'Sin costo registrado'}</div>
        </div>` : ''}
        <div class="consulta-tile iva">
          <div class="consulta-tile-label">🧾 IVA ${p.iva||0}%</div>
          <div class="consulta-tile-value">${p.iva > 0 ? fCOP(Math.round((p.precio||0) / (1 + (p.iva||0) / 100))) : fCOP(p.precio||0)}</div>
          <div class="consulta-tile-sub">${p.iva > 0 ? 'Valor base (precio sin IVA)' : 'No aplica IVA'}</div>
        </div>
        <div class="consulta-tile" style="${(p.saldo||0) > 0 ? 'background:var(--success-bg);border-color:#a8e6c5;' : ''}">
          <div class="consulta-tile-label">📦 Saldo en bodega</div>
          <div class="consulta-tile-value" style="${(p.saldo||0) > 0 ? 'color:var(--success);' : ''}">${p.saldo||0}</div>
          <div class="consulta-tile-sub">${(p.saldo||0) > 0 ? 'Unidades disponibles' : 'Sin stock registrado'}</div>
        </div>
        ${!isAliado ? `<div class="consulta-tile" style="grid-column:span 2;">
          <div class="consulta-tile-label">🏷️ Marca / Referencia</div>
          <div class="consulta-tile-value" style="font-size:15px;">${escH(p.marca||'—')}</div>
          <div class="consulta-tile-sub" style="font-family:'DM Mono',monospace;">${escH(p.ref||'Sin referencia')}</div>
        </div>` : `<div class="consulta-tile">
          <div class="consulta-tile-label">🔖 Referencia</div>
          <div class="consulta-tile-value" style="font-size:15px;font-family:'DM Mono',monospace;">${escH(p.ref||'—')}</div>
          <div class="consulta-tile-sub">Código del producto</div>
        </div>`}
      </div>
    </div>`;

  // Cargar imagen con autenticación Drive y habilitar clic para ampliar
  if (p.imageUrl || p.driveFileId) {
    const imgWrap = document.getElementById('consulta-img-wrap');
    const im = document.createElement('img');
    im.alt = '';
    im.style.cssText = 'width:100%;height:100%;object-fit:contain;border-radius:8px;display:block;';
    Catalog.loadImage(im, p.imageUrl, p.driveFileId, imgWrap);
    imgWrap.appendChild(im);
    imgWrap.onclick = () => {
      // Si Drive API ya cargó una imagen de mejor calidad en im.src (blob URL o data URL
      // diferente al thumbnail guardado), usar esa directamente en el lightbox.
      const liveSrc = (im.complete && im.naturalWidth > 0) ? im.src : '';
      const thumb = (liveSrc && liveSrc !== p.imageUrl) ? liveSrc : (p.imageUrl || liveSrc || '');
      abrirLightbox(thumb, p.driveFileId || null);
    };
  }
}

function consultaAgregarCot(id) {
  const p = Catalog.getById(id);
  if (!p) return;
  const ex = window._cotItems.find(i => i.nombre === p.nombre);
  if (ex) ex.cant++;
  else window._cotItems.push({ nombre: p.nombre, ref: p.ref||'', cant: 1, precio: p.precio||0, iva: p.iva||0, obs: '', imageUrl: p.imageUrl||'', driveFileId: p.driveFileId||'' });
  toast(`✓ "${p.nombre.substring(0,30)}..." agregado a la cotización`, 'success');
}
