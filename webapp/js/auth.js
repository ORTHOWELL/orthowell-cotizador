/**
 * auth.js — Autenticación Google OAuth via Google Identity Services (GIS)
 *
 * Flujo de renovación:
 *   1. Al obtener/restaurar un token válido → se programa renovación silenciosa
 *      5 min antes de que expire, usando un iframe oculto (sin popup visible).
 *   2. Si el iframe falla (cookies de terceros bloqueadas, usuario desconectado
 *      de Google, etc.) → el setInterval cada 30 s detecta la expiración y
 *      muestra el banner naranja para que el usuario renueve con un clic.
 *
 * NOTA: El iframe apunta a oauth-callback.html, que debe estar registrado como
 * "URI de redireccionamiento autorizado" en Google Cloud Console:
 *   https://orthowell.github.io/orthowell-cotizador/webapp/oauth-callback.html
 *   http://localhost:5500/oauth-callback.html  (desarrollo local)
 */

const Auth = (() => {
  let _token = null;
  let _tokenExpiry = 0;
  let _userInfo = null;
  let _tokenClient = null;
  let _loginRequested = false;
  let _renewalTimer = null;

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

    // Fallback: cada 30 s verificar si el token expiró y el iframe falló
    setInterval(() => {
      if (!_userInfo || !_token) return;
      if (Date.now() >= _tokenExpiry) _showRenewalBanner();
    }, 30 * 1000);

    // Cuando vuelva la conexión: intentar renovar si el token expiró mientras offline
    window.addEventListener('online', () => {
      if (_userInfo && Date.now() >= _tokenExpiry) {
        _silentRenewIframe().catch(() => _showRenewalBanner());
      }
    });

    // Intentar restaurar sesión desde localStorage
    const saved = localStorage.getItem('ow_user');
    if (saved) {
      try {
        _userInfo = JSON.parse(saved);
        _token = localStorage.getItem('ow_token');
        _tokenExpiry = parseInt(localStorage.getItem('ow_token_exp') || '0');

        if (_token && Date.now() < _tokenExpiry) {
          _showApp();
          _scheduleRenewal(); // programar renovación silenciosa
          return true;
        }

        if (_userInfo) {
          _showApp();
          if (navigator.onLine) {
            // Con conexión: intentar renovar silenciosamente
            _silentRenewIframe().catch(() => _showRenewalBanner());
          }
          // Sin conexión: el listener 'online' intentará renovar cuando vuelva la red
          return false;
        }
      } catch(e) {}
    }

    _showLogin();
    return false;
  }

  // ── RENOVACIÓN SILENCIOSA VÍA IFRAME ────────────────────────────
  function _scheduleRenewal() {
    clearTimeout(_renewalTimer);
    // Renovar 5 min antes de que expire
    const delay = _tokenExpiry - Date.now() - 5 * 60 * 1000;
    _renewalTimer = setTimeout(() => {
      _silentRenewIframe().catch(() => {
        // Si falla, el setInterval de 30 s mostrará el banner cuando expire
      });
    }, delay > 0 ? delay : 0);
  }

  async function _silentRenewIframe() {
    if (!_userInfo?.email) throw new Error('no_user');

    const base = location.origin + location.pathname.replace(/\/[^/]*$/, '/');
    const redirectUri = base + 'oauth-callback.html';

    const params = new URLSearchParams({
      client_id:     CONFIG.GOOGLE_CLIENT_ID,
      redirect_uri:  redirectUri,
      response_type: 'token',
      scope:         CONFIG.GOOGLE_SCOPES,
      prompt:        'none',
      login_hint:    _userInfo.email,
    });

    return new Promise((resolve, reject) => {
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'display:none;width:1px;height:1px;border:0;position:absolute;top:-200px;left:-200px;';
      iframe.src = 'https://accounts.google.com/o/oauth2/v2/auth?' + params;

      const timer = setTimeout(() => {
        iframe.remove();
        reject(new Error('timeout'));
      }, 15000);

      function handler(ev) {
        if (ev.origin !== location.origin) return;
        if (ev.data?.type !== 'ow_oauth_silent') return;
        window.removeEventListener('message', handler);
        clearTimeout(timer);
        iframe.remove();

        if (ev.data.error || !ev.data.access_token) {
          reject(new Error(ev.data.error || 'no_token'));
          return;
        }

        _token = ev.data.access_token;
        _tokenExpiry = Date.now() + (parseInt(ev.data.expires_in || '3600') - 60) * 1000;
        localStorage.setItem('ow_token', _token);
        localStorage.setItem('ow_token_exp', _tokenExpiry.toString());
        document.getElementById('session-renewal-banner')?.remove();
        _scheduleRenewal(); // programar la próxima renovación
        resolve(_token);
      }
      window.addEventListener('message', handler);
      document.body.appendChild(iframe);
    });
  }

  // ── HANDLE TOKEN RESPONSE (login manual / renovación con clic) ───
  function _handleTokenResponse(resp) {
    const wasLogin = _loginRequested;
    _loginRequested = false;

    if (resp.error) {
      console.warn('OAuth error:', resp.error);
      if (wasLogin) {
        _showError('Error de autenticación: ' + resp.error);
        _showLogin();
      }
      return;
    }

    _token = resp.access_token;
    _tokenExpiry = Date.now() + (resp.expires_in - 60) * 1000;
    localStorage.setItem('ow_token', _token);
    localStorage.setItem('ow_token_exp', _tokenExpiry.toString());
    _scheduleRenewal(); // programar renovación silenciosa automática

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
  }

  // ── BANNER DE SESIÓN EXPIRADA (fallback si iframe falla) ─────────
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
    _loginRequested = true;
    _tokenClient.callback = _handleTokenResponse;
    document.getElementById('auth-error').textContent = '';
    _tokenClient.requestAccessToken({ prompt: 'select_account' });
  }

  function logout() {
    clearTimeout(_renewalTimer);
    if (_token) google.accounts.oauth2.revoke(_token, () => {});
    _token = null; _userInfo = null; _tokenExpiry = 0;
    _loginRequested = false;
    localStorage.removeItem('ow_token');
    localStorage.removeItem('ow_token_exp');
    localStorage.removeItem('ow_user');
    _showLogin();
    if (typeof App !== 'undefined') App.onLogout();
  }

  // ── ENSURE TOKEN (para llamadas a la API) ────────────────────────
  async function ensureToken() {
    if (_token && Date.now() < _tokenExpiry) return _token;
    if (!navigator.onLine) throw new Error('offline');
    // Intentar renovación silenciosa de último momento
    try {
      return await _silentRenewIframe();
    } catch(e) {
      if (_userInfo) _showRenewalBanner();
      throw new Error('session_expired');
    }
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
    document.getElementById('session-renewal-banner')?.remove();
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
