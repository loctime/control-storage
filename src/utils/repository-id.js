// backend/src/utils/repository-id.js
// Utilidades para normalizar y validar repository IDs

/**
 * Normaliza un repositoryId para uso en filesystem
 * Convierte "github:owner:repo" a "github__owner__repo"
 * @param {string} repositoryId - ID del repositorio (ej: "github:owner:repo")
 * @returns {string} - ID normalizado para filesystem
 */
function normalizeForFilesystem(repositoryId) {
  if (!repositoryId || typeof repositoryId !== 'string') {
    throw new Error('repositoryId debe ser un string válido');
  }
  
  // Reemplazar : por __ para evitar problemas en filesystem
  // También sanitizar caracteres problemáticos
  return repositoryId
    .replace(/:/g, '__')
    .replace(/[<>:"|?*]/g, '_') // Caracteres no permitidos en nombres de archivos
    .replace(/\s+/g, '_') // Espacios
    .replace(/_{2,}/g, '_'); // Múltiples guiones bajos
}

/**
 * Valida formato de repositoryId
 * Acepta formato: "github:owner:repo"
 * @param {string} repositoryId - ID a validar
 * @returns {boolean}
 */
function isValidRepositoryId(repositoryId) {
  if (!repositoryId || typeof repositoryId !== 'string') {
    return false;
  }
  
  // Formato esperado: provider:owner:repo
  const parts = repositoryId.split(':');
  return parts.length >= 3 && parts[0] === 'github' && parts[1] && parts[2];
}

/**
 * Genera repositoryId a partir de owner y repo
 * @param {string} owner - Propietario del repositorio
 * @param {string} repo - Nombre del repositorio
 * @returns {string} - repositoryId en formato "github:owner:repo"
 */
function generateRepositoryId(owner, repo) {
  if (!owner || !repo) {
    throw new Error('owner y repo son requeridos');
  }
  
  return `github:${owner}:${repo}`;
}

module.exports = {
  normalizeForFilesystem,
  isValidRepositoryId,
  generateRepositoryId
};
