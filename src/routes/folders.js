/**
 * ⚠️ LEGACY PERMISIVO - Backend actual sin restricciones de contrato
 * 
 * Este archivo implementa el comportamiento LEGACY permisivo del backend.
 * Cualquier caller autenticado puede crear carpetas sin restricciones.
 * 
 * CONTRATO v1 (docs/docs_v2/03_CONTRATOS_TECNICOS/CONTRACT.md):
 * - Las apps NO pueden crear carpetas raíz (parentId=null)
 * - Las apps NO pueden crear carpetas visibles en navbar
 * - Las apps NO pueden auto-pinnear carpetas
 * - Solo ControlFile UI tiene autoridad sobre estructura visible
 * 
 * Estado: Preparado para validaciones futuras (marcadores agregados)
 * Compatibilidad: Mantiene comportamiento actual para no romper apps existentes
 */

const express = require('express');
const router = express.Router();
const admin = require('../firebaseAdmin');
const { getFolderDoc } = require('../services/metadata');
const { cacheFolders, invalidateCache } = require('../middleware/cache');
const { logger } = require('../utils/logger');
const { normalizeAppId } = require('../utils/app-ownership');
const { detectCallerType } = require('../services/contract-validators');
const { 
  recordRootFolderCreation, 
  recordSubfolderCreation, 
  recordTaskbarPin,
  getMetrics
} = require('../services/contract-metrics');
const { isEnabled } = require('../services/contract-feature-flags');

// ⚠️ LEGACY FIELD: metadata.source
// Este campo NO tiene valor contractual según CONTRACT.md v1
// No define UX, no define jerarquía, no debe ser usado por apps
// Se mantiene por compatibilidad pero será eliminado o redefinido en v2
/**
 * Whitelist de valores permitidos para metadata.source (LEGACY)
 * @deprecated Este campo no tiene valor contractual. No usar en nuevas implementaciones.
 */
const ALLOWED_SOURCES = ['navbar', 'taskbar'];

/**
 * ⚠️ LEGACY FUNCTION: Valida y normaliza metadata.source
 * 
 * Este campo es LEGACY y no tiene valor contractual.
 * Se mantiene por compatibilidad pero no debe usarse para determinar UX.
 * 
 * @deprecated No usar para determinar navbar vs taskbar. Ver CONTRACT.md
 */
function validateAndNormalizeSource(source) {
  if (!source || typeof source !== 'string') {
    return 'navbar';
  }
  
  const normalizedSource = source.trim().toLowerCase();
  
  if (ALLOWED_SOURCES.includes(normalizedSource)) {
    return normalizedSource;
  }
  
  // Si no está en la whitelist, retornar default seguro
  return 'navbar';
}

/**
 * POST /api/folders/create
 * 
 * ⚠️ LEGACY PERMISIVO: Actualmente permite crear carpetas sin restricciones
 * 
 * CONTRATO v1 - Validaciones futuras (NO implementadas todavía):
 * - ❌ Apps NO pueden crear carpetas raíz (parentId=null)
 * - ❌ Apps NO pueden crear carpetas visibles en navbar
 * - ✅ Solo ControlFile UI puede crear carpetas raíz
 * 
 * TODO: Agregar validación usando validateRootFolderCreation() cuando se active el contrato
 * TODO: Agregar validación usando validateSubfolderCreation() para subcarpetas
 * 
 * Punto de validación futuro: Línea ~49 (después de validar name)
 */
