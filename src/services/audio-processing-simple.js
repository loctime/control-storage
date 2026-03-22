/**
 * Servicio de procesamiento de audio simplificado (sin FFmpeg)
 * Para testing y casos donde FFmpeg no esté disponible
 */

/**
 * Simula masterización de audio (solo para testing)
 * @param {Buffer} inputBuffer - Buffer del archivo de audio de entrada
 * @param {string} inputFormat - Formato de entrada (wav, mp3)
 * @param {string} outputFormat - Formato de salida (wav, mp3)
 * @returns {Promise<Buffer>} - Buffer del archivo "masterizado"
 */
async function masterAudioFileSimple(inputBuffer, inputFormat = 'wav', outputFormat = 'wav') {
  console.log(`🎵 [SIMULADO] Masterizando audio: ${inputFormat} → ${outputFormat}`);
  console.log(`📊 Buffer size: ${inputBuffer.length} bytes`);
  
  // Simular procesamiento con delay
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Para testing, simplemente retornamos el buffer original
  // En producción, aquí iría el procesamiento real con FFmpeg
  console.log(`✅ [SIMULADO] Masterización completada: ${inputBuffer.length} bytes`);
  
  return inputBuffer;
}

/**
 * Valida si un archivo de audio es soportado
 * @param {string} mimeType - Tipo MIME del archivo
 * @param {number} fileSize - Tamaño del archivo en bytes
 * @returns {Object} - { isValid: boolean, error?: string }
 */
function validateAudioFile(mimeType, fileSize) {
  const supportedTypes = [
    'audio/wav',
    'audio/wave',
    'audio/mpeg', // MP3
    'audio/mp3'
  ];
  
  const maxSize = 50 * 1024 * 1024; // 50MB
  
  if (!supportedTypes.includes(mimeType)) {
    return {
      isValid: false,
      error: 'Tipo de archivo no soportado. Solo WAV y MP3 son permitidos.'
    };
  }
  
  if (fileSize > maxSize) {
    return {
      isValid: false,
      error: 'Archivo demasiado grande. El límite es 50MB.'
    };
  }
  
  return { isValid: true };
}

/**
 * Determina el formato de salida basado en el tipo MIME de entrada
 * @param {string} mimeType - Tipo MIME del archivo de entrada
 * @returns {Object} - { inputFormat: string, outputFormat: string, outputMime: string }
 */
function getAudioFormats(mimeType) {
  if (mimeType.includes('wav')) {
    return {
      inputFormat: 'wav',
      outputFormat: 'wav',
      outputMime: 'audio/wav'
    };
  } else if (mimeType.includes('mpeg') || mimeType.includes('mp3')) {
    return {
      inputFormat: 'mp3',
      outputFormat: 'mp3',
      outputMime: 'audio/mpeg'
    };
  }
  
  throw new Error('Formato de audio no soportado');
}

/**
 * Verifica si FFmpeg está disponible
 * @returns {Promise<boolean>} - true si FFmpeg está disponible
 */
async function checkFFmpegAvailability() {
  try {
    const ffmpeg = require('fluent-ffmpeg');
    
    return new Promise((resolve) => {
      ffmpeg.getAvailableFormats((err, formats) => {
        if (err) {
          console.error('❌ FFmpeg no disponible:', err.message);
          resolve(false);
        } else {
          console.log('✅ FFmpeg disponible');
          resolve(true);
        }
      });
    });
  } catch (error) {
    console.error('❌ Error verificando FFmpeg:', error);
    return false;
  }
}

module.exports = {
  masterAudioFileSimple,
  validateAudioFile,
  getAudioFormats,
  checkFFmpegAvailability
};
