/**
 * Feature Flags para Contrato App ↔ ControlFile v1
 * 
 * Todas las flags están APAGADAS por defecto (soft enforcement)
 * Solo se activan cuando se decide pasar a hard enforcement
 * 
 * Las flags se leen de variables de entorno con fallback a false
 */

/**
 * Feature flags disponibles
 */
const FEATURE_FLAGS = {
  // Soft enforcement: Instrumentación y logging (siempre activo en soft enforcement)
  CONTRACT_SOFT_ENFORCEMENT_ENABLED: process.env.CONTRACT_SOFT_ENFORCEMENT_ENABLED === 'true',
  
  // Hard enforcement: Validaciones activas (todas apagadas por defecto)
  CONTRACT_ENFORCEMENT_ENABLED: process.env.CONTRACT_ENFORCEMENT_ENABLED === 'true',
  CONTRACT_VALIDATE_ROOT_FOLDERS: process.env.CONTRACT_VALIDATE_ROOT_FOLDERS === 'true',
  CONTRACT_VALIDATE_SUBFOLDERS: process.env.CONTRACT_VALIDATE_SUBFOLDERS === 'true',
  CONTRACT_VALIDATE_TASKBAR_PIN: process.env.CONTRACT_VALIDATE_TASKBAR_PIN === 'true',
  
  // Whitelist de apps exentas (formato: app1,app2,app3)
  CONTRACT_APP_WHITELIST: (process.env.CONTRACT_APP_WHITELIST || '').split(',').filter(Boolean),
};

/**
 * Verifica si una feature flag está activa
 * @param {string} flagName - Nombre de la flag
 * @returns {boolean}
 */
function isEnabled(flagName) {
  return FEATURE_FLAGS[flagName] === true;
}

/**
 * Verifica si una app está en la whitelist
 * @param {string} appId - ID de la aplicación
 * @returns {boolean}
 */
function isAppWhitelisted(appId) {
  if (!appId) return false;
  return FEATURE_FLAGS.CONTRACT_APP_WHITELIST.includes(appId);
}

/**
 * Obtiene todas las flags (para debugging)
 * @returns {Object}
 */
function getAllFlags() {
  return { ...FEATURE_FLAGS };
}

module.exports = {
  isEnabled,
  isAppWhitelisted,
  getAllFlags,
  FLAGS: FEATURE_FLAGS
};
