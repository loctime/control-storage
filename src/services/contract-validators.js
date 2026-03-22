/**
 * ⚠️ CONTRATO APP ↔ ControlFile v1 - Helpers Preparatorios
 * 
 * Este archivo contiene stubs y helpers preparatorios para las validaciones
 * del contrato v1. NO implementan validaciones reales todavía.
 * 
 * Estado actual: LEGACY PERMISIVO
 * - El backend actual permite cualquier operación sin restricciones
 * - Estas funciones están preparadas para futuras validaciones
 * - No rompen compatibilidad con apps existentes
 * 
 * Referencia: docs/docs_v2/03_CONTRATOS_TECNICOS/CONTRACT.md
 */

const { logger } = require('../utils/logger');
const { recordCallerTypeDetection } = require('./contract-metrics');
const { isAppWhitelisted } = require('./contract-feature-flags');

/**
 * Determina si el caller es ControlFile UI o una app externa
 * 
 * Estrategia multi-señal (prioridad):
 * 1. Header X-ControlFile-Caller (más confiable)
 * 2. Claims del token (appId)
 * 3. User-Agent pattern matching
 * 4. Origin domain matching
 * 5. Fallback a UNKNOWN
 * 
 * @param {Object} req - Express request object
 * @returns {Object} { 
 *   isControlFileUI: boolean, 
 *   appId?: string,
 *   detectionMethod: string,
 *   confidence: number
 * }
 */
function detectCallerType(req) {
  const signals = [];
  let appId = null;
  let isControlFileUI = false;
  let detectionMethod = 'FALLBACK';
  let confidence = 0;
  
  // 1. Header X-ControlFile-Caller (más confiable)
  const callerHeader = req.headers['x-controlfile-caller'] || req.headers['X-ControlFile-Caller'];
  if (callerHeader) {
    const normalized = callerHeader.trim().toLowerCase();
    if (normalized === 'ui' || normalized === 'controlfile-ui') {
      isControlFileUI = true;
      detectionMethod = 'HEADER';
      confidence = 0.95;
      signals.push('HEADER_UI');
    } else if (normalized === 'app' || normalized.startsWith('app:')) {
      isControlFileUI = false;
      appId = normalized.startsWith('app:') ? normalized.split(':')[1] : null;
      detectionMethod = 'HEADER';
      confidence = 0.95;
      signals.push('HEADER_APP');
    }
  }
  
  // 2. Claims del token (appId)
  if (!isControlFileUI && req.claims) {
    const claimsAppId = req.claims.appId || req.claims.app_id || req.claims.application_id;
    if (claimsAppId) {
      appId = claimsAppId;
      isControlFileUI = false;
      if (detectionMethod === 'FALLBACK') {
        detectionMethod = 'CLAIMS';
        confidence = 0.85;
      }
      signals.push('CLAIMS_APP_ID');
    }
    
    // Verificar si hay claim explícito de ControlFile UI
    if (req.claims.controlfile_ui === true || req.claims.controlFileUI === true) {
      isControlFileUI = true;
      detectionMethod = 'CLAIMS';
      confidence = 0.90;
      signals.push('CLAIMS_CONTROLFILE_UI');
    }
  }
  
  // 3. User-Agent pattern matching
  const userAgent = req.headers['user-agent'] || '';
  if (userAgent && !isControlFileUI && !appId) {
    // Patrones conocidos de ControlFile UI
    const controlFilePatterns = [
      /controlfile/i,
      /control-file/i,
      /controldoc.*web/i,
      /next\.js/i // ControlFile usa Next.js
    ];
    
    if (controlFilePatterns.some(pattern => pattern.test(userAgent))) {
      isControlFileUI = true;
      if (detectionMethod === 'FALLBACK') {
        detectionMethod = 'USER_AGENT';
        confidence = 0.60;
      }
      signals.push('USER_AGENT_CONTROLFILE');
    }
  }
  
  // 4. Origin domain matching
  const origin = req.headers.origin || req.headers.referer || '';
  if (origin && !isControlFileUI && !appId) {
    try {
      const url = new URL(origin);
      const hostname = url.hostname.toLowerCase();
      
      // Dominios conocidos de ControlFile
      const controlFileDomains = [
        'controlfile.app',
        'controlfile.com',
        'controldoc.app',
        'files.controldoc.app',
        'localhost' // Desarrollo
      ];
      
      if (controlFileDomains.some(domain => hostname.includes(domain))) {
        isControlFileUI = true;
        if (detectionMethod === 'FALLBACK') {
          detectionMethod = 'ORIGIN';
          confidence = 0.70;
        }
        signals.push('ORIGIN_CONTROLFILE');
      }
    } catch (e) {
      // URL inválida, ignorar
    }
  }
  
  // 5. Fallback: Si no se detectó nada, marcar como UNKNOWN
  if (detectionMethod === 'FALLBACK') {
    confidence = 0.10;
    signals.push('FALLBACK_UNKNOWN');
  }
  
  // Determinar caller type final
  let callerType = 'UNKNOWN';
  if (isControlFileUI) {
    callerType = 'CONTROLFILE_UI';
  } else if (appId) {
    callerType = 'APP';
  }
  
  // Registrar métrica de detección
  recordCallerTypeDetection({
    method: detectionMethod,
    callerType,
    appId,
    signals
  });
  
  return {
    isControlFileUI,
    appId,
    callerType,
    detectionMethod,
    confidence,
    signals
  };
}

