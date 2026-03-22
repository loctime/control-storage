// backend/src/middleware/cache.js
const tanStackCache = require('../services/tanstack-cache');

// Middleware para cache de archivos
const cacheFiles = async (req, res, next) => {
  try {
    const userId = req.user?.uid;
    const folderId = req.query.folderId || null;

    if (!userId) {
      return next();
    }

    // Obtener archivos con cache
    const files = await tanStackCache.getFiles(userId, folderId);
    
    // Prefetch de datos relacionados
    await tanStackCache.prefetchRelatedData(userId, folderId);
    
    // Agregar datos al request
    req.cachedFiles = files;
    req.cacheHit = true;
    
    next();
  } catch (error) {
    console.log('Cache middleware error:', error.message);
    req.cacheHit = false;
    next();
  }
};

// Middleware para cache de carpetas
const cacheFolders = async (req, res, next) => {
  try {
    const userId = req.user?.uid;

    if (!userId) {
      return next();
    }

    // Obtener carpetas con cache
    const folders = await tanStackCache.getFolders(userId);
    
    // Agregar datos al request
    req.cachedFolders = folders;
    req.cacheHit = true;
    
    next();
  } catch (error) {
    console.log('Cache middleware error:', error.message);
    req.cacheHit = false;
    next();
  }
};

// Middleware para invalidar cache después de operaciones
const invalidateCache = (operation) => {
  return async (req, res, next) => {
    // Ejecutar la operación original
    const originalSend = res.send;
    res.send = function(data) {
      // Invalidar cache después de operación exitosa
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const userId = req.user?.uid;
        const folderId = req.body?.parentId || req.query?.folderId || null;

        if (userId) {
          switch (operation) {
            case 'create':
            case 'update':
            case 'delete':
              tanStackCache.invalidateFiles(userId, folderId);
              tanStackCache.invalidateFiles(userId, null); // Invalidar también root
              break;
            case 'user':
              tanStackCache.invalidateUser(userId);
              break;
          }
        }
      }

      // Llamar al send original
      originalSend.call(this, data);
    };

    next();
  };
};

// Endpoint para estadísticas del cache
const getCacheStats = (req, res) => {
  const stats = tanStackCache.getStats();
  res.json({
    success: true,
    data: stats,
    message: 'Cache statistics retrieved successfully'
  });
};

// Endpoint para limpiar cache
const clearCache = (req, res) => {
  const userId = req.user?.uid;
  
  if (userId) {
    tanStackCache.invalidateUser(userId);
    res.json({
      success: true,
      message: `Cache cleared for user ${userId}`
    });
  } else {
    res.status(400).json({
      success: false,
      message: 'User ID required'
    });
  }
};

module.exports = {
  cacheFiles,
  cacheFolders,
  invalidateCache,
  getCacheStats,
  clearCache,
};
