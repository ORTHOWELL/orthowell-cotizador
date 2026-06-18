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
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }

    // Inicializar catálogo desde cache local (para mostrar algo inmediatamente)
    Catalog.init();

    // Inicializar fecha y número de cotización
    const fecha = document.getElementById('fecha');
    if (fecha) fecha.valueAsDate = new Date();
    const d = new Date();
    const numEl = document.getElementById('num_cot');
    if (numEl) numEl.value = `AO${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-1`;

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

    // Mostrar/ocultar botón de admin
    const btnAdmin = document.getElementById('btn-admin-users');
    if (btnAdmin) btnAdmin.style.display = _rol === 'admin' ? '' : 'none';

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
  }

  // ── USUARIOS (modal admin) ────────────────────────────────────────
  async function openUsersModal() {
    if (_rol !== 'admin') return;
    const modal = document.getElementById('modal-usuarios');
    modal.classList.add('open');
    document.getElementById('users-list').innerHTML = '<div style="padding:16px;color:var(--muted);">Cargando...</div>';
    try {
      const users = await Sync.loadUsers();
      _renderUsersList(users);
    } catch(e) {
      document.getElementById('users-list').innerHTML = '<div style="padding:16px;color:var(--danger);">Error al cargar usuarios</div>';
    }
  }

  function _renderUsersList(users) {
    const el = document.getElementById('users-list');
    if (!users.length) { el.innerHTML = '<div style="padding:16px;color:var(--muted);">No hay usuarios registrados.</div>'; return; }
    el.innerHTML = users.map((u, i) => `
      <div class="user-row">
        <div class="user-info">
          <div class="user-email">${escH(u.email)}</div>
          <div class="user-name">${escH(u.nombre)}</div>
        </div>
        <select class="user-rol-sel" data-idx="${i}" onchange="App._changeUser(${i},'rol',this.value)">
          <option value="vendedor" ${u.rol==='vendedor'?'selected':''}>Vendedor</option>
          <option value="admin" ${u.rol==='admin'?'selected':''}>Admin</option>
        </select>
        <label class="toggle-wrap" title="${u.activo?'Desactivar':'Activar'}">
          <input type="checkbox" ${u.activo?'checked':''} onchange="App._changeUser(${i},'activo',this.checked)" data-idx="${i}">
          <span class="toggle-label">${u.activo?'Activo':'Inactivo'}</span>
        </label>
      </div>`).join('');
    el.dataset.users = JSON.stringify(users);
  }

  function _changeUser(idx, field, value) {
    const el = document.getElementById('users-list');
    const users = JSON.parse(el.dataset.users || '[]');
    if (!users[idx]) return;
    users[idx][field] = value;
    el.dataset.users = JSON.stringify(users);
    // Guardar inmediatamente
    Sync.saveUsers(users)
      .then(() => toast('✓ Usuario actualizado', 'success'))
      .catch(() => toast('Error al guardar', 'error'));
  }

  // ── PERFIL DEL VENDEDOR ───────────────────────────────────────────
  function openProfileModal() {
    const email = Auth.getUser()?.email || '';
    const p = _profile || {};
    document.getElementById('prf-nombre').value    = p.nombre    || Auth.getUser()?.name || '';
    document.getElementById('prf-cargo').value     = p.cargo     || '';
    document.getElementById('prf-telefono').value  = p.telefono  || '';
    document.getElementById('prf-email').value     = p.emailVendedor || email;
    // Notas
    const notas = p.notas || Pdf.loadNotes();
    document.getElementById('prf-notas').value = notas.join('\n');
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
    };
    try {
      await Sync.saveProfile(_profile);
      toast('✓ Perfil guardado', 'success');
      document.getElementById('modal-perfil').classList.remove('open');
    } catch(e) {
      toast('Error al guardar perfil: ' + e.message, 'error');
    }
  }

  return {
    init, afterAuth, onLogout,
    openUsersModal, _changeUser,
    openProfileModal, saveProfile,
    getProfile: () => _profile,
    getRol: () => _rol,
  };
})();

// ── FUNCIONES GLOBALES REQUERIDAS POR EL HTML ─────────────────────
function generarPDF()    { Pdf.generarPDF(); }

// Iniciar app cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => App.init());
