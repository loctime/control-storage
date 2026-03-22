const express = require('express');
const router = express.Router();
const admin = require('../firebaseAdmin');
const b2Service = require('../services/b2');
const multer = require('multer');
const archiver = require('archiver');
const { Readable } = require('stream');
const { logger } = require('../utils/logger');
// Función simple para verificar visibilidad de items
const assertItemVisibleForApp = (itemData) => {
  // Por ahora, todos los items son visibles
  return true;
};
const { cacheFiles, invalidateCache } = require('../middleware/cache');

// List files and folders with pagination (with TanStack cache)
router.get('/list', cacheFiles, async (req, res) => {
  try {
    const uid = req.user?.uid;
    const parentIdParam = typeof req.query.parentId === 'string' ? req.query.parentId : undefined;
    const parentId = parentIdParam === 'null' ? null : parentIdParam;
    const limit = Math.min(parseInt(req.query.pageSize || '100', 10), 200);
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;

    // Validar que el usuario esté autenticado
    if (!uid) {
      return res.status(401).json({ error: 'No autorizado' });
    }

    // Si tenemos datos en cache, usarlos
    if (req.cachedFiles && req.cacheHit) {
      logger.debug('Using cached files data', { userId: uid, parentId });
      return res.json({
        success: true,
        data: req.cachedFiles,
        message: 'Files retrieved from cache',
        cacheHit: true
      });
    }

    const items = [];

    try {
      // Get files from 'files' collection
      let filesQuery = admin.firestore()
        .collection('files')
        .where('userId', '==', uid)
        .where('deletedAt', '==', null);

      if (parentId === null) {
        filesQuery = filesQuery.where('parentId', '==', null);
      } else if (typeof parentId === 'string' && parentId.length > 0) {
        filesQuery = filesQuery.where('parentId', '==', parentId);
      }

      // Ya no filtramos por appCode - todos los archivos del usuario

      filesQuery = filesQuery.orderBy('updatedAt', 'desc');

      if (cursor) {
        const afterDoc = await admin.firestore().collection('files').doc(cursor).get();
        if (afterDoc.exists) {
          filesQuery = filesQuery.startAfter(afterDoc);
        }
      }

      const filesSnap = await filesQuery.limit(limit).get();
      filesSnap.forEach(doc => {
        items.push({ 
          id: doc.id, 
          ...doc.data(),
          type: 'file' // Asegurar que tenga el tipo correcto
        });
      });

    } catch (filesError) {
      logger.warn('Error consulting files', { error: filesError.message, userId: uid });
    }

    try {
      // Get folders from 'files' collection
      let foldersQuery = admin.firestore()
        .collection('files')
        .where('userId', '==', uid)
        .where('type', '==', 'folder');

      if (parentId === null) {
        foldersQuery = foldersQuery.where('parentId', '==', null);
      } else if (typeof parentId === 'string' && parentId.length > 0) {
        foldersQuery = foldersQuery.where('parentId', '==', parentId);
      }

      // Ya no filtramos por appCode - todas las carpetas del usuario

      foldersQuery = foldersQuery.orderBy('createdAt', 'desc');

      const foldersSnap = await foldersQuery.limit(limit).get();
      foldersSnap.forEach(doc => {
        const data = doc.data();
        items.push({ 
          id: doc.id, 
          ...data,
          type: 'folder', // Asegurar que tenga el tipo correcto
          updatedAt: data.modifiedAt || data.createdAt // Usar modifiedAt como updatedAt para consistencia
        });
      });

    } catch (foldersError) {
      logger.warn('Error consulting folders', { error: foldersError.message, userId: uid });
    }

    // Solo leer de files collection (enfoque unificado)

    // Ordenar todos los items por updatedAt/modifiedAt descendente
    items.sort((a, b) => {
      const aTime = a.updatedAt?.toDate ? a.updatedAt.toDate().getTime() : 
                   a.modifiedAt?.toDate ? a.modifiedAt.toDate().getTime() : 
                   a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
      const bTime = b.updatedAt?.toDate ? b.updatedAt.toDate().getTime() : 
                   b.modifiedAt?.toDate ? b.modifiedAt.toDate().getTime() : 
                   b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
      return bTime - aTime;
    });

    // Aplicar límite después de combinar
    const limitedItems = items.slice(0, limit);
    const nextPage = limitedItems.length === limit ? (limitedItems[limitedItems.length - 1]?.id || null) : null;

    return res.json({ items: limitedItems, nextPage });
  } catch (error) {
    logger.error('Error listing files and folders', { error: error.message, userId: uid });
    return res.status(500).json({ 
      error: 'Error interno del servidor', 
      details: process.env.NODE_ENV === 'development' ? error.message : undefined 
    });
  }
});

