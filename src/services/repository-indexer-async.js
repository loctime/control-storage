// backend/src/services/repository-indexer-async.js
// Servicio de indexación asíncrona de repositorios
// Maneja el proceso completo: indexar, guardar, actualizar estado

const { logger } = require('../utils/logger');
const { indexRepository } = require('./repository-indexer');
const repositoryStore = require('./repository-store');
const { acquireLock, releaseLock } = require('./repository-lock');
const { generateRepositoryId } = require('../utils/repository-id');

/**
 * Obtiene el SHA actual del branch en GitHub
 * 
 * MODELO URL-ONLY + TOKEN POR ENTORNO:
 * - Primero intenta acceso público
 * - Si 401/403/404 → retry con process.env.GITHUB_TOKEN
 * - El parámetro accessToken se ignora (mantenido por compatibilidad)
 * 
 * @param {string} owner - Propietario del repositorio
 * @param {string} repo - Nombre del repositorio
 * @param {string} branch - Branch a verificar
 * @param {string|null} accessToken - IGNORADO (mantenido por compatibilidad, no se usa)
 * @returns {Promise<string|null>} - SHA del branch o null si error
 */
async function getCurrentBranchSha(owner, repo, branch, accessToken) {
  try {
    const baseHeaders = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'controlfile-backend'
    };

    // Token por entorno - fallback automático si acceso público falla
    const fallbackToken = process.env.GITHUB_TOKEN || null;

    /**
     * Flujo de acceso: público primero, luego fallback a token de entorno
     */
    const fetchWithFallback = async (url) => {
      const publicResponse = await fetch(url, { headers: baseHeaders });

      if ((publicResponse.status === 401 || publicResponse.status === 403 || publicResponse.status === 404) && fallbackToken) {
        const authHeaders = {
          ...baseHeaders,
          Authorization: `Bearer ${fallbackToken}`
        };
        return fetch(url, { headers: authHeaders });
      }

      return publicResponse;
    };
    
    // Si branch ya es un SHA, retornarlo directamente
    if (branch && branch.match(/^[0-9a-f]{40}$/)) {
      return branch;
    }
    
    // Si no tenemos branch, obtener default branch del repo
    if (!branch) {
      const repoResponse = await fetchWithFallback(`https://api.github.com/repos/${owner}/${repo}`);
      
      if (!repoResponse.ok) {
        return null;
      }
      
      const repoData = await repoResponse.json();
      branch = repoData.default_branch;
      
      if (!branch) {
        return null;
      }
    }
    
    // Obtener SHA del branch
    const branchResponse = await fetchWithFallback(`https://api.github.com/repos/${owner}/${repo}/branches/${branch}`);
    
    if (!branchResponse.ok) {
      return null;
    }
    
    const branchData = await branchResponse.json();
    return branchData.commit?.sha || null;
  } catch (error) {
    logger.error('Error obteniendo SHA del branch', { owner, repo, branch, error: error.message });
    return null;
  }
}

/**
 * Indexa un repositorio de forma asíncrona
 * Este método NO bloquea - inicia la indexación y retorna inmediatamente
 * 
 * MODELO URL-ONLY + TOKEN POR ENTORNO:
 * - El parámetro accessToken se ignora (mantenido por compatibilidad)
 * - Usa acceso público + fallback a process.env.GITHUB_TOKEN
 * - NO lee tokens desde Firestore
 * 
 * @param {string} owner - Propietario del repositorio
 * @param {string} repo - Nombre del repositorio
 * @param {string|null} accessToken - IGNORADO (mantenido por compatibilidad, no se usa)
 * @param {string} uid - ID del usuario
 * @param {string|null} branch - Branch a indexar (opcional)
 * @param {boolean} force - Si es true, reindexa incluso si ya está listo
 * @returns {Promise<{ started: boolean, status: string, repositoryId: string }>}
 */
