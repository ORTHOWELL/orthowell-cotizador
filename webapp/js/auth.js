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

    // ── Seguro 1: setInterval cada 4 min — funciona aunque mobile duerma los timers
    setInterval(() => {
      if (_token && _tokenClient && _userInfo) {
        const msLeft = _tokenExpiry - Date.now();
        if (msLeft > 0 && msLeft <= 600000) _backgroundRenew(); // < 10 min
        if (msLeft <= 0) _backgroundRenew();                     // ya expiró
      }
    }, 4 * 60 * 1000);

    // ── Seguro 2: detectar cuando la app vuelve al frente (móvil)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && _token && _tokenClient && _userInfo) {
        const msLeft = _tokenExpiry - Date.now();
        if (msLeft <= 600000) _backgroundRenew(); // renova si < 10 min o ya expiró
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
          _showApp();
          const msLeft = _tokenExpiry - Date.now();
          setTimeout(_backgroundRenew, Math.max(msLeft - 240000, 60000));
          return true;
        }
        if (_userInfo) {
          _silentRefresh = true;
          _updateHeaderUser();
          _tokenClient.requestAccessToken({ prompt: '' });
          return false;
        }
      } catch(e) {}
    }

    _showLogin();
    return false;
  }

  // ── HANDLE TOKEN RESPONSE ────────────────────────────────────────
  function _handleTokenResponse(resp) {
    const wasSilent = _silentRefresh;
    const wasBackground = _backgroundRenewing;
    _silentRefresh = false;
    _backgroundRenewing = false;

    if (resp.error) {
      console.warn('OAuth error:', resp.error, '| silent:', wasSilent, '| bg:', wasBackground);

      if (wasBackground) {
        // Renovación en background falló — NO cerrar sesión, reintentar en 5 min
        setTimeout(_backgroundRenew, 5 * 60 * 1000);
        return;
      }

      if (wasSilent && _userInfo) {
        // Renovación silenciosa al inicio falló pero el usuario está identificado:
        // mostrar app con barra de aviso, NO la pantalla de login completa.
        _showApp();
        _showRenewalBanner();
        return;
      }

      if (!wasSilent) _showError('Error de autenticación: ' + resp.error);
      _showLogin();
      return;
    }

    _token = resp.access_token;
    _tokenExpiry = Date.now() + (resp.expires_in - 60) * 1000;
    localStorage.setItem('ow_token', _token);
    localStorage.setItem('ow_token_exp', _tokenExpiry.toString());

    if (wasBackground) {
      // Renovación background exitosa — solo actualizar token
      _scheduleRenewal(resp.expires_in);
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
      _showApp(); // también quita la barra de aviso si estaba visible
      if (typeof App !== 'undefined') App.afterAuth();
    })
    .catch(() => {
      _showApp();
      if (typeof App !== 'undefined') App.afterAuth();
    });

    _scheduleRenewal(resp.expires_in);
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

  // ── RENOVACIÓN DE TOKEN EN SEGUNDO PLANO ────────────────────────
  function _scheduleRenewal(expiresIn) {
    const ms = Math.max((expiresIn - 300) * 1000, 60000);
    setTimeout(_backgroundRenew, ms);
  }

  function _backgroundRenew() {
    if (!_tokenClient || _backgroundRenewing) return;
    _backgroundRenewing = true;

    // Intercambiar callback (si GIS lo usa dinámicamente, la respuesta no llega a _handleTokenResponse)
    const orig = _tokenClient.callback;
    const timeoutId = setTimeout(() => {
      // GIS no respondió en 20s — restaurar y reintentar
      _tokenClient.callback = orig;
      _backgroundRenewing = false;
      setTimeout(_backgroundRenew, 5 * 60 * 1000);
    }, 20000);

    _tokenClient.callback = (resp) => {
      clearTimeout(timeoutId);
      _tokenClient.callback = orig;
      _backgroundRenewing = false;
      if (resp.error) {
        setTimeout(_backgroundRenew, 5 * 60 * 1000);
        return;
      }
      _token = resp.access_token;
      _tokenExpiry = Date.now() + (resp.expires_in - 60) * 1000;
      localStorage.setItem('ow_token', _token);
      localStorage.setItem('ow_token_exp', _tokenExpiry.toString());
      _scheduleRenewal(resp.expires_in);
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
    document.getElementById('auth-error').textContent = '';
    _tokenClient.requestAccessToken({ prompt: 'select_account' });
  }

  function logout() {
    if (_token) google.accounts.oauth2.revoke(_token, () => {});
    _token = null; _userInfo = null; _tokenExpiry = 0;
    _backgroundRenewing = false;
    localStorage.removeItem('ow_token');
    localStorage.removeItem('ow_token_exp');
    localStorage.removeItem('ow_user');
    _showLogin();
    if (typeof App !== 'undefined') App.onLogout();
  }

  // ── ENSURE TOKEN (para llamadas a la API) ────────────────────────
  async function ensureToken() {
    if (_token && Date.now() < _tokenExpiry) return _token;
    return new Promise((resolve, reject) => {
      if (!_tokenClient) { reject(new Error('No auth client')); return; }
      const origCallback = _tokenClient.callback;
      _tokenClient.callback = (resp) => {
        _tokenClient.callback = origCallback;
        if (resp.error) { reject(new Error(resp.error)); return; }
        _token = resp.access_token;
        _tokenExpiry = Date.now() + (resp.expires_in - 60) * 1000;
        localStorage.setItem('ow_token', _token);
        localStorage.setItem('ow_token_exp', _tokenExpiry.toString());
        _scheduleRenewal(resp.expires_in);
        resolve(_token);
      };
      _tokenClient.requestAccessToken({ prompt: '' });
    });
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
