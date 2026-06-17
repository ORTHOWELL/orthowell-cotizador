/**
 * sync.js — Sincronización con Google Sheets (catálogo) y Google Drive (imágenes)
 * Todas las operaciones son directas desde el browser usando el access token de OAuth.
 */

const Sync = (() => {
  const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
  const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
  const DRIVE_BASE   = 'https://www.googleapis.com/drive/v3/files';
  let _folderId = localStorage.getItem(CONFIG.DRIVE_FOLDER_ID_KEY) || null;
  let _isSyncing = false;

  // ── SHEETS: LEER CATÁLOGO ────────────────────────────────────────
  async function loadFromSheets() {
    if (CONFIG.SPREADSHEET_ID.startsWith('TODO')) return null;
    setSyncStatus('syncing', 'Sincronizando...');
    try {
      const token = await Auth.ensureToken();
      const url = `${SHEETS_BASE}/${CONFIG.SPREADSHEET_ID}/values/${CONFIG.SHEET_NAME}!A:L`;
      const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
      if (!r.ok) {
        if (r.status === 404) return null; // Sheet no inicializado aún
        throw new Error(`Sheets API ${r.status}: ${await r.text()}`);
      }
      const data = await r.json();
      const rows = data.values || [];
      if (rows.length < 2) { setSyncStatus('', '✓ Vacío'); return []; }

      const [, ...dataRows] = rows; // skip header row
      const catalog = dataRows
        .filter(row => row[0])
        .map(row => ({
          id:           parseInt(row[0])   || 0,
          ref:          row[1]             || '',
          nombre:       row[2]             || '',
          marca:        row[3]             || '',
          precio:       parseFloat(row[4]) || 0,
          precio2:      parseFloat(row[5]) || 0,
          precio3:      parseFloat(row[6]) || 0,
          costo:        parseFloat(row[7]) || 0,
          iva:          parseFloat(row[8]) || 0,
          saldo:        parseFloat(row[9]) || 0,
          imageUrl:     row[10]            || '',
          driveFileId:  row[11]            || '',
        }));

      setSyncStatus('', `✓ ${catalog.length} productos`);
      return catalog;
    } catch(e) {
      console.error('loadFromSheets:', e);
      setSyncStatus('error', 'Error al leer');
      throw e;
    }
  }

  // ── SHEETS: GUARDAR CATÁLOGO COMPLETO ────────────────────────────
  async function saveCatalogToSheets(catalog) {
    if (CONFIG.SPREADSHEET_ID.startsWith('TODO')) return;
    setSyncStatus('syncing', 'Guardando...');
    try {
      const token = await Auth.ensureToken();

      // 1. Limpiar hoja
      await fetch(
        `${SHEETS_BASE}/${CONFIG.SPREADSHEET_ID}/values/${CONFIG.SHEET_NAME}:clear`,
        { method: 'POST', headers: { Authorization: 'Bearer ' + token } }
      );

      // 2. Escribir encabezado + datos
      const rows = [
        CONFIG.SHEET_COLUMNS,
        ...catalog.map(p => [
          p.id, p.ref || '', p.nombre, p.marca || '',
          p.precio || 0, p.precio2 || 0, p.precio3 || 0,
          p.costo || 0, p.iva || 0, p.saldo || 0,
          p.imageUrl || '', p.driveFileId || ''
        ])
      ];

      const r = await fetch(
        `${SHEETS_BASE}/${CONFIG.SPREADSHEET_ID}/values/${CONFIG.SHEET_NAME}!A1?valueInputOption=RAW`,
        {
          method: 'PUT',
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: rows })
        }
      );
      if (!r.ok) throw new Error(`Sheets write ${r.status}: ${await r.text()}`);
      setSyncStatus('', `✓ ${catalog.length} guardados`);
    } catch(e) {
      console.error('saveCatalogToSheets:', e);
      setSyncStatus('error', 'Error al guardar');
      throw e;
    }
  }

  // ── SHEETS: INICIALIZAR (crear hoja si no existe) ────────────────
  async function initSheet() {
    if (CONFIG.SPREADSHEET_ID.startsWith('TODO')) return false;
    try {
      const token = await Auth.ensureToken();
      // Verificar si la hoja "Catalogo" existe
      const r = await fetch(
        `${SHEETS_BASE}/${CONFIG.SPREADSHEET_ID}`,
        { headers: { Authorization: 'Bearer ' + token } }
      );
      if (!r.ok) return false;
      const spreadsheet = await r.json();
      const hasSheet = spreadsheet.sheets?.some(
        s => s.properties.title === CONFIG.SHEET_NAME
      );

      if (!hasSheet) {
        // Crear la hoja
        await fetch(
          `${SHEETS_BASE}/${CONFIG.SPREADSHEET_ID}:batchUpdate`,
          {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              requests: [{ addSheet: { properties: { title: CONFIG.SHEET_NAME } } }]
            })
          }
        );
        // Escribir encabezados
        await fetch(
          `${SHEETS_BASE}/${CONFIG.SPREADSHEET_ID}/values/${CONFIG.SHEET_NAME}!A1?valueInputOption=RAW`,
          {
            method: 'PUT',
            headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ values: [CONFIG.SHEET_COLUMNS] })
          }
        );
      }
      return true;
    } catch(e) {
      console.error('initSheet:', e);
      return false;
    }
  }

  // ── DRIVE: ASEGURAR CARPETA ──────────────────────────────────────
  async function ensureDriveFolder() {
    if (_folderId) return _folderId;
    const token = await Auth.ensureToken();

    // Buscar carpeta existente
    const q = encodeURIComponent(`name='${CONFIG.DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const r = await fetch(`${DRIVE_BASE}?q=${q}&fields=files(id,name)`, {
      headers: { Authorization: 'Bearer ' + token }
    });
    const data = await r.json();
    if (data.files?.length) {
      _folderId = data.files[0].id;
      localStorage.setItem(CONFIG.DRIVE_FOLDER_ID_KEY, _folderId);
      return _folderId;
    }

    // Crear carpeta nueva
    const cr = await fetch(DRIVE_BASE, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: CONFIG.DRIVE_FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder'
      })
    });
    const folder = await cr.json();
    _folderId = folder.id;
    localStorage.setItem(CONFIG.DRIVE_FOLDER_ID_KEY, _folderId);
    return _folderId;
  }

  // ── DRIVE: SUBIR IMAGEN ──────────────────────────────────────────
  async function uploadImageToDrive(ref, base64Data) {
    const token = await Auth.ensureToken();
    const folderId = await ensureDriveFolder();

    // Convertir base64 a Blob
    const blob = _base64ToBlob(base64Data);

    // Verificar si ya existe un archivo con ese nombre y eliminarlo
    const existing = await _findDriveFile(ref, folderId, token);
    if (existing) {
      await fetch(`${DRIVE_BASE}/${existing}`, {
        method: 'DELETE', headers: { Authorization: 'Bearer ' + token }
      });
    }

    // Upload multipart
    const metadata = JSON.stringify({
      name: ref + '.jpg',
      mimeType: 'image/jpeg',
      parents: [folderId]
    });
    const form = new FormData();
    form.append('metadata', new Blob([metadata], { type: 'application/json' }));
    form.append('file', blob, ref + '.jpg');

    const r = await fetch(`${DRIVE_UPLOAD}?uploadType=multipart&fields=id,name,webViewLink`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
      body: form
    });
    if (!r.ok) throw new Error(`Drive upload ${r.status}: ${await r.text()}`);
    const file = await r.json();

    // Hacer el archivo públicamente legible (para mostrar en la app sin auth)
    await fetch(`${DRIVE_BASE}/${file.id}/permissions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' })
    });

    return {
      fileId: file.id,
      url: `https://drive.google.com/thumbnail?id=${file.id}&sz=w800`
    };
  }

  async function _findDriveFile(ref, folderId, token) {
    const q = encodeURIComponent(`name='${ref}.jpg' and '${folderId}' in parents and trashed=false`);
    const r = await fetch(`${DRIVE_BASE}?q=${q}&fields=files(id)`, {
      headers: { Authorization: 'Bearer ' + token }
    });
    const data = await r.json();
    return data.files?.[0]?.id || null;
  }

  function _base64ToBlob(base64) {
    const [header, data] = base64.split(',');
    const mime = header.match(/:(.*?);/)[1];
    const bin = atob(data);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  // ── MIGRACIÓN: localStorage v8 → Google Sheets + Drive ──────────
  async function migrateFromLocalStorage(onProgress) {
    const raw = localStorage.getItem(CONFIG.CATALOG_LEGACY_KEY);
    if (!raw) return null;

    let oldCatalog;
    try { oldCatalog = JSON.parse(raw); } catch(e) { return null; }
    if (!Array.isArray(oldCatalog) || !oldCatalog.length) return null;

    const total = oldCatalog.length;
    let done = 0;
    const migrated = [];

    for (const p of oldCatalog) {
      let imageUrl = '', driveFileId = '';

      // Subir imagen a Drive si existe en base64
      if (p.img && p.img.startsWith('data:image')) {
        try {
          const result = await uploadImageToDrive(p.ref || `product_${p.id}`, p.img);
          imageUrl = result.url;
          driveFileId = result.fileId;
        } catch(e) {
          console.warn('Migration: image upload failed for', p.ref, e);
        }
      }

      migrated.push({
        id:          p.id,
        ref:         p.ref          || '',
        nombre:      p.nombre       || '',
        marca:       p.marca        || '',
        precio:      p.precio       || 0,
        precio2:     p.precio2      || 0,
        precio3:     p.precio3      || 0,
        costo:       p.costo        || 0,
        iva:         p.iva          || 0,
        saldo:       p.saldo        || 0,
        imageUrl,
        driveFileId,
      });

      done++;
      if (onProgress) onProgress(done, total, p.nombre);
    }

    // Guardar en Sheets
    await saveCatalogToSheets(migrated);

    // Marcar como migrado (no eliminar legacy por si falla algo)
    localStorage.setItem('ow_migrated_v9', 'true');
    return migrated;
  }

  function hasPendingMigration() {
    return !localStorage.getItem('ow_migrated_v9') &&
           !!localStorage.getItem(CONFIG.CATALOG_LEGACY_KEY);
  }

  // ── AUTO-SYNC ────────────────────────────────────────────────────
  let _syncTimer = null;
  function startAutoSync() {
    stopAutoSync();
    _syncTimer = setInterval(async () => {
      if (!Auth.isAuthenticated() || _isSyncing) return;
      try {
        _isSyncing = true;
        const remote = await loadFromSheets();
        if (remote && remote.length > 0) {
          Catalog.setFromRemote(remote);
          renderCatalog(document.getElementById('cat-search')?.value || '');
        }
      } catch(e) {} finally { _isSyncing = false; }
    }, CONFIG.AUTO_SYNC_INTERVAL);
  }
  function stopAutoSync() {
    if (_syncTimer) { clearInterval(_syncTimer); _syncTimer = null; }
  }

  // ── SYNC MANUAL ─────────────────────────────────────────────────
  async function syncNow() {
    if (_isSyncing) return;
    _isSyncing = true;
    try {
      setSyncStatus('syncing', 'Sincronizando...');
      const remote = await loadFromSheets();
      const local = Catalog.getAll ? Catalog.getAll() : [];

      if (remote !== null && remote.length === 0 && local.length > 0) {
        // Sheets vacío pero hay datos locales → subir a Sheets
        await saveCatalogToSheets(local);
        toast(`✓ ${local.length} productos guardados en Sheets`, 'success');
        setSyncStatus('', `✓ ${local.length} guardados`);
      } else if (remote !== null && remote.length > 0) {
        // Sheets tiene datos → bajar y actualizar local
        Catalog.setFromRemote(remote);
        renderCatalog(document.getElementById('cat-search')?.value || '');
        toast('✓ Catálogo sincronizado desde Sheets', 'success');
        setSyncStatus('', `✓ ${remote.length} productos`);
      }
    } catch(e) {
      toast('Error al sincronizar: ' + e.message, 'error');
      setSyncStatus('error', 'Error');
    } finally {
      _isSyncing = false;
    }
  }

  // ── USUARIOS ─────────────────────────────────────────────────────
  async function checkUserAccess(email, nombre) {
    try {
      const token = await Auth.ensureToken();
      const r = await fetch(
        `${SHEETS_BASE}/${CONFIG.SPREADSHEET_ID}/values/${CONFIG.USERS_SHEET}!A:D`,
        { headers: { Authorization: 'Bearer ' + token } }
      );
      if (!r.ok) {
        // Hoja no existe → crear y registrar como admin
        await _initUsersSheet(email, nombre, token);
        return { allowed: true, rol: 'admin' };
      }
      const data = await r.json();
      const rows = (data.values || []).slice(1);
      const userRow = rows.find(row => (row[0]||'').toLowerCase() === email.toLowerCase());
      if (!userRow) {
        await _appendUser(email, nombre, 'vendedor', 'FALSE', token);
        return { allowed: false, message: 'Acceso pendiente de aprobación. Contacta al administrador.' };
      }
      if ((userRow[3]||'').toUpperCase() !== 'TRUE') {
        return { allowed: false, message: 'Tu acceso no está activo. Contacta al administrador.' };
      }
      return { allowed: true, rol: userRow[2] || 'vendedor' };
    } catch(e) {
      return { allowed: true, rol: 'vendedor' }; // Si falla, permitir acceso
    }
  }

  async function _initUsersSheet(email, nombre, token) {
    await fetch(`${SHEETS_BASE}/${CONFIG.SPREADSHEET_ID}:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: CONFIG.USERS_SHEET } } }] })
    }).catch(() => {});
    await fetch(
      `${SHEETS_BASE}/${CONFIG.SPREADSHEET_ID}/values/${CONFIG.USERS_SHEET}!A1?valueInputOption=RAW`,
      { method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [['EMAIL','NOMBRE','ROL','ACTIVO'], [email, nombre, 'admin', 'TRUE']] }) }
    );
  }

  async function _appendUser(email, nombre, rol, activo, token) {
    await fetch(
      `${SHEETS_BASE}/${CONFIG.SPREADSHEET_ID}/values/${CONFIG.USERS_SHEET}!A:D:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [[email, nombre, rol, activo]] }) }
    );
  }

  async function loadUsers() {
    const token = await Auth.ensureToken();
    const r = await fetch(
      `${SHEETS_BASE}/${CONFIG.SPREADSHEET_ID}/values/${CONFIG.USERS_SHEET}!A:D`,
      { headers: { Authorization: 'Bearer ' + token } }
    );
    if (!r.ok) return [];
    const data = await r.json();
    return (data.values || []).slice(1)
      .filter(r => r[0])
      .map(r => ({ email: r[0]||'', nombre: r[1]||'', rol: r[2]||'vendedor', activo: (r[3]||'').toUpperCase()==='TRUE' }));
  }

  async function saveUsers(users) {
    const token = await Auth.ensureToken();
    const rows = [['EMAIL','NOMBRE','ROL','ACTIVO'], ...users.map(u => [u.email, u.nombre, u.rol, u.activo?'TRUE':'FALSE'])];
    await fetch(`${SHEETS_BASE}/${CONFIG.SPREADSHEET_ID}/values/${CONFIG.USERS_SHEET}:clear`,
      { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
    await fetch(
      `${SHEETS_BASE}/${CONFIG.SPREADSHEET_ID}/values/${CONFIG.USERS_SHEET}!A1?valueInputOption=RAW`,
      { method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: rows }) }
    );
  }

  // ── PERFILES DE VENDEDOR ──────────────────────────────────────────
  async function loadProfile(email) {
    try {
      const token = await Auth.ensureToken();
      const r = await fetch(
        `${SHEETS_BASE}/${CONFIG.SPREADSHEET_ID}/values/${CONFIG.PROFILES_SHEET}!A:F`,
        { headers: { Authorization: 'Bearer ' + token } }
      );
      if (!r.ok) return null;
      const data = await r.json();
      const rows = (data.values || []).slice(1);
      const row = rows.find(r => (r[0]||'').toLowerCase() === email.toLowerCase());
      if (!row) return null;
      return { email: row[0]||'', nombre: row[1]||'', cargo: row[2]||'', telefono: row[3]||'', emailVendedor: row[4]||'', notas: row[5] ? JSON.parse(row[5]) : null };
    } catch(e) { return null; }
  }

  async function saveProfile(profile) {
    const token = await Auth.ensureToken();
    // Crear hoja si no existe
    await fetch(`${SHEETS_BASE}/${CONFIG.SPREADSHEET_ID}:batchUpdate`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: CONFIG.PROFILES_SHEET } } }] })
    }).catch(() => {});
    // Leer filas actuales
    const rAll = await fetch(`${SHEETS_BASE}/${CONFIG.SPREADSHEET_ID}/values/${CONFIG.PROFILES_SHEET}!A:F`, { headers: { Authorization: 'Bearer ' + token } });
    const allData = rAll.ok ? await rAll.json() : { values: [] };
    const rows = allData.values || [];
    if (!rows.length) rows.push(['EMAIL','NOMBRE','CARGO','TELEFONO','EMAIL_VENDEDOR','NOTAS']);
    const idx = rows.findIndex((r, i) => i > 0 && (r[0]||'').toLowerCase() === profile.email.toLowerCase());
    const row = [profile.email, profile.nombre||'', profile.cargo||'', profile.telefono||'', profile.emailVendedor||'', profile.notas ? JSON.stringify(profile.notas) : ''];
    if (idx >= 0) rows[idx] = row; else rows.push(row);
    await fetch(`${SHEETS_BASE}/${CONFIG.SPREADSHEET_ID}/values/${CONFIG.PROFILES_SHEET}:clear`,
      { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
    await fetch(
      `${SHEETS_BASE}/${CONFIG.SPREADSHEET_ID}/values/${CONFIG.PROFILES_SHEET}!A1?valueInputOption=RAW`,
      { method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: rows }) }
    );
  }

  return {
    initSheet,
    loadFromSheets,
    saveCatalogToSheets,
    uploadImageToDrive,
    ensureDriveFolder,
    migrateFromLocalStorage,
    hasPendingMigration,
    startAutoSync,
    stopAutoSync,
    syncNow,
    checkUserAccess,
    loadUsers,
    saveUsers,
    loadProfile,
    saveProfile,
  };
})();
