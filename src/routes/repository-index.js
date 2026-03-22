// backend/src/routes/repository-index.js
// Endpoint POST /api/repository/index para indexación de repositorios desde ControlRepo
const express = require('express');
const admin = require('../firebaseAdmin');
const { logger } = require('../utils/logger');
const { acquireLock, releaseLock } = require('../services/repository-lock');
const { indexRepository } = require('../services/repository-indexer');

const router = express.Router();

/**
 * POST /api/repository/index
 * 
 * ⚠️ ENDPOINT TRUSTED-INTERNAL
 * Este endpoint está diseñado para ser llamado SOLO desde ControlRepo (Vercel).
 * NO debe exponerse públicamente sin autenticación adicional.
 * 
 * Body JSON:
 * {
 *   owner: string,
 *   repo: string,
 *   branch?: string (opcional, usa default branch si no se proporciona),
 *   accessToken?: string | null,
 *   uid: string
 * }
 * 
 * Este endpoint NO usa Firebase Auth.
 * La request viene SOLO desde ControlRepo.
 * 
 * FUTURO: Implementar X-ControlRepo-Signature para validación de origen.
 */
router.post('/index', async (req, res) => {
  let lockAcquired = false;
  let repositoryId = null;
  
  try {
    // 1. Validar body
    const { owner, repo, branch, accessToken, uid } = req.body;
    
    if (!owner || typeof owner !== 'string') {
      return res.status(400).json({ error: 'owner es requerido y debe ser string' });
    }
    if (!repo || typeof repo !== 'string') {
      return res.status(400).json({ error: 'repo es requerido y debe ser string' });
    }
    // branch es OPCIONAL - se resolverá si no viene
    if (branch !== undefined && typeof branch !== 'string') {
      return res.status(400).json({ error: 'branch debe ser string si se proporciona' });
    }
    if (accessToken !== undefined && accessToken !== null && typeof accessToken !== 'string') {
      return res.status(400).json({ error: 'accessToken debe ser string o null' });
    }
    if (!uid || typeof uid !== 'string') {
      return res.status(400).json({ error: 'uid es requerido y debe ser string' });
    }
    
    logger.info('Iniciando indexación de repositorio', { owner, repo, branch: branch || 'default', uid });
    
    // 2. Crear repositoryId válido para Firestore (sin /)
    // Formato: github:owner:repo (a prueba de futuro)
    repositoryId = `github:${owner}:${repo}`;
    
    // 3. Adquirir lock persistente
    const lockResult = await acquireLock(repositoryId, 30000);
    if (!lockResult.acquired) {
      logger.warn('No se pudo adquirir lock', { repositoryId });
      return res.status(409).json({ 
        error: 'Repositorio ya está siendo indexado',
        repositoryId 
      });
    }
    lockAcquired = true;
    
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();
    
    // 4. Guardar índice inicial (status: indexing)
    const indexRef = db.collection('apps').doc('controlrepo')
      .collection('repositories').doc(repositoryId);
    
    const initialIndex = {
      owner,
      repo,
      branch: branch || null, // Puede ser null si no se proporciona
      uid,
      status: 'indexing',
      createdAt: now,
      updatedAt: now,
      startedAt: now
    };
    
    await indexRef.set(initialIndex, { merge: true });
    logger.info('Índice inicial guardado', { repositoryId });
    
    // 5. Ejecutar indexRepository (resuelve branch automáticamente si no viene)
    let indexResult;
    try {
      indexResult = await indexRepository(owner, repo, accessToken, branch);
    } catch (error) {
      logger.error('Error ejecutando indexRepository', { repositoryId, error: error.message });
      
      // Actualizar estado a error
      await indexRef.update({
        status: 'error',
        error: error.message,
        updatedAt: admin.firestore.Timestamp.now()
      });
      
      throw error;
    }
    
    // 6. Guardar contenido pesado en filesystem (tree y files completos)
    const fs = require('fs').promises;
    const path = require('path');
    const INDEXES_DIR = process.env.INDEXES_DIR || path.join(__dirname, '../../indexes');
    await fs.mkdir(INDEXES_DIR, { recursive: true });
    
    const indexPath = path.join(INDEXES_DIR, `${repositoryId}.json`);
    const heavyData = {
      files: indexResult.files,
      tree: indexResult.tree,
      indexedAt: new Date().toISOString()
    };
    await fs.writeFile(indexPath, JSON.stringify(heavyData, null, 2));
    logger.info('Contenido pesado guardado en filesystem', { repositoryId, indexPath });
    
    // 7. Guardar solo metadata en Firestore (optimizado)
    const finalIndex = {
      status: 'completed',
      indexedAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
      branch: indexResult.branch,
      branchSha: indexResult.branchSha,
      // Solo metadata, no contenido pesado
      repoInfo: indexResult.repoInfo,
      stats: {
        totalFiles: indexResult.stats.totalFiles,
        totalSize: indexResult.stats.totalSize,
        indexedFiles: indexResult.stats.indexedFiles,
        languages: indexResult.stats.languages,
        extensions: indexResult.stats.extensions
      },
      // Pointer al contenido pesado en filesystem
      indexPath: indexPath,
      indexSize: JSON.stringify(heavyData).length
    };
    
    await indexRef.update(finalIndex);
    logger.info('Índice final guardado (solo metadata)', { repositoryId });
    
    // 8. Generar y guardar Project Brain (solo metadata ligera)
    const projectBrain = generateProjectBrain(indexResult);
    const brainRef = db.collection('apps').doc('controlrepo')
      .collection('repositories').doc(repositoryId)
      .collection('brains').doc('latest');
    
    await brainRef.set({
      ...projectBrain,
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now()
    });
    logger.info('Project Brain guardado', { repositoryId });
    
    // 9. Generar y guardar métricas (solo estadísticas, no contenido)
    const metrics = generateMetrics(indexResult);
    const metricsRef = db.collection('apps').doc('controlrepo')
      .collection('repositories').doc(repositoryId)
      .collection('metrics').doc('latest');
    
    await metricsRef.set({
      ...metrics,
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now()
    });
    logger.info('Métricas guardadas', { repositoryId });
    
    // 10. Liberar lock
    await releaseLock(repositoryId);
    lockAcquired = false;
    
    // 11. Retornar 202 Accepted (proceso async con locks)
    return res.status(202).json({
      success: true,
      repositoryId,
      status: 'completed',
      stats: indexResult.stats,
      message: 'Repositorio indexado exitosamente'
    });
    
  } catch (error) {
    logger.error('Error en indexación de repositorio', { 
      repositoryId, 
      error: error.message,
      stack: error.stack 
    });
    
    // Asegurar liberación del lock SIEMPRE
    if (lockAcquired && repositoryId) {
      try {
        await releaseLock(repositoryId);
      } catch (releaseError) {
        logger.error('Error liberando lock en catch', { 
          repositoryId, 
          error: releaseError.message 
        });
      }
    }
    
    return res.status(500).json({
      error: 'Error indexando repositorio',
      message: error.message,
      repositoryId
    });
  }
});

