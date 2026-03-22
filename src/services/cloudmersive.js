class CloudmersiveService {
  constructor() {
    this.apiKey = process.env.CLOUDMERSIVE_API_KEY;
    
    // Verificar si los módulos están instalados
    let Cloudmersive, CloudmersiveOCR, CloudmersiveConvert;
    
    try {
      Cloudmersive = require('cloudmersive-virus-api-client');
      CloudmersiveOCR = require('cloudmersive-ocr-api-client');
      CloudmersiveConvert = require('cloudmersive-convert-api-client');
    } catch (error) {
      console.warn('⚠️ Módulos de Cloudmersive no instalados. Cloudmersive features will be disabled.');
      this.enabled = false;
      this.apiKey = null;
      this.virusApi = null;
      this.ocrApi = null;
      this.convertApi = null;
      return;
    }
    
    if (!this.apiKey) {
      console.warn('⚠️ CLOUDMERSIVE_API_KEY not configured. Cloudmersive features will be disabled.');
      this.enabled = false;
      return;
    }
    
    this.enabled = true;
    
    try {
      // Virus API
      this.virusApi = new Cloudmersive.ScanApi();
      this.virusApi.apiClient.authentications['Apikey'].apiKey = this.apiKey;
      
      // OCR API
      this.ocrApi = new CloudmersiveOCR.ImageOcrApi();
      this.ocrApi.apiClient.authentications['Apikey'].apiKey = this.apiKey;
      
      // Convert API
      this.convertApi = new CloudmersiveConvert.ConvertDocumentApi();
      this.convertApi.apiClient.authentications['Apikey'].apiKey = this.apiKey;
      
      console.log('✅ Cloudmersive service initialized');
    } catch (error) {
      console.warn('⚠️ Error inicializando Cloudmersive:', error.message);
      this.enabled = false;
    }
  }

  // Virus Scan
  async scanVirus(fileBuffer) {
    if (!this.enabled) {
      throw new Error('Cloudmersive API key not configured');
    }
    
    const result = await this.virusApi.scanFile(fileBuffer);
    return {
      clean: result.CleanResult,
      virusName: result.FoundViruses?.[0]?.VirusName || null,
      scannedAt: new Date()
    };
  }

  // OCR
  async extractText(fileBuffer, mimeType = 'image/jpeg') {
    if (!this.enabled) {
      throw new Error('Cloudmersive API key not configured');
    }
    
    let result;
    
    // Usar método apropiado según tipo de archivo
    if (mimeType === 'application/pdf') {
      // Para PDFs usar el método específico
      result = await this.ocrApi.imageOcrPdfToText(fileBuffer);
    } else {
      // Para imágenes usar el método de fotos
      result = await this.ocrApi.imageOcrPhotoToText(fileBuffer);
    }
    
    return {
      text: result.TextResult || '',
      confidence: result.MeanConfidenceLevel || 0,
      processedAt: new Date()
    };
  }

  // Conversiones
  async convertDocxToPdf(fileBuffer) {
    if (!this.enabled) {
      throw new Error('Cloudmersive API key not configured');
    }
    
    return await this.convertApi.convertDocumentDocxToPdf(fileBuffer);
  }

  async convertXlsxToPdf(fileBuffer) {
    if (!this.enabled) {
      throw new Error('Cloudmersive API key not configured');
    }
    
    return await this.convertApi.convertDocumentXlsxToPdf(fileBuffer);
  }

  async convertPptxToPdf(fileBuffer) {
    if (!this.enabled) {
      throw new Error('Cloudmersive API key not configured');
    }
    
    return await this.convertApi.convertDocumentPptxToPdf(fileBuffer);
  }

  // Detectar si archivo es sospechoso
  isSuspiciousFile(fileName, fileSize, mimeType) {
    const suspiciousExts = ['.exe', '.bat', '.cmd', '.sh', '.app', '.dmg', 
                           '.apk', '.jar', '.zip', '.rar', '.7z', '.iso'];
    const ext = fileName.toLowerCase().slice(fileName.lastIndexOf('.'));
    
    return suspiciousExts.includes(ext) || fileSize > 50_000_000; // >50MB
  }

  // Detectar si imagen necesita conversión automática
  needsAutoConversion(fileName, fileSize, mimeType) {
    const ext = fileName.toLowerCase().slice(fileName.lastIndexOf('.'));
    
    // HEIC siempre convertir
    if (ext === '.heic' || mimeType === 'image/heic') return true;
    
    // PNG grandes (>5MB) convertir a JPEG
    if ((ext === '.png' || mimeType === 'image/png') && fileSize > 5_000_000) return true;
    
    return false;
  }
}

// Exportar instancia singleton
module.exports = new CloudmersiveService();

