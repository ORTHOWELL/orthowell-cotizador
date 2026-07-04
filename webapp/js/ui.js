/**
 * ui.js — Utilidades de interfaz, helpers, toasts, tabs, modales
 */

// ── FORMAT HELPERS ──────────────────────────────────────────────────
function fNum(n) { return Math.round(n).toLocaleString('es-CO'); }
function fCOP(n) { return '$' + fNum(n); }
function escH(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── TOAST ───────────────────────────────────────────────────────────
function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3500);
}

// ── TABS ────────────────────────────────────────────────────────────
function switchTab(t) {
  ['cotizar','consulta','catalogo','pedidos'].forEach((n, i) => {
    const tab = document.querySelectorAll('.tab')[i];
    if (tab) tab.classList.toggle('active', n === t);
    const panel = document.getElementById('panel-' + n);
    if (panel) panel.classList.toggle('active', n === t);
  });
  if (t === 'catalogo') renderCatalog();
  if (t === 'consulta') document.getElementById('consulta-input').focus();
  if (t === 'pedidos' && typeof renderOrdersList === 'function') renderOrdersList();
}

// ── MODAL PRODUCTO ──────────────────────────────────────────────────
function abrirNuevoProducto() {
  window._editProdId = null;
  document.getElementById('prod-modal-title').textContent = 'Nuevo Producto';
  ['prod-nombre','prod-precio','prod-precio2','prod-precio3',
   'prod-costo','prod-iva','prod-saldo','prod-marca','prod-ref']
    .forEach(id => document.getElementById(id).value = '');
  document.getElementById('ref-status').textContent = '';
  document.getElementById('modal-prod').classList.add('open');
}
function cerrarModalProd() {
  document.getElementById('modal-prod').classList.remove('open');
}
function checkRefUnique() {
  const inp = document.getElementById('prod-ref');
  const st  = document.getElementById('ref-status');
  const val = inp.value.trim().toUpperCase();
  if (!val) { st.textContent = ''; return; }
  const catalog = Catalog.getAll();
  const dup = catalog.find(p => p.ref === val && p.id !== window._editProdId);
  if (dup) {
    st.textContent = '✗ Ya existe en: ' + dup.nombre.substring(0, 40);
    st.style.color = 'var(--danger)'; inp.style.borderColor = 'var(--danger)';
  } else {
    st.textContent = '✓ Referencia disponible';
    st.style.color = 'var(--success)'; inp.style.borderColor = 'var(--success)';
  }
}

// ── MODAL IMAGEN (cotización o catálogo) ────────────────────────────
function abrirImgModal(type, catId, cotIdx) {
  window._imgTarget = { type, catId, cotIdx };
  window._selectedImg = null;
  const catalog = Catalog.getAll();
  const p = type === 'catalog' ? catalog.find(x => x.id === catId) : null;
  const name = type === 'catalog' ? p?.nombre : window._cotItems?.[cotIdx]?.nombre;
  document.getElementById('img-modal-title').textContent = 'Imagen: ' + (name || '').substring(0, 40);
  document.getElementById('img-q').value = name || '';
  document.getElementById('img-grid').innerHTML = '';
  document.getElementById('img-status').textContent = '';
  document.getElementById('paste-instructions').style.display = 'block';
  document.getElementById('paste-preview').style.display = 'none';
  document.getElementById('paste-img').src = '';
  document.getElementById('modal-img').classList.add('open');
  setTimeout(() => document.getElementById('paste-zone').focus(), 100);
}
function abrirImgModalBuscar(catId) { abrirImgModal('catalog', catId, null); }
function cerrarModalImg() {
  document.getElementById('modal-img').classList.remove('open');
  window._imgTarget = null; window._selectedImg = null;
  document.getElementById('file-inp').value = '';
}

// ── MODAL NOTAS PDF ─────────────────────────────────────────────────
function abrirNotasPDF() {
  const notes = Pdf.loadNotes();
  document.getElementById('pdf-notes-list').innerHTML = '';
  notes.forEach((n, i) => addNotaRow(n, i));
  document.getElementById('modal-notes').classList.add('open');
}
function cerrarNotasPDF() { document.getElementById('modal-notes').classList.remove('open'); }
function addNotaRow(text, idx) {
  const list = document.getElementById('pdf-notes-list');
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:8px;';
  row.dataset.idx = idx !== undefined ? idx : list.children.length;
  const inp = document.createElement('input');
  inp.type = 'text'; inp.value = text; inp.style.flex = '1';
  inp.placeholder = 'Texto de la nota...';
  const btnDel = document.createElement('button');
  btnDel.className = 'btn-del'; btnDel.textContent = '✕';
  btnDel.onclick = () => row.remove();
  row.append(inp, btnDel);
  list.appendChild(row);
}
function guardarNotasPDF() {
  const notes = [...document.querySelectorAll('#pdf-notes-list div')]
    .map(row => row.querySelector('input').value.trim())
    .filter(Boolean);
  Pdf.saveNotes(notes);
  cerrarNotasPDF();
  toast('✓ Notas del PDF guardadas', 'success');
}
function resetNotasPDF() {
  if (!confirm('¿Restaurar las notas predeterminadas?')) return;
  Pdf.saveNotes([...Pdf.DEFAULT_NOTES]);
  abrirNotasPDF();
  toast('Notas restauradas', 'success');
}

