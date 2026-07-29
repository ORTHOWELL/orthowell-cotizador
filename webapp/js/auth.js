/**
 * auth.js — Autenticación Google OAuth via Google Identity Services (GIS)
 * No requiere backend: el token se obtiene directamente en el navegador.
 */

const Auth = (() => {
  let _token = null;
  let _tokenExpiry = 0;
  let _userInfo = null;
  let _tokenClient = null;
  let _silentRefresh = false;
  let _backgroundRenewing = false;
  let _loginRequested = false;  // true SOLO cuando el usuario hace clic en "Ingresar"
  let _appReady = false;        // true después de que App.afterAuth() se ejecutó al menos una vez

  // ── INIT ──────────────────────────────────────────────────────────
  async function init() {
    if (!window.google?.accounts) {
      await new Promise(resolve => {
        const check = setInterval(() => {
          if (window.google?.accounts) { clearInterval(check); resolve(); }
        }, 100);
        setTimeout(() => { clearInterval(check); resolve(); }, 10000);
      });
    }

    if (!window.google?.accounts) {
      _showError('No se pudo cargar Google Identity Services. Verifica tu conexión.');
      return false;
    }

    if (CONFIG.GOOGLE_CLIENT_ID.startsWith('TODO')) {
      _showError('⚙️ Configura tu GOOGLE_CLIENT_ID en js/config.js para comenzar.');
      return false;
    }

    _tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      scope: CONFIG.GOOGLE_SCOPES,
      callback: _handleTokenResponse,
    });

    // ── Seguro 1: setInterval cada 4 min — funciona aunque mobile suspenda timers
    setInterval(() => {
      if (!_token || !_tokenClient || !_userInfo) return;
      const msLeft = _tokenExpiry - Date.now();
      if (msLeft <= 0) {
        // Token ya expirado — aviso al usuario
        _showRenewalBanner();
      } else if (msLeft <= 10 * 60 * 1000) {
        // Menos de 10 min — renovar en background
        _backgroundRenew();
      }
    }, 4 * 60 * 1000);

    // ── Seguro 2: detectar cuando la app vuelve al frente (móvil / tab)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden || !_token || !_tokenClient || !_userInfo) return;
      const msLeft = _tokenExpiry - Date.now();
      if (msLeft <= 0) {
        _showRenewalBanner();
      } else if (msLeft <= 10 * 60 * 1000) {
        _backgroundRenew();
      }
    });

    // Intentar restaurar sesión
    const saved = localStorage.getItem('ow_user');
    if (saved) {
      try {
        _userInfo = JSON.parse(saved);
        _token = localStorage.getItem('ow_token');
        _tokenExpiry = parseInt(localStorage.getItem('ow_token_exp') || '0');

        if (_token && Date.now() < _tokenExpiry) {
          // ── Token válido ─────────────────────────────────────────
          _showApp();
          const msLeft = _tokenExpiry - Date.now();
          // Renovar anticipadamente a los 10 min antes de expirar
          setTimeout(_backgroundRenew, Math.max(msLeft - 10 * 60 * 1000, 60000));
          return true;
        }

        if (_userInfo) {
          // ── Token expirado pero usuario guardado ─────────────────
          // MOSTRAR LA APP INMEDIATAMENTE con banner — NUNCA mostrar el login overlay.
          // El usuario NO debe ver la pantalla de inicio de sesión por un token expirado.
          _showApp();
          _showRenewalBanner();
          // Intentar renovación silenciosa en background
          _silentRefresh = true;
          setTimeout(() => _tokenClient.requestAccessToken({ prompt: '' }), 200);
          return false;
        }
      } catch(e) {}
    }

    // No hay sesión guardada → mostrar login
    _showLogin();
    return false;
  }

  // ── HANDLE TOKEN RESPONSE ────────────────────────────────────────
  function _handleTokenResponse(resp) {
    const wasSilent     = _silentRefresh;
    const wasBackground = _backgroundRenewing;
    const wasLogin      = _loginRequested;
    _silentRefresh      = false;
    _backgroundRenewing = false;
    _loginRequested     = false;

    if (resp.error) {
      console.warn('OAuth error:', resp.error, { wasSilent, wasBackground, wasLogin });

      if (wasBackground) {
        _onRenewalFailed();
        return;
      }

      if (wasSilent) {
        // Renovación silenciosa falló — el banner ya está visible (lo pusimos en init).
        // No hacer nada más; el usuario puede usar la app y pulsar "Renovar".
        return;
      }

      if (wasLogin) {
        // El usuario intentó iniciar sesión explícitamente y falló
        _showError('Error de autenticación: ' + resp.error);
        _showLogin();
        return;
      }

      // ── Respuesta tardía/inesperada de GIS — NUNCA cerrar sesión ──
      if (_userInfo) _onRenewalFailed();
      return;
    }

    // ── Token recibido con éxito ──────────────────────────────────
    _token = resp.access_token;
    _tokenExpiry = Date.now() + (resp.expires_in - 60) * 1000;
    localStorage.setItem('ow_token', _token);
    localStorage.setItem('ow_token_exp', _tokenExpiry.toString());

    if (wasBackground) {
      // Renovación en background exitosa — actualizar token y quitar banner si está
      _scheduleRenewal(resp.expires_in);
      const banner = document.getElementById('session-renewal-banner');
      if (banner) banner.remove();
      return;
    }

    // Login normal o silent refresh exitoso → obtener info del usuario
    fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: 'Bearer ' + _token }
    })
    .then(r => r.json())
    .then(info => {
      _userInfo = info;
      localStorage.setItem('ow_user', JSON.stringify(info));
      _showApp(); // quita overlay y banner
      if (typeof App !== 'undefined') App.afterAuth();
    })
    .catch(() => {
      _showApp();
      if (typeof App !== 'undefined') App.afterAuth();
    });

    _scheduleRenewal(resp.expires_in);
  }

  // ── CUANDO FALLA UNA RENOVACIÓN ──────────────────────────────────
  function _onRenewalFailed() {
    const msLeft = _tokenExpiry - Date.now();
    if (msLeft <= 0) {
      // Ya expiró → mostrar banner (o ya está)
      if (_userInfo) _showRenewalBanner();
      return;
    }
    if (msLeft <= 10 * 60 * 1000 && _userInfo) {
      // Expira en < 10 min → mostrar banner proactivo
      _showRenewalBanner();
    }
    // Reintentar: cuanto menos tiempo quede, más frecuente el reintento
    const delay = Math.min(5 * 60 * 1000, Math.max(Math.floor(msLeft / 3), 30000));
    setTimeout(_backgroundRenew, delay);
  }

  // ── BARRA DE AVISO DE SESIÓN EXPIRADA ───────────────────────────
  function _showRenewalBanner() {
    if (document.getElementById('session-renewal-banner')) return;
    const el = document.createElement('div');
    el.id = 'session-renewal-banner';
    el.style.cssText = [
      'position:fixed;top:60px;left:0;right:0;z-index:9998;',
      'background:#e65100;color:#fff;padding:11px 20px;',
      'display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap;',
      'font-size:13px;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,.4);',
    ].join('');
    el.innerHTML = [
      '<span>⏰ Tu sesión expiró. Los cambios no se guardarán hasta renovar.</span>',
      '<button onclick="Auth.login()" style="',
        'background:#fff;color:#e65100;border:none;padding:7px 18px;',
        'border-radius:6px;cursor:pointer;font-size:12px;font-weight:700;white-space:nowrap;',
      '">🔄 Renovar sesión</button>',
    ].join('');
    document.body.appendChild(el);
  }

  // ── RENOVACIÓN EN SEGUNDO PLANO ──────────────────────────────────
  function _scheduleRenewal(expiresIn) {
    // Renovar 10 min antes de expirar (antes era 5 min, muy poco margen)
    const ms = Math.max((expiresIn - 600) * 1000, 60000);
    setTimeout(_backgroundRenew, ms);
  }

  function _backgroundRenew() {
    if (!_tokenClient || _backgroundRenewing) return;
    _backgroundRenewing = true;

    const orig = _tokenClient.callback;
    const timeoutId = setTimeout(() => {
      // GIS no respondió en 25s — restaurar y manejar como fallo
      _tokenClient.callback = orig;
      _backgroundRenewing = false;
      _onRenewalFailed();
    }, 25000);

    _tokenClient.callback = (resp) => {
      clearTimeout(timeoutId);
      _tokenClient.callback = orig;
      _backgroundRenewing = false;
      if (resp.error) {
        _onRenewalFailed();
        return;
      }
      _token = resp.access_token;
      _tokenExpiry = Date.now() + (resp.expires_in - 60) * 1000;
      localStorage.setItem('ow_token', _token);
      localStorage.setItem('ow_token_exp', _tokenExpiry.toString());
      _scheduleRenewal(resp.expires_in);
      // Quitar banner si estaba por renovación exitosa en background
      const banner = document.getElementById('session-renewal-banner');
      if (banner) banner.remove();
    };

    _tokenClient.requestAccessToken({ prompt: '' });
  }

  // ── LOGIN / LOGOUT ───────────────────────────────────────────────
  function login() {
    if (!_tokenClient) {
      if (window.google?.accounts && !CONFIG.GOOGLE_CLIENT_ID.startsWith('TODO')) {
        _tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: CONFIG.GOOGLE_CLIENT_ID,
          scope: CONFIG.GOOGLE_SCOPES,
          callback: _handleTokenResponse,
        });
      } else {
        _showError('Google no ha cargado aún. Recarga la página.');
        return;
      }
    }
    // Cancelar cualquier estado de renovación en curso para que el callback esté libre
    _backgroundRenewing = false;
    _silentRefresh = false;
    _loginRequested = true;
    document.getElementById('auth-error').textContent = '';
    _tokenClient.requestAccessToken({ prompt: 'select_account' });
  }

  function logout() {
    if (_token) google.accounts.oauth2.revoke(_token, () => {});
    _token = null; _userInfo = null; _tokenExpiry = 0;
    _backgroundRenewing = false; _loginRequested = false; _appReady = false;
    localStorage.removeItem('ow_token');
    localStorage.removeItem('ow_token_exp');
    localStorage.removeItem('ow_user');
    _showLogin();
    if (typeof App !== 'undefined') App.onLogout();
  }

  // ── ENSURE TOKEN (para llamadas a la API) ────────────────────────
  async function ensureToken() {
    if (_token && Date.now() < _tokenExpiry) return _token;
    // Token expirado — mostrar banner y rechazar.
    // NO intentar popup silencioso (puede mostrar ventana de Google inesperada).
    if (_userInfo) _showRenewalBanner();
    throw new Error('session_expired');
  }

  // ── UI HELPERS ───────────────────────────────────────────────────
  function _showLogin() {
    const overlay = document.getElementById('auth-overlay');
    if (overlay) overlay.classList.remove('hidden');
    _updateHeaderUser();
  }
  function _showApp() {
    const overlay = document.getElementById('auth-overlay');
    if (overlay) overlay.classList.add('hidden');
    const banner = document.getElementById('session-renewal-banner');
    if (banner) banner.remove();
    _updateHeaderUser();
  }
  function _showError(msg) {
    const el = document.getElementById('auth-error');
    if (el) el.textContent = msg;
  }
  function _updateHeaderUser() {
    const nameEl   = document.getElementById('user-name');
    const emailEl  = document.getElementById('user-email');
    const avatarEl = document.getElementById('user-avatar');
    if (nameEl)  nameEl.textContent  = _userInfo?.name  || _userInfo?.email || '';
    if (emailEl) emailEl.textContent = _userInfo?.email || '';
    if (avatarEl && _userInfo?.picture) {
      avatarEl.src = _userInfo.picture;
      avatarEl.style.display = 'inline';
    } else if (avatarEl) {
      avatarEl.style.display = 'none';
    }
  }

  // ── PUBLIC API ───────────────────────────────────────────────────
  return {
    init,
    login,
    logout,
    getToken: () => _token,
    ensureToken,
    getUser: () => _userInfo,
    isAuthenticated: () => !!_token && Date.now() < _tokenExpiry,
  };
})();
