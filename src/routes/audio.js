const express = require('express');
const router = express.Router();
const admin = require('../firebaseAdmin');
const b2Service = require('../services/b2');
const audioProcessing = require('../services/audio-processing');
const audioProcessingSimple = require('../services/audio-processing-simple');
const { assertItemVisibleForApp } = require('../services/metadata');

/**
 * Masterizar archivo de audio
 * POST /api/audio/master
 * Body: { fileId: string, action: 'create' | 'replace' }
 */
router.post('/master', async (req, res) => {
  try {
    const { fileId, action } = req.body;
    const { uid } = req.user;

    if (!fileId) {
      return res.status(400).json({ error: 'ID de archivo requerido' });
    }

    if (!action || !['create', 'replace'].includes(action)) {
      return res.status(400).json({ error: 'Acción inválida. Use "create" o "replace"' });
    }

    // Obtener archivo de Firestore
    const fileRef = admin.firestore().collection('files').doc(fileId);
    const fileDoc = await fileRef.get();

    if (!fileDoc.exists) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    const fileData = fileDoc.data();
    
    // Verificar propiedad
    if (fileData.userId !== uid) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    if (!assertItemVisibleForApp(fileData)) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    if (fileData.deletedAt) {
      return res.status(400).json({ error: 'Archivo eliminado' });
    }

    // Validar archivo de audio
    const validation = audioProcessing.validateAudioFile(fileData.mime, fileData.size);
    if (!validation.isValid) {
      return res.status(400).json({ error: validation.error });
    }

    console.log(`🎵 Iniciando masterización de audio: ${fileData.name}`);

    // Descargar archivo de B2
    let inputBuffer;
    try {
      inputBuffer = await b2Service.getObjectBuffer(fileData.bucketKey);
      console.log(`📥 Archivo descargado: ${inputBuffer.length} bytes`);
    } catch (error) {
      console.error('❌ Error descargando archivo de B2:', error);
      return res.status(500).json({ 
        error: 'Error descargando archivo',
        details: error.message 
      });
    }

    // Determinar formatos de entrada y salida
    let formats;
    try {
      formats = audioProcessing.getAudioFormats(fileData.mime);
      console.log(`🔧 Formatos: ${formats.inputFormat} → ${formats.outputFormat}`);
    } catch (error) {
      console.error('❌ Error determinando formatos:', error);
      return res.status(400).json({ 
        error: 'Formato de audio no soportado',
        details: error.message 
      });
    }

    // Verificar si FFmpeg está disponible
    const ffmpegAvailable = await audioProcessingSimple.checkFFmpegAvailability();
    
    // Procesar audio con FFmpeg o método simplificado
    let masteredBuffer;
    try {
      if (ffmpegAvailable) {
        console.log('🎵 Usando FFmpeg para masterización');
        if (formats.outputFormat === 'mp3') {
          masteredBuffer = await audioProcessing.masterAudioToMp3(inputBuffer);
        } else {
          masteredBuffer = await audioProcessing.masterAudioFile(inputBuffer, formats.inputFormat, formats.outputFormat);
        }
      } else {
        console.log('⚠️ FFmpeg no disponible, usando método simplificado');
        masteredBuffer = await audioProcessingSimple.masterAudioFileSimple(inputBuffer, formats.inputFormat, formats.outputFormat);
      }
      console.log(`✅ Audio masterizado: ${masteredBuffer.length} bytes`);
    } catch (error) {
      console.error('❌ Error procesando audio:', error);
      return res.status(500).json({ 
        error: 'Error procesando audio',
        details: error.message 
      });
    }

    if (action === 'create') {
      // Crear nuevo archivo masterizado
      const masteredName = fileData.name.replace(/\.(wav|mp3)$/i, '_mastered.$1');
      const masteredKey = `${uid}/${Date.now()}_${masteredName}`;

      // Subir archivo masterizado a B2
      await b2Service.uploadFileDirectly(masteredKey, masteredBuffer, formats.outputMime);

      // Crear registro en Firestore
      const newFileRef = admin.firestore().collection('files').doc();
      await newFileRef.set({
        id: newFileRef.id,
        userId: uid,
        name: masteredName,
        bucketKey: masteredKey,
        key: masteredKey,
        size: masteredBuffer.length,
        mime: formats.outputMime,
        parentId: fileData.parentId,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        // appCode eliminado
        originalFileId: fileId, // Referencia al archivo original
        mastered: true // Marcar como masterizado
      });

      // Actualizar cuota del usuario
      const userRef = admin.firestore().collection('users').doc(uid);
      await userRef.update({
        usedBytes: admin.firestore.FieldValue.increment(masteredBuffer.length)
      });

      console.log(`📁 Archivo masterizado creado: ${masteredName}`);

      res.json({
        success: true,
        message: 'Audio masterizado exitosamente',
        fileId: newFileRef.id,
        fileName: masteredName,
        fileSize: masteredBuffer.length,
        action: 'created'
      });

    } else if (action === 'replace') {
      // Reemplazar archivo original
      const oldSize = fileData.size;
      const newSize = masteredBuffer.length;

      // Subir archivo masterizado con la misma clave
      await b2Service.uploadFileDirectly(fileData.bucketKey, masteredBuffer, formats.outputMime);

      // Actualizar metadatos en Firestore
      await fileRef.update({
        size: newSize,
        mime: formats.outputMime,
        updatedAt: new Date(),
        mastered: true,
        masteredAt: new Date()
      });

      // Ajustar cuota del usuario
      const userRef = admin.firestore().collection('users').doc(uid);
      await userRef.update({
        usedBytes: admin.firestore.FieldValue.increment(newSize - oldSize)
      });

      console.log(`🔄 Archivo original reemplazado: ${fileData.name}`);

      res.json({
        success: true,
        message: 'Audio masterizado y reemplazado exitosamente',
        fileId: fileId,
        fileName: fileData.name,
        fileSize: newSize,
        action: 'replaced'
      });
    }

  } catch (error) {
    console.error('Error en masterización de audio:', error);
    
    // Manejar errores específicos de FFmpeg
    if (error.message.includes('FFmpeg') || error.message.includes('procesamiento')) {
      return res.status(500).json({ 
        error: 'Error de procesamiento de audio',
        details: 'El archivo podría estar corrupto o en formato no soportado'
      });
    }

    res.status(500).json({ 
      error: 'Error interno del servidor',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * Obtener información de un archivo de audio para masterización
 * GET /api/audio/info/:fileId
 */
router.get('/info/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    const { uid } = req.user;

    if (!fileId) {
      return res.status(400).json({ error: 'ID de archivo requerido' });
    }

    // Obtener archivo de Firestore
    const fileRef = admin.firestore().collection('files').doc(fileId);
    const fileDoc = await fileRef.get();

    if (!fileDoc.exists) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    const fileData = fileDoc.data();
    
    // Verificar propiedad
    if (fileData.userId !== uid) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    if (fileData.deletedAt) {
      return res.status(400).json({ error: 'Archivo eliminado' });
    }

    // Validar si es archivo de audio soportado
    const validation = audioProcessing.validateAudioFile(fileData.mime, fileData.size);
    
    res.json({
      fileId: fileId,
      fileName: fileData.name,
      fileSize: fileData.size,
      mimeType: fileData.mime,
      canMaster: validation.isValid,
      error: validation.error,
      isMastered: fileData.mastered || false
    });

  } catch (error) {
    console.error('Error obteniendo info de audio:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * Test FFmpeg availability
 * GET /api/audio/test-ffmpeg
 */
router.get('/test-ffmpeg', async (req, res) => {
  try {
    const ffmpeg = require('fluent-ffmpeg');
    
    // Test FFmpeg availability
    ffmpeg.getAvailableFormats((err, formats) => {
      if (err) {
        console.error('❌ FFmpeg not available:', err);
        return res.status(500).json({ 
          error: 'FFmpeg no disponible',
          details: err.message 
        });
      }
      
      console.log('✅ FFmpeg disponible');
      res.json({
        success: true,
        message: 'FFmpeg está disponible',
        formats: Object.keys(formats).slice(0, 10) // Primeros 10 formatos
      });
    });
    
  } catch (error) {
    console.error('❌ Error testing FFmpeg:', error);
    res.status(500).json({ 
      error: 'Error verificando FFmpeg',
      details: error.message 
    });
  }
});

module.exports = router;
