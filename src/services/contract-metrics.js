/**
 * Servicio de Métricas para Contrato App ↔ ControlFile v1
 * 
 * Recopila métricas sobre violaciones potenciales del contrato
 * sin bloquear ninguna operación (soft enforcement)
 */

const { logger } = require('../utils/logger');

/**
 * Métricas en memoria (para desarrollo/testing)
 * En producción, estas deberían enviarse a un sistema de métricas externo
 */
const metrics = {
  rootFolderCreations: {
    total: 0,
    byCallerType: { CONTROLFILE_UI: 0, APP: 0, UNKNOWN: 0 },
    byAppId: {},
    byUserId: {},
    timestamps: []
  },
  subfolderCreations: {
    total: 0,
    outsideAppRoot: 0,
    byCallerType: { CONTROLFILE_UI: 0, APP: 0, UNKNOWN: 0 },
    byAppId: {},
    byUserId: {},
    timestamps: []
  },
  taskbarPins: {
    total: 0,
    byCallerType: { CONTROLFILE_UI: 0, APP: 0, UNKNOWN: 0 },
    byAppId: {},
    byUserId: {},
    timestamps: []
  },
  callerTypeDetections: {
    total: 0,
    byMethod: { HEADER: 0, CLAIMS: 0, USER_AGENT: 0, ORIGIN: 0, FALLBACK: 0 },
    classifications: { CONTROLFILE_UI: 0, APP: 0, UNKNOWN: 0 }
  }
};

/**
 * Registra una creación de carpeta raíz
 * @param {Object} data - Datos del evento
 */
function recordRootFolderCreation(data) {
  const { callerType, appId, userId, folderId } = data;
  
  metrics.rootFolderCreations.total++;
  metrics.rootFolderCreations.byCallerType[callerType] = 
    (metrics.rootFolderCreations.byCallerType[callerType] || 0) + 1;
  
  if (appId) {
    metrics.rootFolderCreations.byAppId[appId] = 
      (metrics.rootFolderCreations.byAppId[appId] || 0) + 1;
  }
  
  if (userId) {
    metrics.rootFolderCreations.byUserId[userId] = 
      (metrics.rootFolderCreations.byUserId[userId] || 0) + 1;
  }
  
  metrics.rootFolderCreations.timestamps.push({
    timestamp: new Date().toISOString(),
    callerType,
    appId,
    userId,
    folderId
  });
  
  // Mantener solo últimas 1000 entradas
  if (metrics.rootFolderCreations.timestamps.length > 1000) {
    metrics.rootFolderCreations.timestamps.shift();
  }
}

/**
 * Registra una creación de subcarpeta
 * @param {Object} data - Datos del evento
 */
function recordSubfolderCreation(data) {
  const { callerType, appId, userId, folderId, parentId, outsideAppRoot } = data;
  
  metrics.subfolderCreations.total++;
  metrics.subfolderCreations.byCallerType[callerType] = 
    (metrics.subfolderCreations.byCallerType[callerType] || 0) + 1;
  
  if (outsideAppRoot) {
    metrics.subfolderCreations.outsideAppRoot++;
  }
  
  if (appId) {
    metrics.subfolderCreations.byAppId[appId] = 
      (metrics.subfolderCreations.byAppId[appId] || 0) + 1;
  }
  
  if (userId) {
    metrics.subfolderCreations.byUserId[userId] = 
      (metrics.subfolderCreations.byUserId[userId] || 0) + 1;
  }
  
  metrics.subfolderCreations.timestamps.push({
    timestamp: new Date().toISOString(),
    callerType,
    appId,
    userId,
    folderId,
    parentId,
    outsideAppRoot
  });
  
  // Mantener solo últimas 1000 entradas
  if (metrics.subfolderCreations.timestamps.length > 1000) {
    metrics.subfolderCreations.timestamps.shift();
  }
}

/**
 * Registra un pin en taskbar
 * @param {Object} data - Datos del evento
 */
function recordTaskbarPin(data) {
  const { callerType, appId, userId, folderId } = data;
  
  metrics.taskbarPins.total++;
  metrics.taskbarPins.byCallerType[callerType] = 
    (metrics.taskbarPins.byCallerType[callerType] || 0) + 1;
  
  if (appId) {
    metrics.taskbarPins.byAppId[appId] = 
      (metrics.taskbarPins.byAppId[appId] || 0) + 1;
  }
  
  if (userId) {
    metrics.taskbarPins.byUserId[userId] = 
      (metrics.taskbarPins.byUserId[userId] || 0) + 1;
  }
  
  metrics.taskbarPins.timestamps.push({
    timestamp: new Date().toISOString(),
    callerType,
    appId,
    userId,
    folderId
  });
  
  // Mantener solo últimas 1000 entradas
  if (metrics.taskbarPins.timestamps.length > 1000) {
    metrics.taskbarPins.timestamps.shift();
  }
}

/**
 * Registra una detección de caller type
 * @param {Object} data - Datos de la detección
 */
function recordCallerTypeDetection(data) {
  const { method, callerType } = data;
  
  metrics.callerTypeDetections.total++;
  metrics.callerTypeDetections.byMethod[method] = 
    (metrics.callerTypeDetections.byMethod[method] || 0) + 1;
  metrics.callerTypeDetections.classifications[callerType] = 
    (metrics.callerTypeDetections.classifications[callerType] || 0) + 1;
}

/**
 * Obtiene todas las métricas (para debugging/monitoring)
 * @returns {Object}
 */
function getMetrics() {
  return JSON.parse(JSON.stringify(metrics)); // Deep copy
}

/**
 * Resetea las métricas (útil para testing)
 */
function resetMetrics() {
  Object.keys(metrics).forEach(key => {
    if (Array.isArray(metrics[key])) {
      metrics[key] = [];
    } else if (typeof metrics[key] === 'object') {
      if (key === 'timestamps') {
        metrics[key] = [];
      } else {
        Object.keys(metrics[key]).forEach(subKey => {
          if (typeof metrics[key][subKey] === 'number') {
            metrics[key][subKey] = 0;
          } else if (Array.isArray(metrics[key][subKey])) {
            metrics[key][subKey] = [];
          } else if (typeof metrics[key][subKey] === 'object') {
            metrics[key][subKey] = {};
          }
        });
      }
    }
  });
}

module.exports = {
  recordRootFolderCreation,
  recordSubfolderCreation,
  recordTaskbarPin,
  recordCallerTypeDetection,
  getMetrics,
  resetMetrics
};
