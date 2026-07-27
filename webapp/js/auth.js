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
  let _backgroundRenewing = false; // true mientras hay una renovación en curso

  // ── INIT ──────────────────────────────────────────────────────────
  async function init() {
    // Esperar a que cargue la librería GIS
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

    // Seguro periódico: cada 4 minutos verifica si el token está próximo a expirar.
    // Esto garantiza renovación aunque los timers de setTimeout fallen (ej: mobile sleep).
    setInterval(() => {
      if (_token && _tokenClient && _userInfo) {
        const msLeft = _tokenExpiry - Date.now();
        if (msLeft > 0 && msLeft <= 600000) { // menos de 10 minutos
          _backgroundRenew();
        }
      }
    }, 4 * 60 * 1000);

    // Intentar restaurar sesión
    const saved = localStorage.getItem('ow_user');
    if (saved) {
      try {
        _userInfo = JSON.parse(saved);
        _token = localStorage.getItem('ow_token');
        _tokenExpiry = parseInt(localStorage.getItem('ow_token_exp') || '0');
        if (_token && Date.now() < _tokenExpiry) {
          // Token aún válido → entrar directo y programar renovación automática
          _showApp();
          const msLeft = _tokenExpiry - Date.now();
          setTimeout(_backgroundRenew, Math.max(msLeft - 240000, 60000));
          return true;
        }
        if (_userInfo) {
          // Token expirado pero hay sesión guardada → renovar silenciosamente.
          // Si Google sigue con sesión activa, entra sin popup.
          // Si falla, _handleTokenResponse muestra login.
          _silentRefresh = true;
          _updateHeaderUser();
          _tokenClient.requestAccessToken({ prompt: '' });
          return false;
        }
      } catch(e) {}
    }

    // Sin sesión guardada → mostrar pantalla de login
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
      console.warn('OAuth error:', resp.error, '| background:', wasBackground);
      if (wasBackground) {
        // Renovación en background falló — NO cerrar sesión, reintentar en 5 min.
        setTimeout(_backgroundRenew, 5 * 60 * 1000);
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
      // Renovación background exitosa — solo actualizar token, no re-iniciar app
      _scheduleRenewal(resp.expires_in);
      return;
    }

    // Login normal → obtener info del usuario e iniciar app
    fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: 'Bearer ' + _token }
    })
    .then(r => r.json())
    .then(info => {
      _userInfo = info;
      localStorage.setItem('ow_user', JSON.stringify(info));
      _showApp();
      if (typeof App !== 'undefined') App.afterAuth();
    })
    .catch(() => {
      _showApp();
      if (typeof App !== 'undefined') App.afterAuth();
    });

    _scheduleRenewal(resp.expires_in);
  }

  // ── RENOVACIÓN DE TOKEN EN SEGUNDO PLANO ────────────────────────
  function _scheduleRenewal(expiresIn) {
    const ms = Math.max((expiresIn - 300) * 1000, 60000); // 5 min antes de expirar
    setTimeout(_backgroundRenew, ms);
  }

  function _backgroundRenew() {
    if (!_tokenClient || _backgroundRenewing) return;
    _backgroundRenewing = true;

    // Doble protección: intercambiar callback (funciona si GIS usa referencia dinámica)
    // + flag _backgroundRenewing (funciona si GIS usa el callback original).
    const orig = _tokenClient.callback;
    const timeout = setTimeout(() => {
      // Si el callback no se dispara en 20s, restaurar y reintentar después
      _tokenClient.callback = orig;
      _backgroundRenewing = false;
      setTimeout(_backgroundRenew, 5 * 60 * 1000);
    }, 20000);

    _tokenClient.callback = (resp) => {
      clearTimeout(timeout);
      _tokenClient.callback = orig;
      _backgroundRenewing = false;
      if (resp.error) {
        console.warn('Background renewal error:', resp.error, '— retrying in 5 min');
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
    if (_token) {
      google.accounts.oauth2.revoke(_token, () => {});
    }
    _token = null; _userInfo = null; _tokenExpiry = 0;
    _backgroundRenewing = false;
    localStorage.removeItem('ow_token');
    localStorage.removeItem('ow_token_exp');
    localStorage.removeItem('ow_user');
    _showLogin();
    if (typeof App !== 'undefined') App.onLogout();
  }

  // ── TOKEN REFRESH ────────────────────────────────────────────────
  async function ensureToken() {
    if (_token && Date.now() < _tokenExpiry) return _token;
    // Token expirado → pedir silenciosamente
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