/**
 * Genera Project Brain a partir del resultado de indexación
 * Solo incluye metadata ligera, no contenido completo
 * @param {Object} indexResult - Resultado de indexRepository
 * @returns {Object} Project Brain (solo metadata)
 */
function generateProjectBrain(indexResult) {
  const { files, repoInfo, stats } = indexResult;
  
  // Extraer información clave de archivos importantes (solo paths y tamaños)
  const importantFiles = files.slice(0, 20).map(f => ({
    path: f.path,
    size: f.size,
    sha: f.sha
    // NO incluir content aquí - está en filesystem
  }));
  
  // Generar resumen del proyecto (solo metadata)
  const summary = {
    description: repoInfo.description || 'Sin descripción',
    language: repoInfo.language || 'Unknown',
    totalFiles: stats.totalFiles,
    mainFiles: importantFiles
  };
  
  // Generar estructura del proyecto (solo estadísticas)
  const structure = {
    languages: stats.languages,
    extensions: stats.extensions,
    topFiles: importantFiles.map(f => f.path)
  };
  
  return {
    summary,
    structure,
    repoInfo: {
      name: repoInfo.name,
      stars: repoInfo.stars,
      forks: repoInfo.forks,
      createdAt: repoInfo.createdAt,
      updatedAt: repoInfo.updatedAt
    }
  };
}

