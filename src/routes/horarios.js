const express = require('express');
const router = express.Router();
const multer = require('multer');
const b2Service = require('../services/b2');
const { logger } = require('../utils/logger');

// Configurar multer para manejar multipart/form-data
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB máximo para imágenes de horario
  },
  fileFilter: (req, file, cb) => {
    // Solo permitir imágenes PNG
    if (file.mimetype === 'image/png') {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos PNG'), false);
    }
  }
});

/**
 * GET /api/horarios/semana-actual?ownerId=xxx
 * 
 * Endpoint público que devuelve directamente la imagen PNG del horario semanal.
 * La imagen se busca en Backblaze B2 en la ruta: horarios/{ownerId}/semana-actual.png
 * El backend actúa como proxy del archivo (bucket privado).
 * 
 * Query params:
 * - ownerId (obligatorio): ID del propietario
 * 
 * Respuestas:
 * - 200: Imagen PNG directamente (Content-Type: image/png)
 * - 400: ownerId no proporcionado
 * - 404: Archivo no encontrado (JSON: { code: "NOT_FOUND" })
 * - 500: Error interno del servidor
 */
router.get('/semana-actual', async (req, res) => {
  try {
    const ownerId = typeof req.query.ownerId === 'string' && req.query.ownerId.trim()
      ? req.query.ownerId.trim()
      : null;

    if (!ownerId) {
      return res.status(400).json({
        error: 'ownerId es obligatorio',
        code: 'OWNER_ID_REQUIRED'
      });
    }

    // Construir la ruta del archivo en Backblaze B2
    const bucketKey = `horarios/${ownerId}/semana-actual.png`;

    logger.info('GET /semana-actual: Obteniendo imagen', {
      ownerId,
      bucketKey
    });

    // Obtener stream desde B2 (bucket privado, proxy a través del backend)
    const fileStream = await b2Service.getObjectStream(bucketKey);

    // Determinar Content-Type según query param format
    const format = typeof req.query.format === 'string' ? req.query.format.toLowerCase() : null;
    const contentType = format === 'webp' ? 'image/webp' : 'image/png';

    // Setear headers CORS y Content-Type
    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=86400');
    

    // Manejar errores del stream
    fileStream.on('error', (streamError) => {
      logger.error('Error streaming imagen desde B2', {
        error: streamError.message,
        bucketKey,
        ownerId,
        errorName: streamError.name,
        errorCode: streamError.code,
        httpStatusCode: streamError.$metadata?.httpStatusCode
      });

      // Si el archivo no existe, devolver 404
      if (streamError.name === 'NotFound' || 
          streamError.name === 'NoSuchKey' ||
          streamError.code === 'NotFound' ||
          streamError.$metadata?.httpStatusCode === 404) {
        if (!res.headersSent) {
          return res.status(404).json({ code: 'NOT_FOUND' });
        }
      }

      // Otros errores
      if (!res.headersSent) {
        res.status(500).json({
          error: 'Error al obtener archivo',
          code: 'STREAM_ERROR'
        });
      }
    });

    // Stream el archivo directamente al cliente
    fileStream.pipe(res);

  } catch (error) {
    logger.error('Error en GET /semana-actual', {
      error: error.message,
      code: error.code,
      name: error.name,
      httpStatusCode: error.$metadata?.httpStatusCode,
      ownerId: req.query?.ownerId
    });

    // Si el archivo no existe, devolver 404
    // El SDK v3 de AWS S3 puede usar 'NoSuchKey' o httpStatusCode 404
    if (error.name === 'NotFound' || 
        error.name === 'NoSuchKey' ||
        error.code === 'NotFound' ||
        error.$metadata?.httpStatusCode === 404) {
      return res.status(404).json({ code: 'NOT_FOUND' });
    }

    // Otros errores
    res.status(500).json({
      error: 'Error interno del servidor',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * POST /api/horarios/semana-actual
 * 
 * Endpoint para subir/actualizar la imagen del horario semanal.
 * La imagen se guarda en Backblaze B2 en la ruta: horarios/{ownerId}/semana-actual.png
 * 
 * Content-Type: multipart/form-data
 * Campos:
 * - file (File, requerido): Archivo PNG con el horario semanal
 * - ownerId (string, opcional): ID del propietario. Si no se proporciona, usa "default"
 * 
 * Respuestas:
 * - 200: Horario subido exitosamente
 * - 400: Error de validación (archivo faltante, formato incorrecto, etc.)
 * - 500: Error interno del servidor
 */
router.post('/semana-actual', upload.single('file'), async (req, res) => {
  try {
    // Validar que hay archivo
    if (!req.file) {
      logger.warn('POST /semana-actual: No file received');
      return res.status(400).json({
        error: 'Archivo requerido',
        code: 'FILE_MISSING'
      });
    }

    // Validar que es PNG
    if (req.file.mimetype !== 'image/png') {
      logger.warn('POST /semana-actual: Invalid file type', {
        mimetype: req.file.mimetype
      });
      return res.status(400).json({
        error: 'Solo se permiten archivos PNG',
        code: 'INVALID_FILE_TYPE'
      });
    }

    // Obtener ownerId desde body o query, usar "default" si no viene
    const ownerId = (req.body.ownerId || req.query.ownerId || 'default').trim();

    // Construir la ruta del archivo en Backblaze B2
    const bucketKey = `horarios/${ownerId}/semana-actual.png`;

    logger.info('Subiendo horario semanal', {
      ownerId,
      bucketKey,
      fileSize: req.file.size,
      mimetype: req.file.mimetype
    });

    // Subir el archivo a B2
    await b2Service.uploadFileDirectly(
      bucketKey,
      req.file.buffer,
      'image/png'
    );

    logger.info('Horario semanal subido exitosamente', {
      ownerId,
      bucketKey,
      fileSize: req.file.size
    });

    res.status(200).json({
      success: true,
      message: 'Horario semanal actualizado exitosamente',
      ownerId,
      bucketKey,
      fileSize: req.file.size
    });

  } catch (error) {
    logger.error('Error subiendo horario semanal', {
      error: error.message,
      code: error.code,
      stack: error.stack,
      ownerId: req.body?.ownerId || req.query?.ownerId || 'default'
    });

    // Si es un error de multer (tamaño de archivo, etc.)
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          error: 'El archivo es demasiado grande (máx. 10MB)',
          code: 'FILE_TOO_LARGE'
        });
      }
      return res.status(400).json({
        error: 'Error procesando archivo',
        code: 'UPLOAD_ERROR',
        message: error.message
      });
    }

    // Si es el error de validación de tipo de archivo
    if (error.message === 'Solo se permiten archivos PNG') {
      return res.status(400).json({
        error: error.message,
        code: 'INVALID_FILE_TYPE'
      });
    }

    res.status(500).json({
      error: 'Error interno del servidor',
      code: 'INTERNAL_ERROR'
    });
  }
});

module.exports = router;
