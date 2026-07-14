/**
 * app.js — Punto de entrada principal. Orquesta auth, sync, catálogo y UI.
 */

const App = (() => {
  let _rol = 'vendedor';
  let _profile = null;

  // ── INIT (carga inicial de la página) ────────────────────────────
  async function init() {
    // Registrar Service Worker para PWA/offline
    if ('serviceWorker' in navigator) {
      const swReg = await navigator.serviceWorker.register('./sw.js').catch(() => null);
      if (swReg) {
        // Forzar verificación de actualización en cada carga
        swReg.update().catch(() => {});

        // Cuando el nuevo SW toma el control, recargar para cargar los JS actualizados.
        // Si hay una cotización en progreso, mostrar aviso en lugar de recargar.
        const _prevController = navigator.serviceWorker.controller;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (!_prevController) return; // primera instalación
          const tieneItems = window._cotItems && window._cotItems.length > 0;
          if (!tieneItems) {
            // Sin cotización en progreso → recargar automáticamente
            window.location.reload();
          } else {
            // Hay items → mostrar aviso que no se puede cerrar fácilmente
            if (document.getElementById('sw-update-banner')) return;
            const wrap = document.createElement('div');
            wrap.id = 'sw-update-banner';
            wrap.innerHTML =
              '<div style="position:fixed;top:0;left:0;right:0;z-index:9999;' +
              'background:#e65100;color:#fff;padding:10px 16px;' +
              'display:flex;gap:12px;align-items:center;justify-content:center;' +
              'font-size:13px;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,.4);">' +
              '⚠️ Hay una actualización disponible.' +
              '<button onclick="location.reload()" style="background:#fff;color:#e65100;border:none;' +
              'padding:5px 14px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700;">Recargar ahora</button>' +
              '</div>';
            document.body.appendChild(wrap);
          }
        });
      }
    }

    // Inicializar catálogo desde cache local (para mostrar algo inmediatamente)
    Catalog.init();

    // Inicializar fecha (el número de cotización se genera en afterAuth cuando ya hay usuario)
    const fecha = document.getElementById('fecha');
    if (fecha) fecha.valueAsDate = new Date();

    // Cerrar dropdown de búsqueda al clic fuera
    document.addEventListener('click', e => {
      if (!e.target.closest('#search-input') && !e.target.closest('#search-results'))
        document.getElementById('search-results')?.classList.remove('visible');
    });

    // Paste en modal de imagen
    document.getElementById('paste-zone')?.addEventListener('paste', function(e) {
      e.preventDefault();
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (!item.type.startsWith('image/')) continue;
        const file = item.getAsFile();
        if (!file) continue;
        compressAndSet(file, (b64) => {
          window._selectedImg = b64;
          document.getElementById('paste-instructions').style.display = 'none';
          document.getElementById('paste-preview').style.display = 'block';
          document.getElementById('paste-img').src = b64;
          toast('✓ Imagen pegada — haz clic en "Usar imagen"', 'success');
        });
        return;
      }
      toast('No se encontró imagen. Usa Win+Shift+S para capturar.', 'error');
    });

    // Online / offline indicators
    window.addEventListener('online',  () => { setSyncStatus('', 'En línea'); onOnline(); });
    window.addEventListener('offline', () => setSyncStatus('offline', 'Sin conexión'));
    if (!navigator.onLine) setSyncStatus('offline', 'Sin conexión');

    // PWA install prompt
    let _deferredInstall = null;
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      _deferredInstall = e;
      document.getElementById('pwa-banner')?.classList.add('show');
    });
    document.getElementById('btn-install-pwa')?.addEventListener('click', async () => {
      if (!_deferredInstall) return;
      _deferredInstall.prompt();
      const { outcome } = await _deferredInstall.userChoice;
      _deferredInstall = null;
      document.getElementById('pwa-banner')?.classList.remove('show');
    });
    document.getElementById('btn-dismiss-pwa')?.addEventListener('click', () => {
      document.getElementById('pwa-banner')?.classList.remove('show');
    });

    // Inicializar autenticación
    const authReady = await Auth.init();
    if (authReady) {
      // Ya tenía sesión
      await afterAuth();
    }
    // Si no hay sesión, el auth.js muestra el overlay de login
  }

  // ── AFTER AUTH (después de login exitoso) ────────────────────────
  async function afterAuth() {
    const user = Auth.getUser();
    const email = user?.email || '';
    const nombre = user?.name || email;

    // Verificar acceso del usuario
    const access = await Sync.checkUserAccess(email, nombre);
    if (!access.allowed) {
      toast(access.message, 'error');
      setTimeout(() => Auth.logout(), 3000);
      document.getElementById('auth-error').textContent = access.message;
      document.getElementById('auth-overlay').classList.remove('hidden');
      return;
    }
    _rol = access.rol;

    // Mostrar/ocultar botón de admin y badge de rol en el header
    const btnAdmin = document.getElementById('btn-admin-users');
    if (btnAdmin) btnAdmin.style.display = _rol === 'admin' ? '' : 'none';
    _updateRoleBadge(_rol);
    _applyRoleRestrictions(_rol);

    // Cargar perfil del vendedor
    _profile = await Sync.loadProfile(email);

    // Inicializar el Sheet si no existe
    await Sync.initSheet().catch(() => {});

    // Verificar si hay migración pendiente
    if (Sync.hasPendingMigration()) {
      await showMigrationDialog();
      return;
    }

    // Cargar catálogo desde Sheets
    try {
      setSyncStatus('syncing', 'Cargando...');
      const remote = await Sync.loadFromSheets();
      if (remote && remote.length > 0) {
        Catalog.setFromRemote(remote);
      }
    } catch(e) {
      console.warn('Could not load from Sheets, using local cache:', e);
      setSyncStatus('error', 'Usando caché');
    }

    // Cargar pedidos (solo para admin y vendedor)
    if (_rol !== 'aliado' && typeof Orders !== 'undefined') {
      try {
        const remoteOrders = await Sync.loadOrders();
        if (remoteOrders && remoteOrders.length > 0) {
          Orders.setFromRemote(remoteOrders);
        } else {
          Orders.init();
        }
      } catch(e) {
        console.warn('Could not load orders from Sheets, using local cache:', e);
        Orders.init();
      }
    }

    // Generar número de cotización con iniciales del usuario y consecutivo del día
    const numEl = document.getElementById('num_cot');
    if (numEl && typeof generarNumeroCot === 'function') {
      numEl.value = generarNumeroCot(user);
    }

    // Renderizar UI
    renderCatalog();
    updateSummary();

    // Arrancar auto-sync
    Sync.startAutoSync();
  }

  // ── MIGRACIÓN DESDE localStorage v8 ─────────────────────────────
  async function showMigrationDialog() {
    const overlay = document.getElementById('modal-migration');
    if (!overlay) {
      // Crear modal de migración dinámicamente
      const html = `
        <div class="modal-overlay open" id="modal-migration">
          <div class="modal" style="width:560px;">
            <div class="modal-header">
              <span>🔄 Migración de datos al nuevo sistema</span>
            </div>
            <div class="modal-body">
              <div style="background:#fff4ee;border-radius:10px;padding:16px;border:1px solid var(--orange-mid);">
                <div style="font-weight:700;font-size:14px;margin-bottom:6px;">Se detectó un catálogo guardado localmente</div>
                <div style="font-size:13px;color:var(--text2);">
                  Vamos a migrar todos tus productos y sus imágenes al nuevo sistema (Google Sheets + Drive).
                  Este proceso es <strong>automático y toma unos minutos</strong> según la cantidad de imágenes.
                </div>
              </div>
              <div class="migration-progress">
                <div id="mig-title" style="font-weight:700;font-size:13px;margin-bottom:8px;">📦 Preparando migración...</div>
                <div class="migration-bar-wrap"><div class="migration-bar" id="mig-bar"></div></div>
                <div id="mig-pct" style="font-size:12px;color:var(--muted);margin-bottom:6px;">0%</div>
                <div class="migration-log" id="mig-log"></div>
              </div>
              <div style="font-size:12px;color:var(--muted);">⚡ Las imágenes se suben a Google Drive automáticamente. Por favor, no cierres la ventana.</div>
            </div>
            <div class="modal-footer">
              <button class="btn btn-primary" id="btn-start-migration">▶ Iniciar Migración</button>
              <button class="btn btn-outline" id="btn-skip-migration">Omitir (usar cache)</button>
            </div>
          </div>
        </div>`;
      document.body.insertAdjacentHTML('beforeend', html);
    }

    document.getElementById('modal-migration').classList.add('open');

    document.getElementById('btn-skip-migration').onclick = async () => {
      document.getElementById('modal-migration').remove();
      localStorage.setItem('ow_migrated_v9', 'skipped');
      renderCatalog();
      updateSummary();
      Sync.startAutoSync();
    };

    document.getElementById('btn-start-migration').onclick = async () => {
      document.getElementById('btn-start-migration').disabled = true;
      document.getElementById('btn-skip-migration').disabled = true;

      try {
        const catalog = await Sync.migrateFromLocalStorage((done, total, name) => {
          const pct = Math.round(done / total * 100);
          document.getElementById('mig-bar').style.width = pct + '%';
          document.getElementById('mig-pct').textContent = `${done}/${total} · ${pct}%`;
          document.getElementById('mig-title').textContent = `📦 Migrando: ${name.substring(0, 45)}...`;
          const log = document.getElementById('mig-log');
          if (log) log.innerHTML = `✓ ${name.substring(0, 50)}<br>` + log.innerHTML;
        });

        document.getElementById('mig-title').textContent = '✅ Migración completada';
        document.getElementById('mig-bar').style.width = '100%';

        if (catalog) {
          Catalog.setFromRemote(catalog);
          toast(`✅ ${catalog.length} productos migrados a Google Sheets + Drive`, 'success');
        }

        setTimeout(() => {
          document.getElementById('modal-migration')?.remove();
          renderCatalog();
          updateSummary();
          Sync.startAutoSync();
        }, 2000);

      } catch(e) {
        document.getElementById('mig-title').textContent = '❌ Error: ' + e.message;
        toast('Error en migración: ' + e.message, 'error');
        document.getElementById('btn-skip-migration').disabled = false;
      }
    };
  }

  // ── ON ONLINE ─────────────────────────────────────────────────────
  async function onOnline() {
    if (!Auth.isAuthenticated()) return;
    try {
      const remote = await Sync.loadFromSheets();
      if (remote && remote.length > 0) {
        Catalog.setFromRemote(remote);
        renderCatalog(document.getElementById('cat-search')?.value || '');
      }
    } catch(e) {}
  }

  // ── ON LOGOUT ─────────────────────────────────────────────────────
  function onLogout() {
    _rol = 'vendedor'; _profile = null;
    Sync.stopAutoSync();
    window._cotItems = [];
    renderItems();
    updateSummary();
    // Restaurar tabs ocultos para próxima sesión
    document.querySelectorAll('.tab').forEach(t => t.style.display = '');
    const btnSync = document.getElementById('btn-sync');
    if (btnSync) btnSync.style.display = '';
  }

  // ── USUARIOS (modal admin) ────────────────────────────────────────
  async function openUsersModal() {
    if (_rol !== 'admin') return;
    const modal = document.getElementById('modal-usuarios');
    modal.classList.add('open');
    document.getElementById('users-list').innerHTML = '<div style="padding:16px;color:var(--muted);">Cargando...</div>';
    // Limpiar form manual
    const fe = document.getElementById('new-user-email');
    const fn = document.getElementById('new-user-nombre');
    if (fe) fe.value = '';
    if (fn) fn.value = '';
    try {
      const users = await Sync.loadUsers();
      _renderUsersList(users);
    } catch(e) {
      document.getElementById('users-list').innerHTML = '<div style="padding:16px;color:var(--danger);">Error al cargar usuarios</div>';
    }
  }

  function _renderUsersList(users) {
    const el = document.getElementById('users-list');
    if (!users.length) {
      el.innerHTML = '<div style="padding:16px;color:var(--muted);text-align:center;">No hay usuarios registrados todavía.</div>';
      el.dataset.users = '[]';
      return;
    }

    const sorted = [...users].sort((a, b) => (a.activo === b.activo ? 0 : a.activo ? 1 : -1));
    const pending = sorted.filter(u => !u.activo).length;

    el.innerHTML =
      (pending > 0
        ? `<div style="padding:10px 14px;background:#fff8e1;border-bottom:2px solid #ffe082;font-size:12px;color:#e65100;font-weight:700;display:flex;align-items:center;gap:8px;">
            <span>⏳</span>
            <span>${pending} usuario${pending>1?'s':''} pendiente${pending>1?'s':''} de aprobación — actívalos abajo para dar acceso</span>
           </div>`
        : '') +
      sorted.map((u) => {
        const origIdx = users.indexOf(u);
        const isPending = !u.activo;
        return `
        <div class="user-row" style="${isPending ? 'background:#fffde7;border-left:3px solid #ffc107;' : ''}">
          <div class="user-info" style="flex:1;min-width:0;">
            <div class="user-email" style="font-weight:600;">${escH(u.email)}</div>
            <div class="user-name" style="font-size:11px;color:var(--muted);">${escH(u.nombre) || '<em>Sin nombre</em>'}</div>
          </div>
          <select class="user-rol-sel" onchange="App._changeUser(${origIdx},'rol',this.value)" style="font-size:12px;">
            <option value="vendedor" ${u.rol==='vendedor'?'selected':''}>Vendedor</option>
            <option value="aliado"   ${u.rol==='aliado'  ?'selected':''}>Aliado</option>
            <option value="admin"    ${u.rol==='admin'   ?'selected':''}>Admin</option>
          </select>
          ${isPending
            ? `<button onclick="App._changeUser(${origIdx},'activo',true)" style="background:#2e7d32;color:#fff;border:none;padding:7px 14px;border-radius:7px;cursor:pointer;font-size:12px;font-weight:700;white-space:nowrap;">✓ Aprobar</button>`
            : `<button onclick="App._changeUser(${origIdx},'activo',false)" style="background:var(--danger);color:#fff;border:none;padding:7px 12px;border-radius:7px;cursor:pointer;font-size:12px;">Desactivar</button>`
          }
        </div>`;
      }).join('');
    el.dataset.users = JSON.stringify(users);
  }

  function _changeUser(idx, field, value) {
    const el = document.getElementById('users-list');
    const users = JSON.parse(el.dataset.users || '[]');
    if (!users[idx]) return;
    users[idx][field] = value;
    el.dataset.users = JSON.stringify(users);
    Sync.saveUsers(users)
      .then(() => {
        toast('✓ Usuario actualizado', 'success');
        _renderUsersList(users); // re-render para reflejar cambio
      })
      .catch(() => toast('Error al guardar', 'error'));
  }

  async function addUserManual() {
    const email  = (document.getElementById('new-user-email')?.value  || '').trim();
    const nombre = (document.getElementById('new-user-nombre')?.value || '').trim();
    const rol    = document.getElementById('new-user-rol')?.value || 'vendedor';
    if (!email || !email.includes('@')) { toast('Ingresa un email válido', 'error'); return; }
    const btn = document.getElementById('btn-add-user');
    if (btn) btn.disabled = true;
    try {
      await Sync.addUserManual(email, nombre, rol);
      toast('✓ Usuario agregado y activado', 'success');
      document.getElementById('new-user-email').value  = '';
      document.getElementById('new-user-nombre').value = '';
      // Recargar lista
      const users = await Sync.loadUsers();
      _renderUsersList(users);
    } catch(e) {
      toast(e.message || 'Error al agregar usuario', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ── RESTRICCIONES POR ROL ─────────────────────────────────────────
  function _applyRoleRestrictions(rol) {
    const isAliado = rol === 'aliado';
    const tabs = document.querySelectorAll('.tab');
    // Tabs: 0=cotizar, 1=consulta, 2=catalogo, 3=pedidos
    if (tabs[0]) tabs[0].style.display = isAliado ? 'none' : '';
    if (tabs[2]) tabs[2].style.display = isAliado ? 'none' : '';
    if (tabs[3]) tabs[3].style.display = isAliado ? 'none' : ''; // aliado no ve Pedidos
    // Ocultar botón de sincronización manual para aliados (solo lectura)
    const btnSync = document.getElementById('btn-sync');
    if (btnSync) btnSync.style.display = isAliado ? 'none' : '';
    // Si es aliado, forzar pestaña de consulta
    if (isAliado) {
      if (typeof switchTab === 'function') switchTab('consulta');
    }
  }

  // ── BADGE DE ROL EN HEADER ────────────────────────────────────────
  function _updateRoleBadge(rol) {
    const badge = document.getElementById('user-role-badge');
    if (!badge) return;
    const cfg = {
      admin:    { label: 'ADMIN',    bg: '#fff3e0', color: '#e65100' },
      vendedor: { label: 'VENDEDOR', bg: '#e8f5e9', color: '#2e7d32' },
      aliado:   { label: 'ALIADO',   bg: '#e8eaf6', color: '#283593' },
    };
    const c = cfg[rol] || cfg.vendedor;
    badge.textContent      = c.label;
    badge.style.background = c.bg;
    badge.style.color      = c.color;
    badge.style.display    = 'inline';
  }

  // ── PERFIL DEL VENDEDOR ───────────────────────────────────────────
  function openProfileModal() {
    const user  = Auth.getUser();
    const email = user?.email || '';
    const p = _profile || {};

    // Tarjeta de cuenta activa
    const gName  = document.getElementById('prf-google-name');
    const gEmail = document.getElementById('prf-google-email');
    const gAvatar = document.getElementById('prf-avatar');
    const gBadge  = document.getElementById('prf-rol-badge');
    if (gName)  gName.textContent  = user?.name  || email;
    if (gEmail) gEmail.textContent = email;
    if (gAvatar && user?.picture) { gAvatar.src = user.picture; gAvatar.style.display = 'inline'; }
    if (gBadge) {
      const isAdmin = _rol === 'admin';
      gBadge.textContent = isAdmin ? 'ADMIN' : 'VENDEDOR';
      gBadge.style.background = isAdmin ? '#fff3e0' : '#e8f5e9';
      gBadge.style.color      = isAdmin ? '#e65100' : '#2e7d32';
    }

    document.getElementById('prf-nombre').value    = p.nombre    || user?.name || '';
    document.getElementById('prf-cargo').value     = p.cargo     || '';
    document.getElementById('prf-telefono').value  = p.telefono  || '';
    document.getElementById('prf-email').value     = p.emailVendedor || email;
    const notas = p.notas || Pdf.loadNotes();
    document.getElementById('prf-notas').value = notas.join('\n');
    document.getElementById('prf-banco').value = p.banco || '';
    document.getElementById('modal-perfil').classList.add('open');
  }

  async function saveProfile() {
    const email = Auth.getUser()?.email || '';
    const notas = document.getElementById('prf-notas').value.split('\n').map(s=>s.trim()).filter(Boolean);
    _profile = {
      email,
      nombre:        document.getElementById('prf-nombre').value.trim(),
      cargo:         document.getElementById('prf-cargo').value.trim(),
      telefono:      document.getElementById('prf-telefono').value.trim(),
      emailVendedor: document.getElementById('prf-email').value.trim(),
      notas,
      banco: document.getElementById('prf-banco').value.trim(),
      // Preservar imágenes de marca (se guardan por separado via updateBrand)
      hdr: _profile?.hdr || null,
      ftr: _profile?.ftr || null,
    };
    try {
      await Sync.saveProfile(_profile);
      toast('✓ Perfil guardado', 'success');
      document.getElementById('modal-perfil').classList.remove('open');
    } catch(e) {
      toast('Error al guardar perfil: ' + e.message, 'error');
    }
  }

  async function updateBrand(hdr, ftr) {
    if (!_profile) return;
    _profile = { ..._profile, hdr: hdr || null, ftr: ftr || null };
    try {
      await Sync.saveProfile(_profile);
    } catch(e) {
      console.warn('Brand sync to Sheets failed:', e);
    }
  }

  // ── FORZAR ACTUALIZACIÓN COMPLETA ────────────────────────────────
  async function forceUpdate() {
    toast('Limpiando caché y actualizando...', 'success');
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    } catch(e) { console.warn('forceUpdate:', e); }
    // Navegar a la misma URL con timestamp para bypassear caché HTTP del browser
    const base = location.origin + location.pathname;
    window.location.replace(base + '?_=' + Date.now());
  }

  return {
    init, afterAuth, onLogout,
    openUsersModal, _changeUser, addUserManual,
    openProfileModal, saveProfile, updateBrand,
    forceUpdate,
    getProfile: () => _profile,
    getRol: () => _rol,
  };
})();

