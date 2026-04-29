const express = require('express');
const { v4: uuidv4 } = require('uuid');
const admin = require('../../firebaseAdmin');
const b2Service = require('../../services/b2');
const { logger } = require('../../utils/logger');

const router = express.Router();

const APP_ID = 'controlinject';
const SNAPSHOT_KIND = 'mapping-snapshot';
const DEFAULT_SHARE_HOURS = 24;

function sanitizeSegment(value) {
  return String(value || '')
    .trim()
    .replace(/[<>:"\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/\/+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function ensureJsonFileName(fileName) {
  const trimmed = String(fileName || '').trim();
  if (!trimmed) {
    return `mapping-${Date.now()}.json`;
  }
  return trimmed.toLowerCase().endsWith('.json') ? trimmed : `${trimmed}.json`;
}

function buildBucketKey(uid, pathSegments, fileName) {
  const safePath = pathSegments
    .map(sanitizeSegment)
    .filter(Boolean);
  const uniquePrefix = `${Date.now()}-${uuidv4()}`;
  return [
    'apps',
    APP_ID,
    uid,
    ...safePath,
    `${uniquePrefix}-${sanitizeSegment(fileName) || 'mapping.json'}`
  ].join('/');
}

function buildDownloadUrl(req, fileId) {
  return `${req.protocol}://${req.get('host')}/api/apps/${APP_ID}/download-mapping?fileId=${encodeURIComponent(fileId)}`;
}

async function createShareForFile(fileId, fileData, publicBaseUrl) {
  const shareToken = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const expiresAt = new Date(Date.now() + DEFAULT_SHARE_HOURS * 60 * 60 * 1000);
  const shareRef = admin.firestore().collection('shares').doc(shareToken);

  await shareRef.set({
    token: shareToken,
    fileId,
    uid: fileData.userId,
    fileName: fileData.name,
    fileSize: fileData.size,
    mime: fileData.mime,
    expiresAt,
    createdAt: new Date(),
    isActive: true,
    downloadCount: 0,
  });

  return {
    shareToken,
    shareUrl: `${publicBaseUrl}/share/${shareToken}`,
  };
}

router.post('/upload-mapping', async (req, res) => {
  try {
    const { appId, nombre, fileName, path, snapshot } = req.body || {};
    const { uid } = req.user;

    if (appId !== APP_ID) {
      return res.status(400).json({
        error: 'appId inválido',
        code: 'INVALID_APP_ID',
      });
    }

    if (!nombre || typeof nombre !== 'string') {
      return res.status(400).json({
        error: 'nombre es obligatorio',
        code: 'NAME_REQUIRED',
      });
    }

    if (!Array.isArray(path) || path.length === 0 || path.some((segment) => typeof segment !== 'string' || !segment.trim())) {
      return res.status(400).json({
        error: 'path debe ser un array no vacío de strings',
        code: 'INVALID_PATH',
      });
    }

    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      return res.status(400).json({
        error: 'snapshot debe ser un objeto JSON',
        code: 'INVALID_SNAPSHOT',
      });
    }

    const resolvedFileName = ensureJsonFileName(fileName);
    const payload = Buffer.from(JSON.stringify(snapshot, null, 2), 'utf8');
    const bucketKey = buildBucketKey(uid, path, resolvedFileName);

    const uploadResult = await b2Service.uploadFileDirectly(bucketKey, payload, 'application/json');

    const fileRef = admin.firestore().collection('files').doc();
    const now = new Date();
    const fileData = {
      id: fileRef.id,
      userId: uid,
      appId: APP_ID,
      sourceApp: APP_ID,
      kind: SNAPSHOT_KIND,
      name: resolvedFileName,
      fileName: resolvedFileName,
      size: payload.length,
      mime: 'application/json',
      bucketKey,
      etag: uploadResult.etag,
      parentId: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
      metadata: {
        appId: APP_ID,
        nombre,
        path,
        kind: SNAPSHOT_KIND,
        version: snapshot.version ?? 1,
      },
    };

    await fileRef.set(fileData);

    const publicBaseUrl = process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`;
    const { shareUrl } = await createShareForFile(fileRef.id, fileData, publicBaseUrl);

    logger.info('ControlInject mapping uploaded', {
      fileId: fileRef.id,
      bucketKey,
      userId: uid,
      fileSize: payload.length,
    });

    res.status(200).json({
      fileId: fileRef.id,
      fileName: resolvedFileName,
      fileSize: payload.length,
      downloadUrl: buildDownloadUrl(req, fileRef.id),
      shareUrl,
    });
  } catch (error) {
    logger.error('Error uploading ControlInject mapping', {
      error: error.message,
      userId: req.user?.uid,
    });

    res.status(500).json({
      error: 'Error interno del servidor',
      code: 'UPLOAD_MAPPING_FAILED',
    });
  }
});

router.get('/download-mapping', async (req, res) => {
  try {
    const { fileId } = req.query;
    const { uid } = req.user;

    if (!fileId || typeof fileId !== 'string') {
      return res.status(400).json({
        error: 'fileId es obligatorio',
        code: 'FILE_ID_REQUIRED',
      });
    }

    const fileRef = admin.firestore().collection('files').doc(fileId);
    const fileDoc = await fileRef.get();

    if (!fileDoc.exists) {
      return res.status(404).json({
        error: 'Archivo no encontrado',
        code: 'FILE_NOT_FOUND',
      });
    }

    const fileData = fileDoc.data();

    if (fileData.userId !== uid) {
      return res.status(403).json({
        error: 'No autorizado',
        code: 'FILE_FORBIDDEN',
      });
    }

    if (fileData.appId !== APP_ID || fileData.kind !== SNAPSHOT_KIND) {
      return res.status(404).json({
        error: 'Mapping no encontrado',
        code: 'MAPPING_NOT_FOUND',
      });
    }

    if (fileData.deletedAt) {
      return res.status(404).json({
        error: 'Archivo eliminado',
        code: 'FILE_DELETED',
      });
    }

    const buffer = await b2Service.getObjectBuffer(fileData.bucketKey);
    const snapshot = JSON.parse(buffer.toString('utf8'));

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(200).json(snapshot);
  } catch (error) {
    logger.error('Error downloading ControlInject mapping', {
      error: error.message,
      fileId: req.query?.fileId,
      userId: req.user?.uid,
    });

    res.status(500).json({
      error: 'Error interno del servidor',
      code: 'DOWNLOAD_MAPPING_FAILED',
    });
  }
});

module.exports = router;
