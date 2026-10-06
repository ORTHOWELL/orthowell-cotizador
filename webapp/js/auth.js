/**
 * auth.js — Autenticación Google OAuth via Google Identity Services (GIS)
 *
 * Flujo de renovación (el token de Google dura 1 h):
 *   1. Al obtener/restaurar un token válido → se programa renovación silenciosa
 *      5 min antes de que expire, usando un iframe oculto (sin popup visible).
 *   2. Los temporizadores no corren con la app en segundo plano (celular
 *      minimizado, equipo en reposo): al volver a primer plano / reconectar se
 *      revisa el token y se renueva de inmediato si venció o está por vencer.
 *   3. Si el iframe falla (cookies de terceros bloqueadas, etc.) → banner naranja
 *      y la renovación se hace con el primer toque del usuario (popup de Google
 *      sin selector de cuenta: se abre y se cierra solo si ya hay permiso).
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
  let _appReady = false;        // App.afterAuth ya corrió con una sesión válida
  let _silentInFlight = null;   // renovación por iframe en curso (evita iframes duplicados)
  let _popupInFlight = false;   // popup de renovación abierto
  let _popupTimer = null;
  let _tapArmed = false;        // esperando el primer toque para renovar
  let _tapUsed = false;         // ya se intentó renovar con toque en este vencimiento

  function _initClient() {
    _tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      scope: CONFIG.GOOGLE_SCOPES,
      callback: _handleTokenResponse,
      // Popup cerrado o bloqueado: liberar para poder reintentar (banner / botón)
      error_callback: () => { _popupInFlight = false; clearTimeout(_popupTimer); },
    });
  }

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

    _initClient();

    // Fallback: cada 30 s verificar si el token expiró y el iframe falló
    setInterval(() => {
      if (!_userInfo || !_token) return;
      if (Date.now() >= _tokenExpiry) _expiredFallback();
    }, 30 * 1000);

    // Volver a conexión / a primer plano: los temporizadores no corren con la app
    // minimizada, así que revisar el token en ese momento y renovar si hace falta.
    window.addEventListener('online', _renewIfNeeded);
    window.addEventListener('pageshow', e => { if (e.persisted) _renewIfNeeded(); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') _renewIfNeeded();
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
          _appReady = true;   // app.js llamará a afterAuth al recibir true
          return true;
        }

        if (_userInfo) {
          _showApp();
          if (navigator.onLine) {
            // Con conexión: intentar renovar silenciosamente
            _silentRenewIframe().catch(_expiredFallback);
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

  // Revisa el token (al volver a primer plano o a tener conexión):
  //  - vigente por más de 5 min → solo re-programar el temporizador (pudo quedar suspendido)
  //  - vencido o por vencer     → renovar ya; si falla y ya venció → banner + toque
  function _renewIfNeeded() {
    if (!_userInfo || !navigator.onLine) return;
    if (_token && Date.now() < _tokenExpiry - 5 * 60 * 1000) { _scheduleRenewal(); return; }
    _silentRenewIframe().catch(() => {
      if (Date.now() >= _tokenExpiry) _expiredFallback();
    });
  }

  // Token vencido y la renovación silenciosa falló: avisar y renovar con el primer toque
  function _expiredFallback() {
    if (!_userInfo) return;
    _showRenewalBanner();
    _armTapRenewal();
  }

  function _armTapRenewal() {
    if (_tapArmed || _tapUsed) return;   // un solo intento por vencimiento
    _tapArmed = true;
    // 'click' (no pointerdown): en táctil solo el click cuenta como gesto del usuario
    // y el navegador bloquea popups sin gesto. No se cancela el toque original.
    document.addEventListener('click', () => {
      _tapArmed = false;
      _tapUsed = true;
      if (_userInfo && Date.now() >= _tokenExpiry) renew();
    }, { capture: true, once: true });
  }

  // Token nuevo obtenido (iframe o popup): cerrar aviso y arrancar la app si aún no lo hizo
  function _onTokenRefreshed() {
    _tapUsed = false;
    document.getElementById('session-renewal-banner')?.remove();
    _scheduleRenewal();
    if (!_appReady && _userInfo) {
      _appReady = true;
      _showApp();
      if (typeof App !== 'undefined') App.afterAuth();
    }
  }

  function _silentRenewIframe() {
    // Una sola renovación a la vez (ensureToken puede llamarse varias veces seguidas)
    if (!_silentInFlight) {
      _silentInFlight = _doSilentRenewIframe().finally(() => { _silentInFlight = null; });
    }
    return _silentInFlight;
  }

  async function _doSilentRenewIframe() {
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
        _onTokenRefreshed();
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
    _popupInFlight = false;
    clearTimeout(_popupTimer);

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
    _tapUsed = false;
    _scheduleRenewal(); // programar renovación silenciosa automática

    // Si es una renovación de la misma cuenta y la app ya arrancó, no se reinicia
    // (afterAuth solo corre en el primer login, o si cambió la cuenta).
    const run = changed => {
      _showApp();
      if (changed || !_appReady) {
        _appReady = true;
        if (typeof App !== 'undefined') App.afterAuth();
      }
    };
    fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: 'Bearer ' + _token }
    })
    .then(r => r.json())
    .then(info => {
      const changed = !_userInfo || (info.email && info.email !== _userInfo.email);
      _userInfo = info;
      localStorage.setItem('ow_user', JSON.stringify(info));
      run(changed);
    })
    .catch(() => run(false));
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
      '<button onclick="Auth.renew()" style="',
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
        _initClient();
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

  // Renovar la sesión de un usuario ya conocido: sin selector de cuenta.
  // Google abre un popup que se cierra solo si el usuario ya dio permiso.
  // Debe llamarse desde un gesto del usuario (toque/clic).
  function renew() {
    if (!_userInfo?.email) return login();
    if (_popupInFlight) return;
    if (!_tokenClient) {
      if (window.google?.accounts && !CONFIG.GOOGLE_CLIENT_ID.startsWith('TODO')) _initClient();
      else { _showError('Google no ha cargado aún. Recarga la página.'); return; }
    }
    _popupInFlight = true;
    clearTimeout(_popupTimer);
    _popupTimer = setTimeout(() => { _popupInFlight = false; }, 90 * 1000);
    _loginRequested = false;
    _tokenClient.callback = _handleTokenResponse;
    _tokenClient.requestAccessToken({ prompt: '', hint: _userInfo.email });
  }

  function logout() {
    clearTimeout(_renewalTimer);
    if (_token) google.accounts.oauth2.revoke(_token, () => {});
    _token = null; _userInfo = null; _tokenExpiry = 0;
    _loginRequested = false; _appReady = false; _tapUsed = false;
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
      if (_userInfo) _expiredFallback();
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
    renew,
    logout,
    getToken: () => _token,
    ensureToken,
    getUser: () => _userInfo,
    isAuthenticated: () => !!_token && Date.now() < _tokenExpiry,
  };
})();