// ── FUNCIONES GLOBALES REQUERIDAS POR EL HTML ─────────────────────
function generarPDF()    { Pdf.generarPDF(); }

// ── LIGHTBOX DE IMAGEN ────────────────────────────────────────────
function abrirLightbox(thumbSrc, driveFileId) {
  if (!thumbSrc && !driveFileId) return;
  const lb  = document.getElementById('img-lightbox');
  const img = document.getElementById('img-lightbox-img');
  const spin = document.getElementById('img-lightbox-spin');

  // Extraer fileId desde URL de Drive si no se pasó explícitamente
  let fileId = driveFileId;
  if (!fileId && thumbSrc && thumbSrc.includes('drive.google.com')) {
    const m = thumbSrc.match(/[?&]id=([^&]+)/);
    fileId = m ? m[1] : null;
  }

  // Si el thumb ya es un blob URL (Drive API cargó imagen completa en la tarjeta),
  // mostrarlo directamente sin opacidad reducida — ya es calidad completa.
  const isAlreadyFull = thumbSrc && thumbSrc.startsWith('blob:');

  img.src = thumbSrc || '';
  img.style.opacity = (fileId && !isAlreadyFull) ? '0.5' : '1';
  if (spin) spin.style.display = (fileId && !isAlreadyFull) ? 'block' : 'none';

  lb.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  // Si ya tenemos calidad completa (blob URL), no necesitamos pedir Drive de nuevo
  if (fileId && !isAlreadyFull && typeof Catalog !== 'undefined') {
    Catalog.fetchFullImage(fileId)
      .then(fullSrc => {
        if (lb.style.display !== 'flex') return;
        img.src = fullSrc;
        img.style.opacity = '1';
        if (spin) spin.style.display = 'none';
      })
      .catch(() => {
        img.style.opacity = '1';
        if (spin) spin.style.display = 'none';
      });
  }
}
function cerrarLightbox() {
  const lb = document.getElementById('img-lightbox');
  lb.style.display = 'none';
  document.getElementById('img-lightbox-img').src = '';
  document.body.style.overflow = '';
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { cerrarLightbox(); cerrarEscaner(); }
});

