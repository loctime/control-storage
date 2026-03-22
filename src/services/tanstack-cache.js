// backend/src/services/tanstack-cache.js
// Implementación de cache simple para el backend sin dependencias externas

const { logger } = require('../utils/logger');

class TanStackCache {
  constructor() {
    this.cache = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      totalRequests: 0,
    };
    
    // Configuración de cache
    this.config = {
      staleTime: 5 * 60 * 1000, // 5 minutos
      gcTime: 10 * 60 * 1000,   // 10 minutos
      maxSize: 1000, // Máximo 1000 entradas en cache
    };
  }

  // Obtener datos con cache inteligente
  async getFiles(userId, folderId) {
    const cacheKey = `files-${userId}-${folderId}`;
    this.stats.totalRequests++;

    try {
      // Verificar si existe en cache y no está expirado
      const cached = this.cache.get(cacheKey);
      if (cached && this.isValidCacheEntry(cached)) {
        this.stats.hits++;
        logger.debug(`Cache HIT for ${cacheKey}`);
        return cached.data;
      }

      // Si no está en cache o está expirado, obtener de DB
      logger.debug(`Fetching files from DB for user ${userId}, folder ${folderId}`);
      const result = await this.fetchFilesFromDB(userId, folderId);
      
      // Guardar en cache
      this.setCacheEntry(cacheKey, result);
      
      this.stats.misses++;
      logger.debug(`Cache MISS for ${cacheKey} - data fetched from DB`);
      return result;
    } catch (error) {
      this.stats.misses++;
      logger.warn(`Cache MISS for ${cacheKey}:`, { error: error.message });
      throw error;
    }
  }

  // Obtener carpetas con cache
  async getFolders(userId) {
    const cacheKey = `folders-${userId}`;
    this.stats.totalRequests++;

    try {
      // Verificar si existe en cache y no está expirado
      const cached = this.cache.get(cacheKey);
      if (cached && this.isValidCacheEntry(cached)) {
        this.stats.hits++;
        logger.debug(`Cache HIT for ${cacheKey}`);
        return cached.data;
      }

      // Si no está en cache o está expirado, obtener de DB
      logger.debug(`Fetching folders from DB for user ${userId}`);
      const result = await this.fetchFoldersFromDB(userId);
      
      // Guardar en cache
      this.setCacheEntry(cacheKey, result);
      
      this.stats.misses++;
      logger.debug(`Cache MISS for ${cacheKey} - data fetched from DB`);
      return result;
    } catch (error) {
      this.stats.misses++;
      logger.warn(`Cache MISS for ${cacheKey}:`, { error: error.message });
      throw error;
    }
  }

  // Prefetch de datos relacionados
  async prefetchRelatedData(userId, folderId) {
    try {
      // Prefetch de carpetas si no están en cache
      const foldersKey = `folders-${userId}`;
      if (!this.cache.has(foldersKey) || !this.isValidCacheEntry(this.cache.get(foldersKey))) {
        const folders = await this.fetchFoldersFromDB(userId);
        this.setCacheEntry(foldersKey, folders);
      }

      // Prefetch de archivos de carpetas padre
      if (folderId) {
        const rootFilesKey = `files-${userId}-null`;
        if (!this.cache.has(rootFilesKey) || !this.isValidCacheEntry(this.cache.get(rootFilesKey))) {
          const rootFiles = await this.fetchFilesFromDB(userId, null);
          this.setCacheEntry(rootFilesKey, rootFiles);
        }
      }

      logger.debug(`Prefetched related data for user ${userId}`);
    } catch (error) {
      logger.warn(`Prefetch error:`, { error: error.message });
    }
  }

  // Invalidar cache específico
  invalidateFiles(userId, folderId) {
    const cacheKey = `files-${userId}-${folderId}`;
    this.cache.delete(cacheKey);
    logger.debug(`Invalidated cache for files-${userId}-${folderId}`);
  }

  // Invalidar todo el cache de un usuario
  invalidateUser(userId) {
    // Eliminar todas las entradas que pertenecen al usuario
    for (const [key] of this.cache.entries()) {
      if (key.includes(`-${userId}-`) || key.endsWith(`-${userId}`)) {
        this.cache.delete(key);
      }
    }
    logger.debug(`Invalidated all cache for user ${userId}`);
  }

  // Obtener estadísticas del cache
  getStats() {
    const hitRate = this.stats.totalRequests > 0 
      ? (this.stats.hits / this.stats.totalRequests * 100).toFixed(2)
      : 0;

    return {
      ...this.stats,
      hitRate: `${hitRate}%`,
      cacheSize: this.cache.size,
    };
  }

  // Métodos auxiliares para el cache
  isValidCacheEntry(cached) {
    if (!cached || !cached.timestamp) return false;
    const now = Date.now();
    return (now - cached.timestamp) < this.config.staleTime;
  }

  setCacheEntry(key, data) {
    // Limpiar cache si excede el tamaño máximo
    if (this.cache.size >= this.config.maxSize) {
      this.cleanupCache();
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  cleanupCache() {
    // Eliminar entradas más antiguas si el cache está lleno
    const entries = Array.from(this.cache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    
    // Eliminar el 20% más antiguo
    const toDelete = Math.floor(entries.length * 0.2);
    for (let i = 0; i < toDelete; i++) {
      this.cache.delete(entries[i][0]);
    }
  }

  // Fetch real de base de datos usando Firestore
  async fetchFilesFromDB(userId, folderId) {
    const admin = require('../firebaseAdmin');
    
    try {
      const items = [];

      // Get files from 'files' collection
      let filesQuery = admin.firestore()
        .collection('files')
        .where('userId', '==', userId)
        .where('deletedAt', '==', null);

      if (folderId === null) {
        filesQuery = filesQuery.where('parentId', '==', null);
      } else if (typeof folderId === 'string' && folderId.length > 0) {
        filesQuery = filesQuery.where('parentId', '==', folderId);
      }

      // Ya no filtramos por appCode - todos los archivos del usuario

      filesQuery = filesQuery.orderBy('updatedAt', 'desc');

      const filesSnap = await filesQuery.get();
      filesSnap.forEach(doc => {
        const data = doc.data();
        items.push({
          id: doc.id,
          ...data,
          type: 'file'
        });
      });

      // Get folders from 'files' collection
      let foldersQuery = admin.firestore()
        .collection('files')
        .where('userId', '==', userId)
        .where('type', '==', 'folder')
        .where('deletedAt', '==', null);

      if (folderId === null) {
        foldersQuery = foldersQuery.where('parentId', '==', null);
      } else if (typeof folderId === 'string' && folderId.length > 0) {
        foldersQuery = foldersQuery.where('parentId', '==', folderId);
      }

      // Ya no filtramos por appCode - todas las carpetas del usuario

      foldersQuery = foldersQuery.orderBy('updatedAt', 'desc');

      const foldersSnap = await foldersQuery.get();
      foldersSnap.forEach(doc => {
        const data = doc.data();
        items.push({
          id: doc.id,
          ...data,
          type: 'folder'
        });
      });

      // Sort by updatedAt desc
      items.sort((a, b) => {
        const aTime = a.updatedAt?.toDate?.() || new Date(a.updatedAt);
        const bTime = b.updatedAt?.toDate?.() || new Date(b.updatedAt);
        return bTime - aTime;
      });

      logger.debug(`Fetched ${items.length} items from DB for user ${userId}, folder ${folderId}`);
      return items;
    } catch (error) {
      logger.error('Error fetching files from DB', { error: error.message, userId, folderId });
      
      // Si es error de índice, mostrar enlace para crear índice
      if (error.code === 9 && error.details && error.details.includes('index')) {
        logger.info('ENLACE PARA CREAR ÍNDICE:', { 
          details: error.details,
          message: 'Copia este enlace y ábrelo en el navegador para crear el índice automáticamente'
        });
      }
      
      throw error;
    }
  }

  async fetchFoldersFromDB(userId) {
    const admin = require('../firebaseAdmin');
    
    try {
      const folders = [];

      let foldersQuery = admin.firestore()
        .collection('files')
        .where('userId', '==', userId)
        .where('type', '==', 'folder')
        .where('deletedAt', '==', null);

      // Ya no filtramos por appCode - todas las carpetas del usuario

      foldersQuery = foldersQuery.orderBy('updatedAt', 'desc');

      const foldersSnap = await foldersQuery.get();
      foldersSnap.forEach(doc => {
        const data = doc.data();
        folders.push({
          id: doc.id,
          ...data,
          type: 'folder'
        });
      });

      logger.debug(`Fetched ${folders.length} folders from DB for user ${userId}`);
      return folders;
    } catch (error) {
      logger.error('Error fetching folders from DB', { error: error.message, userId });
      
      // Si es error de índice, mostrar enlace para crear índice
      if (error.code === 9 && error.details && error.details.includes('index')) {
        logger.info('ENLACE PARA CREAR ÍNDICE:', { 
          details: error.details,
          message: 'Copia este enlace y ábrelo en el navegador para crear el índice automáticamente'
        });
      }
      
      throw error;
    }
  }
}

// Instancia singleton
const tanStackCache = new TanStackCache();

module.exports = tanStackCache;