/**
 * Genera métricas a partir del resultado de indexación
 * Solo incluye estadísticas, no contenido completo
 * @param {Object} indexResult - Resultado de indexRepository
 * @returns {Object} Métricas (solo estadísticas)
 */
function generateMetrics(indexResult) {
  const { stats, files } = indexResult;
  
  return {
    totalFiles: stats.totalFiles,
    totalSize: stats.totalSize,
    indexedFiles: stats.indexedFiles,
    languages: stats.languages,
    extensions: stats.extensions,
    averageFileSize: stats.totalFiles > 0 ? Math.round(stats.totalSize / stats.totalFiles) : 0,
    // Solo paths y tamaños, no contenido
    largestFiles: files
      .sort((a, b) => (b.size || 0) - (a.size || 0))
      .slice(0, 10)
      .map(f => ({ path: f.path, size: f.size })),
    fileCountByExtension: stats.extensions
  };
}

/**
 * GET /api/repository/status/:repositoryId
 * 
 * Consulta el estado de indexación de un repositorio
 * 
 * Params:
 * - repositoryId: string (formato: github:owner:repo)
 * 
 * Respuesta exitosa (200):
 * {
 *   repositoryId: string,
 *   status: 'indexing' | 'completed' | 'error',
 *   owner: string,
 *   repo: string,
 *   branch: string | null,
 *   indexedAt: Timestamp | null,
 *   stats: Object | null,
 *   error?: string (solo si status === 'error')
 * }
 * 
 * Respuesta no encontrado (404):
 * {
 *   error: 'Repositorio no encontrado',
 *   repositoryId: string
 * }
 */
router.get('/status/:repositoryId', async (req, res) => {
  try {
    const { repositoryId } = req.params;
    
    if (!repositoryId || typeof repositoryId !== 'string') {
      return res.status(400).json({ 
        error: 'repositoryId es requerido',
        repositoryId: repositoryId || null
      });
    }
    
    logger.info('Consultando estado de repositorio', { repositoryId });
    
    const db = admin.firestore();
    const indexRef = db.collection('apps').doc('controlrepo')
      .collection('repositories').doc(repositoryId);
    
    const doc = await indexRef.get();
    
    if (!doc.exists) {
      logger.warn('Repositorio no encontrado', { repositoryId });
      return res.status(404).json({
        error: 'Repositorio no encontrado',
        repositoryId
      });
    }
    
    const data = doc.data();
    
    // Construir respuesta con campos relevantes
    const response = {
      repositoryId,
      status: data.status || 'unknown',
      owner: data.owner,
      repo: data.repo,
      branch: data.branch || null,
      indexedAt: data.indexedAt || null,
      stats: data.stats || null
    };
    
    // Incluir error si existe
    if (data.status === 'error' && data.error) {
      response.error = data.error;
    }
    
    logger.info('Estado de repositorio consultado', { 
      repositoryId, 
      status: response.status 
    });
    
    return res.status(200).json(response);
    
  } catch (error) {
    logger.error('Error consultando estado de repositorio', {
      repositoryId: req.params.repositoryId,
      error: error.message,
      stack: error.stack
    });
    
    return res.status(500).json({
      error: 'Error consultando estado del repositorio',
      message: error.message,
      repositoryId: req.params.repositoryId
    });
  }
});

module.exports = router;
