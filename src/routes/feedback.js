const express = require('express');
const router = express.Router();
const multer = require('multer');
const feedbackService = require('../services/feedback-service');
const { logger } = require('../utils/logger');
const admin = require('../firebaseAdmin');

// Configurar multer para manejar multipart/form-data
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB máximo para screenshots
  },
});

/**
 * POST /api/feedback
 * Crear feedback con screenshot
 *
 * Content-Type: multipart/form-data
 * Campos:
 *   - payload (JSON string): { appId, tenantId?, userRole?, comment, context, clientRequestId?, source? }
 *   - screenshot (File): imagen PNG/JPEG (máx 10MB)
 *
 * Headers requeridos:
 *   - Authorization: Bearer <Firebase ID Token>
 */
router.post('/', upload.single('screenshot'), async (req, res) => {
  try {
    const userId = req.user?.uid;

    if (!userId) {
      return res.status(401).json({ error: 'No autorizado', code: 'AUTH_REQUIRED' });
    }

    // Validar que hay screenshot
    if (!req.file) {
      return res.status(400).json({
        error: 'Screenshot requerido',
        code: 'SCREENSHOT_MISSING',
      });
    }

    // Validar que hay payload
    if (!req.body.payload) {
      return res.status(400).json({
        error: 'Payload requerido',
        code: 'PAYLOAD_MISSING',
      });
    }

    // Parsear payload JSON
    let payload;
    try {
      payload = typeof req.body.payload === 'string' ? JSON.parse(req.body.payload) : req.body.payload;
    } catch (e) {
      return res.status(400).json({
        error: 'Payload inválido (debe ser JSON válido)',
        code: 'PAYLOAD_INVALID',
      });
    }

    // Validar que appId está presente
    if (!payload.appId) {
      return res.status(400).json({
        error: 'appId es requerido en payload',
        code: 'APPID_MISSING',
      });
    }

    // Crear feedback
    const result = await feedbackService.createFeedback(
      userId,
      payload.appId,
      payload,
      req.file.buffer,
      req.file
    );

    // Si viene de caché (idempotencia), retornar 200 en lugar de 201
    const statusCode = result.fromCache ? 200 : 201;

    // Auditoría global (async, no bloquea respuesta)
    if (!result.fromCache) {
      // Importar función de auditoría del backend
      const { createAuditLog } = require('../utils/audit');
      createAuditLog(
        'feedback.created',
        userId,
        {
          before: {},
          after: {
            feedbackId: result.feedbackId,
            appId: payload.appId,
            tenantId: payload.tenantId || null,
          },
        },
        {
          targetUid: userId,
        }
      ).catch((err) => {
        logger.error('Error creando auditoría de feedback', { error: err.message });
      });
    }

    res.status(statusCode).json({
      success: true,
      feedbackId: result.feedbackId,
      screenshotFileId: result.screenshotFileId,
      status: result.status,
      createdAt: result.createdAt?.toDate?.()?.toISOString() || result.createdAt,
    });
  } catch (error) {
    logger.error('Error creando feedback', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.uid,
    });

    // Error de validación
    if (error.message.includes('requerido') || error.message.includes('inválido') || error.message.includes('no está permitido')) {
      return res.status(400).json({
        error: error.message,
        code: 'VALIDATION_ERROR',
      });
    }

    // Error de permisos
    if (error.message.includes('pertenece') || error.message.includes('No autorizado')) {
      return res.status(403).json({
        error: error.message,
        code: 'PERMISSION_DENIED',
      });
    }

    // Error genérico
    res.status(500).json({
      error: 'Error interno del servidor',
      code: 'INTERNAL_ERROR',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * GET /api/feedback
 * Listar feedback con filtros y paginación
 *
 * Query Parameters:
 *   - appId (required): filtrar por app
 *   - tenantId (optional): filtrar por tenant
 *   - status (optional): open | in_progress | resolved | archived
 *   - createdBy (optional): UID del creador
 *   - assignedTo (optional): UID asignado
 *   - fromDate (optional): timestamp inicio
 *   - toDate (optional): timestamp fin
 *   - cursor (optional): cursor para paginación (ID del último documento)
 *   - pageSize (optional): tamaño de página (default: 20, max: 100)
 *
 * Headers requeridos:
 *   - Authorization: Bearer <Firebase ID Token>
 */
router.get('/', async (req, res) => {
  try {
    const userId = req.user?.uid;

    if (!userId) {
      return res.status(401).json({ error: 'No autorizado', code: 'AUTH_REQUIRED' });
    }

    // Validar que appId está presente
    const appId = req.query.appId;
    if (!appId) {
      return res.status(400).json({
        error: 'appId es requerido en query params',
        code: 'APPID_MISSING',
      });
    }

    // Validar permisos para leer feedback de createdBy
    const createdBy = req.query.createdBy;
    if (createdBy && createdBy !== userId) {
      // Verificar si es admin de la app (simplificado por ahora)
      // En producción, esto debería verificar contra apps/{appId}/users/{userId}
      // Por ahora, permitir solo si es el propio usuario
    }

    // Construir filtros
    const filters = {
      appId: appId,
      tenantId: req.query.tenantId !== undefined ? (req.query.tenantId === 'null' ? null : req.query.tenantId) : undefined,
      status: req.query.status,
      createdBy: createdBy,
      assignedTo: req.query.assignedTo !== undefined ? (req.query.assignedTo === 'null' ? null : req.query.assignedTo) : undefined,
      fromDate: req.query.fromDate ? parseInt(req.query.fromDate, 10) : undefined,
      toDate: req.query.toDate ? parseInt(req.query.toDate, 10) : undefined,
    };

    // Construir paginación
    const pagination = {
      cursor: req.query.cursor,
      pageSize: req.query.pageSize ? parseInt(req.query.pageSize, 10) : 20,
    };

    // Validar pageSize
    if (pagination.pageSize > 100) {
      pagination.pageSize = 100;
    }
    if (pagination.pageSize < 1) {
      pagination.pageSize = 20;
    }

    // Obtener lista de feedback
    const result = await feedbackService.getFeedbackList(filters, pagination, userId);

    // Convertir timestamps a ISO strings para respuesta JSON
    const items = result.items.map((item) => {
      const data = { ...item };
      // Convertir Timestamps de Firestore a ISO strings
      Object.keys(data).forEach((key) => {
        if (data[key] && typeof data[key].toDate === 'function') {
          data[key] = data[key].toDate().toISOString();
        }
      });
      // Convertir arrays de history con timestamps
      if (data.history && Array.isArray(data.history)) {
        data.history = data.history.map((entry) => {
          if (entry.timestamp && typeof entry.timestamp.toDate === 'function') {
            entry.timestamp = entry.timestamp.toDate().toISOString();
          }
          return entry;
        });
      }
      return data;
    });

    res.json({
      items: items,
      pagination: result.pagination,
    });
  } catch (error) {
    logger.error('Error listando feedback', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.uid,
    });

    res.status(500).json({
      error: 'Error interno del servidor',
      code: 'INTERNAL_ERROR',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * PATCH /api/feedback/:feedbackId
 * Actualizar feedback
 *
 * Body:
 *   {
 *     "status"?: "in_progress" | "resolved" | "archived",
 *     "assignedTo"?: string | null,
 *     "internalNotes"?: string
 *   }
 *
 * Headers requeridos:
 *   - Authorization: Bearer <Firebase ID Token>
 */
router.patch('/:feedbackId', async (req, res) => {
  try {
    const userId = req.user?.uid;
    const { feedbackId } = req.params;

    if (!userId) {
      return res.status(401).json({ error: 'No autorizado', code: 'AUTH_REQUIRED' });
    }

    // Validar que feedbackId está presente
    if (!feedbackId) {
      return res.status(400).json({
        error: 'feedbackId es requerido',
        code: 'FEEDBACKID_MISSING',
      });
    }

    // Obtener feedback existente para validar permisos
    const db = admin.firestore();
    const feedbackRef = db.collection('feedback').doc(feedbackId);
    const feedbackDoc = await feedbackRef.get();

    if (!feedbackDoc.exists) {
      return res.status(404).json({
        error: `Feedback ${feedbackId} no encontrado`,
        code: 'FEEDBACK_NOT_FOUND',
      });
    }

    const feedbackData = feedbackDoc.data();

    // Validar permisos: debe ser creador, asignado, o admin de la app
    const isOwner = feedbackData.userId === userId;
    const isAssigned = feedbackData.assignedTo === userId;
    // TODO: Verificar si es admin de la app (simplificado por ahora)
    // const isAppAdmin = await checkAppAdmin(feedbackData.appId, userId);

    if (!isOwner && !isAssigned) {
      return res.status(403).json({
        error: 'No autorizado para actualizar este feedback',
        code: 'PERMISSION_DENIED',
      });
    }

    // Obtener actualizaciones del body
    const updates = {};
    if (req.body.status !== undefined) {
      updates.status = req.body.status;
    }
    if (req.body.assignedTo !== undefined) {
      updates.assignedTo = req.body.assignedTo === null || req.body.assignedTo === '' ? null : req.body.assignedTo;
    }
    if (req.body.internalNotes !== undefined) {
      updates.internalNotes = req.body.internalNotes || null;
    }

    // Validar que hay al menos un campo para actualizar
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        error: 'No hay campos para actualizar',
        code: 'NO_UPDATES',
      });
    }

    // Actualizar feedback
    const result = await feedbackService.updateFeedback(feedbackId, userId, updates);

    // Convertir timestamps a ISO strings
    const feedback = result.feedback;
    Object.keys(feedback).forEach((key) => {
      if (feedback[key] && typeof feedback[key].toDate === 'function') {
        feedback[key] = feedback[key].toDate().toISOString();
      }
    });
    // Convertir arrays de history con timestamps
    if (feedback.history && Array.isArray(feedback.history)) {
      feedback.history = feedback.history.map((entry) => {
        if (entry.timestamp && typeof entry.timestamp.toDate === 'function') {
          entry.timestamp = entry.timestamp.toDate().toISOString();
        }
        return entry;
      });
    }

    // Auditoría global (async, no bloquea respuesta)
    const { createAuditLog } = require('../utils/audit');
    createAuditLog(
      'feedback.updated',
      userId,
      {
        before: {
          status: feedbackData.status,
          assignedTo: feedbackData.assignedTo,
          internalNotes: feedbackData.internalNotes,
        },
        after: updates,
      },
      {
        targetUid: feedbackData.userId,
      }
    ).catch((err) => {
      logger.error('Error creando auditoría de feedback', { error: err.message });
    });

    res.json({
      success: true,
      feedback: feedback,
    });
  } catch (error) {
    logger.error('Error actualizando feedback', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.uid,
      feedbackId: req.params.feedbackId,
    });

    // Error de validación
    if (error.message.includes('no encontrado') || error.message.includes('inválido')) {
      return res.status(400).json({
        error: error.message,
        code: 'VALIDATION_ERROR',
      });
    }

    // Error genérico
    res.status(500).json({
      error: 'Error interno del servidor',
      code: 'INTERNAL_ERROR',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

module.exports = router;
