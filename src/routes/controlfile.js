const express = require('express');
const multer = require('multer');
const { randomUUID } = require('crypto');
const b2Service = require('../services/b2');
const admin = require('../firebaseAdmin');
const { logger } = require('../utils/logger');

const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();

router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'Campo "file" es obligatorio', code: 'MISSING_FILE' });
    }

    const sourceApp = req.body.sourceApp || 'controlaudit';
    const auditId = req.body.auditId;
    const companyId = req.body.companyId;
    const metadataStr = req.body.metadata;

    if (!auditId || !companyId) {
      return res.status(400).json({
        error: 'Los campos "auditId" y "companyId" son obligatorios',
        code: 'MISSING_FIELDS',
      });
    }

    let metadata = {};
    if (metadataStr) {
      try {
        metadata = JSON.parse(metadataStr);
      } catch (_) {
        return res.status(400).json({ error: 'El campo "metadata" debe ser un JSON valido', code: 'INVALID_METADATA' });
      }
    }

    const fileName = file.originalname;
    const fileSize = file.size;
    const fileType = file.mimetype || 'application/octet-stream';
    const fileExtension = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '';
    const fileUuid = randomUUID();

    const bucketPath = `audits/${companyId}/${auditId}/${fileUuid}${fileExtension ? '.' + fileExtension : ''}`;

    logger.info('Uploading ControlFile external file', {
      bucketPath,
      fileName,
      fileSize,
      userId: req.user?.uid,
      sourceApp,
    });

    await b2Service.uploadFileDirectly(bucketPath, file.buffer, fileType);
    const fileURL = await b2Service.createPresignedGetUrl(bucketPath, 3600);

    const fileRef = admin.firestore().collection('files').doc();
    const fileId = fileRef.id;

    await fileRef.set({
      id: fileId,
      sourceApp,
      companyId,
      auditId,
      fileName,
      fileURL,
      bucketPath,
      metadata,
      uploadedBy: req.user?.uid,
      createdAt: new Date(),
      userId: req.user?.uid,
      name: fileName,
      size: fileSize,
      mime: fileType,
      type: 'file',
      updatedAt: new Date(),
      deletedAt: null,
    });

    return res.json({ fileId, fileURL });
  } catch (error) {
    logger.error('Error uploading controlfile external file', { error: error?.message || error });
    return res.status(500).json({ error: 'Error interno del servidor', code: 'INTERNAL_ERROR' });
  }
});

module.exports = router;
