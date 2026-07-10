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

    // Intentar restaurar sesión
    const saved = localStorage.getItem('ow_user');
    if (saved) {
      try {
        _userInfo = JSON.parse(saved);
        _token = localStorage.getItem('ow_token');
        _tokenExpiry = parseInt(localStorage.getItem('ow_token_exp') || '0');
        if (_token && Date.now() < _tokenExpiry) {
          // Token aún válido → entrar directo
          _showApp();
          return true;
        }
        if (_userInfo) {
          // Token expirado pero hay sesión guardada → renovar silenciosamente.
          // Si Google sigue con sesión activa en el dispositivo, entra sin popup.
          // Si falla (sesión de Google cerrada), _handleTokenResponse muestra login.
          _silentRefresh = true;
          _updateHeaderUser(); // mostrar nombre/avatar mientras carga
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
    _silentRefresh = false;
    if (resp.error) {
      console.warn('OAuth error:', resp.error);
      if (!wasSilent) _showError('Error de autenticación: ' + resp.error);
      _showLogin();
      return;
    }

    _token = resp.access_token;
    _tokenExpiry = Date.now() + (resp.expires_in - 60) * 1000;
    localStorage.setItem('ow_token', _token);
    localStorage.setItem('ow_token_exp', _tokenExpiry.toString());

    // Obtener info del usuario
    fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: 'Bearer ' + _token }
    })
    .then(r => r.json())
    .then(info => {
      _userInfo = info;
      localStorage.setItem('ow_user', JSON.stringify(info));
      _showApp();
      // Iniciar la app después de autenticar
      if (typeof App !== 'undefined') App.afterAuth();
    })
    .catch(() => {
      _showApp();
      if (typeof App !== 'undefined') App.afterAuth();
    });

    // Auto-renovar token antes de expirar
    const renewIn = (resp.expires_in - 120) * 1000;
    setTimeout(() => {
      if (_tokenClient) _tokenClient.requestAccessToken({ prompt: '' });
    }, Math.max(renewIn, 60000));
  }

  // ── LOGIN / LOGOUT ───────────────────────────────────────────────
  function login() {
    if (!_tokenClient) {
      // GIS puede haber cargado después del timeout de init() — intentar inicializar ahora
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