// ── MODAL BRANDING PDF ──────────────────────────────────────────────
function abrirBrand() {
  const b = Pdf.loadBrand();
  window._brandHdr = b.hdr; window._brandFtr = b.ftr;
  _refreshBrandPreview('hdr'); _refreshBrandPreview('ftr');
  document.getElementById('modal-brand').classList.add('open');
}
function cerrarBrand() { document.getElementById('modal-brand').classList.remove('open'); }
function _refreshBrandPreview(zone) {
  const img = document.getElementById('brand-' + zone + '-preview');
  const ph  = document.getElementById('brand-' + zone + '-placeholder');
  const clr = document.getElementById('brand-' + zone + '-clear');
  const data = zone === 'hdr' ? window._brandHdr : window._brandFtr;
  if (data) {
    img.src = data; img.style.display = 'block';
    ph.style.display = 'none'; clr.style.display = 'block';
  } else {
    img.src = ''; img.style.display = 'none';
    ph.style.display = 'block'; clr.style.display = 'none';
  }
}
function loadBrandImg(zone, e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 4 * 1024 * 1024) { toast('Imagen muy grande (máx 4MB)', 'error'); return; }
  const reader = new FileReader();
  reader.onload = ev => {
    const image = new Image();
    image.onload = () => {
      const MAX = 2100;
      let w = image.width, h = image.height;
      if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(image, 0, 0, w, h);
      const b64 = canvas.toDataURL('image/jpeg', 0.90);
      if (zone === 'hdr') window._brandHdr = b64;
      else window._brandFtr = b64;
      _refreshBrandPreview(zone);
      toast('✓ Imagen cargada — presiona Guardar', 'success');
    };
    image.src = ev.target.result;
  };
  reader.readAsDataURL(file);
  e.target.value = '';
}
function clearBrandImg(e, zone) {
  e.stopPropagation();
  if (zone === 'hdr') window._brandHdr = null;
  else window._brandFtr = null;
  _refreshBrandPreview(zone);
}
function _compressBrandForSheets(b64) {
  if (!b64) return Promise.resolve(null);
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const attempts = [[800, 0.75], [600, 0.65], [500, 0.55], [400, 0.45]];
      for (const [maxW, q] of attempts) {
        let w = img.width, h = img.height;
        if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        const result = c.toDataURL('image/jpeg', q);
        if (result.length <= 44000) return resolve(result);
      }
      resolve(null); // no cabe en Sheets, omitir
    };
    img.onerror = () => resolve(null);
    img.src = b64;
  });
}

async function guardarBrand() {
  Pdf.saveBrand(window._brandHdr, window._brandFtr);
  cerrarBrand();
  const hdrTxt = window._brandHdr ? '✓ encabezado personalizado' : 'diseño ORTHOWELL';
  const ftrTxt = window._brandFtr ? '✓ pie personalizado' : 'pie ORTHOWELL';
  toast('Configuración guardada — ' + hdrTxt + ' · ' + ftrTxt, 'success');
  // Sincronizar a Sheets para que sea visible en todos los dispositivos
  try {
    const [hdrS, ftrS] = await Promise.all([
      _compressBrandForSheets(window._brandHdr),
      _compressBrandForSheets(window._brandFtr),
    ]);
    await App.updateBrand(hdrS, ftrS);
    toast('✓ Marca sincronizada en todos los dispositivos', 'success');
  } catch(e) {
    console.warn('Brand Sheets sync failed:', e);
  }
}

// ── MODAL IMÁGENES MASIVAS ──────────────────────────────────────────
function abrirModalImagenesMasivas() {
  document.getElementById('zip-status').textContent = '';
  document.getElementById('url-status').textContent = '';
  document.getElementById('masiva-status').textContent = '';
  document.getElementById('masiva-progress').style.display = 'none';
  document.getElementById('modal-img-masivas').classList.add('open');
}
function cerrarModalImagenesMasivas() {
  window._masivaStopped = true;
  document.getElementById('modal-img-masivas').classList.remove('open');
}