async function indexRepositoryAsync(owner, repo, accessToken, uid, branch, force = false) {
  const repositoryId = generateRepositoryId(owner, repo);
  
  // Verificar estado actual
  const currentStatus = await repositoryStore.getStatus(repositoryId);
  
  // Si ya está indexando, no hacer nada
  if (currentStatus === 'indexing') {
    logger.info('Repositorio ya está siendo indexado', { repositoryId });
    return {
      started: false,
      status: 'indexing',
      repositoryId
    };
  }
  
  // Si ya está listo y no es forzado, verificar si cambió el SHA
  if (currentStatus === 'ready' && !force) {
    const currentSha = await getCurrentBranchSha(owner, repo, branch, accessToken);
    const indexedSha = await repositoryStore.getIndexedBranchSha(repositoryId);
    
    // Si el SHA no cambió, no reindexar
    if (currentSha && indexedSha && currentSha === indexedSha) {
      logger.info('Repositorio ya indexado y SHA no cambió', { repositoryId, sha: currentSha });
      return {
        started: false,
        status: 'ready',
        repositoryId
      };
    }
    
    // SHA cambió, necesita reindexación
    logger.info('SHA del repositorio cambió, se reindexará', { 
      repositoryId, 
      oldSha: indexedSha, 
      newSha: currentSha 
    });
  }
  
  // Adquirir lock para evitar indexaciones concurrentes
  const lockResult = await acquireLock(repositoryId, 30000);
  if (!lockResult.acquired) {
    logger.warn('No se pudo adquirir lock para indexación', { repositoryId });
    return {
      started: false,
      status: 'indexing', // Asumir que otra instancia está indexando
      repositoryId
    };
  }
  
  // Actualizar estado a indexing
  await repositoryStore.updateStatus(repositoryId, 'indexing', {
    owner,
    repo,
    branch: branch || null,
    uid,
    createdAt: new Date().toISOString()
  });
  
  // Ejecutar indexación en background (no esperar)
  performIndexation(repositoryId, owner, repo, accessToken, branch, uid).catch(error => {
    logger.error('Error en indexación asíncrona', { repositoryId, error: error.message });
  });
  
  return {
    started: true,
    status: 'indexing',
    repositoryId
  };
}

/**
 * Ejecuta la indexación y guarda los resultados
 * Este método es llamado internamente por indexRepositoryAsync
 * @private
 */
async function performIndexation(repositoryId, owner, repo, accessToken, branch, uid) {
  try {
    logger.info('Iniciando proceso de indexación', { repositoryId });
    
    // 1. Indexar repositorio
    const indexResult = await indexRepository(owner, repo, accessToken, branch);
    
    // 2. Preparar datos del índice completo
    const indexData = {
      files: indexResult.files,
      tree: indexResult.tree,
      indexedAt: new Date().toISOString(),
      branch: indexResult.branch,
      branchSha: indexResult.branchSha
    };
    
    // 3. Guardar índice completo en filesystem
    await repositoryStore.saveIndex(repositoryId, indexData);
    
    // 4. Guardar metadata liviana
    await repositoryStore.saveMetadata(repositoryId, {
      status: 'ready',
      owner,
      repo,
      branch: indexResult.branch,
      branchSha: indexResult.branchSha,
      uid,
      indexedAt: new Date().toISOString(),
      stats: {
        totalFiles: indexResult.stats.totalFiles,
        totalSize: indexResult.stats.totalSize,
        indexedFiles: indexResult.stats.indexedFiles,
        languages: indexResult.stats.languages,
        extensions: indexResult.stats.extensions
      }
    });
    
    logger.info('Indexación completada exitosamente', { 
      repositoryId,
      totalFiles: indexResult.stats.totalFiles
    });
    
  } catch (error) {
    logger.error('Error durante indexación', { repositoryId, error: error.message });
    
    // Actualizar estado a error
    await repositoryStore.updateStatus(repositoryId, 'error', {
      error: error.message,
      updatedAt: new Date().toISOString()
    });
    
    throw error;
  } finally {
    // Siempre liberar lock
    try {
      await releaseLock(repositoryId);
    } catch (releaseError) {
      logger.error('Error liberando lock', { repositoryId, error: releaseError.message });
    }
  }
}

module.exports = {
  indexRepositoryAsync
};
