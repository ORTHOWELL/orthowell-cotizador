/**
 * ORTHOWELL Cotizador — Configuración
 *
 * PASOS PARA CONFIGURAR:
 * 1. Sigue la guía de Google Cloud Console
 * 2. Reemplaza los valores TODO con tus credenciales reales
 * 3. Crea el Google Sheet y copia su ID desde la URL
 */

const CONFIG = {

  // ─── GOOGLE OAUTH ───────────────────────────────────────────
  // Obtenido en: Google Cloud Console → APIs → Credenciales → ID de cliente OAuth
  // Formato: xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com
  GOOGLE_CLIENT_ID: '420825323169-705n8tnp22alekd4356m3caafug3qtku.apps.googleusercontent.com',

  // ─── GOOGLE SHEETS ──────────────────────────────────────────
  // ID del Google Sheet (la parte larga en la URL del sheet)
  // Ejemplo URL: https://docs.google.com/spreadsheets/d/  <<ESTE_ES_EL_ID>>  /edit
  SPREADSHEET_ID: '1FIgB1QmUlG99BazJDuqwYtAtKt2dbHOSlX5MiXkcvh8',

  // Nombres de pestañas en Google Sheets
  SHEET_NAME:    'Catalogo',
  USERS_SHEET:   'Usuarios',
  PROFILES_SHEET:'Perfiles',

  // ─── GOOGLE DRIVE ───────────────────────────────────────────
  // Nombre de la carpeta que se creará automáticamente en tu Drive
  DRIVE_FOLDER_NAME: 'ORTHOWELL-COTIZADOR-IMAGENES',

  // ─── APP SETTINGS ───────────────────────────────────────────
  APP_NAME: 'ORTHOWELL Cotizador',
  APP_VERSION: '2.0.0',

  // Claves localStorage (compatibilidad con versión anterior)
  CATALOG_CACHE_KEY: 'ow_catalog_v9',       // Nueva clave (sin base64)
  CATALOG_LEGACY_KEY: 'ow_catalog_v8',      // Clave de la versión anterior
  BRAND_KEY: 'ow_brand_v1',
  NOTES_KEY: 'ow_pdf_notes',
  DRIVE_FOLDER_ID_KEY: 'ow_drive_folder_id',

  // Intervalo de sincronización automática desde Sheets (ms)
  AUTO_SYNC_INTERVAL: 5 * 60 * 1000,       // 5 minutos

  // Email del administrador principal (siempre tiene acceso aunque falle el Sheet)
  ADMIN_EMAIL: 'andresortega.ie@gmail.com',

  // Scopes de Google APIs necesarios
  // email + profile: para obtener nombre y correo del usuario autenticado
  GOOGLE_SCOPES: [
    'openid',
    'email',
    'profile',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.file',
  ].join(' '),

  // Columnas del Sheet (orden fijo — no cambiar)
  SHEET_COLUMNS: ['ID','REF','NOMBRE','MARCA','PRECIO1','PRECIO2','PRECIO3','COSTO','IVA','SALDO','IMAGE_URL','DRIVE_FILE_ID'],
};
