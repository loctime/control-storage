const ffmpeg = require('fluent-ffmpeg');
const { Readable } = require('stream');

/**
 * Servicio de procesamiento de audio con FFmpeg
 * Proporciona funciones para masterizar archivos de audio
 */

/**
 * Masteriza un archivo de audio usando FFmpeg con loudnorm
 * @param {Buffer} inputBuffer - Buffer del archivo de audio de entrada
 * @param {string} inputFormat - Formato de entrada (wav, mp3)
 * @param {string} outputFormat - Formato de salida (wav, mp3)
 * @returns {Promise<Buffer>} - Buffer del archivo masterizado
 */
async function masterAudioFile(inputBuffer, inputFormat = 'wav', outputFormat = 'wav') {
  return new Promise((resolve, reject) => {
    const chunks = [];
    
    // Crear stream de entrada desde el buffer
    const inputStream = new Readable();
    inputStream.push(inputBuffer);
    inputStream.push(null);
    
    // Configuración de loudnorm para masterización
    // -14 LUFS: Estándar de streaming (Spotify, YouTube)
    // -1.5 dB True Peak: Evita clipping
    // 11 LU LRA: Rango dinámico apropiado
    const loudnormFilter = 'loudnorm=I=-14:TP=-1.5:LRA=11';
    
    console.log(`🎵 Iniciando masterización: ${inputFormat} → ${outputFormat}`);
    console.log(`📊 Buffer size: ${inputBuffer.length} bytes`);
    
    ffmpeg(inputStream)
      .inputFormat(inputFormat)
      .audioFilters(loudnormFilter)
      .audioCodec('pcm_s16le') // Para WAV
      .format(outputFormat)
      .on('error', (err) => {
        console.error('❌ Error en FFmpeg:', err);
        reject(new Error(`Error de procesamiento: ${err.message}`));
      })
      .on('end', () => {
        console.log('✅ Masterización completada');
        resolve(Buffer.concat(chunks));
      })
      .on('progress', (progress) => {
        console.log(`⏳ Procesando: ${progress.percent}%`);
      })
      .stream()
      .on('data', (chunk) => {
        chunks.push(chunk);
      })
      .on('end', () => {
        resolve(Buffer.concat(chunks));
      });
  });
}

/**
 * Convierte un archivo MP3 masterizado a formato MP3
 * @param {Buffer} inputBuffer - Buffer del archivo de audio
 * @returns {Promise<Buffer>} - Buffer del archivo MP3 masterizado
 */
async function masterAudioToMp3(inputBuffer) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    
    const inputStream = new Readable();
    inputStream.push(inputBuffer);
    inputStream.push(null);
    
    const loudnormFilter = 'loudnorm=I=-14:TP=-1.5:LRA=11';
    
    ffmpeg(inputStream)
      .inputFormat('mp3')
      .audioFilters(loudnormFilter)
      .audioCodec('libmp3lame')
      .audioBitrate('320k') // Alta calidad
      .format('mp3')
      .on('error', (err) => {
        console.error('Error en FFmpeg MP3:', err);
        reject(new Error(`Error de procesamiento MP3: ${err.message}`));
      })
      .on('end', () => {
        console.log('Masterización MP3 completada');
        resolve(Buffer.concat(chunks));
      })
      .stream()
      .on('data', (chunk) => {
        chunks.push(chunk);
      })
      .on('end', () => {
        resolve(Buffer.concat(chunks));
      });
  });
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

module.exports = {
  masterAudioFile,
  masterAudioToMp3,
  validateAudioFile,
  getAudioFormats
};
