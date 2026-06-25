/**
 * catalog.js — Gestión del catálogo: CRUD, búsqueda, importación, exportación.
 * Las imágenes ya NO se guardan en base64 aquí; usan URLs de Google Drive.
 */

const Catalog = (() => {
  let _catalog = [];

  // Productos default para primera instalación (sin imágenes)
  const DEFAULTS = [
    {id:1,nombre:'PESA ADULTO',precio:289000,ref:'PESA-ADULTO-STD',marca:''},
    {id:2,nombre:'PULSOXÍMETRO PEDIÁTRICO',precio:110000,ref:'PULSOX-PED-STD',marca:''},
    {id:3,nombre:'TENSIOMETRO MANUAL CLASSICC I',precio:50000,ref:'TENS-CLASSICC-I',marca:''},
    {id:4,nombre:'PULSOXÍMETRO ADULTO LATIDOS',precio:80000,ref:'PULSOX-ADU-LAT',marca:''},
    {id:5,nombre:'CINTA MÉTRICA GMD',precio:5000,ref:'CINTA-MET-GMD',marca:'GMD'},
    {id:6,nombre:'FONENDOSCOPIO ADULTO HS-30L',precio:35000,ref:'FONEN-ADU-HS30L',marca:''},
    {id:7,nombre:'EQUIPO DE ÓRGANOS GMD',precio:600000,ref:'ORGANOS-GMD-STD',marca:'GMD'},
    {id:8,nombre:'EQUIPO DE ÓRGANOS PREMIUM',precio:1620000,ref:'ORGANOS-PREMIUM',marca:''},
    {id:9,nombre:'MARTILLO REFLEJOS',precio:25000,ref:'MART-REFLEJOS',marca:''},
    {id:10,nombre:'MANGO LARINGOSCOPIO MEDIANO SG',precio:688000,ref:'LARING-MANGO-SG',marca:'SG'},
  ].map(p => ({...p, precio2:0, precio3:0, costo:0, iva:0, saldo:0, imageUrl:'', driveFileId:''}));

  // ── PERSISTENCIA LOCAL (cache sin imágenes base64) ──────────────
  function _saveCache() {
    try {
      localStorage.setItem(CONFIG.CATALOG_CACHE_KEY, JSON.stringify(_catalog));
    } catch(e) {
      // localStorage lleno → limpiar cache antiguo
      localStorage.removeItem(CONFIG.CATALOG_CACHE_KEY);
    }
  }
  function _loadCache() {
    const raw = localStorage.getItem(CONFIG.CATALOG_CACHE_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch(e) { return null; }
  }

  // ── INIT ────────────────────────────────────────────────────────
  function init() {
    const cached = _loadCache();
    if (cached && cached.length) {
      _catalog = _migrate(cached);
    } else {
      _catalog = JSON.parse(JSON.stringify(DEFAULTS));
    }
  }

  // Migrar campos faltantes
  function _migrate(arr) {
    return arr.map(p => ({
      id:          p.id          || 0,
      ref:         p.ref         || '',
      nombre:      p.nombre      || '',
      marca:       p.marca       || '',
      precio:      p.precio      || 0,
      precio2:     p.precio2     || 0,
      precio3:     p.precio3     || 0,
      costo:       p.costo       || 0,
      iva:         p.iva         || 0,
      saldo:       p.saldo       || 0,
      imageUrl:    p.imageUrl    || p.img || '',    // compatibilidad
      driveFileId: p.driveFileId || '',
    }));
  }

  // ── SETTERS ─────────────────────────────────────────────────────
  function setFromRemote(remote) {
    _catalog = _migrate(remote);
    _saveCache();
  }

  // ── GETTERS ─────────────────────────────────────────────────────
  function getAll() { return _catalog; }
  function getById(id) { return _catalog.find(p => p.id === id) || null; }
  function search(q) {
    if (!q) return _catalog;
    const ql = q.toLowerCase();
    return _catalog.filter(p =>
      p.nombre.toLowerCase().includes(ql) ||
      (p.ref   || '').toLowerCase().includes(ql) ||
      (p.marca || '').toLowerCase().includes(ql)
    );
  }

  // ── ADD / UPDATE / DELETE ────────────────────────────────────────
  function add(data) {
    const id = _catalog.length ? Math.max(..._catalog.map(p => p.id)) + 1 : 1;
    const p = { id, ...data, imageUrl: '', driveFileId: '' };
    _catalog.push(p);
    _saveCache();
    _syncSave();
    return p;
  }

  function update(id, data) {
    const idx = _catalog.findIndex(p => p.id === id);
    if (idx < 0) return null;
    _catalog[idx] = { ..._catalog[idx], ...data };
    _saveCache();
    _syncSave();
    return _catalog[idx];
  }

  function remove(id) {
    _catalog = _catalog.filter(p => p.id !== id);
    _saveCache();
    _syncSave();
  }

  function setImage(id, imageUrl, driveFileId) {
    const idx = _catalog.findIndex(p => p.id === id);
    if (idx < 0) return;
    _catalog[idx].imageUrl    = imageUrl;
    _catalog[idx].driveFileId = driveFileId || '';
    _saveCache();
    _syncSave();
  }

  // Debounce para no saturar la API al editar rápido
  let _syncTimer = null;
  function _syncSave() {
    if (!Auth.isAuthenticated()) return;
    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(async () => {
      try { await Sync.saveCatalogToSheets(_catalog); }
      catch(e) { console.warn('Auto-save to Sheets failed:', e); }
    }, 1500);
  }

  // ── GUARDAR PRODUCTO (desde modal) ──────────────────────────────
  function saveFromModal() {
    const nombre = document.getElementById('prod-nombre').value.trim();
    const ref    = document.getElementById('prod-ref').value.trim().toUpperCase().replace(/[^A-Z0-9\-]/g,'');
    if (!nombre) { toast('Ingresa el nombre del producto', 'error'); return false; }
    if (!ref)    { toast('La referencia es obligatoria', 'error'); document.getElementById('prod-ref').focus(); return false; }

    const dup = _catalog.find(p => p.ref === ref && p.id !== window._editProdId);
    if (dup) {
      document.getElementById('ref-status').textContent = '✗ Ref ya usada por: ' + dup.nombre.substring(0, 35);
      document.getElementById('ref-status').style.color = 'var(--danger)';
      document.getElementById('prod-ref').focus();
      toast('Referencia duplicada — usa una única', 'error');
      return false;
    }

    const n = id => { const v = parseFloat(document.getElementById(id).value); return isNaN(v) ? 0 : v; };
    const data = {
      nombre,
      precio:  n('prod-precio'),
      precio2: n('prod-precio2'),
      precio3: n('prod-precio3'),
      costo:   n('prod-costo'),
      iva:     n('prod-iva'),
      saldo:   n('prod-saldo'),
      marca:   document.getElementById('prod-marca').value.trim(),
      ref
    };

    if (window._editProdId) {
      update(window._editProdId, data);
      toast('✓ Producto actualizado', 'success');
    } else {
      add(data);
      toast('✓ Producto agregado al catálogo', 'success');
    }
    cerrarModalProd();
    renderCatalog(document.getElementById('cat-search')?.value || '');
    return true;
  }

  // ── EDITAR PRODUCTO (abrir modal con datos) ──────────────────────
  function editProduct(id) {
    window._editProdId = id;
    const p = getById(id);
    if (!p) return;
    document.getElementById('prod-modal-title').textContent = 'Editar Producto';
    document.getElementById('prod-nombre').value  = p.nombre;
    document.getElementById('prod-precio').value  = p.precio  ?? 0;
    document.getElementById('prod-precio2').value = p.precio2 ?? 0;
    document.getElementById('prod-precio3').value = p.precio3 ?? 0;
    document.getElementById('prod-costo').value   = p.costo   ?? 0;
    document.getElementById('prod-iva').value     = p.iva     ?? 0;
    document.getElementById('prod-saldo').value   = p.saldo   ?? 0;
    document.getElementById('prod-marca').value   = p.marca   || '';
    document.getElementById('prod-ref').value     = p.ref     || '';
    document.getElementById('ref-status').textContent = '';
    document.getElementById('modal-prod').classList.add('open');
  }

  function deleteProduct(id) {
    if (!confirm('¿Eliminar este producto del catálogo?')) return;
    remove(id);
    renderCatalog(document.getElementById('cat-search')?.value || '');
    toast('Producto eliminado', 'success');
  }

  // ── RENDER CATÁLOGO (virtual scroll por batches) ─────────────────
  let _filtered = [];
  let _page = 0;
  const PAGE_SIZE = 40;

  function renderCatalog(filter) {
    const q = (filter || '').toLowerCase();
    _filtered = search(q);
    _page = 0;
    const grid = document.getElementById('catalog-grid');
    if (!grid) return;
    grid.innerHTML = '';
    document.getElementById('cat-count').textContent = _filtered.length + ' producto(s)';

    if (!_filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state'; empty.style.gridColumn = '1/-1';
      empty.innerHTML = '<div class="icon">📦</div><p>Sin resultados</p>';
      grid.appendChild(empty);
      return;
    }
    _renderPage();
  }

  function _renderPage() {
    const grid = document.getElementById('catalog-grid');
    if (!grid) return;
    const slice = _filtered.slice(_page * PAGE_SIZE, (_page + 1) * PAGE_SIZE);
    if (!slice.length) return;

    const frag = document.createDocumentFragment();
    slice.forEach(p => frag.appendChild(_buildCard(p)));
    grid.appendChild(frag);
    _page++;
    if (_page * PAGE_SIZE < _filtered.length) requestAnimationFrame(_renderPage);
  }

  function _buildCard(p) {
    const card = document.createElement('div');
    card.className = 'catalog-card';
    card.dataset.id = p.id;

    const imgWrap = document.createElement('div');
    imgWrap.className = 'catalog-card-img';
    if (p.imageUrl) {
      const im = document.createElement('img');
      im.alt = ''; im.loading = 'lazy';
      im.src = p.imageUrl;
      // Si Drive aún no procesó el thumbnail, reintenta hasta 4 veces (Drive puede tardar ~30s)
      let _retries = 0;
      im.onerror = () => {
        if (_retries < 4 && p.imageUrl && p.imageUrl.includes('drive.google.com')) {
          _retries++;
          const delay = _retries * 8000; // 8s, 16s, 24s, 32s
          setTimeout(() => { im.src = p.imageUrl + '&_r=' + _retries; }, delay);
        } else {
          imgWrap.replaceChildren(Object.assign(document.createElement('span'), {textContent:'📦', style:'font-size:34px'}));
        }
      };
      imgWrap.appendChild(im);
    } else {
      imgWrap.appendChild(Object.assign(document.createElement('span'), {textContent:'📦', style:'font-size:34px'}));
    }

    const ov = document.createElement('div');
    ov.className = 'img-overlay';
    ov.innerHTML =
      `<button class="img-overlay-btn" onclick="abrirImgModal('catalog',${p.id},null)">📁 Subir foto</button>` +
      `<button class="img-overlay-btn" onclick="abrirImgModalBuscar(${p.id})">🔍 Buscar</button>`;
    imgWrap.appendChild(ov);
    card.appendChild(imgWrap);

    const body = document.createElement('div');
    body.className = 'catalog-card-body';
    const margen = (p.precio > 0) ? ((p.precio - (p.costo||0)) / p.precio * 100).toFixed(1) : null;
    body.innerHTML =
      `<div class="catalog-card-name">${escH(p.nombre)}</div>` +
      `<div style="font-size:11px;color:var(--muted);margin-bottom:3px;">🏷️ ${escH(p.marca||'—')}</div>` +
      `<div class="catalog-card-price">P1: ${fCOP(p.precio||0)}</div>` +
      `<div style="display:flex;gap:4px;flex-wrap:wrap;margin:3px 0;">` +
        `<span style="background:#f0f0ec;font-size:10px;font-weight:600;padding:2px 6px;border-radius:4px;">P2: ${fCOP(p.precio2||0)}</span>` +
        `<span style="background:#f0f0ec;font-size:10px;font-weight:600;padding:2px 6px;border-radius:4px;">P3: ${fCOP(p.precio3||0)}</span>` +
      `</div>` +
      `<div style="display:flex;gap:4px;flex-wrap:wrap;margin:2px 0;">` +
        `<span style="background:#fff3e8;color:#c0692a;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;border-left:3px solid var(--orange);">💰 ${fCOP(p.costo||0)}</span>` +
        `<span style="background:#f0f4ff;color:#3b5bdb;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;">IVA ${p.iva||0}%</span>` +
        `<span style="background:#f0fdf4;color:var(--success);font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;">Saldo: ${p.saldo||0}</span>` +
        (margen !== null ? `<span style="background:#f5f5f0;color:${margen>=0?'var(--success)':'var(--danger)'};font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;">${margen}% margen</span>` : '') +
      `</div>` +
      `<div class="catalog-card-meta">${p.ref?'<span class="ref-badge">'+escH(p.ref)+'</span>':''}</div>` +
      `<div class="catalog-card-actions">` +
        `<button class="cat-btn edit" onclick="Catalog.editProduct(${p.id})">✏️ Editar</button>` +
        `<button class="cat-btn del" onclick="Catalog.deleteProduct(${p.id})">✕ Borrar</button>` +
      `</div>`;
    card.appendChild(body);
    return card;
  }

  // Limpia el caché de imágenes del SW para que la próxima carga traiga la imagen nueva
  function _clearImageCache() {
    if (!navigator.serviceWorker?.controller) return;
    const mc = new MessageChannel();
    navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_IMAGE_CACHE' }, [mc.port2]);
  }

  // ── CONFIRM IMAGE (desde modal de imagen) ────────────────────────
  async function confirmarImg() {
    const selected = window._selectedImg;
    const target = window._imgTarget;
    if (!selected) { toast('Selecciona, sube o pega una imagen primero', 'error'); return; }

    if (target.type === 'catalog') {
      const p = getById(target.catId);
      if (!p) return;

      // Subir a Drive si tenemos conexión y es base64
      if (Auth.isAuthenticated() && selected.startsWith('data:image')) {
        try {
          toast('Subiendo imagen a Drive...', 'success');
          const result = await Sync.uploadImageToDrive(p.ref || `prod_${p.id}`, selected);
          // Guardar URL de Drive para persistencia en Sheets
          setImage(target.catId, result.url, result.fileId);
          _clearImageCache();
          // Mostrar base64 INMEDIATAMENTE en la tarjeta (Drive tarda ~30s en procesar el thumbnail)
          // Restaurar URL de Drive justo después para que el sync a Sheets use la URL correcta
          p.imageUrl = selected;
          renderCatalog(document.getElementById('cat-search')?.value || '');
          p.imageUrl = result.url;
          return;
        } catch(e) {
          console.warn('Drive upload failed, using local:', e);
          setImage(target.catId, selected, '');
        }
      } else {
        setImage(target.catId, selected, '');
      }
      renderCatalog(document.getElementById('cat-search')?.value || '');
    } else {
      // Imagen para item de cotización (solo local, no va a Drive)
      const idx = target.cotIdx;
      if (window._cotItems?.[idx]) {
        window._cotItems[idx].imageUrl = selected;
        const btn = document.querySelector(`#items-container .item-thumb-btn[data-idx="${idx}"]`);
        if (btn) {
          btn.innerHTML = '';
          const im = document.createElement('img');
          im.src = selected; im.alt = '';
          btn.appendChild(im);
        }
      }
    }
    cerrarModalImg();
    toast('✓ Imagen guardada', 'success');
  }

  // ── IMPORT SISTEMA CONTABLE ──────────────────────────────────────
  function importarSistemaContable(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const wb = XLSX.read(ev.target.result, {type:'array'});
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});

        let headerRow = -1;
        for (let i = 0; i < Math.min(rows.length, 15); i++) {
          if (rows[i].some(c => String(c).toUpperCase().trim() === 'DETALLE')) {
            headerRow = i; break;
          }
        }
        if (headerRow < 0) { toast('No se reconoció el formato del sistema contable', 'error'); return; }

        const hdr = rows[headerRow].map(c => String(c).toUpperCase().trim());
        const I = {
          NOMBRE: hdr.findIndex(h => h === 'DETALLE'),
          REF:    hdr.findIndex(h => h === 'COD BARRAS'),
          MARCA:  hdr.findIndex(h => h === 'MARCA'),
          P1:     hdr.findIndex(h => h === 'PRECIO NORMAL'),
          P2:     hdr.findIndex(h => h === 'CLIENTES'),
          P3:     hdr.findIndex(h => h === 'ALIADOS'),
          IVA:    hdr.findIndex(h => h === '%IVA'),
          SALDO:  hdr.findIndex(h => h === 'SALDO'),
          COSTO:  hdr.findIndex(h => h === 'COSTO'),
        };
        if (I.NOMBRE < 0) { toast('No se encontró columna DETALLE', 'error'); return; }

        const num = v => { const n = parseFloat(String(v).replace(/[^0-9.]/g,'')); return isNaN(n) ? 0 : n; };
        const str = v => String(v || '').trim();
        const refsSeen = new Set(_catalog.map(p => (p.ref||'').toUpperCase()));
        let updated = 0, added = 0, skipped = 0;
        let nextId = _catalog.length ? Math.max(..._catalog.map(p => p.id)) + 1 : 1;

        for (let i = headerRow + 2; i < rows.length; i++) {
          const row = rows[i];
          const nombre = str(row[I.NOMBRE]);
          if (!nombre || nombre.startsWith('**') || nombre.length < 2) continue;
          let ref = str(I.REF >= 0 ? row[I.REF] : row[0]).toUpperCase().replace(/\s+/g,'');
          if (!ref) { skipped++; continue; }

          const marca = I.MARCA >= 0 ? str(row[I.MARCA]) : '';
          const p1    = I.P1    >= 0 ? num(row[I.P1])   : 0;
          const p2    = I.P2    >= 0 ? num(row[I.P2])   : 0;
          const p3    = I.P3    >= 0 ? num(row[I.P3])   : 0;
          const iva   = I.IVA   >= 0 ? num(row[I.IVA])  : 0;
          const saldo = I.SALDO >= 0 ? num(row[I.SALDO]): 0;
          const costo = I.COSTO >= 0 ? num(row[I.COSTO]): 0;

          const existing = _catalog.find(p => (p.ref||'').toUpperCase() === ref);
          if (existing) {
            Object.assign(existing, {nombre,marca,precio:p1,precio2:p2,precio3:p3,costo,iva,saldo});
            updated++;
          } else {
            if (refsSeen.has(ref)) { skipped++; continue; }
            refsSeen.add(ref);
            _catalog.push({id:nextId++,nombre,ref,marca,precio:p1,precio2:p2,precio3:p3,costo,iva,saldo,imageUrl:'',driveFileId:''});
            added++;
          }
        }
        _saveCache();
        _syncSave();
        renderCatalog(document.getElementById('cat-search')?.value || '');
        toast(`✅ ${updated} actualizados · ${added} nuevos · ${skipped} omitidos`, 'success');
      } catch(err) { toast('Error: ' + err.message, 'error'); }
    };
    reader.readAsArrayBuffer(file);
  }

  // ── IMPORT EXCEL GENÉRICO ────────────────────────────────────────
  function importarExcel(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const wb = XLSX.read(ev.target.result, {type:'array'});
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
        if (rows.length < 2) { toast('El archivo parece vacío', 'error'); return; }

        const header = rows[0].map(h => String(h).toUpperCase().trim());
        const iNombre  = header.findIndex(h => h.includes('NOMBRE') || h.includes('DESCRIPCION') || h.includes('DESCRIPCIÓN') || h.includes('PRODUCTO'));
        const iPrecio  = header.findIndex(h => h.includes('PRECIO') || h.includes('PRICE') || h.includes('VALOR'));
        const iRef     = header.findIndex(h => h.includes('REF') || h.includes('CODIGO') || h.includes('CÓDIGO') || h.includes('SKU'));
        const iCosto   = header.findIndex(h => h.includes('COSTO') || h.includes('COST'));
        const iPrecio2 = header.findIndex(h => h==='PRECIO 2' || h==='PRECIO2' || h==='P2');
        const iPrecio3 = header.findIndex(h => h==='PRECIO 3' || h==='PRECIO3' || h==='P3');
        const iIva     = header.findIndex(h => h.includes('IVA'));
        const iSaldo   = header.findIndex(h => h.includes('SALDO') || h.includes('STOCK'));
        const iMarca   = header.findIndex(h => h.includes('MARCA') || h.includes('BRAND'));
        if (iNombre < 0) { toast('No se encontró columna NOMBRE', 'error'); return; }

        const maxId = _catalog.length ? Math.max(..._catalog.map(p => p.id)) : 0;
        const refsSeen = new Set(_catalog.map(p => (p.ref||'').toUpperCase()));
        let nextId = maxId + 1, nuevos = [], skipped = 0;

        rows.slice(1).forEach(row => {
          const nombre = String(row[iNombre]||'').trim();
          if (!nombre) return;
          const precio = parseFloat(String(row[iPrecio >= 0 ? iPrecio : -1]||'0').replace(/[^0-9.]/g,'')) || 0;
          let ref = String(row[iRef >= 0 ? iRef : -1]||'').trim().toUpperCase().replace(/[^A-Z0-9\-]/g,'');

          const existing = ref
            ? _catalog.find(p => p.ref === ref)
            : _catalog.find(p => p.nombre.toUpperCase() === nombre.toUpperCase());

          const _nv = i => i >= 0 ? (parseFloat(String(row[i]||'').replace(/[^0-9.]/g,''))||0) : 0;
          if (existing) {
            existing.precio  = precio || existing.precio;
            existing.costo   = _nv(iCosto)   || existing.costo;
            existing.precio2 = _nv(iPrecio2) || existing.precio2;
            existing.precio3 = _nv(iPrecio3) || existing.precio3;
            existing.iva     = _nv(iIva)     || existing.iva;
            existing.saldo   = _nv(iSaldo)   || existing.saldo;
            if (iMarca >= 0 && row[iMarca]) existing.marca = String(row[iMarca]).trim();
          } else {
            if (!ref) {
              const base = nombre.substring(0,12).toUpperCase().replace(/[^A-Z0-9]/g,'-').replace(/-+/g,'-');
              let cand = base, n = 1;
              while (refsSeen.has(cand)) { cand = base + '-' + n; n++; }
              ref = cand;
            }
            if (refsSeen.has(ref)) { skipped++; return; }
            refsSeen.add(ref);
            nuevos.push({id:nextId++,nombre,ref,marca:iMarca>=0?String(row[iMarca]||'').trim():'',
              precio,precio2:_nv(iPrecio2),precio3:_nv(iPrecio3),
              costo:_nv(iCosto),iva:_nv(iIva),saldo:_nv(iSaldo),imageUrl:'',driveFileId:''});
          }
        });

        _catalog = _catalog.concat(nuevos);
        _saveCache();
        _syncSave();
        renderCatalog(document.getElementById('cat-search')?.value || '');
        toast(`✓ ${nuevos.length} nuevos, ${rows.length-1-nuevos.length-skipped} actualizados`, 'success');
      } catch(err) { toast('Error al leer el archivo: ' + err.message, 'error'); }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  }

  // ── EXPORT EXCEL ─────────────────────────────────────────────────
  function exportarExcel() {
    if (!_catalog.length) { toast('El catálogo está vacío', 'error'); return; }
    const rows = [['REFERENCIA','NOMBRE','MARCA','PRECIO 1','PRECIO 2','PRECIO 3','COSTO','IVA %','SALDO','IMAGE_URL']];
    _catalog.forEach(p => rows.push([
      p.ref||'', p.nombre, p.marca||'',
      p.precio||0, p.precio2||0, p.precio3||0,
      p.costo||0, p.iva||0, p.saldo||0, p.imageUrl||''
    ]));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{wch:22},{wch:50},{wch:16},{wch:14},{wch:14},{wch:14},{wch:14},{wch:8},{wch:10},{wch:60}];
    XLSX.utils.book_append_sheet(wb, ws, 'Catálogo');
    XLSX.writeFile(wb, 'catalogo_orthowell.xlsx');
    toast('✓ Excel exportado', 'success');
  }

  // ── ZIP IMPORT ────────────────────────────────────────────────────
  function importarZIP(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    const status = document.getElementById('zip-status');
    status.innerHTML = '<span class="loading-spin"></span> Leyendo ZIP...';

    const doImport = async (JSZip) => {
      const zip = await JSZip.loadAsync(file);
      const imgFiles = Object.keys(zip.files).filter(n =>
        /\.(jpg|jpeg|png|webp|gif)$/i.test(n) && !zip.files[n].dir
      );
      if (!imgFiles.length) { status.textContent = '⚠ No se encontraron imágenes en el ZIP'; return; }

      let matched = 0, notFound = 0, done = 0;
      status.innerHTML = `<span class="loading-spin"></span> Procesando ${imgFiles.length} imágenes...`;

      for (const name of imgFiles) {
        const ref = name.split('/').pop().replace(/\.[^.]+$/, '').trim().toUpperCase();
        const prod = _catalog.find(p =>
          (p.ref||'').toUpperCase() === ref ||
          (p.nombre||'').toUpperCase().includes(ref)
        );
        const blob = await zip.files[name].async('blob');
        const imgFile = new File([blob], name, {type: blob.type || 'image/jpeg'});

        if (prod) {
          await new Promise(resolve => compressAndSet(imgFile, async b64 => {
            try {
              if (Auth.isAuthenticated()) {
                const result = await Sync.uploadImageToDrive(prod.ref || `prod_${prod.id}`, b64);
                setImage(prod.id, result.url, result.fileId);
              } else {
                setImage(prod.id, b64, '');
              }
              matched++;
            } catch(e) {
              setImage(prod.id, b64, '');
              matched++;
            }
            done++;
            resolve();
          }));
        } else {
          notFound++;
          done++;
        }
        status.innerHTML = `<span class="loading-spin"></span> ${done}/${imgFiles.length} · ${matched} asignadas`;
      }

      renderCatalog(document.getElementById('cat-search')?.value || '');
      status.textContent = `✅ ${matched} imágenes asignadas · ${notFound} sin coincidencia`;
      toast(`✅ ZIP: ${matched} imágenes cargadas`, 'success');
    };

    if (window.JSZip) { doImport(window.JSZip); return; }
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    s.onload = () => doImport(window.JSZip).catch(err => { status.textContent = '⚠ Error: ' + err.message; });
    s.onerror = () => { status.textContent = '⚠ No se pudo cargar JSZip'; };
    document.head.appendChild(s);
  }

  // ── IMPORT URLs DESDE EXCEL ──────────────────────────────────────
  async function importarURLsExcel(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    const status = document.getElementById('url-status');
    status.innerHTML = '<span class="loading-spin"></span> Leyendo Excel...';
    const reader = new FileReader();
    reader.onload = async ev => {
      try {
        const wb = XLSX.read(ev.target.result, {type:'array'});
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
        const hdr = rows[0].map(h => String(h).toUpperCase().trim());
        const iRef = hdr.findIndex(h => h.includes('REF') || h.includes('CODIGO'));
        const iUrl = hdr.findIndex(h => h.includes('URL') || h.includes('IMAGEN') || h.includes('IMAGE'));
        if (iRef < 0 || iUrl < 0) { status.textContent = '⚠ Se necesitan columnas REFERENCIA e IMAGEN_URL'; return; }

        const dataRows = rows.slice(1).filter(r => r[iRef] && r[iUrl]);
        let ok = 0, err = 0;
        status.innerHTML = `<span class="loading-spin"></span> Procesando ${dataRows.length} URLs...`;

        for (const row of dataRows) {
          const ref = String(row[iRef]).trim().toUpperCase();
          const url = String(row[iUrl]).trim();
          const prod = _catalog.find(p => (p.ref||'').toUpperCase() === ref);
          if (!prod || !url.startsWith('http')) { err++; continue; }
          try {
            await new Promise((res, rej) => {
              const img = new Image();
              img.crossOrigin = 'anonymous';
              img.onload = () => {
                const c = document.createElement('canvas');
                const MAX = 800;
                let w = img.width, h = img.height;
                if (w > MAX || h > MAX) { if(w>h){h=Math.round(h*MAX/w);w=MAX;}else{w=Math.round(w*MAX/h);h=MAX;} }
                c.width = w; c.height = h;
                c.getContext('2d').drawImage(img, 0, 0, w, h);
                const b64 = c.toDataURL('image/jpeg', 0.82);
                if (Auth.isAuthenticated()) {
                  Sync.uploadImageToDrive(prod.ref || `prod_${prod.id}`, b64)
                    .then(result => { setImage(prod.id, result.url, result.fileId); ok++; res(); })
                    .catch(() => { setImage(prod.id, b64, ''); ok++; res(); });
                } else {
                  setImage(prod.id, b64, ''); ok++; res();
                }
              };
              img.onerror = () => { err++; res(); };
              img.src = url;
            });
          } catch { err++; }
        }
        renderCatalog(document.getElementById('cat-search')?.value || '');
        status.textContent = `✅ ${ok} imágenes · ${err} errores`;
        toast(`✅ ${ok} imágenes cargadas desde URLs`, 'success');
      } catch(ex) { status.textContent = '⚠ Error: ' + ex.message; }
    };
    reader.readAsArrayBuffer(file);
  }

  // ── BÚSQUEDA MASIVA AUTOMÁTICA ────────────────────────────────────
  async function iniciarBusquedaMasiva() {
    window._masivaStopped = false;
    const sinFoto = _catalog.filter(p => !p.imageUrl);
    if (!sinFoto.length) { toast('Todos los productos ya tienen imagen', 'success'); return; }
    document.getElementById('btn-stop-masiva').style.display = 'inline-flex';
    document.getElementById('masiva-progress').style.display = 'block';
    const bar = document.getElementById('masiva-bar');
    const log = document.getElementById('masiva-log');
    const statusEl = document.getElementById('masiva-status');
    let ok = 0, fail = 0, i = 0;

    for (const prod of sinFoto) {
      if (window._masivaStopped) break;
      i++;
      bar.style.width = Math.round(i / sinFoto.length * 100) + '%';
      statusEl.textContent = `${i}/${sinFoto.length} · ${ok} asignadas`;

      const q = [prod.nombre.split(' ').slice(0,4).join(' '), prod.marca].filter(Boolean).join(' ');
      try {
        const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q + ' medical')}&srnamespace=6&format=json&origin=*&srlimit=3`;
        const r = await fetch(url);
        const d = await r.json();
        const pages = d.query?.search || [];
        if (pages.length) {
          const imgName = pages[0].title.replace('File:', '');
          const imgUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(imgName)}?width=400`;
          await new Promise(res => {
            const img = new Image(); img.crossOrigin = 'anonymous';
            img.onload = () => {
              const c = document.createElement('canvas');
              let w = img.width, h = img.height, MAX = 800;
              if(w>MAX||h>MAX){if(w>h){h=Math.round(h*MAX/w);w=MAX;}else{w=Math.round(w*MAX/h);h=MAX;}}
              c.width=w;c.height=h;c.getContext('2d').drawImage(img,0,0,w,h);
              const b64 = c.toDataURL('image/jpeg', 0.82);
              if (Auth.isAuthenticated()) {
                Sync.uploadImageToDrive(prod.ref || `prod_${prod.id}`, b64)
                  .then(result => { setImage(prod.id, result.url, result.fileId); ok++; log.innerHTML = `✓ ${prod.nombre.substring(0,40)}<br>` + log.innerHTML; res(); })
                  .catch(() => { setImage(prod.id, b64, ''); ok++; res(); });
              } else {
                setImage(prod.id, b64, ''); ok++; res();
              }
            };
            img.onerror = () => { fail++; res(); };
            img.src = imgUrl;
            setTimeout(() => { fail++; res(); }, 5000);
          });
        } else { fail++; }
      } catch { fail++; }

      if (i % 10 === 0) { _saveCache(); renderCatalog(document.getElementById('cat-search')?.value || ''); }
      await new Promise(r => setTimeout(r, 400));
    }

    _saveCache();
    renderCatalog(document.getElementById('cat-search')?.value || '');
    document.getElementById('btn-stop-masiva').style.display = 'none';
    statusEl.textContent = `✅ Completado: ${ok} imágenes · ${fail} sin resultado`;
    toast(`✅ Búsqueda masiva: ${ok} imágenes asignadas`, 'success');
  }

  function descargarPlantillaURLs() {
    const rows = [['REFERENCIA', 'IMAGEN_URL']];
    _catalog.slice(0, 5).forEach(p => rows.push([p.ref||'', 'https://url-de-la-imagen.jpg']));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{wch:20},{wch:60}];
    XLSX.utils.book_append_sheet(wb, ws, 'URLs');
    XLSX.writeFile(wb, 'plantilla_imagenes.xlsx');
  }

  // ── PUBLIC API ───────────────────────────────────────────────────
  return {
    init,
    getAll,
    getById,
    search,
    add,
    update,
    remove,
    setImage,
    setFromRemote,
    saveFromModal,
    editProduct,
    deleteProduct,
    renderCatalog,
    confirmarImg,
    importarSistemaContable,
    importarExcel,
    exportarExcel,
    importarZIP,
    importarURLsExcel,
    iniciarBusquedaMasiva,
    descargarPlantillaURLs,
  };
})();

// Alias globales para compatibilidad con onclicks en HTML
function renderCatalog(filter) { Catalog.renderCatalog(filter); }
function editarProd(id)        { Catalog.editProduct(id); }
function eliminarProd(id)      { Catalog.deleteProduct(id); }
function guardarProducto()     { Catalog.saveFromModal(); }
function confirmarImg()        { Catalog.confirmarImg(); }
function exportarExcel()       { Catalog.exportarExcel(); }
function importarExcel(e)      { Catalog.importarExcel(e); }
function importarSistemaContable(e) { Catalog.importarSistemaContable(e); }
function importarZIP(e)        { Catalog.importarZIP(e); }
function importarURLsExcel(e)  { Catalog.importarURLsExcel(e); }
function descargarPlantillaURLs() { Catalog.descargarPlantillaURLs(); }
function iniciарBusquedaMasiva() { Catalog.iniciarBusquedaMasiva(); }
function detenerBusquedaMasiva() {
  window._masivaStopped = true;
  document.getElementById('btn-stop-masiva').style.display = 'none';
  document.getElementById('masiva-status').textContent = '⏹ Detenido';
  Catalog.renderCatalog(document.getElementById('cat-search')?.value || '');
}
