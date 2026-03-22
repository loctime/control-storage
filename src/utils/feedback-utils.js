const { logger } = require('./logger');

/**
 * Valida que un screenshot sea válido
 * @param {Object} file - Archivo del screenshot
 * @param {Buffer} buffer - Buffer del archivo
 * @returns {Object} { valid: boolean, error?: string }
 */
function validateScreenshot(file, buffer) {
  // Validar que existe
  if (!file || !buffer) {
    return { valid: false, error: 'Screenshot no recibido' };
  }

  // Validar tipo MIME
  const allowedMimes = ['image/png', 'image/jpeg', 'image/jpg'];
  if (!allowedMimes.includes(file.mimetype)) {
    return {
      valid: false,
      error: `Formato de imagen no válido. Permitidos: ${allowedMimes.join(', ')}`,
    };
  }

  // Validar tamaño máximo (10MB)
  const maxSize = 10 * 1024 * 1024; // 10MB
  if (buffer.length > maxSize) {
    return {
      valid: false,
      error: `Screenshot demasiado grande. Máximo: ${maxSize / 1024 / 1024}MB`,
    };
  }

  // Validar tamaño mínimo (debe ser una imagen válida)
  const minSize = 100; // 100 bytes
  if (buffer.length < minSize) {
    return {
      valid: false,
      error: 'Screenshot demasiado pequeño o inválido',
    };
  }

  return { valid: true };
}

/**
 * Genera un ID único para feedback
 * @returns {string} feedback_{timestamp}_{random}
 */
function generateFeedbackId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 11);
  return `feedback_${timestamp}_${random}`;
}

/**
 * Genera un ID único para archivo
 * @returns {string} file_{timestamp}_{random}
 */
function generateFileId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 11);
  return `file_${timestamp}_${random}`;
}

/**
 * Construye un bucketKey para screenshots de feedback
 * @param {string} appId - ID de la app normalizado
 * @param {string} userId - UID del usuario
 * @param {string} fileId - ID del archivo
 * @param {string} extension - Extensión del archivo (png, jpeg)
 * @returns {string} feedback/{appId}/{userId}/{timestamp}_{fileId}.{extension}
 */
function buildFeedbackBucketKey(appId, userId, fileId, extension = 'png') {
  const timestamp = Date.now();
  return `feedback/${appId}/${userId}/${timestamp}_${fileId}.${extension}`;
}

/**
 * Obtiene la extensión del archivo desde el MIME type
 * @param {string} mimeType - MIME type del archivo
 * @returns {string} Extensión sin punto (png, jpeg)
 */
function getExtensionFromMime(mimeType) {
  const mimeToExt = {
    'image/png': 'png',
    'image/jpeg': 'jpeg',
    'image/jpg': 'jpeg',
  };
  return mimeToExt[mimeType] || 'png';
}

/**
 * Crea un diff entre dos objetos para el historial
 * @param {Object} before - Estado anterior
 * @param {Object} after - Estado posterior
 * @returns {Object} { before: {}, after: {} }
 */
function createHistoryDiff(before, after) {
  const changes = {
    before: {},
    after: {},
  };

  const allKeys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);

  for (const key of allKeys) {
    const beforeValue = before?.[key];
    const afterValue = after?.[key];

    // Comparar usando JSON.stringify para objetos profundos
    if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
      changes.before[key] = beforeValue;
      changes.after[key] = afterValue;
    }
  }

  return changes;
}

module.exports = {
  validateScreenshot,
  generateFeedbackId,
  generateFileId,
  buildFeedbackBucketKey,
  getExtensionFromMime,
  createHistoryDiff,
};
