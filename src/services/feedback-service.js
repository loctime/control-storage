const admin = require('../firebaseAdmin');
const b2Service = require('./b2');
const { normalizeAppId } = require('../utils/app-ownership');
const {
  validateScreenshot,
  generateFeedbackId,
  generateFileId,
  buildFeedbackBucketKey,
  getExtensionFromMime,
  createHistoryDiff,
} = require('../utils/feedback-utils');
const { logger } = require('../utils/logger');

// Whitelist de apps permitidas (puede extenderse o consultarse desde Firestore)
const ALLOWED_APPS = [
  'controlaudit',
  'controlaudit',
  'controlstore',
  'controlremito',
  'controlciclo',
  'controlgastos',
  'controlhorarios',
];

// Apps que son multi-tenant (requieren tenantId obligatorio)
const MULTI_TENANT_APPS = [];

/**
 * Valida que un appId esté en la whitelist
 * @param {string} appId - ID de la aplicación
 * @returns {boolean} true si está permitida
 */
function validateAppId(appId) {
  if (!appId || typeof appId !== 'string') {
    return false;
  }

  const normalized = normalizeAppId(appId);
  return ALLOWED_APPS.includes(normalized);
}

/**
 * Valida que un tenantId sea válido para la app y usuario
 * Si la app es multi-tenant, verifica que el usuario pertenezca al tenant
 * @param {string} appId - ID de la aplicación normalizado
 * @param {string|null} tenantId - ID del tenant
 * @param {string} userId - UID del usuario
 * @returns {Promise<boolean>} true si es válido
 */
async function validateTenantId(appId, tenantId, userId) {
  // Si tenantId es null/undefined, verificar si la app es multi-tenant
  if (!tenantId || tenantId === null || tenantId === '') {
    if (MULTI_TENANT_APPS.includes(appId)) {
      throw new Error(`tenantId es obligatorio para la app ${appId}`);
    }
    return true; // No es multi-tenant, null es válido
  }

  // Si tenantId existe, validar que el usuario pertenece al tenant
  // Estructura: apps/{appId}/tenants/{tenantId}/users/{userId}
  const db = admin.firestore();
  const tenantUserRef = db
    .collection('apps')
    .doc(appId)
    .collection('tenants')
    .doc(tenantId)
    .collection('users')
    .doc(userId);

  const tenantUserDoc = await tenantUserRef.get();

  if (!tenantUserDoc.exists) {
    throw new Error(`Usuario no pertenece al tenant ${tenantId} de la app ${appId}`);
  }

  return true;
}

/**
 * Verifica idempotencia mediante clientRequestId
 * @param {string} userId - UID del usuario
 * @param {string} appId - ID de la aplicación normalizado
 * @param {string} clientRequestId - ID del request del cliente
 * @returns {Promise<Object|null>} Feedback existente o null
 */
async function checkIdempotency(userId, appId, clientRequestId) {
  if (!clientRequestId) {
    return null;
  }

  const db = admin.firestore();
  const feedbackQuery = await db
    .collection('feedback')
    .where('userId', '==', userId)
    .where('appId', '==', appId)
    .where('clientRequestId', '==', clientRequestId)
    .limit(1)
    .get();

  if (!feedbackQuery.empty) {
    const doc = feedbackQuery.docs[0];
    const data = doc.data();
    return {
      feedbackId: doc.id,
      ...data,
    };
  }

  return null;
}

/**
 * Valida el payload de feedback
 * @param {Object} payload - Payload a validar
 * @returns {Object} { valid: boolean, error?: string }
 */
function validateFeedbackPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, error: 'Payload inválido' };
  }

  if (!payload.appId || typeof payload.appId !== 'string') {
    return { valid: false, error: 'appId es requerido y debe ser un string' };
  }

  if (!payload.comment || typeof payload.comment !== 'string' || payload.comment.trim().length === 0) {
    return { valid: false, error: 'comment es requerido y no puede estar vacío' };
  }

  if (!payload.context || typeof payload.context !== 'object') {
    return { valid: false, error: 'context es requerido' };
  }

  if (!payload.context.page || typeof payload.context.page !== 'object') {
    return { valid: false, error: 'context.page es requerido' };
  }

  if (!payload.context.viewport || typeof payload.context.viewport !== 'object') {
    return { valid: false, error: 'context.viewport es requerido' };
  }

  // Validar estructura básica del viewport
  const { viewport } = payload.context;
  if (
    typeof viewport.x !== 'number' ||
    typeof viewport.y !== 'number' ||
    typeof viewport.width !== 'number' ||
    typeof viewport.height !== 'number' ||
    typeof viewport.dpr !== 'number'
  ) {
    return {
      valid: false,
      error: 'context.viewport debe tener x, y, width, height y dpr como números',
    };
  }

  return { valid: true };
}

/**
 * Crea un feedback con screenshot
 * @param {string} userId - UID del usuario
 * @param {string} appId - ID de la aplicación
 * @param {Object} payload - Payload del feedback
 * @param {Buffer} screenshotBuffer - Buffer del screenshot
 * @param {Object} file - Objeto del archivo (multer)
 * @returns {Promise<Object>} Feedback creado
 */
async function createFeedback(userId, appId, payload, screenshotBuffer, file) {
  const db = admin.firestore();
  const now = admin.firestore.Timestamp.now();

  // Normalizar appId
  const normalizedAppId = normalizeAppId(appId);

  // Validar appId
  if (!validateAppId(normalizedAppId)) {
    throw new Error(`AppId ${appId} no está permitido`);
  }

  // Validar tenantId
  const tenantId = payload.tenantId === null || payload.tenantId === undefined ? null : payload.tenantId;
  await validateTenantId(normalizedAppId, tenantId, userId);

  // Validar payload
  const validation = validateFeedbackPayload(payload);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Validar screenshot
  const screenshotValidation = validateScreenshot(file, screenshotBuffer);
  if (!screenshotValidation.valid) {
    throw new Error(screenshotValidation.error);
  }

  // Verificar idempotencia
  if (payload.clientRequestId) {
    const existing = await checkIdempotency(userId, normalizedAppId, payload.clientRequestId);
    if (existing) {
      logger.info('Feedback ya existe (idempotencia)', {
        feedbackId: existing.feedbackId,
        clientRequestId: payload.clientRequestId,
      });
      return {
        success: true,
        feedbackId: existing.feedbackId,
        screenshotFileId: existing.screenshotFileId,
        status: existing.status,
        createdAt: existing.createdAt,
        fromCache: true,
      };
    }
  }

  // Generar IDs
  const fileId = generateFileId();
  const feedbackId = generateFeedbackId();

  // Generar bucketKey
  const extension = getExtensionFromMime(file.mimetype);
  const bucketKey = buildFeedbackBucketKey(normalizedAppId, userId, fileId, extension);

  // Upload a B2
  const uploadResult = await b2Service.uploadFileDirectly(bucketKey, screenshotBuffer, file.mimetype);

  // Crear documento en colección 'files'
  // IMPORTANTE: NO actualizar cuota de usuario (los screenshots de feedback NO cuentan en cuota)
  const fileRef = db.collection('files').doc(fileId);
  await fileRef.set({
    id: fileId,
    userId: userId,
    name: `feedback-screenshot-${Date.now()}.${extension}`,
    size: screenshotBuffer.length,
    mime: file.mimetype,
    bucketKey: bucketKey,
    etag: uploadResult.etag,
    type: 'file',
    appId: normalizedAppId,
    parentId: null, // Feedback no pertenece a carpeta
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    // NO actualizar users/{userId}.quota - los screenshots de feedback NO cuentan
  });

  // Crear entrada inicial del historial
  const historyEntry = {
    action: 'created',
    performedBy: userId,
    timestamp: now,
    changes: {
      after: {
        status: 'open',
        comment: payload.comment,
      },
    },
  };

  // Crear documento en colección 'feedback'
  const feedbackRef = db.collection('feedback').doc(feedbackId);
  const feedbackData = {
    feedbackId: feedbackId,
    appId: normalizedAppId,
    tenantId: tenantId,
    userId: userId,
    userRole: payload.userRole || null,
    createdBy: userId,
    comment: payload.comment.trim(),
    screenshotFileId: fileId,
    context: payload.context,
    clientRequestId: payload.clientRequestId || null,
    status: 'open',
    assignedTo: null,
    internalNotes: null,
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
    archivedAt: null,
    history: [historyEntry],
  };

  await feedbackRef.set(feedbackData);

  logger.info('Feedback creado exitosamente', {
    feedbackId,
    appId: normalizedAppId,
    userId,
    tenantId,
  });

  return {
    success: true,
    feedbackId: feedbackId,
    screenshotFileId: fileId,
    status: 'open',
    createdAt: feedbackData.createdAt,
  };
}

