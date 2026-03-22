// backend/src/services/repository-store.js
// Servicio de almacenamiento de índices en filesystem
// SOLO filesystem para índice completo. Metadata liviana en JSON separado.
// Compatible con formato antiguo (Firestore + formato plano) y nuevo (filesystem JSON)

const fs = require('fs').promises;
const path = require('path');
const admin = require('../firebaseAdmin');
const { logger } = require('../utils/logger');
const { normalizeForFilesystem } = require('../utils/repository-id');

const INDEXES_DIR = process.env.INDEXES_DIR || path.join(__dirname, '../../indexes');

/**
 * Asegura que el directorio de índices existe
 */
async function ensureIndexesDir() {
  try {
    await fs.mkdir(INDEXES_DIR, { recursive: true });
  } catch (error) {
    logger.error('Error creando directorio de índices', { error: error.message, dir: INDEXES_DIR });
    throw error;
  }
}

/**
 * Obtiene la ruta del directorio del repositorio
 * @param {string} repositoryId - ID del repositorio
 * @returns {string} - Ruta completa del directorio
 */
function getRepositoryDir(repositoryId) {
  const normalizedId = normalizeForFilesystem(repositoryId);
  return path.join(INDEXES_DIR, normalizedId);
}

/**
 * Obtiene la ruta del archivo de índice (formato nuevo)
 * @param {string} repositoryId - ID del repositorio
 * @returns {string} - Ruta completa del archivo index.json
 */
function getIndexPath(repositoryId) {
  return path.join(getRepositoryDir(repositoryId), 'index.json');
}

/**
 * Obtiene la ruta del archivo de índice en formato antiguo
 * Formato antiguo: {INDEXES_DIR}/{repositoryId}.json
 * @param {string} repositoryId - ID del repositorio
 * @returns {string} - Ruta completa del archivo {repositoryId}.json
 */
function getLegacyIndexPath(repositoryId) {
  return path.join(INDEXES_DIR, `${repositoryId}.json`);
}

/**
 * Obtiene la ruta del archivo de metadata liviana
 * @param {string} repositoryId - ID del repositorio
 * @returns {string} - Ruta completa del archivo metadata.json
 */
function getMetadataPath(repositoryId) {
  return path.join(getRepositoryDir(repositoryId), 'metadata.json');
}

/**
 * Obtiene la ruta del archivo de embeddings (opcional)
 * @param {string} repositoryId - ID del repositorio
 * @returns {string} - Ruta completa del archivo embeddings.json
 */
function getEmbeddingsPath(repositoryId) {
  return path.join(getRepositoryDir(repositoryId), 'embeddings.json');
}

/**
 * Verifica si un repositorio existe en filesystem
 * @param {string} repositoryId - ID del repositorio
 * @returns {Promise<boolean>}
 */