/**
 * Valida si una app puede crear carpetas raíz (parentId = null)
 * 
 * CONTRATO v1: Las apps NO pueden crear carpetas raíz
 * Solo ControlFile UI puede crear carpetas raíz (navbar)
 * 
 * @param {Object} req - Express request object
 * @param {string|null} parentId - ID del parent (null = raíz)
 * @returns {Object} { allowed: boolean, reason?: string }
 */
function validateRootFolderCreation(req, parentId) {
  const caller = detectCallerType(req);
  
  // LEGACY: Por ahora siempre permite
  // TODO: Cuando se active el contrato, validar:
  // if (!caller.isControlFileUI && parentId === null) {
  //   return { allowed: false, reason: 'Apps cannot create root folders' };
  // }
  
  return { allowed: true };
}

/**
 * Valida si una app puede crear subcarpetas dentro de un parent
 * 
 * CONTRATO v1: Las apps solo pueden crear subcarpetas dentro de su app root
 * 
 * @param {Object} req - Express request object
 * @param {string} parentId - ID del parent folder
 * @returns {Promise<Object>} { allowed: boolean, reason?: string }
 */
async function validateSubfolderCreation(req, parentId) {
  const caller = detectCallerType(req);
  
  // LEGACY: Por ahora siempre permite
  // TODO: Cuando se active el contrato, validar:
  // 1. Obtener el parent folder
  // 2. Verificar que el parent pertenece a la app del caller
  // 3. Si no pertenece, rechazar
  
  return { allowed: true };
}

/**
 * Valida si una app puede auto-pinnear carpetas en el taskbar
 * 
 * CONTRATO v1: Las apps NO pueden auto-pinnear carpetas
 * Solo ControlFile UI puede agregar items al taskbar
 * 
 * @param {Object} req - Express request object
 * @returns {Object} { allowed: boolean, reason?: string }
 */
function validateTaskbarPin(req) {
  const caller = detectCallerType(req);
  
  // LEGACY: Por ahora siempre permite
  // TODO: Cuando se active el contrato, validar:
  // if (!caller.isControlFileUI) {
  //   return { allowed: false, reason: 'Apps cannot pin folders to taskbar' };
  // }
  
  return { allowed: true };
}

/**
 * Obtiene o crea el app root folder para una aplicación
 * 
 * CONTRATO v1: Las apps deben usar POST /api/apps/:appId/root
 * Este helper será usado por ese endpoint futuro
 * 
 * @param {string} uid - User ID
 * @param {string} appId - Application ID
 * @returns {Promise<Object>} { folderId: string, folderData: Object }
 */
async function ensureAppRootFolder(uid, appId) {
  // TODO: Implementar cuando se cree POST /api/apps/:appId/root
  // 1. Buscar carpeta raíz de la app (marcada con metadata.appId)
  // 2. Si no existe, crearla con parentId=null pero NO visible en navbar
  // 3. Agregarla automáticamente a userSettings.taskbarItems
  // 4. Retornar folderId
  
  throw new Error('ensureAppRootFolder not implemented yet');
}

/**
 * Verifica si una carpeta pertenece a una aplicación específica
 * 
 * @param {string} folderId - Folder ID
 * @param {string} appId - Application ID
 * @returns {Promise<boolean>}
 */
async function folderBelongsToApp(folderId, appId) {
  // TODO: Implementar verificación
  // 1. Obtener el folder
  // 2. Verificar metadata.appId o rastrear ancestros hasta el app root
  // 3. Retornar true si pertenece a la app
  
  return false;
}

module.exports = {
  detectCallerType,
  validateRootFolderCreation,
  validateSubfolderCreation,
  validateTaskbarPin,
  ensureAppRootFolder,
  folderBelongsToApp
};