// Get presigned URL for download
router.post('/presign-get', async (req, res) => {
  try {
    const { fileId } = req.body;
    const { uid } = req.user;

    if (!fileId) {
      return res.status(400).json({ error: 'ID de archivo requerido' });
    }

    // Get file from Firestore
    const fileRef = admin.firestore().collection('files').doc(fileId);
    const fileDoc = await fileRef.get();

    if (!fileDoc.exists) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    const fileData = fileDoc.data();
    if (fileData.userId !== uid) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    if (!assertItemVisibleForApp(fileData)) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    if (fileData.deletedAt) {
      return res.status(404).json({ error: 'Archivo eliminado' });
    }

    const key = fileData.bucketKey || fileData.key || fileData.objectKey;
    // Fallback: si no hay clave de B2 pero existe una URL absoluta (ej. controlAudit), usarla
    if (!key) {
      if (typeof fileData.url === 'string' && /^https?:\/\//i.test(fileData.url)) {
        logger.warn('Using direct URL due to missing bucketKey', { fileId, urlHost: (() => { try { return new URL(fileData.url).host; } catch (_) { return 'invalid'; } })() });
        return res.json({
          downloadUrl: fileData.url,
          fileName: fileData.name,
          fileSize: fileData.size,
        });
      }
      logger.warn('File without bucketKey/key', { fileId, hasBucketKey: !!fileData.bucketKey });
      return res.status(400).json({ error: 'Archivo sin clave de almacenamiento (bucketKey)' });
    }

    // Generate presigned URL
    const downloadUrl = await b2Service.createPresignedGetUrl(key, 300); // 5 minutes

    res.json({ 
      downloadUrl,
      fileName: fileData.name,
      fileSize: fileData.size
    });
  } catch (error) {
    logger.error('Error generating download URL', {
      error: error?.message || error,
      stack: error?.stack,
      fileId: req.body.fileId,
      userId: req.user?.uid,
    });
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Delete file
router.post('/delete', invalidateCache('delete'), async (req, res) => {
  try {
    const { fileId } = req.body;
    const { uid } = req.user;

    if (!fileId) {
      return res.status(400).json({ error: 'ID de archivo requerido' });
    }

    // Get file from Firestore
    const fileRef = admin.firestore().collection('files').doc(fileId);
    const fileDoc = await fileRef.get();

    if (!fileDoc.exists) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    const fileData = fileDoc.data();
    if (fileData.userId !== uid) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    if (fileData.deletedAt) {
      return res.status(400).json({ error: 'Archivo ya eliminado' });
    }

    // Soft delete - mark as deleted
    await fileRef.update({
      deletedAt: new Date(),
    });

    // Update user quota
    const userRef = admin.firestore().collection('users').doc(uid);
    await userRef.update({
      usedBytes: admin.firestore.FieldValue.increment(-fileData.size),
    });

    res.json({ 
      success: true,
      message: 'Archivo eliminado exitosamente'
    });
  } catch (error) {
    logger.error('Error deleting file', { error: error.message, fileId: req.body.fileId, userId: req.user?.uid });
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Rename file
router.post('/rename', invalidateCache('update'), async (req, res) => {
  try {
    const { fileId, newName } = req.body;
    const { uid } = req.user;

    if (!fileId || !newName) {
      return res.status(400).json({ error: 'ID de archivo y nuevo nombre requeridos' });
    }

    // Get file from Firestore
    const fileRef = admin.firestore().collection('files').doc(fileId);
    const fileDoc = await fileRef.get();

    if (!fileDoc.exists) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    const fileData = fileDoc.data();
    if (fileData.userId !== uid) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    if (!assertItemVisibleForApp(fileData)) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    if (fileData.deletedAt) {
      return res.status(404).json({ error: 'Archivo eliminado' });
    }

    // Update file name
    await fileRef.update({
      name: newName,
      updatedAt: new Date(),
    });

    res.json({ 
      success: true,
      message: 'Archivo renombrado exitosamente'
    });
  } catch (error) {
    logger.error('Error renaming file', { error: error.message, fileId: req.body.fileId, userId: req.user?.uid });
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Permanently delete file (from trash)
router.post('/permanent-delete', invalidateCache('delete'), async (req, res) => {
  try {
    const { fileId } = req.body;
    const { uid } = req.user;

    if (!fileId) {
      return res.status(400).json({ error: 'ID de archivo requerido' });
    }

    // Get file from files collection
    const fileRef = admin.firestore().collection('files').doc(fileId);
    const fileDoc = await fileRef.get();

    if (!fileDoc.exists) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    const fileData = fileDoc.data();
    if (fileData.userId !== uid) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    if (!fileData.deletedAt) {
      return res.status(400).json({ error: 'Archivo no está en la papelera' });
    }

    // Delete from B2
    try {
      await b2Service.deleteObject(fileData.bucketKey);
    } catch (error) {
      logger.warn('Error deleting from B2 (file might not exist)', { error: error.message, fileId, bucketKey: fileData.bucketKey });
    }

    // Delete from Firestore
    await fileRef.delete();

    res.json({ 
      success: true,
      message: 'Archivo eliminado permanentemente'
    });
  } catch (error) {
    logger.error('Error permanently deleting file', { error: error.message, fileId: req.body.fileId, userId: req.user?.uid });
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Restore file from trash
router.post('/restore', invalidateCache('create'), async (req, res) => {
  try {
    const { fileId } = req.body;
    const { uid } = req.user;

    if (!fileId) {
      return res.status(400).json({ error: 'ID de archivo requerido' });
    }

    // Get file from files collection
    const fileRef = admin.firestore().collection('files').doc(fileId);
    const fileDoc = await fileRef.get();

    if (!fileDoc.exists) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    const fileData = fileDoc.data();
    if (fileData.userId !== uid) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    if (!fileData.deletedAt) {
      return res.status(400).json({ error: 'Archivo no está en la papelera' });
    }

    // Check if user has enough quota
    const userRef = admin.firestore().collection('users').doc(uid);
    const userDoc = await userRef.get();
    const userData = userDoc.data();

    if (userData.usedBytes + fileData.size > userData.planQuotaBytes) {
      return res.status(413).json({ 
        error: 'No tienes suficiente espacio para restaurar este archivo'
      });
    }

    // Restore file
    await fileRef.update({
      deletedAt: null,
      updatedAt: new Date(),
    });

    // Update user quota
    await userRef.update({
      usedBytes: admin.firestore.FieldValue.increment(fileData.size),
    });

    res.json({ 
      success: true,
      message: 'Archivo restaurado exitosamente'
    });
  } catch (error) {
    logger.error('Error restoring file', { error: error.message, fileId: req.body.fileId, userId: req.user?.uid });
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Download multiple files as a ZIP
router.post('/zip', async (req, res) => {
  try {
    const { fileIds, zipName } = req.body || {};
    const { uid } = req.user;
    // APP_CODE eliminado

    if (!Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({ error: 'Lista de archivos requerida' });
    }
    if (fileIds.length > 200) {
      return res.status(400).json({ error: 'Demasiados archivos seleccionados (máximo 200)' });
    }

    // Cargar metadatos y validar propiedad
    const filesMeta = [];
    for (const fid of fileIds) {
      const fileRef = admin.firestore().collection('files').doc(fid);
      const fileDoc = await fileRef.get();
      if (!fileDoc.exists) {
        continue;
      }
      const data = fileDoc.data();
      if (!data || data.userId !== uid || data.deletedAt || data.type === 'folder') {
        continue;
      }
      if (!assertItemVisibleForApp(data)) {
        continue;
      }
      filesMeta.push({ id: fid, name: data.name || `${fid}`, bucketKey: data.bucketKey });
    }

    if (filesMeta.length === 0) {
      return res.status(404).json({ error: 'No se encontraron archivos válidos' });
    }

    const archive = archiver('zip', { zlib: { level: 9 } });
    const filename = `${zipName || 'seleccion'}-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    archive.on('error', (err) => {
      logger.error('ZIP error', { error: err.message, userId: req.user?.uid });
      try { res.status(500).end(); } catch (_) {}
    });

    archive.pipe(res);

    // Evitar nombres duplicados en el ZIP
    const usedNames = new Map();

    for (const meta of filesMeta) {
      try {
        const presigned = await b2Service.createPresignedGetUrl(meta.bucketKey, 300);
        const response = await fetch(presigned);
        if (!response.ok || !response.body) {
          continue;
        }
        let entryName = meta.name;
        if (usedNames.has(entryName)) {
          const count = usedNames.get(entryName) + 1;
          usedNames.set(entryName, count);
          const dot = entryName.lastIndexOf('.');
          if (dot > 0) {
            entryName = `${entryName.substring(0, dot)} (${count})${entryName.substring(dot)}`;
          } else {
            entryName = `${entryName} (${count})`;
          }
        } else {
          usedNames.set(entryName, 0);
        }

        const nodeStream = typeof Readable.fromWeb === 'function' ? Readable.fromWeb(response.body) : Readable.from(response.body);
        archive.append(nodeStream, { name: entryName });
      } catch (e) {
        logger.warn('Error adding file to ZIP', { fileId: meta.id, error: e.message, userId: req.user?.uid });
      }
    }

    await archive.finalize();
  } catch (error) {
    logger.error('Error creating ZIP', { error: error.message, userId: req.user?.uid });
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Replace file contents while keeping same metadata/id
router.post('/replace', multer({ storage: multer.memoryStorage() }).single('file'), async (req, res) => {
  try {
    const { fileId } = req.body;
    const { uid } = req.user;

    if (!fileId) {
      return res.status(400).json({ error: 'ID de archivo requerido' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Archivo no recibido' });
    }

    // Load file
    const fileRef = admin.firestore().collection('files').doc(fileId);
    const fileDoc = await fileRef.get();
    if (!fileDoc.exists) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    const fileData = fileDoc.data();
    if (fileData.userId !== uid) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    if (fileData.deletedAt) {
      return res.status(400).json({ error: 'El archivo está eliminado' });
    }

    if (!assertItemVisibleForApp(fileData)) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    // Upload to same key
    const uploadResult = await b2Service.uploadFileDirectly(
      fileData.bucketKey,
      req.file.buffer,
      req.file.mimetype
    );

    // Update Firestore doc
    const newSize = req.file.size;
    const oldSize = fileData.size || 0;
    await fileRef.update({
      size: newSize,
      mime: req.file.mimetype,
      etag: uploadResult.etag,
      updatedAt: new Date(),
    });

    // Adjust user quota by size delta
    const userRef = admin.firestore().collection('users').doc(uid);
    await userRef.update({
      usedBytes: admin.firestore.FieldValue.increment(newSize - oldSize),
    });

    res.json({ success: true, message: 'Archivo reemplazado', size: newSize, mime: req.file.mimetype });
  } catch (error) {
    logger.error('Error replacing file', { error: error.message, fileId: req.body.fileId, userId: req.user?.uid });
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Permanently delete multiple files from trash
router.post('/empty-trash', invalidateCache('delete'), async (req, res) => {
  try {
    const body = req.body || {};
    const fileIds = Array.isArray(body.fileIds) ? body.fileIds : [];
    const uid = req.user?.uid;

    if (!fileIds.length) {
      return res.status(400).json({ error: 'Lista de archivos vacia' });
    }

    const fileRefs = fileIds.map((id) => admin.firestore().collection('files').doc(id));
    const fileDocs = await Promise.all(fileRefs.map((ref) => ref.get()));

    const validDocs = [];
    const notFound = [];
    const unauthorized = [];

    for (let i = 0; i < fileDocs.length; i++) {
      const doc = fileDocs[i];
      const id = fileIds[i];
      if (!doc.exists) {
        notFound.push(id);
        continue;
      }
      const data = doc.data() || {};
      if (data.userId !== uid) {
        unauthorized.push(id);
        continue;
      }
      validDocs.push({ id, size: data.size || 0, bucketKey: data.bucketKey });
    }

    await Promise.all(validDocs.map(async ({ bucketKey }) => {
      try {
        if (bucketKey) await b2Service.deleteObject(bucketKey);
      } catch (e) {
        logger.warn('B2 delete failed in empty-trash', { bucketKey, error: e?.message || e });
      }
    }));

    const batch = admin.firestore().batch();
    validDocs.forEach(({ id }) => {
      batch.delete(admin.firestore().collection('files').doc(id));
    });
    await batch.commit();

    const totalBytes = validDocs.reduce((acc, it) => acc + (typeof it.size === 'number' ? it.size : 0), 0);
    if (totalBytes) {
      await admin.firestore().collection('users').doc(uid).update({
        usedBytes: admin.firestore.FieldValue.increment(-totalBytes),
      });
    }

    return res.json({
      success: true,
      deletedIds: validDocs.map((d) => d.id),
      notFound,
      unauthorized,
    });
  } catch (error) {
    logger.error('Error emptying trash', { error: error?.message || error, userId: req.user?.uid });
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