/**
 * Obtiene lista de feedback con filtros y paginación
 * @param {Object} filters - Filtros de búsqueda
 * @param {Object} pagination - Paginación (cursor, pageSize)
 * @param {string} userId - UID del usuario que hace la consulta
 * @returns {Promise<Object>} Lista de feedback con paginación
 */
async function getFeedbackList(filters, pagination, userId) {
  const db = admin.firestore();
  let query = db.collection('feedback');

  // Aplicar filtros
  if (filters.appId) {
    const normalizedAppId = normalizeAppId(filters.appId);
    query = query.where('appId', '==', normalizedAppId);
  } else {
    throw new Error('appId es requerido en filtros');
  }

  // IMPORTANTE: Si tenantId existe, SIEMPRE filtrar por él (aislamiento multi-tenant)
  if (filters.tenantId !== undefined && filters.tenantId !== null) {
    query = query.where('tenantId', '==', filters.tenantId);
  }

  if (filters.status) {
    query = query.where('status', '==', filters.status);
  }

  if (filters.createdBy) {
    query = query.where('userId', '==', filters.createdBy);
  }

  if (filters.assignedTo !== undefined) {
    if (filters.assignedTo === null) {
      query = query.where('assignedTo', '==', null);
    } else {
      query = query.where('assignedTo', '==', filters.assignedTo);
    }
  }

  if (filters.fromDate) {
    const fromTimestamp = admin.firestore.Timestamp.fromMillis(filters.fromDate);
    query = query.where('createdAt', '>=', fromTimestamp);
  }

  if (filters.toDate) {
    const toTimestamp = admin.firestore.Timestamp.fromMillis(filters.toDate);
    query = query.where('createdAt', '<=', toTimestamp);
  }

  // Ordenar por createdAt DESC
  query = query.orderBy('createdAt', 'desc');

  // Paginación
  const pageSize = Math.min(pagination?.pageSize || 20, 100);
  query = query.limit(pageSize + 1); // +1 para saber si hay más

  if (pagination?.cursor) {
    const cursorDoc = await db.collection('feedback').doc(pagination.cursor).get();
    if (cursorDoc.exists) {
      query = query.startAfter(cursorDoc);
    }
  }

  const snapshot = await query.get();
  const items = [];
  let hasMore = false;

  snapshot.forEach((doc, index) => {
    // Si hay más documentos que pageSize, hay más páginas
    if (index >= pageSize) {
      hasMore = true;
      return;
    }

    const data = doc.data();
    items.push({
      id: doc.id,
      ...data,
    });
  });

  // Determinar cursor para siguiente página
  const lastItem = items[items.length - 1];
  const nextCursor = hasMore && lastItem ? lastItem.id : undefined;

  return {
    items: items.slice(0, pageSize), // Solo retornar hasta pageSize
    pagination: {
      pageSize: pageSize,
      hasMore: hasMore,
      cursor: nextCursor,
    },
  };
}

