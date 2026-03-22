// backend/src/index.js
/**
 * ⚠️ LEGACY PERMISIVO - Backend actual sin restricciones de contrato
 * 
 * El backend actual mantiene comportamiento permisivo para compatibilidad.
 * Ver docs/docs_v2/03_CONTRATOS_TECNICOS/CONTRACT.md para el contrato v1.
 * 
 * Estado: Preparado para validaciones futuras (marcadores agregados en routes/folders.js)
 */
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const githubStatusRoutes = require('./routes/github-status');
const repositoryIndexRoutes = require('./routes/repository-index'); // Legacy - mantener por compatibilidad
const repositoriesRoutes = require('./routes/repositories'); // Nuevo endpoint rediseñado
const chatRoutes = require('./routes/chat'); // Endpoint de chat

const adminRoutes = require('./routes/admin');
const superdevRoutes = require('./routes/superdev');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Firebase Admin must be initialized before any route or middleware that uses Firestore/Auth
require('./firebaseAdmin');

const authMiddleware = require('./middleware/auth');
const superdevAuthMiddleware = require('./middleware/superdev-auth');
const uploadRoutes = require('./routes/upload');
const externalUploadRoutes = require('./routes/external-upload');
const filesRoutes = require('./routes/files');
const sharesRoutes = require('./routes/shares');
const healthRoutes = require('./routes/health');
const foldersRoutes = require('./routes/folders');
// const userRoutes = require('./routes/user'); // Archivo no existe
const usersRoutes = require('./routes/users');
const userRoutes = require('./routes/user');
const audioRoutes = require('./routes/audio');
const storesRoutes = require('./routes/stores/sheets');
const feedbackRoutes = require('./routes/feedback');
const accountsRoutes = require('./routes/accounts');
const platformRoutes = require('./routes/platform');
const billingRoutes = require('./routes/billing');
const controlfileRoutes = require('./routes/controlfile');
const horariosRoutes = require('./routes/horarios');
const publicHorariosRoutes = require('./routes/publicHorarios.routes');
const emailWebhookRoutes = require('./routes/emailWebhook');
const emailReceptorRoutes = require('./routes/email-receptor');
const emailAlertsRoutes = require('./routes/emailAlerts');
const debugAlertsRoutes = require('./routes/debugAlerts');
const emailUsersRoutes = require('./modules/emailUsers/emailUsers.routes');
const emailAlertsApiRoutes = require('./modules/emailAlerts/emailAlerts.routes');
const vehiclesRoutes = require('./modules/emailAlerts/vehicles.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const dashboardSummaryRoutes = require('./routes/dashboard');
const logisticsV2Routes = require('./modules/logistics/logistics.routes');
const trainingRoutes = require('./modules/training/training.routes');
const { getCacheStats, clearCache } = require('./middleware/cache');
const { logger } = require('./utils/logger');
const requestLogger = require('./middleware/request-logger');
const legacyDeprecation = require('./middleware/legacy-deprecation');

const app = express();
const PORT = process.env.PORT || 3001;
const isLocalMode = process.env.NODE_ENV !== 'production';

// Trust proxy for Render.com and other reverse proxies
app.set('trust proxy', 1);

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Demasiadas solicitudes desde esta IP, intenta de nuevo más tarde.'
  }
});

// CORS configuration MUST come before rate limiting to handle preflight requests
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
  : [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3002',
      'http://localhost:3003',
      'http://localhost:5173',
      'https://files.controldoc.app',
      'https://controldoc.app',
      'https://stock.controldoc.app',
      'https://horario.controldoc.app',
      'https://gastos.controldoc.app',
      'https://auditoria.controldoc.app',
      'https://repo.controldoc.app',
      'https://hise.controldoc.app'
    ];

logger.info('CORS allowed origins', { allowedOrigins });

// Centralized allowed headers for CORS (including SDK headers)
const allowedHeaders = [
  'Authorization',
  'Content-Type',
  'X-Requested-With',
  'X-SDK-Version',
  'X-SDK-Client',
  'x-idempotency-key',
  'x-request-id'
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      logger.debug('CORS allowed origin', { origin });
      callback(null, true);
    } else {
      logger.warn('CORS blocked origin', { origin });
      callback(null, false);
    }
  },
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: allowedHeaders,
  credentials: true,
  optionsSuccessStatus: 200,
  preflightContinue: false
};

