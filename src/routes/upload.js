const express = require('express');
const router = express.Router();
const admin = require('../firebaseAdmin');
const b2Service = require('../services/b2');
const multer = require('multer'); // Added multer for file uploads
const { resolveParentAndAncestors } = require('../services/metadata');
const { logger } = require('../utils/logger');
const { 
  loadAccount, 
  requireActiveAccount, 
  requireStorage,
  AccountNotFoundError,
  AccountNotActiveError,
  QuotaExceededError
} = require('../platform/guards/require-account');

// Test endpoint for debugging (no auth required)
router.post('/test-no-auth', async (req, res) => {
  logger.debug('Test endpoint (no auth)', { headers: req.headers, body: req.body });
  res.json({ 
    success: true, 
    body: req.body, 
    headers: req.headers 
  });
});

// Test endpoint for debugging
router.post('/test', async (req, res) => {
  logger.debug('Test endpoint', { headers: req.headers, body: req.body, user: req.user });
  res.json({ 
    success: true, 
    body: req.body, 
    user: req.user,
    headers: req.headers 
  });
});

// Generate presigned URL for upload
router.post('/presign', async (req, res) => {
  try {
    logger.debug('Presign request', { 
      headers: req.headers, 
      body: req.body, 
      user: req.user,
      contentType: req.headers['content-type']
    });
    
    const {
      name: nameDirect,
      fileName,
      size: sizeDirect,
      fileSize,
      mime: mimeDirect,
      mimeType,
      parentId,
    } = req.body;
    const name = nameDirect || fileName;
    const size = (typeof sizeDirect === 'number' ? sizeDirect : undefined) ?? fileSize;
    const mime = mimeDirect || mimeType;
    const { uid } = req.user;

    logger.debug('Parsed upload data', { name, size, mime, parentId, uid });

    if (!name || !size || !mime) {
      logger.warn('Missing required fields', { name: !!name, size: !!size, mime: !!mime });
      return res.status(400).json({ error: 'Faltan parámetros requeridos', message: 'name/fileName, size/fileSize y mime/mimeType son obligatorios' });
    }

    // Validate file size (max 5GB)
    const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5GB
    if (size > MAX_FILE_SIZE) {
      return res.status(400).json({ error: 'El archivo es demasiado grande (máx. 5GB)' });
    }

    // Validación de cuenta y cuota usando el guard
    const account = await loadAccount(uid);
    requireActiveAccount(account);
    requireStorage(account, size);

    // Resolve parent and ancestors
    logger.debug('Resolving parent folder', { parentId, uid });
    const resolved = await resolveParentAndAncestors(uid, parentId);
    const parentPath = resolved.path || '';
    const effectiveParentId = resolved.parentId || parentId || null;
    const ancestors = resolved.ancestors || [];
    logger.debug('Resolved parent info', { parentPath, effectiveParentId, ancestors });

    // Generate file key
    let fileKey = generateFileKey(uid, parentPath, name);
    
    // Normalización adicional del key final (colapsar múltiples slashes)
    // Esto asegura que no haya dobles slashes que rompan la firma presignada
    fileKey = fileKey.replace(/\/+/g, '/');

    // Check if multipart upload is needed
    const multipartConfig = b2Service.calculateMultipartConfig(size);
    const uploadSessionId = Math.random().toString(36).substr(2, 9);
    let uploadUrl = '';
    let uploadSessionData = {
      uploadSessionId,
      key: fileKey,
      fileKey: fileKey, // Alias para compatibilidad con SDK
      url: '',
    };

    if (multipartConfig?.useMultipart) {
      // Create multipart upload
      const uploadId = await b2Service.createMultipartUpload(fileKey, mime);
      
      // Generate presigned URLs for each part
      const parts = [];
      for (let i = 1; i <= multipartConfig.totalParts; i++) {
        const partUrl = await b2Service.createPresignedUploadPartUrl(fileKey, uploadId, i);
        parts.push({
          partNumber: i,
          url: partUrl,
        });
      }

      uploadSessionData.multipart = {
        uploadId,
        parts,
      };
      // Para multipart, usar la primera URL de parte como uploadUrl principal
      uploadUrl = parts[0]?.url || '';
    } else {
      // Single upload
      uploadUrl = await b2Service.createPresignedPutUrl(fileKey, 3600, mime);
      uploadSessionData.url = uploadUrl;
    }

    // Agregar campos requeridos por el SDK
    uploadSessionData.uploadUrl = uploadUrl;
    uploadSessionData.method = 'PUT'; // B2 usa PUT para uploads
    uploadSessionData.headers = {}; // Headers vacíos, B2 maneja todo en la URL presignada

    // Create upload session in Firestore
    const sessionRef = admin.firestore().collection('uploadSessions').doc(uploadSessionId);
    await sessionRef.set({
      uid,
      size,
      parentId: effectiveParentId || null,
      name,
      mime,
      status: 'pending',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      createdAt: new Date(),
      bucketKey: fileKey,
      uploadId: uploadSessionData.multipart?.uploadId || null,
      // appCode eliminado
      ancestors,
    });

    // Lógica de taskbar eliminada - ya no necesitamos APP_CODE

    res.json(uploadSessionData);
  } catch (error) {
    // Manejar errores del guard
    if (error instanceof AccountNotFoundError) {
      return res.status(404).json({
        error: error.message,
        code: error.code
      });
    }
    
    if (error instanceof AccountNotActiveError) {
      return res.status(403).json({
        error: error.message,
        code: error.code,
        details: {
          status: error.account.status
        }
      });
    }
    
    if (error instanceof QuotaExceededError) {
      return res.status(413).json({
        error: error.message,
        code: error.code,
        details: {
          requestedBytes: error.requestedBytes,
          availableBytes: error.availableBytes
        }
      });
    }
    
    logger.error('Error in presign upload', { error: error.message, userId: req.user?.uid });
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Confirm upload completion
router.post('/confirm', async (req, res) => {
  try {
    const { uploadSessionId, etag, parts } = req.body;
    const { uid } = req.user;

    if (!uploadSessionId) {
      return res.status(400).json({ error: 'ID de sesión requerido' });
    }

    // Get upload session
    const sessionRef = admin.firestore().collection('uploadSessions').doc(uploadSessionId);
    const sessionDoc = await sessionRef.get();

    if (!sessionDoc.exists) {
      return res.status(404).json({ error: 'Sesión de subida no encontrada' });
    }

    const sessionData = sessionDoc.data();
    if (sessionData.uid !== uid) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    if (sessionData.status !== 'pending' && sessionData.status !== 'uploaded') {
      return res.status(400).json({ error: 'Sesión ya procesada' });
    }

    // Complete multipart upload if needed
    if (sessionData.uploadId && parts) {
      await b2Service.completeMultipartUpload(sessionData.bucketKey, sessionData.uploadId, parts);
    }

    // Verify file exists in B2
    const metadata = await b2Service.getObjectMetadata(sessionData.bucketKey);
    if (!metadata) {
      return res.status(400).json({ error: 'Archivo no encontrado en B2' });
    }

    // Create file record in Firestore
    const fileRef = admin.firestore().collection('files').doc();
    await fileRef.set({
      id: fileRef.id,
      userId: uid,
      name: sessionData.name,
      size: sessionData.size,
      mime: sessionData.mime,
      parentId: sessionData.parentId,
      bucketKey: sessionData.bucketKey,
      etag: etag || metadata.etag,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      ancestors: Array.isArray(sessionData.ancestors) ? sessionData.ancestors : [],
    });

    // Update session status
    await sessionRef.update({
      status: 'completed',
      completedAt: new Date(),
    });

    res.json({ 
      success: true, 
      fileId: fileRef.id,
      message: 'Archivo subido exitosamente'
    });
  } catch (error) {
    logger.error('Error confirming upload', { error: error.message, userId: req.user?.uid });
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Proxy upload endpoint - recibe archivo y lo sube a B2
router.post('/proxy-upload', multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 * 1024, // 5GB máximo
  }
}).single('file'), async (req, res) => {
  try {
    logger.info('Proxy upload request received', { 
      fileName: req.file?.originalname, 
      fileSize: req.file?.size, 
      sessionId: req.body.sessionId,
      userId: req.user?.uid,
      contentType: req.headers['content-type']
    });
    
    if (!req.file) {
      logger.warn('No file received in proxy upload', { body: req.body, files: req.files });
      return res.status(400).json({ error: 'No se recibió archivo' });
    }

    const { sessionId } = req.body;
    const { uid } = req.user;

    if (!sessionId) {
      return res.status(400).json({ error: 'ID de sesión requerido' });
    }

    // Obtener información de la sesión de upload
    const sessionRef = admin.firestore().collection('uploadSessions').doc(sessionId);
    const sessionDoc = await sessionRef.get();

    if (!sessionDoc.exists) {
      logger.warn('Upload session not found', { sessionId, userId: uid });
      return res.status(404).json({ error: 'Sesión de upload no encontrada' });
    }

    const sessionData = sessionDoc.data();
    if (sessionData.uid !== uid) {
      logger.warn('Unauthorized upload attempt', { sessionId, sessionUid: sessionData.uid, requestUid: uid });
      return res.status(403).json({ error: 'No autorizado' });
    }

    // Validar que la sesión esté en estado válido
    if (sessionData.status !== 'pending' && sessionData.status !== 'uploaded') {
      logger.warn('Upload session already processed', { sessionId, status: sessionData.status });
      return res.status(400).json({ error: 'Sesión ya procesada' });
    }

    // Validar tamaño del archivo coincide con la sesión
    if (req.file.size !== sessionData.size) {
      logger.warn('File size mismatch', { 
        sessionId, 
        expectedSize: sessionData.size, 
        actualSize: req.file.size 
      });
      // No rechazar, pero loguear la diferencia (puede haber pequeñas diferencias por encoding)
    }

    // Virus scan si es archivo sospechoso
    const cloudmersive = require('../services/cloudmersive');
    let virusScanResult = null;

    if (cloudmersive.enabled && cloudmersive.isSuspiciousFile(sessionData.name, req.file.size, sessionData.mime)) {
      logger.info('Scanning suspicious file for viruses', { fileName: sessionData.name });
      try {
        virusScanResult = await cloudmersive.scanVirus(req.file.buffer);
        if (!virusScanResult.clean) {
          // Actualizar sesión como fallida
          await sessionRef.update({
            status: 'failed',
            error: `Virus detectado: ${virusScanResult.virusName}`,
            failedAt: new Date()
          });
          return res.status(400).json({ 
            error: `Virus detectado: ${virusScanResult.virusName}`,
            code: 'VIRUS_DETECTED'
          });
        }
        logger.info('Virus scan passed', { fileName: sessionData.name });
      } catch (error) {
        logger.error('Virus scan failed', { error: error.message, fileName: sessionData.name });
        // Continuar sin escaneo si falla (graceful degradation)
      }
    }

    // Usar mime type de la sesión (más confiable que el del request)
    const mimeToUpload = sessionData.mime || req.file.mimetype || 'application/octet-stream';
    const fileToUpload = req.file.buffer;

    logger.debug('Uploading file to B2', {
      bucketKey: sessionData.bucketKey,
      fileName: sessionData.name,
      fileSize: req.file.size,
      mimeType: mimeToUpload
    });

    // Subir archivo a B2 usando el backend
    const uploadStartTime = Date.now();
    const uploadResult = await b2Service.uploadFileDirectly(
      sessionData.bucketKey,
      fileToUpload,
      mimeToUpload
    );
    const uploadDuration = Date.now() - uploadStartTime;

    logger.info('File uploaded to B2 successfully', { 
      fileName: sessionData.name, 
      bucketKey: sessionData.bucketKey,
      etag: uploadResult.etag,
      userId: uid,
      durationMs: uploadDuration,
      fileSize: req.file.size
    });

    // Actualizar estado de la sesión
    await sessionRef.update({
      status: 'uploaded',
      uploadedAt: new Date(),
      etag: uploadResult.etag,
      virusScan: virusScanResult,
      actualFileSize: req.file.size // Guardar tamaño real por si hay diferencias
    });

    res.json({ 
      success: true, 
      message: 'Archivo subido correctamente',
      etag: uploadResult.etag 
    });

  } catch (error) {
    logger.error('Error in proxy upload', { 
      error: error.message, 
      stack: error.stack,
      userId: req.user?.uid,
      sessionId: req.body.sessionId
    });
    
    // Intentar actualizar la sesión como fallida si tenemos el sessionId
    if (req.body.sessionId) {
      try {
        const sessionRef = admin.firestore().collection('uploadSessions').doc(req.body.sessionId);
        await sessionRef.update({
          status: 'failed',
          error: error.message,
          failedAt: new Date()
        });
      } catch (updateError) {
        logger.error('Failed to update session status', { error: updateError.message });
      }
    }
    
    res.status(500).json({ 
      error: 'Error interno del servidor',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Helper functions
async function getParentPath(parentId) {
  // Si el parentId es null o vacío, es la carpeta raíz
  if (!parentId) {
    return '';
  }
  
  // Verificar si es una carpeta especial (main-* o sub-*)
  if (parentId.startsWith('main-') || parentId.startsWith('sub-')) {
    // Para carpetas especiales, usar el nombre como path
    // Estas carpetas se manejan en el frontend y no existen en Firestore
    return '';
  }
  
  // Buscar en la colección 'files'
  const folderRef = admin.firestore().collection('files').doc(parentId);
  const folderDoc = await folderRef.get();
  
  if (!folderDoc.exists) {
    throw new Error('Carpeta padre no encontrada');
  }
  
  const folderData = folderDoc.data();
  return folderData.path || '';
}

function generateFileKey(userId, parentPath, fileName) {
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).substr(2, 9);
  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
  
  // Normalizar parentPath: eliminar slashes al inicio y al final, y colapsar múltiples slashes
  const normalizedParentPath = parentPath
    ? parentPath.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/')
    : '';
  
  // Construir las partes del path
  const pathParts = [userId];
  if (normalizedParentPath) {
    pathParts.push(normalizedParentPath);
  }
  pathParts.push(`${timestamp}_${randomId}_${sanitizedFileName}`);
  
  // Unir las partes y normalizar el resultado final (colapsar múltiples slashes)
  const finalKey = pathParts.filter(Boolean).join('/').replace(/\/+/g, '/');
  
  return finalKey;
}

module.exports = router;