router.post('/create', invalidateCache('create'), async (req, res) => {
  try {
    const { 
      name, 
      parentId, 
      id, 
      icon, 
      color, 
      description, 
      tags, 
      isPublic, 
      customFields,
      source 
    } = req.body;
    const { uid } = req.user;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Nombre de carpeta requerido' });
    }

    // 🔍 SOFT ENFORCEMENT: Instrumentación y logging (sin bloquear)
    const callerInfo = detectCallerType(req);
    const isRootFolder = parentId === null || parentId === undefined;
    
    // Logging estructurado para análisis
    if (isEnabled('CONTRACT_SOFT_ENFORCEMENT_ENABLED')) {
      if (isRootFolder) {
        // Violación potencial: App creando carpeta raíz
        logger.warn('CONTRACT_VIOLATION_WARNING', {
          event: 'CONTRACT_VIOLATION_WARNING',
          type: 'ROOT_FOLDER_CREATION',
          callerType: callerInfo.callerType,
          appId: callerInfo.appId,
          userId: uid,
          endpoint: 'POST /api/folders/create',
          parentId: null,
          folderName: name.trim(),
          detectionMethod: callerInfo.detectionMethod,
          confidence: callerInfo.confidence,
          signals: callerInfo.signals,
          timestamp: new Date().toISOString()
        });
        
        // Registrar métrica
        recordRootFolderCreation({
          callerType: callerInfo.callerType,
          appId: callerInfo.appId,
          userId: uid,
          folderId: null // Aún no creado
        });
      } else {
        // Subcarpeta: verificar si está fuera de app root (futuro)
        // Por ahora solo logueamos
        logger.info('SUBFOLDER_CREATION', {
          event: 'SUBFOLDER_CREATION',
          callerType: callerInfo.callerType,
          appId: callerInfo.appId,
          userId: uid,
          endpoint: 'POST /api/folders/create',
          parentId: parentId,
          folderName: name.trim(),
          detectionMethod: callerInfo.detectionMethod,
          timestamp: new Date().toISOString()
        });
        
        // Registrar métrica (outsideAppRoot será false por ahora)
        recordSubfolderCreation({
          callerType: callerInfo.callerType,
          appId: callerInfo.appId,
          userId: uid,
          folderId: null,
          parentId: parentId,
          outsideAppRoot: false // TODO: Verificar cuando se implemente folderBelongsToApp
        });
      }
    }

    // ⚠️ PUNTO DE VALIDACIÓN FUTURA (CONTRATO v1)
    // TODO: Descomentar cuando se active el contrato:
    // const { validateRootFolderCreation, validateSubfolderCreation } = require('../services/contract-validators');
    // if (parentId === null) {
    //   const rootValidation = validateRootFolderCreation(req, parentId);
    //   if (!rootValidation.allowed) {
    //     return res.status(403).json({ error: rootValidation.reason });
    //   }
    // } else {
    //   const subfolderValidation = await validateSubfolderCreation(req, parentId);
    //   if (!subfolderValidation.allowed) {
    //     return res.status(403).json({ error: subfolderValidation.reason });
    //   }
    // }

    // Generate folder ID or use provided one
    const folderId = id && typeof id === 'string' && id.trim().length > 0
      ? id
      : `main-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Generate slug
    const baseSlug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');
    let slug = baseSlug;
    
    // Check for slug uniqueness within the same parent
    const filesCol = admin.firestore().collection('files');
    let counter = 1;
    while (true) {
      const existingQuery = await filesCol
        .where('userId', '==', uid)
        .where('parentId', '==', parentId || null)
        .where('slug', '==', slug)
        .where('type', '==', 'folder')
        .limit(1)
        .get();
      
      if (existingQuery.empty) break;
      slug = `${baseSlug}-${counter}`;
      counter++;
    }
    
    // Calculate path + ancestors
    let path = `/${slug}`;
    let ancestors = [];
    if (parentId) {
      const parent = await getFolderDoc(parentId);
      if (parent) {
        path = `${parent.data.path}${path}`;
        ancestors = Array.isArray(parent.data.ancestors) ? [...parent.data.ancestors, parentId] : [parentId];
      }
    }

    // Create folder in Firestore
    const folderRef = admin.firestore().collection('files').doc(folderId);
    await folderRef.set({
      id: folderId,
      userId: uid,
      name: name.trim(),
      slug: slug,
      parentId: parentId || null,
      path: path,
      ancestors,
      createdAt: new Date(),
      modifiedAt: new Date(),
      type: 'folder',
      metadata: {
        isMainFolder: !parentId,
        isDefault: false,
        icon: icon || 'Folder',
        color: color || 'text-purple-600',
        description: description || '',
        tags: Array.isArray(tags) ? tags : [],
        isPublic: Boolean(isPublic),
        viewCount: 0,
        lastAccessedAt: new Date(),
        permissions: {
          canEdit: true,
          canDelete: true,
          canShare: true,
          canDownload: true
        },
        customFields: customFields || {},
        // ⚠️ LEGACY FIELD: metadata.source no tiene valor contractual
        source: validateAndNormalizeSource(source)
      }
    });

    // 🔍 SOFT ENFORCEMENT: Actualizar métricas con folderId real después de crear
    if (isEnabled('CONTRACT_SOFT_ENFORCEMENT_ENABLED')) {
      if (isRootFolder) {
        // Re-registrar con folderId real (la métrica anterior tenía folderId=null)
        recordRootFolderCreation({
          callerType: callerInfo.callerType,
          appId: callerInfo.appId,
          userId: uid,
          folderId: folderId
        });
      } else {
        // Re-registrar subcarpeta con folderId real
        recordSubfolderCreation({
          callerType: callerInfo.callerType,
          appId: callerInfo.appId,
          userId: uid,
          folderId: folderId,
          parentId: parentId,
          outsideAppRoot: false // TODO: Verificar cuando se implemente folderBelongsToApp
        });
      }
    }

    res.json({ 
      success: true, 
      folderId: folderId,
      slug: slug,
      path: path,
      message: 'Carpeta creada exitosamente'
    });

  } catch (error) {
    logger.error('Error creating folder', { error: error.message, userId: req.user?.uid });
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/folders/by-slug/:username/:path
router.get('/by-slug/:username/:path(*)', async (req, res) => {
  try {
    const { username, path } = req.params;
    const { uid } = req.user;

    if (!username || !path) {
      return res.status(400).json({ error: 'Username y path requeridos' });
    }

    // Parse the path to get slug segments
    const pathSegments = path.split('/').filter(segment => segment.trim() !== '');
    
    if (pathSegments.length === 0) {
      return res.status(400).json({ error: 'Path inválido' });
    }

    // Find the user by username
    const usersCol = admin.firestore().collection('users');
    const userQuery = await usersCol
      .where('username', '==', username)
      .limit(1)
      .get();

    if (userQuery.empty) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const userDoc = userQuery.docs[0];
    const targetUserId = userDoc.id;

    // Check if the folder is public or if user is the owner
    if (targetUserId !== uid) {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    // Navigate through the path to find the target folder
    let currentParentId = null;
    let currentFolder = null;

    for (const slug of pathSegments) {
      const filesCol = admin.firestore().collection('files');
      const folderQuery = await filesCol
        .where('userId', '==', targetUserId)
        .where('parentId', '==', currentParentId)
        .where('slug', '==', slug)
        .where('type', '==', 'folder')
        .limit(1)
        .get();

      if (folderQuery.empty) {
        return res.status(404).json({ error: 'Carpeta no encontrada' });
      }

      currentFolder = folderQuery.docs[0].data();
      currentParentId = currentFolder.id;
    }

    // Update view count
    if (currentFolder) {
      const folderRef = admin.firestore().collection('files').doc(currentFolder.id);
      await folderRef.update({
        'metadata.viewCount': (currentFolder.metadata?.viewCount || 0) + 1,
        'metadata.lastAccessedAt': new Date()
      });
    }

    res.json({
      success: true,
      folder: currentFolder
    });

  } catch (error) {
    logger.error('Error getting folder by slug', { error: error.message, username: req.params.username, path: req.params.path });
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * Helper: Busca o crea una carpeta raíz por nombre
 * Reutiliza lógica de GET /api/folders/root
 * 
 * ⚠️ LEGACY PERMISIVO: Actualmente permite crear carpetas raíz sin restricciones
 * 
 * CONTRATO v1 - Validaciones futuras (NO implementadas todavía):
 * - Este helper será usado por ControlFile UI para crear carpetas navbar
 * - Las apps NO deben usar este helper directamente
 * - Las apps deben usar POST /api/apps/:appId/root (futuro)
 * 
 * TODO: Agregar validación de caller type cuando se active el contrato
 * TODO: Este helper NO debe establecer metadata.source (campo legacy)
 * 
 * @param {string} uid - User ID
 * @param {string} name - Folder name
 * @param {Object} req - Express request object (opcional, para instrumentación)
 */
async function ensureRootFolder(uid, name, req = null) {
  const filesCol = admin.firestore().collection('files');
  
  // Buscar raíz existente
  const existingSnap = await filesCol
    .where('userId', '==', uid)
    .where('parentId', '==', null)
    .where('name', '==', name)
    .where('type', '==', 'folder')
    .limit(1)
    .get();

  if (!existingSnap.empty) {
    const doc = existingSnap.docs[0];
    return { folderId: doc.id, folderData: doc.data() };
  }

  // 🔍 SOFT ENFORCEMENT: Instrumentación si req está disponible
  let callerInfo = null;
  if (req && isEnabled('CONTRACT_SOFT_ENFORCEMENT_ENABLED')) {
    callerInfo = detectCallerType(req);
    
    logger.warn('CONTRACT_VIOLATION_WARNING', {
      event: 'CONTRACT_VIOLATION_WARNING',
      type: 'ROOT_FOLDER_CREATION_VIA_HELPER',
      callerType: callerInfo.callerType,
      appId: callerInfo.appId,
      userId: uid,
      helper: 'ensureRootFolder',
      folderName: name,
      detectionMethod: callerInfo.detectionMethod,
      confidence: callerInfo.confidence,
      signals: callerInfo.signals,
      timestamp: new Date().toISOString()
    });
  }

  // Crear si no existe (reutiliza lógica de /root)
  const generatedId = `main-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const folderRef = filesCol.doc(generatedId);
  const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');
  const path = `/${slug}`;
  
  const doc = {
    id: generatedId,
    userId: uid,
    name,
    slug: slug,
    parentId: null,
    path,
    ancestors: [],
    createdAt: new Date(),
    modifiedAt: new Date(),
    type: 'folder',
    metadata: {
      isMainFolder: true,
      isDefault: true,
      icon: 'Folder',
      color: 'text-purple-600',
      description: '',
      tags: [],
      isPublic: false,
      viewCount: 0,
      lastAccessedAt: new Date(),
      permissions: {
        canEdit: true,
        canDelete: true,
        canShare: true,
        canDownload: true
      },
      customFields: {}
      // ⚠️ NOTA: No establecemos metadata.source aquí (campo legacy)
      // Las carpetas creadas por ensureRootFolder son para navbar (ControlFile UI)
    },
  };

  await folderRef.set(doc);
  
  // 🔍 SOFT ENFORCEMENT: Registrar métrica después de crear
  if (req && callerInfo && isEnabled('CONTRACT_SOFT_ENFORCEMENT_ENABLED')) {
    recordRootFolderCreation({
      callerType: callerInfo.callerType,
      appId: callerInfo.appId,
      userId: uid,
      folderId: generatedId
    });
  }
  
  return { folderId: generatedId, folderData: doc };
}

/**
 * Helper: Busca o crea una carpeta por slug dentro de un parent
 * Reutiliza lógica de GET /api/folders/by-slug y POST /api/folders/create
 * 
 * ⚠️ LEGACY PERMISIVO: Actualmente permite crear subcarpetas sin restricciones
 * 
 * CONTRATO v1 - Validaciones futuras (NO implementadas todavía):
 * - Las apps solo pueden crear subcarpetas dentro de su app root
 * - Debe validar que el parent pertenece a la app del caller
 * 
 * TODO: Agregar validación usando folderBelongsToApp() cuando se active el contrato
 * TODO: El hardcodeo de source: 'navbar' es legacy y debe eliminarse
 * 
 * @param {string} uid - User ID
 * @param {string} slug - Folder slug
 * @param {string} parentId - Parent folder ID
 * @param {Object} req - Express request object (opcional, para instrumentación)
 */
async function ensureFolderBySlug(uid, slug, parentId, req = null) {
  const filesCol = admin.firestore().collection('files');
  
  // Buscar carpeta existente
  const existingQuery = await filesCol
    .where('userId', '==', uid)
    .where('parentId', '==', parentId)
    .where('slug', '==', slug)
    .where('type', '==', 'folder')
    .limit(1)
    .get();

  if (!existingQuery.empty) {
    const doc = existingQuery.docs[0];
    return { folderId: doc.id, folderData: doc.data() };
  }

  // 🔍 SOFT ENFORCEMENT: Instrumentación si req está disponible
  let callerInfo = null;
  if (req && isEnabled('CONTRACT_SOFT_ENFORCEMENT_ENABLED')) {
    callerInfo = detectCallerType(req);
    
    logger.info('SUBFOLDER_CREATION_VIA_HELPER', {
      event: 'SUBFOLDER_CREATION_VIA_HELPER',
      callerType: callerInfo.callerType,
      appId: callerInfo.appId,
      userId: uid,
      helper: 'ensureFolderBySlug',
      slug: slug,
      parentId: parentId,
      detectionMethod: callerInfo.detectionMethod,
      timestamp: new Date().toISOString()
    });
  }

  // Crear si no existe (reutiliza lógica de /create)
  const folderId = `main-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  // Calcular path y ancestors
  let path = `/${slug}`;
  let ancestors = [];
  if (parentId) {
    const parent = await getFolderDoc(parentId);
    if (parent) {
      path = `${parent.data.path}${path}`;
      ancestors = Array.isArray(parent.data.ancestors) ? [...parent.data.ancestors, parentId] : [parentId];
    }
  }

  const folderRef = filesCol.doc(folderId);
  await folderRef.set({
    id: folderId,
    userId: uid,
    name: slug, // Usar slug como nombre por defecto
    slug: slug,
    parentId: parentId || null,
    path: path,
    ancestors,
    createdAt: new Date(),
    modifiedAt: new Date(),
    type: 'folder',
    metadata: {
      isMainFolder: !parentId,
      isDefault: false,
      icon: 'Folder',
      color: 'text-purple-600',
      description: '',
      tags: [],
      isPublic: false,
      viewCount: 0,
      lastAccessedAt: new Date(),
      permissions: {
        canEdit: true,
        canDelete: true,
        canShare: true,
        canDownload: true
      },
      customFields: {},
      // ⚠️ LEGACY: Hardcodeo de source es incorrecto según CONTRACT.md
      // Este campo no tiene valor contractual y debe eliminarse en v2
      source: 'navbar'
    }
  });

  // 🔍 SOFT ENFORCEMENT: Registrar métrica después de crear
  if (req && callerInfo && isEnabled('CONTRACT_SOFT_ENFORCEMENT_ENABLED')) {
    recordSubfolderCreation({
      callerType: callerInfo.callerType,
      appId: callerInfo.appId,
      userId: uid,
      folderId: folderId,
      parentId: parentId,
      outsideAppRoot: false // TODO: Verificar cuando se implemente folderBelongsToApp
    });
  }

  return { folderId, folderData: await folderRef.get().then(doc => doc.data()) };
}

/**
 * Endpoint de compatibilidad SDK
 * GET /api/folders?path=controldoc/perfil
 * 
 * ⚠️ LEGACY PERMISIVO: Actualmente permite crear carpetas raíz desde SDK
 * 
 * CONTRATO v1 - Cambios futuros:
 * - Las apps NO deben usar este endpoint directamente para crear carpetas raíz
 * - Las apps deben usar POST /api/apps/:appId/root (futuro)
 * - Este endpoint será refactorizado para usar ensureAppRootFolder()
 * 
 * IMPORTANTE: userId se obtiene SIEMPRE de req.user (token), NO de query params
 * 
 * TODO: Refactorizar para usar ensureAppRootFolder() cuando se implemente
 * TODO: Agregar validación de caller type cuando se active el contrato
 */
router.get('/', async (req, res) => {
  try {
    const { uid } = req.user;
    const pathParam = req.query.path || req.query.name || '';
    
    if (!uid) {
      return res.status(401).json({ error: 'No autorizado' });
    }

    // Si no hay path o es solo un nombre, usar lógica de /root
    if (!pathParam || pathParam.trim() === '') {
      // Si no hay path, buscar o crear carpeta raíz con nombre por defecto
      const defaultName = (req.query.name || 'ControlAudit').toString().trim();
      if (!defaultName) {
        return res.status(400).json({ error: 'Path o name requerido' });
      }
      
      const { folderId } = await ensureRootFolder(uid, defaultName, req);
      return res.json({ folderId });
    }

    // Parsear path en segmentos
    const pathSegments = pathParam.split('/').filter(segment => segment.trim() !== '');
    
    if (pathSegments.length === 0) {
      return res.status(400).json({ error: 'Path inválido' });
    }

    // Navegar/crear cada segmento del path
    let currentParentId = null;
    let currentFolderId = null;

    for (const segment of pathSegments) {
      const slug = segment.toLowerCase().trim();
      
      if (!slug) {
        continue; // Saltar segmentos vacíos
      }

      if (currentParentId === null) {
        // ⚠️ PUNTO DE CAMBIO FUTURO (CONTRATO v1)
        // Primer segmento: buscar o crear carpeta raíz
        // TODO: Si es una app, usar ensureAppRootFolder() en lugar de ensureRootFolder()
        // TODO: Si es ControlFile UI, mantener ensureRootFolder()
        const { folderId } = await ensureRootFolder(uid, segment, req);
        currentParentId = folderId;
        currentFolderId = folderId;
      } else {
        // Segmentos siguientes: buscar o crear dentro del parent
        // TODO: Agregar validación de que el parent pertenece a la app cuando se active el contrato
        const { folderId } = await ensureFolderBySlug(uid, slug, currentParentId, req);
        currentParentId = folderId;
        currentFolderId = folderId;
      }
    }

    return res.json({ folderId: currentFolderId });

  } catch (error) {
    logger.error('Error in GET /api/folders (SDK compatibility)', { 
      error: error.message, 
      userId: req.user?.uid,
      path: req.query.path 
    });
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * Endpoint de compatibilidad SDK (POST)
 * POST /api/folders
 *
 * ⚠️ LEGACY PERMISIVO: Actualmente permite crear carpetas raíz desde SDK
 * 
 * CONTRATO v1 - Cambios futuros:
 * - Las apps NO deben usar este endpoint directamente para crear carpetas raíz
 * - Las apps deben usar POST /api/apps/:appId/root (futuro)
 * - Este endpoint será refactorizado para usar ensureAppRootFolder()
 * 
 * El SDK espera este endpoint para ensurePath.
 * Internamente delega a la misma lógica que GET /api/folders
 * 
 * TODO: Refactorizar para usar ensureAppRootFolder() cuando se implemente
 * TODO: Agregar validación de caller type cuando se active el contrato
 */
router.post('/', async (req, res) => {
  try {
    const { uid } = req.user;
    const pathParam = req.body?.path || req.body?.name || '';

    if (!uid) {
      return res.status(401).json({ error: 'No autorizado' });
    }

    if (!pathParam || typeof pathParam !== 'string') {
      return res.status(400).json({ error: 'Path requerido' });
    }

    const pathSegments = pathParam.split('/').filter(Boolean);

    let currentParentId = null;
    let currentFolderId = null;

    for (const segment of pathSegments) {
      const slug = segment
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^\w-]/g, '');

      if (!slug) continue;

      if (currentParentId === null) {
        // ⚠️ PUNTO DE CAMBIO FUTURO (CONTRATO v1)
        // TODO: Si es una app, usar ensureAppRootFolder() en lugar de ensureRootFolder()
        // TODO: Si es ControlFile UI, mantener ensureRootFolder()
        const { folderId } = await ensureRootFolder(uid, segment, req);
        currentParentId = folderId;
        currentFolderId = folderId;
      } else {
        // TODO: Agregar validación de que el parent pertenece a la app cuando se active el contrato
        const { folderId } = await ensureFolderBySlug(uid, slug, currentParentId, req);
        currentParentId = folderId;
        currentFolderId = folderId;
      }
    }

    return res.json({ folderId: currentFolderId });

  } catch (error) {
    logger.error('Error in POST /api/folders (SDK compatibility)', {
      error: error.message,
      userId: req.user?.uid,
    });
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * GET /api/folders/root?name=ControlAudit&pin=1
 * 
 * ⚠️ LEGACY PERMISIVO: Actualmente permite crear carpetas raíz y pin opcional
 * 
 * CONTRATO v1 - Validaciones futuras (NO implementadas todavía):
 * - Solo ControlFile UI puede crear carpetas raíz (navbar)
 * - Solo ControlFile UI puede hacer pin en taskbar
 * - Las apps NO pueden usar este endpoint directamente
 * 
 * TODO: Agregar validación usando validateRootFolderCreation() cuando se active el contrato
 * TODO: Agregar validación usando validateTaskbarPin() para el parámetro pin
 */
router.get('/root', async (req, res) => {
  try {
    const { uid } = req.user;
    const rawName = (req.query.name || 'ControlAudit').toString();
    const name = rawName.trim();
    const shouldPin = String(req.query.pin || '0') === '1';

    if (!name) {
      return res.status(400).json({ error: 'Nombre inválido' });
    }

    // 🔍 SOFT ENFORCEMENT: Instrumentación y logging (sin bloquear)
    const callerInfo = detectCallerType(req);
    
    if (isEnabled('CONTRACT_SOFT_ENFORCEMENT_ENABLED')) {
      // Logging de creación de carpeta raíz
      logger.warn('CONTRACT_VIOLATION_WARNING', {
        event: 'CONTRACT_VIOLATION_WARNING',
        type: 'ROOT_FOLDER_CREATION',
        callerType: callerInfo.callerType,
        appId: callerInfo.appId,
        userId: uid,
        endpoint: 'GET /api/folders/root',
        folderName: name,
        shouldPin: shouldPin,
        detectionMethod: callerInfo.detectionMethod,
        confidence: callerInfo.confidence,
        signals: callerInfo.signals,
        timestamp: new Date().toISOString()
      });
      
      // Logging de pin en taskbar si aplica
      if (shouldPin) {
        logger.warn('CONTRACT_VIOLATION_WARNING', {
          event: 'CONTRACT_VIOLATION_WARNING',
          type: 'TASKBAR_PIN',
          callerType: callerInfo.callerType,
          appId: callerInfo.appId,
          userId: uid,
          endpoint: 'GET /api/folders/root',
          folderName: name,
          detectionMethod: callerInfo.detectionMethod,
          confidence: callerInfo.confidence,
          signals: callerInfo.signals,
          timestamp: new Date().toISOString()
        });
      }
    }

    const filesCol = admin.firestore().collection('files');

    // Buscar raíz por usuario + parentId null + nombre exacto
    const existingSnap = await filesCol
      .where('userId', '==', uid)
      .where('parentId', '==', null)
      .where('name', '==', name)
      .where('type', '==', 'folder')
      .limit(1)
      .get();

    let folderId;
    let folderData;

    if (!existingSnap.empty) {
      const d = existingSnap.docs[0];
      folderId = d.id;
      folderData = d.data();
    } else {
      // Crear si no existe
      const generatedId = `main-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const folderRef = filesCol.doc(generatedId);

      const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');
      const path = `/${slug}`;
      const doc = {
        id: generatedId,
        userId: uid,
        name,
        slug: slug,
        parentId: null,
        path,
        ancestors: [],
        createdAt: new Date(),
        modifiedAt: new Date(),
        type: 'folder',
        metadata: {
          isMainFolder: true,
          isDefault: true,
          icon: 'Folder',
          color: 'text-purple-600',
          description: '',
          tags: [],
          isPublic: false,
          viewCount: 0,
          lastAccessedAt: new Date(),
          permissions: {
            canEdit: true,
            canDelete: true,
            canShare: true,
            canDownload: true
          },
          customFields: {}
        },
      };

      await folderRef.set(doc);
      folderId = generatedId;
      folderData = doc;
    }

    // 🔍 SOFT ENFORCEMENT: Registrar métricas después de crear carpeta
    if (isEnabled('CONTRACT_SOFT_ENFORCEMENT_ENABLED')) {
      recordRootFolderCreation({
        callerType: callerInfo.callerType,
        appId: callerInfo.appId,
        userId: uid,
        folderId: folderId
      });
    }

    // ⚠️ PUNTO DE VALIDACIÓN FUTURA (CONTRATO v1)
    // Pin opcional en barra de tareas
    // TODO: Descomentar cuando se active el contrato:
    // const { validateTaskbarPin } = require('../services/contract-validators');
    // if (shouldPin) {
    //   const pinValidation = validateTaskbarPin(req);
    //   if (!pinValidation.allowed) {
    //     return res.status(403).json({ error: pinValidation.reason });
    //   }
    // }
    if (shouldPin) {
      // 🔍 SOFT ENFORCEMENT: Registrar métrica de pin
      if (isEnabled('CONTRACT_SOFT_ENFORCEMENT_ENABLED')) {
        recordTaskbarPin({
          callerType: callerInfo.callerType,
          appId: callerInfo.appId,
          userId: uid,
          folderId: folderId
        });
      }
      
      const settingsRef = admin.firestore().collection('userSettings').doc(uid);
      await admin.firestore().runTransaction(async (t) => {
        const s = await t.get(settingsRef);
        const current = s.exists ? (s.data() || {}) : {};
        const items = Array.isArray(current.taskbarItems) ? current.taskbarItems : [];
        const exists = items.some((it) => it && it.id === folderId);
        if (!exists) {
          items.push({
            id: folderId,
            name,
            icon: 'Folder',
            color: 'text-purple-600',
            type: 'folder',
            isCustom: true,
          });
          t.set(settingsRef, { taskbarItems: items, updatedAt: new Date() }, { merge: true });
        }
      });
    }

    return res.json({ folderId, folder: { id: folderId, ...folderData } });
  } catch (error) {
    logger.error('Error in GET /api/folders/root', { error: error.message, userId: req.user?.uid });
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

async function deleteFolderRecursive(db, userId, folderId) {
  const childrenSnapshot = await db
    .collection('files')
    .where('userId', '==', userId)
    .where('parentId', '==', folderId)
    .get();

  const fileChildren = [];
  const folderChildren = [];

  childrenSnapshot.forEach((doc) => {
    const data = doc.data() || {};
    if (data.type === 'folder') {
      folderChildren.push(doc.id);
    } else {
      fileChildren.push(doc.ref);
    }
  });

  if (fileChildren.length > 0) {
    const batch = db.batch();
    fileChildren.forEach((ref) => batch.delete(ref));
    await batch.commit();
  }

  for (const subFolderId of folderChildren) {
    await deleteFolderRecursive(db, userId, subFolderId);
  }

  await db.collection('files').doc(folderId).delete();
}

router.post('/permanent-delete', invalidateCache('delete'), async (req, res) => {
  try {
    const uid = req.user?.uid;
    const folderId = req.body?.folderId;

    if (!folderId || typeof folderId !== 'string') {
      return res.status(400).json({ error: 'ID de carpeta requerido' });
    }

    const db = admin.firestore();
    const folderRef = db.collection('files').doc(folderId);
    const folderDoc = await folderRef.get();

    if (!folderDoc.exists) {
      return res.json({ success: true, deletedFolderId: folderId, note: 'Carpeta no encontrada (idempotente)' });
    }

    const folderData = folderDoc.data() || {};
    if (folderData.userId !== uid) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    if (folderData.type !== 'folder') {
      return res.status(400).json({ error: 'El elemento no es una carpeta' });
    }

    await deleteFolderRecursive(db, uid, folderId);
    return res.json({ success: true, deletedFolderId: folderId });
  } catch (error) {
    logger.error('Error permanently deleting folder', { error: error.message, userId: req.user?.uid, folderId: req.body?.folderId });
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

router.post('/set-main', invalidateCache('update'), async (req, res) => {
  try {
    const uid = req.user?.uid;
    const folderId = req.body?.folderId;
    const appRaw = req.body?.app;

    if (!folderId || typeof folderId !== 'string') {
      return res.status(400).json({ error: 'folderId es requerido' });
    }
    if (!appRaw || !appRaw.id || typeof appRaw.id !== 'string' || !appRaw.id.trim()) {
      return res.status(400).json({ error: 'Missing app.id. Every folder or file must belong to an application.' });
    }

    const appId = normalizeAppId(appRaw.id);
    const db = admin.firestore();
    const folderRef = db.collection('files').doc(folderId);
    const folderDoc = await folderRef.get();

    if (!folderDoc.exists) {
      return res.status(404).json({ error: 'Carpeta no encontrada' });
    }

    const folderData = folderDoc.data() || {};
    if (folderData.userId !== uid) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    if (folderData.type !== 'folder') {
      return res.status(400).json({ error: 'El elemento no es una carpeta' });
    }
    if (!folderData.appId) {
      return res.status(400).json({ error: 'La carpeta no tiene appId. No se puede establecer como principal.' });
    }

    const folderAppId = normalizeAppId(folderData.appId);
    if (folderAppId !== appId) {
      return res.status(400).json({ error: `La carpeta pertenece a la app '${folderData.appId}', pero se solicito '${appRaw.id}'` });
    }

    const existingMainFolders = await db
      .collection('files')
      .where('userId', '==', uid)
      .where('appId', '==', appId)
      .where('type', '==', 'folder')
      .where('metadata.isMainFolder', '==', true)
      .get();

    await db.runTransaction(async (transaction) => {
      existingMainFolders.forEach((doc) => {
        if (doc.id !== folderId) {
          transaction.update(doc.ref, {
            'metadata.isMainFolder': false,
            updatedAt: new Date(),
          });
        }
      });

      transaction.update(folderRef, {
        'metadata.isMainFolder': true,
        updatedAt: new Date(),
      });
    });

    return res.json({
      success: true,
      message: 'Carpeta principal establecida exitosamente',
      folderId,
    });
  } catch (error) {
    logger.error('Error setting main folder', { error: error.message, userId: req.user?.uid, folderId: req.body?.folderId });
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});
module.exports = router;