// Apply CORS FIRST before any other middleware
app.use(cors(corsOptions));
// Handle all OPTIONS requests with CORS
app.options('*', cors(corsOptions));

// Now apply other middleware AFTER CORS
app.use(helmet());
app.use(compression());
app.use(limiter);
app.use(requestLogger);

// Body parsing middleware with logging
// IMPORTANTE: Debe estar ANTES de montar las rutas para que req.body esté disponible
// Límite de 25mb para soportar emails con attachments grandes
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Legacy API compatibility headers for sunset migration
app.use(legacyDeprecation);

// Debug middleware for all requests
app.use((req, res, next) => {
  if (req.path.startsWith('/api/uploads')) {
    logger.debug('Uploads debug', {
      path: req.path,
      method: req.method,
      origin: req.headers.origin,
      contentType: req.headers['content-type'],
    });
  }
  next();
});

// Health check route (no auth required) - disponible en /health y /api/health
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'controlfile',
    storage: 'backblaze',
    auth: 'firebase',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    version: '1.0.0'
  });
});
app.use('/api/health', healthRoutes);
app.use('/v1/health', healthRoutes);

// Test route without auth
app.post('/api/test-upload', (req, res) => {
  logger.info('Test upload endpoint', {
    headers: req.headers,
  });
  res.json({ 
    success: true, 
    body: req.body, 
    headers: req.headers 
  });
});

// External upload endpoint - POST /upload (sin /api) para aplicaciones externas
// Este es el endpoint único y oficial para subida de archivos desde apps externas
app.post('/upload', authMiddleware, externalUploadRoutes);
app.post('/v1/external/upload', authMiddleware, externalUploadRoutes);

// Protected routes with auth
app.use('/api/uploads', authMiddleware, (req, res, next) => {
  logger.debug('Uploads after auth', {
    method: req.method,
    contentType: req.headers['content-type'],
  });
  next();
}, uploadRoutes);
app.use('/v1/uploads', authMiddleware, uploadRoutes);

// GitHub endpoints
// ===== ControlRepo - GitHub =====
// NOTA: GitHub OAuth fue eliminado. Los repositorios se acceden por URL.
// Solo se mantiene /api/github/status como stub defensivo para compatibilidad.
app.use('/api/github', authMiddleware, githubStatusRoutes);

// Repository indexing endpoint - NO usa authMiddleware (viene desde ControlRepo)
// Legacy endpoint - mantener por compatibilidad temporal
app.use('/api/repository', repositoryIndexRoutes);

// Nuevos endpoints redise??ados - arquitectura limpia
// POST /repositories/index - Iniciar indexaci??n
// GET /repositories/:repositoryId/status - Estado del repositorio
app.use('/repositories', repositoriesRoutes);

// v1 canonical routes for repository workflows
app.use('/v1/repositories', repositoriesRoutes);

// Chat endpoint
// POST /api/chat/query - Consultas sobre repositorios indexados
app.use('/api/chat', chatRoutes);
app.use('/v1/chat', chatRoutes);

