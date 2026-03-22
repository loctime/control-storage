// backend/src/routes/repositories.js
// Endpoints para gestión de repositorios e indexación
// Arquitectura limpia: backend es la única fuente de verdad

const express = require('express');
const { logger } = require('../utils/logger');
const { isValidRepositoryId, generateRepositoryId } = require('../utils/repository-id');
const repositoryStore = require('../services/repository-store');
const { indexRepositoryAsync } = require('../services/repository-indexer-async');

const router = express.Router();

/**
 * POST /repositories/index
 * 
 * Inicia indexación de un repositorio
 * - Si no existe, inicia indexación
 * - Si ya está indexando, retorna estado actual
 * - Si ya está listo, verifica SHA y solo reindexa si cambió (o si force=true)
 * 
 * Body JSON:
 * {
 *   "repositoryId": "github:owner:repo",  // OPCIONAL: se genera desde owner+repo
 *   "owner": string,                      // REQUERIDO si no hay repositoryId
 *   "repo": string,                       // REQUERIDO si no hay repositoryId
 *   "accessToken": string | null,         // OPCIONAL: para repos privados
 *   "uid": string,                        // REQUERIDO
 *   "branch": string | null,              // OPCIONAL: default branch si no se proporciona
 *   "force": boolean                      // OPCIONAL: fuerza reindexación aunque esté listo
 * }
 */
router.post('/index', async (req, res) => {
  try {
    let { repositoryId, owner, repo, accessToken, uid, branch, force } = req.body;
    
    // Validar entrada
    if (!repositoryId) {
      if (!owner || typeof owner !== 'string') {
        return res.status(400).json({ 
          error: 'owner es requerido cuando no se proporciona repositoryId',
          field: 'owner'
        });
      }
      if (!repo || typeof repo !== 'string') {
        return res.status(400).json({ 
          error: 'repo es requerido cuando no se proporciona repositoryId',
          field: 'repo'
        });
      }
      repositoryId = generateRepositoryId(owner, repo);
    } else {
      if (!isValidRepositoryId(repositoryId)) {
        return res.status(400).json({ 
          error: 'repositoryId debe tener formato: github:owner:repo',
          repositoryId
        });
      }
      // Extraer owner y repo del repositoryId
      const parts = repositoryId.split(':');
      owner = parts[1];
      repo = parts[2];
    }
    
    if (!uid || typeof uid !== 'string') {
      return res.status(400).json({ 
        error: 'uid es requerido',
        field: 'uid'
      });
    }
    
    // accessToken es opcional (null para repos públicos)
    if (accessToken !== undefined && accessToken !== null && typeof accessToken !== 'string') {
      return res.status(400).json({ 
        error: 'accessToken debe ser string o null',
        field: 'accessToken'
      });
    }
    
    // branch es opcional
    if (branch !== undefined && branch !== null && typeof branch !== 'string') {
      return res.status(400).json({ 
        error: 'branch debe ser string o null',
        field: 'branch'
      });
    }
    
    // force es opcional, default false
    force = force === true;
    
    logger.info('Solicitud de indexación recibida', { 
      repositoryId, 
      owner, 
      repo, 
      hasToken: !!accessToken,
      branch: branch || 'default',
      force 
    });
    
    // Verificar estado actual
    const currentStatus = await repositoryStore.getStatus(repositoryId);
    
    // Si ya está indexando, retornar estado actual
    if (currentStatus === 'indexing') {
      const metadata = await repositoryStore.getMetadata(repositoryId);
      return res.status(200).json({
        repositoryId,
        status: 'indexing',
        message: 'Indexación ya en progreso',
        startedAt: metadata?.createdAt || null
      });
    }
    
    // Si ya está listo y no es forzado, retornar estado actual
    if (currentStatus === 'ready' && !force) {
      const metadata = await repositoryStore.getMetadata(repositoryId);
      return res.status(200).json({
        repositoryId,
        status: 'ready',
        message: 'Repositorio ya indexado y listo',
        indexedAt: metadata?.indexedAt || null,
        stats: metadata?.stats || null
      });
    }
    
    // Iniciar indexación asíncrona
    const result = await indexRepositoryAsync(owner, repo, accessToken, uid, branch, force);
    
    if (!result.started) {
      // Ya estaba en proceso o no se pudo iniciar
      const metadata = await repositoryStore.getMetadata(repositoryId);
      return res.status(200).json({
        repositoryId,
        status: result.status,
        message: result.status === 'ready' 
          ? 'Repositorio ya indexado y listo'
          : 'Indexación ya en progreso',
        ...(metadata?.indexedAt && { indexedAt: metadata.indexedAt }),
        ...(metadata?.stats && { stats: metadata.stats })
      });
    }
    
    // Indexación iniciada
    return res.status(200).json({
      repositoryId,
      status: 'indexing',
      message: 'Indexación iniciada'
    });
    
  } catch (error) {
    logger.error('Error en POST /repositories/index', { 
      error: error.message,
      stack: error.stack
    });
    
    return res.status(500).json({
      error: 'Error iniciando indexación',
      message: error.message
    });
  }
});

/**
 * GET /repositories/:repositoryId/status
 * 
 * Obtiene el estado actual del repositorio
 * 
 * IMPORTANTE: NUNCA devuelve 404
 * - Si el repositorio no existe, retorna status: 'idle'
 * - Estados posibles: 'idle' | 'indexing' | 'ready' | 'error'
 * 
 * Respuesta (200):
 * {
 *   "repositoryId": "github:owner:repo",
 *   "status": "idle" | "indexing" | "ready" | "error",
 *   "indexedAt": "2024-01-01T12:00:00Z" | null,
 *   "stats": {
 *     "totalFiles": 150,
 *     "totalSize": 1048576,
 *     "languages": { "TypeScript": 50, "JavaScript": 100 },
 *     "extensions": { ".ts": 50, ".js": 100 }
 *   } | null,
 *   "error": "Mensaje de error" | null  // Solo si status === 'error'
 * }
 */
router.get('/:repositoryId/status', async (req, res) => {
  try {
    const { repositoryId } = req.params;
    
    if (!repositoryId || typeof repositoryId !== 'string') {
      return res.status(400).json({ 
        error: 'repositoryId es requerido',
        repositoryId: repositoryId || null
      });
    }
    
    if (!isValidRepositoryId(repositoryId)) {
      return res.status(400).json({ 
        error: 'repositoryId debe tener formato: github:owner:repo',
        repositoryId
      });
    }
    
    logger.info('Consultando estado de repositorio', { repositoryId });
    
    // Obtener estado (nunca retorna null, siempre retorna 'idle' si no existe)
    const status = await repositoryStore.getStatus(repositoryId);
    
    // Obtener metadata si existe
    const metadata = await repositoryStore.getMetadata(repositoryId);
    
    // Construir respuesta
    const response = {
      repositoryId,
      status,
      indexedAt: metadata?.indexedAt || null,
      stats: metadata?.stats || null
    };
    
    // Incluir error solo si status es 'error'
    if (status === 'error' && metadata?.error) {
      response.error = metadata.error;
    }
    
    logger.info('Estado consultado', { repositoryId, status });
    
    // Siempre 200, nunca 404
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
