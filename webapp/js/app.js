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
        swReg.addEventListener('updatefound', () => {
          const nw = swReg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'activated') {
              const b = document.createElement('div');
              b.innerHTML = '<div style="position:fixed;bottom:80px;left:50%;transform:translateX(-50%);' +
                'background:#1a1a1a;color:#fff;padding:12px 20px;border-radius:10px;z-index:9999;' +
                'font-size:13px;display:flex;gap:12px;align-items:center;box-shadow:0 4px 20px rgba(0,0,0,.5);">' +
                '<span>✓ App actualizada — recarga para aplicar</span>' +
                '<button onclick="location.reload()" style="background:var(--orange);color:#fff;border:none;' +
                'padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700;">Recargar</button>' +
                '</div>';
              document.body.appendChild(b);
              setTimeout(() => b.remove(), 30000);
            }
          });
        });
      }
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
    // Tabs: 0=cotizar, 1=consulta, 2=catalogo
    if (tabs[0]) tabs[0].style.display = isAliado ? 'none' : '';
    if (tabs[2]) tabs[2].style.display = isAliado ? 'none' : '';
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
    const isAdmin = rol === 'admin';
    badge.textContent = isAdmin ? 'ADMIN' : 'VENDEDOR';
    badge.style.background = isAdmin ? '#fff3e0' : '#e8f5e9';
    badge.style.color      = isAdmin ? '#e65100' : '#2e7d32';
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
    openUsersModal, _changeUser, addUserManual,
    openProfileModal, saveProfile,
    getProfile: () => _profile,
    getRol: () => _rol,
  };
})();

// ── FUNCIONES GLOBALES REQUERIDAS POR EL HTML ─────────────────────
function generarPDF()    { Pdf.generarPDF(); }

// Iniciar app cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => App.init());