async function repositoryExists(repositoryId) {
  try {
    const indexPath = getIndexPath(repositoryId);
    await fs.access(indexPath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

/**
 * Obtiene el estado actual del repositorio
 * Retorna: 'idle' | 'indexing' | 'ready' | 'error'
 * NUNCA retorna null - si no existe, retorna 'idle'
 * 
 * Compatibilidad con formato antiguo:
 * - Primero busca metadata en filesystem (formato nuevo)
 * - Si no existe, busca en Firestore (formato antiguo)
 * - Mapea 'completed' (formato antiguo) a 'ready' (formato nuevo)
 * 
 * @param {string} repositoryId - ID del repositorio
 * @returns {Promise<'idle' | 'indexing' | 'ready' | 'error'>}
 */
async function getStatus(repositoryId) {
  try {
    // 1. Intentar obtener metadata del formato nuevo (filesystem JSON)
    const metadataPath = getMetadataPath(repositoryId);
    const metadata = await fs.readFile(metadataPath, 'utf-8');
    const data = JSON.parse(metadata);
    return data.status || 'idle';
  } catch (error) {
    if (error.code === 'ENOENT') {
      // 2. No existe metadata en filesystem, verificar Firestore (formato antiguo)
      try {
        const db = admin.firestore();
        const indexRef = db.collection('apps').doc('controlrepo')
          .collection('repositories').doc(repositoryId);
        
        const doc = await indexRef.get();
        
        if (doc.exists) {
          const data = doc.data();
          const firestoreStatus = data.status;
          
          // Mapear 'completed' del formato antiguo a 'ready' del formato nuevo
          if (firestoreStatus === 'completed') {
            logger.info('Repositorio encontrado en Firestore con status completed, mapeando a ready', { repositoryId });
            return 'ready';
          }
          
          // Mapear otros estados directamente si son compatibles
          if (['indexing', 'error'].includes(firestoreStatus)) {
            return firestoreStatus;
          }
          
          // Si es 'idle' o desconocido, retornar idle
          return 'idle';
        }
        
        // No existe en Firestore tampoco = no ha sido indexado = idle
        return 'idle';
      } catch (firestoreError) {
        logger.warn('Error verificando Firestore para repositorio', { 
          repositoryId, 
          error: firestoreError.message 
        });
        // Si Firestore falla, asumir idle
        return 'idle';
      }
    }
    
    logger.error('Error leyendo status del repositorio', { repositoryId, error: error.message });
    return 'idle'; // Por defecto, asumir idle si hay error
  }
}

/**
 * Obtiene metadata liviana del repositorio
 * @param {string} repositoryId - ID del repositorio
 * @returns {Promise<Object | null>}
 */
async function getMetadata(repositoryId) {
  try {
    const metadataPath = getMetadataPath(repositoryId);
    const metadata = await fs.readFile(metadataPath, 'utf-8');
    return JSON.parse(metadata);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Obtiene el índice completo del repositorio
 * SOLO para uso interno (chat-service, etc.)
 * El frontend NUNCA debe recibir esto
 * 
 * Compatibilidad con formato antiguo:
 * - Primero busca índice en formato nuevo: {normalizedId}/index.json
 * - Si no existe, busca en formato antiguo: {repositoryId}.json
 * - Esto permite usar índices completados sin relanzar la indexación
 * 
 * @param {string} repositoryId - ID del repositorio
 * @returns {Promise<Object | null>}
 */
async function getIndex(repositoryId) {
  try {
    // 1. Intentar obtener índice en formato nuevo
    const indexPath = getIndexPath(repositoryId);
    const indexData = await fs.readFile(indexPath, 'utf-8');
    const parsed = JSON.parse(indexData);
    logger.info('Índice cargado desde formato nuevo', { repositoryId, path: indexPath });
    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') {
      // 2. No existe en formato nuevo, intentar formato antiguo
      try {
        const legacyPath = getLegacyIndexPath(repositoryId);
        const legacyIndexData = await fs.readFile(legacyPath, 'utf-8');
        const parsed = JSON.parse(legacyIndexData);
        logger.info('Índice cargado desde formato antiguo', { repositoryId, path: legacyPath });
        
        // El formato antiguo puede tener estructura ligeramente diferente
        // Asegurar compatibilidad con el formato esperado
        if (parsed.files && parsed.tree) {
          return parsed;
        }
        
        // Si la estructura es diferente, intentar adaptarla
        logger.warn('Estructura de índice antiguo diferente, adaptando', { repositoryId });
        return parsed;
      } catch (legacyError) {
        if (legacyError.code === 'ENOENT') {
          logger.info('Índice no encontrado en formato nuevo ni antiguo', { repositoryId });
          return null;
        }
        logger.error('Error leyendo índice en formato antiguo', { 
          repositoryId, 
          error: legacyError.message 
        });
        throw legacyError;
      }
    }
    throw error;
  }
}

/**
 * Obtiene los embeddings del repositorio (si existen)
 * @param {string} repositoryId - ID del repositorio
 * @returns {Promise<Object | null>}
 */
async function getEmbeddings(repositoryId) {
  try {
    const embeddingsPath = getEmbeddingsPath(repositoryId);
    const embeddingsData = await fs.readFile(embeddingsPath, 'utf-8');
    return JSON.parse(embeddingsData);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Guarda el índice completo en filesystem
 * @param {string} repositoryId - ID del repositorio
 * @param {Object} indexData - Datos del índice completo (files, tree, etc.)
 * @returns {Promise<void>}
 */
async function saveIndex(repositoryId, indexData) {
  await ensureIndexesDir();
  
  const repoDir = getRepositoryDir(repositoryId);
  await fs.mkdir(repoDir, { recursive: true });
  
  const indexPath = getIndexPath(repositoryId);
  await fs.writeFile(indexPath, JSON.stringify(indexData, null, 2), 'utf-8');
  
  logger.info('Índice guardado en filesystem', { repositoryId, path: indexPath });
}

/**
 * Guarda metadata liviana del repositorio
 * Esta es la ÚNICA metadata que se consulta frecuentemente
 * NO incluye el índice completo ni contenido pesado
 * @param {string} repositoryId - ID del repositorio
 * @param {Object} metadata - Metadata liviana
 * @returns {Promise<void>}
 */
async function saveMetadata(repositoryId, metadata) {
  await ensureIndexesDir();
  
  const repoDir = getRepositoryDir(repositoryId);
  await fs.mkdir(repoDir, { recursive: true });
  
  const metadataPath = getMetadataPath(repositoryId);
  
  // Estructura de metadata liviana
  const metadataToSave = {
    repositoryId,
    status: metadata.status || 'idle', // idle | indexing | ready | error
    owner: metadata.owner,
    repo: metadata.repo,
    branch: metadata.branch || null,
    branchSha: metadata.branchSha || null, // Para comparar cambios
    uid: metadata.uid,
    indexedAt: metadata.indexedAt || null, // ISO string
    stats: metadata.stats || null, // { totalFiles, totalSize, languages, etc. }
    error: metadata.error || null, // Solo si status === 'error'
    createdAt: metadata.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  await fs.writeFile(metadataPath, JSON.stringify(metadataToSave, null, 2), 'utf-8');
  
  logger.info('Metadata guardada', { repositoryId, status: metadataToSave.status });
}

/**
 * Guarda embeddings (opcional, para futura implementación de chat)
 * @param {string} repositoryId - ID del repositorio
 * @param {Object} embeddings - Embeddings vectoriales
 * @returns {Promise<void>}
 */
async function saveEmbeddings(repositoryId, embeddings) {
  await ensureIndexesDir();
  
  const repoDir = getRepositoryDir(repositoryId);
  await fs.mkdir(repoDir, { recursive: true });
  
  const embeddingsPath = getEmbeddingsPath(repositoryId);
  await fs.writeFile(embeddingsPath, JSON.stringify(embeddings, null, 2), 'utf-8');
  
  logger.info('Embeddings guardados', { repositoryId, path: embeddingsPath });
}

/**
 * Actualiza solo el estado del repositorio
 * @param {string} repositoryId - ID del repositorio
 * @param {'idle' | 'indexing' | 'ready' | 'error'} status - Nuevo estado
 * @param {Object} updates - Campos adicionales a actualizar
 * @returns {Promise<void>}
 */
async function updateStatus(repositoryId, status, updates = {}) {
  const currentMetadata = await getMetadata(repositoryId) || {};
  
  await saveMetadata(repositoryId, {
    ...currentMetadata,
    status,
    ...updates,
    updatedAt: new Date().toISOString()
  });
}

/**
 * Obtiene el SHA del branch actualmente indexado
 * Para comparar si ha cambiado y decidir reindexación
 * @param {string} repositoryId - ID del repositorio
 * @returns {Promise<string | null>}
 */
async function getIndexedBranchSha(repositoryId) {
  const metadata = await getMetadata(repositoryId);
  return metadata?.branchSha || null;
}

/**
 * Obtiene el Project Brain del repositorio desde Firestore
 * @param {string} repositoryId - ID del repositorio
 * @returns {Promise<Object | null>}
 */
async function getProjectBrain(repositoryId) {
  try {
    const db = admin.firestore();
    const brainRef = db.collection('apps').doc('controlrepo')
      .collection('repositories').doc(repositoryId)
      .collection('brains').doc('latest');
    
    const doc = await brainRef.get();
    
    if (doc.exists) {
      const data = doc.data();
      // Remover campos de Firestore Timestamp y convertir a objeto plano
      const brain = { ...data };
      if (brain.createdAt && brain.createdAt.toDate) {
        brain.createdAt = brain.createdAt.toDate().toISOString();
      }
      if (brain.updatedAt && brain.updatedAt.toDate) {
        brain.updatedAt = brain.updatedAt.toDate().toISOString();
      }
      return brain;
    }
    
    return null;
  } catch (error) {
    logger.warn('Error obteniendo Project Brain', { repositoryId, error: error.message });
    return null; // Retornar null en lugar de lanzar error para permitir queries sin brain
  }
}

/**
 * Obtiene las métricas del repositorio desde Firestore
 * @param {string} repositoryId - ID del repositorio
 * @returns {Promise<Object | null>}
 */
async function getMetrics(repositoryId) {
  try {
    const db = admin.firestore();
    const metricsRef = db.collection('apps').doc('controlrepo')
      .collection('repositories').doc(repositoryId)
      .collection('metrics').doc('latest');
    
    const doc = await metricsRef.get();
    
    if (doc.exists) {
      const data = doc.data();
      // Remover campos de Firestore Timestamp y convertir a objeto plano
      const metrics = { ...data };
      if (metrics.createdAt && metrics.createdAt.toDate) {
        metrics.createdAt = metrics.createdAt.toDate().toISOString();
      }
      if (metrics.updatedAt && metrics.updatedAt.toDate) {
        metrics.updatedAt = metrics.updatedAt.toDate().toISOString();
      }
      return metrics;
    }
    
    return null;
  } catch (error) {
    logger.warn('Error obteniendo métricas', { repositoryId, error: error.message });
    return null; // Retornar null en lugar de lanzar error para permitir queries sin metrics
  }
}

/**
 * Elimina un repositorio completo del filesystem
 * Usar con precaución - no hay limpieza automática por defecto
 * @param {string} repositoryId - ID del repositorio
 * @returns {Promise<void>}
 */
async function deleteRepository(repositoryId) {
  try {
    const repoDir = getRepositoryDir(repositoryId);
    await fs.rm(repoDir, { recursive: true, force: true });
    logger.info('Repositorio eliminado del filesystem', { repositoryId });
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    // Ya no existe, OK
  }
}

module.exports = {
  getStatus,
  getMetadata,
  getIndex,
  getEmbeddings,
  getProjectBrain,
  getMetrics,
  saveIndex,
  saveMetadata,
  saveEmbeddings,
  updateStatus,
  getIndexedBranchSha,
  repositoryExists,
  deleteRepository
};