// Protected routes with auth
app.use('/api/files', authMiddleware, filesRoutes);
app.use('/v1/files', authMiddleware, filesRoutes);
app.use('/api/folders', authMiddleware, foldersRoutes);
app.use('/v1/folders', authMiddleware, foldersRoutes);
// app.use('/api/user', authMiddleware, userRoutes); // Ruta deshabilitada: no existe ./routes/user
app.use('/api/user', authMiddleware, userRoutes);
app.use('/v1/users', authMiddleware, userRoutes);
app.use('/api/users', authMiddleware, usersRoutes);
app.use('/v1/users', authMiddleware, usersRoutes);
app.use('/api/audio', authMiddleware, audioRoutes);
app.use('/v1/audio', authMiddleware, audioRoutes);
app.use('/api/stores', authMiddleware, storesRoutes);
app.use('/api/admin', authMiddleware, adminRoutes);
app.use('/v1/admin', authMiddleware, adminRoutes);
app.use('/api/feedback', authMiddleware, feedbackRoutes);
app.use('/api/accounts', authMiddleware, accountsRoutes);
app.use('/api/platform', authMiddleware, platformRoutes);
app.use('/v1/platform', authMiddleware, platformRoutes);
app.use('/api/billing', authMiddleware, billingRoutes);
app.use('/v1/billing', authMiddleware, billingRoutes);
app.use('/api/controlfile', authMiddleware, controlfileRoutes);
app.use('/v1/controlfile', authMiddleware, controlfileRoutes);
// P??blico: GET /api/horarios/publicos-completos?companySlug=... (sin auth)
app.use(publicHorariosRoutes);
app.use('/api/horarios', horariosRoutes);
app.use('/api', emailWebhookRoutes);
app.use('/api', emailReceptorRoutes);
app.use('/api', emailAlertsRoutes);
app.use('/api', debugAlertsRoutes);
app.use('/api', emailUsersRoutes);
app.use('/api', emailAlertsApiRoutes);
app.use('/api', vehiclesRoutes);
app.use('/api', authMiddleware, dashboardRoutes);
app.use('/api/dashboard', authMiddleware, dashboardSummaryRoutes);
app.use('/api/logistics/v2', authMiddleware, logisticsV2Routes);
app.use('/api/training', authMiddleware, trainingRoutes);
app.use('/v1/training', authMiddleware, trainingRoutes);

// Superdev routes - EXCLUSIVO para usuarios con role === 'superdev'
app.use('/api/superdev', superdevAuthMiddleware, superdevRoutes);
app.use('/v1/superdev', superdevAuthMiddleware, superdevRoutes);

// Shares routes - mixed public and protected
app.use('/api/shares', sharesRoutes);
app.use('/v1/shares', sharesRoutes);

// TanStack Cache endpoints
app.get('/api/cache/stats', authMiddleware, getCacheStats);
app.post('/api/cache/clear', authMiddleware, clearCache);
// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err, path: req.path });
  
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ 
      error: 'El archivo es demasiado grande',
      maxSize: '10MB'
    });
  }
  
  res.status(500).json({ 
    error: 'Error interno del servidor',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Algo salió mal'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

app.listen(PORT, () => {
  logger.info('ControlFile backend started', {
    port: PORT,
    env: process.env.NODE_ENV || 'development',
    firebaseProjectId: process.env.FIREBASE_PROJECT_ID || null,
  });
  console.log(`🚀 Servidor backend ejecutándose en puerto ${PORT}`);
  console.log(`📁 Entorno: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🏠 Modo local: ${isLocalMode ? 'activado' : 'desactivado'}`);
  console.log(`🔗 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
  console.log(`🔐 Firebase Project ID: ${process.env.FIREBASE_PROJECT_ID || 'NO CONFIGURADO'}`);
  console.log(`📦 B2 Bucket: ${process.env.B2_BUCKET_NAME || 'NO CONFIGURADO'}`);

  // Comprobar conectividad Firestore al arranque (solo en producción para detectar UNAUTHENTICATED pronto)
  if (process.env.NODE_ENV === 'production') {
    const admin = require('./firebaseAdmin');
    if (admin.apps.length) {
      admin.firestore().collection('apps').limit(1).get()
        .then(() => { logger.info('[Startup] Firestore: OK'); })
        .catch((e) => {
          const unauth = e && (e.code === 16 || (e.message && String(e.message).includes('UNAUTHENTICATED')));
          if (unauth) {
            logger.error('[Startup] Firestore UNAUTHENTICATED. La cuenta de servicio (FB_ADMIN_APPDATA o GOOGLE_SERVICE_ACCOUNT_KEY) debe ser del proyecto donde está Firestore y tener permisos. Revisa las variables en Render.');
          } else {
            logger.warn('[Startup] Firestore check failed:', e && e.message);
          }
        });
    }
  }
});

module.exports = app;