/**
 * Actualiza un feedback
 * @param {string} feedbackId - ID del feedback
 * @param {string} userId - UID del usuario que actualiza
 * @param {Object} updates - Campos a actualizar
 * @returns {Promise<Object>} Feedback actualizado
 */
async function updateFeedback(feedbackId, userId, updates) {
  const db = admin.firestore();
  const now = admin.firestore.Timestamp.now();

  // Obtener feedback existente
  const feedbackRef = db.collection('feedback').doc(feedbackId);
  const feedbackDoc = await feedbackRef.get();

  if (!feedbackDoc.exists) {
    throw new Error(`Feedback ${feedbackId} no encontrado`);
  }

  const currentData = feedbackDoc.data();
  const changes = {};

  // Validar permisos (debe ser creador, asignado o admin de la app)
  // Esta validación se hace en el route handler

  // Obtener estado anterior para el historial
  const before = {
    status: currentData.status,
    assignedTo: currentData.assignedTo,
    internalNotes: currentData.internalNotes,
  };

  // Aplicar cambios
  if (updates.status !== undefined) {
    if (!['open', 'in_progress', 'resolved', 'archived'].includes(updates.status)) {
      throw new Error('Status inválido');
    }
    changes.status = updates.status;

    // Si cambia a resolved, setear resolvedAt
    if (updates.status === 'resolved' && currentData.status !== 'resolved') {
      changes.resolvedAt = now;
    } else if (updates.status !== 'resolved' && currentData.status === 'resolved') {
      changes.resolvedAt = null;
    }

    // Si cambia a archived, setear archivedAt
    if (updates.status === 'archived' && currentData.status !== 'archived') {
      changes.archivedAt = now;
    } else if (updates.status !== 'archived' && currentData.status === 'archived') {
      changes.archivedAt = null;
    }
  }

  if (updates.assignedTo !== undefined) {
    changes.assignedTo = updates.assignedTo === '' ? null : updates.assignedTo;
  }

  if (updates.internalNotes !== undefined) {
    changes.internalNotes = updates.internalNotes || null;
  }

  // Actualizar updatedAt
  changes.updatedAt = now;

  // Determinar acción del historial
  let historyAction = 'note_added';
  if (updates.status !== undefined && updates.status !== currentData.status) {
    historyAction = updates.status === 'resolved' ? 'resolved' : 'status_changed';
  } else if (updates.assignedTo !== undefined) {
    historyAction = 'assigned';
  }

  // Crear entrada del historial
  const after = {
    status: changes.status !== undefined ? changes.status : before.status,
    assignedTo: changes.assignedTo !== undefined ? changes.assignedTo : before.assignedTo,
    internalNotes: changes.internalNotes !== undefined ? changes.internalNotes : before.internalNotes,
  };

  const historyDiff = createHistoryDiff(before, after);
  const historyEntry = {
    action: historyAction,
    performedBy: userId,
    timestamp: now,
    changes: historyDiff,
  };

  // Obtener historial actual y agregar nueva entrada
  const currentHistory = currentData.history || [];
  const updatedHistory = [...currentHistory, historyEntry];

  // Actualizar documento
  await feedbackRef.update({
    ...changes,
    history: updatedHistory,
  });

  // Obtener documento actualizado
  const updatedDoc = await feedbackRef.get();
  const updatedData = updatedDoc.data();

  logger.info('Feedback actualizado', {
    feedbackId,
    userId,
    changes,
  });

  return {
    success: true,
    feedback: {
      id: updatedDoc.id,
      ...updatedData,
    },
  };
}

module.exports = {
  createFeedback,
  getFeedbackList,
  updateFeedback,
  validateFeedbackPayload,
  validateTenantId,
  checkIdempotency,
  generateFeedbackId,
};