// ── ESCÁNER DE CÓDIGO DE BARRAS ───────────────────────────────────
let _barcodeScanner = null;
let _barcodeTarget  = null;

async function abrirEscaner(target) {
  _barcodeTarget = target;
  const modal  = document.getElementById('modal-scanner');
  const status = document.getElementById('scanner-status');
  modal.style.display = 'flex';
  status.textContent = 'Cargando escáner...';

  if (!window.Html5Qrcode) {
    try {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
        s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
      });
    } catch(e) {
      cerrarEscaner();
      toast('No se pudo cargar el escáner. Verifica tu conexión.', 'error');
      return;
    }
  }

  status.textContent = 'Apunta al código de barras del producto';
  document.getElementById('scanner-reader').innerHTML = '';

  try {
    _barcodeScanner = new Html5Qrcode('scanner-reader', {
      formatsToSupport: [
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
      ],
      verbose: false,
    });

    const qrboxFn = (vw, vh) => {
      const w = Math.min(Math.round(vw * 0.85), 320);
      return { width: w, height: Math.round(w * 0.28) };
    };

    await _barcodeScanner.start(
      { facingMode: 'environment' },
      { fps: 15, qrbox: qrboxFn },
      (decodedText) => {
        cerrarEscaner();
        if (_barcodeTarget === 'consulta') {
          const inp = document.getElementById('consulta-input');
          if (inp) { inp.value = decodedText; consultaBuscar(decodedText); }
        } else {
          const inp = document.getElementById('search-input');
          if (inp) { inp.value = decodedText; buscarProducto(decodedText); }
        }
        toast('✓ REF leída: ' + decodedText, 'success');
      },
      () => {}
    );
  } catch(e) {
    cerrarEscaner();
    const msg = (e?.message || String(e)).toLowerCase();
    if (msg.includes('permission') || msg.includes('denied') || msg.includes('notallowed')) {
      toast('Permiso de cámara denegado. Habilítalo en la configuración del navegador.', 'error');
    } else {
      toast('No se pudo acceder a la cámara: ' + (e?.message || e), 'error');
    }
  }
}

async function cerrarEscaner() {
  if (_barcodeScanner) {
    try { await _barcodeScanner.stop(); } catch(e) {}
    try { _barcodeScanner.clear(); }    catch(e) {}
    _barcodeScanner = null;
  }
  const modal = document.getElementById('modal-scanner');
  if (modal) modal.style.display = 'none';
  const reader = document.getElementById('scanner-reader');
  if (reader) reader.innerHTML = '';
}

// Iniciar app cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => App.init());
