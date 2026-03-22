// backend/src/services/repository-lock.js
// Servicio de locks persistente en filesystem para indexación de repositorios
const fs = require('fs').promises;
const path = require('path');
const { logger } = require('../utils/logger');

const LOCKS_DIR = process.env.LOCKS_DIR || path.join(__dirname, '../../locks');

// Asegurar que el directorio de locks existe
async function ensureLocksDir() {
  try {
    await fs.mkdir(LOCKS_DIR, { recursive: true });
  } catch (error) {
    logger.error('Error creando directorio de locks', { error: error.message, dir: LOCKS_DIR });
    throw error;
  }
}

/**
 * Adquiere un lock persistente para un repositorio
 * @param {string} repositoryId - ID único del repositorio
 * @param {number} timeoutMs - Tiempo máximo de espera en ms (default: 30000)
 * @returns {Promise<{ acquired: boolean, lockPath: string }>}
 */
async function acquireLock(repositoryId, timeoutMs = 30000) {
  await ensureLocksDir();
  
  const lockPath = path.join(LOCKS_DIR, `${repositoryId}.lock`);
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    try {
      // Intentar crear el archivo de lock exclusivamente
      const fd = await fs.open(lockPath, 'wx');
      await fd.close();
      
      // Escribir timestamp y PID para debugging
      const lockData = {
        repositoryId,
        acquiredAt: new Date().toISOString(),
        pid: process.pid
      };
      await fs.writeFile(lockPath, JSON.stringify(lockData, null, 2));
      
      logger.info('Lock adquirido', { repositoryId, lockPath });
      return { acquired: true, lockPath };
    } catch (error) {
      if (error.code === 'EEXIST') {
        // Lock ya existe, esperar un poco y reintentar
        await new Promise(resolve => setTimeout(resolve, 500));
        continue;
      }
      throw error;
    }
  }
  
  logger.warn('Timeout adquiriendo lock', { repositoryId, timeoutMs });
  return { acquired: false, lockPath };
}

/**
 * Libera un lock persistente
 * @param {string} repositoryId - ID único del repositorio
 * @returns {Promise<void>}
 */
async function releaseLock(repositoryId) {
  const lockPath = path.join(LOCKS_DIR, `${repositoryId}.lock`);
  
  try {
    await fs.unlink(lockPath);
    logger.info('Lock liberado', { repositoryId, lockPath });
  } catch (error) {
    if (error.code === 'ENOENT') {
      logger.warn('Lock no existe al intentar liberar', { repositoryId });
      return;
    }
    logger.error('Error liberando lock', { repositoryId, error: error.message });
    throw error;
  }
}

/**
 * Verifica si un lock existe
 * @param {string} repositoryId - ID único del repositorio
 * @returns {Promise<boolean>}
 */
async function isLocked(repositoryId) {
  const lockPath = path.join(LOCKS_DIR, `${repositoryId}.lock`);
  
  try {
    await fs.access(lockPath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

module.exports = {
  acquireLock,
  releaseLock,
  isLocked
};