// ── COMPRESS IMAGE ──────────────────────────────────────────────────
function compressAndSet(file, callback) {
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      const MAX = 800;
      let w = img.width, h = img.height;
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
        else { w = Math.round(w * MAX / h); h = MAX; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      callback(canvas.toDataURL('image/jpeg', 0.75));
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

// Convert a URL to base64 (for PDF images from Drive)
async function urlToBase64(url) {
  // Usar fetch para evitar problemas de CORS con Drive/lh3.googleusercontent.com
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const blob = await resp.blob();
    const b64 = await new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onloadend = () => res(reader.result);
      reader.onerror = rej;
      reader.readAsDataURL(blob);
    });
    // Redimensionar via canvas
    return await new Promise((res) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 500;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
          else { w = Math.round(w * MAX / h); h = MAX; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        res(canvas.toDataURL('image/jpeg', 0.75));
      };
      img.onerror = () => res(b64); // fallback: devolver blob sin redimensionar
      img.src = b64;
    });
  } catch(e) {
    // Fallback: img element con crossOrigin
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const MAX = 500;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
          else { w = Math.round(w * MAX / h); h = MAX; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.75));
      };
      img.onerror = reject;
      img.src = url;
    });
  }
}

// ── IMAGE SEARCH (Wikipedia/Wikimedia Commons) ──────────────────────
async function buscarImagen() {
  const q = (document.getElementById('img-q').value || '').trim();
  if (!q) { toast('Escribe qué imagen buscar', 'error'); return; }
  const status = document.getElementById('img-status');
  const grid = document.getElementById('img-grid');
  status.innerHTML = '<span class="loading-spin"></span> Buscando...';
  grid.innerHTML = ''; window._selectedImg = null;

  const terms = [q + ' equipo médico', q + ' medical device', q];
  let results = [];
  for (const term of terms) {
    try {
      const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(term)}&srnamespace=6&format=json&origin=*&srlimit=9`;
      const r = await fetch(url);
      const d = await r.json();
      const pages = d.query?.search || [];
      if (pages.length) {
        results = pages.map(p => ({
          title: p.title.replace('File:', ''),
          thumb: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(p.title.replace('File:',''))}?width=200`,
          full: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(p.title.replace('File:',''))}`
        }));
        break;
      }
    } catch(e) {}
  }

  if (!results.length) {
    const unsplashTerms = [q, q.split(' ').slice(0,2).join(' ')];
    results = unsplashTerms.flatMap((t, i) => Array.from({length:3}, (_, j) => ({
      title: `${t} ${j+1}`,
      thumb: `https://source.unsplash.com/200x200/?${encodeURIComponent(t)}&sig=${i*3+j}`,
      full: `https://source.unsplash.com/400x400/?${encodeURIComponent(t)}&sig=${i*3+j}`
    })));
  }

  status.textContent = `${results.length} imágenes — clic para seleccionar`;
  grid.innerHTML = results.map((r, i) =>
    `<div class="img-grid-item" onclick="selImagen(this,'${r.full.replace(/'/g,"\\'")}')">
      <img src="${r.thumb}" loading="lazy" onerror="this.closest('.img-grid-item').style.display='none'">
      <div class="img-check">✓</div>
    </div>`
  ).join('');
}

async function selImagen(el, url) {
  document.querySelectorAll('.img-grid-item').forEach(x => x.classList.remove('selected'));
  el.classList.add('selected');
  const status = document.getElementById('img-status');
  status.innerHTML = '<span class="loading-spin"></span> Descargando...';
  try {
    const resp = await fetch(url);
    const blob = await resp.blob();
    compressAndSet(new File([blob], 'img.jpg', {type: blob.type}), b64 => {
      window._selectedImg = b64;
      status.textContent = '✓ Lista — clic en "Usar imagen"';
    });
  } catch(e) {
    window._selectedImg = url;
    status.textContent = '✓ Seleccionada (URL externa)';
  }
}

// ── FILE UPLOAD ─────────────────────────────────────────────────────
function onFileImg(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { toast('Imagen muy grande (máx 10MB)', 'error'); return; }
  compressAndSet(file, (b64) => {
    window._selectedImg = b64;
    confirmarImg();
  });
  e.target.value = '';
}

// ── SYNC STATUS UI ──────────────────────────────────────────────────
function setSyncStatus(state, text) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  el.className = 'sync-status ' + state;
  el.querySelector('span:last-child').textContent = text;
  const btn = document.getElementById('btn-sync');
  if (btn) btn.classList.toggle('spinning', state === 'syncing');
}
