const express = require('express');
const router = express.Router();
const admin = require('../firebaseAdmin');
const { logger } = require('../utils/logger');

/**
 * Obtiene la instancia de Auth central (authApp)
 */
function getCentralAuth() {
  try {
    return admin.app('authApp').auth();
  } catch (error) {
    throw new Error('Auth central no está inicializado');
  }
}

/**
 * GET /api/superdev/list-owners
 * 
 * SUPERDEV-ONLY: Listar todos los owners disponibles para impersonación
 * 
 * Requiere:
 * - role === 'superdev' (verificado por middleware)
 * 
 * Retorna:
 * - { owners: Array<{ uid: string; email: string | null; nombre: string | null }> }
 * 
 * Notas:
 * - Solo retorna owners válidos de la colección apps/auditoria/owners
 * - Email y nombre se obtienen desde Firebase Auth
 * - Si un owner no tiene cuenta en Auth, se omite de la lista
 */
router.get('/list-owners', async (req, res) => {
  try {
    const superdevUid = req.superdev.uid;
    const superdevEmail = req.superdev.email;

    // 1. Obtener todos los owners de Firestore
    const db = admin.firestore();
    const ownersSnapshot = await db
      .collection('apps')
      .doc('auditoria')
      .collection('owners')
      .get();

    // 2. Para cada owner, obtener email y nombre desde Firebase Auth
    const centralAuth = getCentralAuth();
    const owners = [];

    // Procesar owners en paralelo para mejor rendimiento
    const ownerPromises = ownersSnapshot.docs.map(async (ownerDoc) => {
      const ownerId = ownerDoc.id;
      const ownerData = ownerDoc.data();

      // Validar que sea un owner válido
      if (
        !ownerData ||
        ownerData.role !== 'admin' ||
        ownerData.ownerId !== ownerId ||
        ownerData.appId !== 'auditoria'
      ) {
        // Omitir owners inválidos
        return null;
      }

      try {
        // Obtener datos del usuario desde Firebase Auth
        const authUser = await centralAuth.getUser(ownerId);
        
        return {
          uid: ownerId,
          email: authUser.email || null,
          nombre: authUser.displayName || null,
        };
      } catch (error) {
        // Si el owner no tiene cuenta en Auth, omitirlo
        if (error.code === 'auth/user-not-found') {
          logger.debug('Owner sin cuenta Auth omitido de lista', {
            ownerId,
            superdevUid,
          });
          return null;
        }
        // Para otros errores, loguear pero continuar
        logger.warn('Error obteniendo datos de Auth para owner', {
          ownerId,
          error: error.message,
          superdevUid,
        });
        return null;
      }
    });

    // Esperar todas las promesas y filtrar nulos
    const ownerResults = await Promise.all(ownerPromises);
    const validOwners = ownerResults.filter(
      (owner) => owner !== null
    );

    // 3. Ordenar por email (o nombre si no hay email)
    validOwners.sort((a, b) => {
      const aDisplay = a.email || a.nombre || a.uid;
      const bDisplay = b.email || b.nombre || b.uid;
      return aDisplay.localeCompare(bDisplay);
    });

    // 4. Logging de auditoría
    logger.info('Superdev list owners successful', {
      superdevUid,
      superdevEmail,
      ownersCount: validOwners.length,
      timestamp: new Date().toISOString(),
    });

    // 5. Retornar lista de owners
    return res.status(200).json({ owners: validOwners });

  } catch (error) {
    logger.error('Error en list owners endpoint', {
      error: error.message,
      stack: error.stack,
      path: req.path,
    });

    return res.status(500).json({
      error: 'Error interno del servidor',
      code: 'INTERNAL_ERROR',
    });
  }
});

/**
 * POST /api/superdev/impersonate
 * 
 * SUPERDEV-ONLY: Generar un custom token para impersonar a un owner
 * 
 * Requiere:
 * - role === 'superdev' (verificado por middleware)
 * - Body: { ownerId: string }
 * 
 * Retorna:
 * - { customToken: string }
 * 
 * Restricciones:
 * - No modifica Firestore
 * - No persiste estado
 * - Solo genera token temporal (logout revierte)
 */
router.post('/impersonate', async (req, res) => {
  try {
    const superdevUid = req.superdev.uid;
    const superdevEmail = req.superdev.email;

    // 1. Validar body
    const { ownerId } = req.body || {};

    if (!ownerId || typeof ownerId !== 'string' || ownerId.trim() === '') {
      logger.warn('Impersonate attempt with invalid ownerId', {
        superdevUid,
        ownerId: ownerId || 'missing',
      });
      return res.status(400).json({
        error: 'ownerId es requerido y debe ser un string válido',
        code: 'INVALID_OWNER_ID',
      });
    }

    const targetOwnerId = ownerId.trim();

    // 2. Verificar que el owner existe en Firestore (colección correcta)
    const db = admin.firestore();
    const ownerDoc = await db
      .collection('apps')
      .doc('auditoria')
      .collection('owners')
      .doc(targetOwnerId)
      .get();

    if (!ownerDoc.exists) {
      logger.warn('Impersonate attempt for non-existent owner', {
        superdevUid,
        targetOwnerId,
      });
      return res.status(404).json({
        error: 'Owner no encontrado',
        code: 'OWNER_NOT_FOUND',
      });
    }

    // 3. Validar que el target sea realmente un OWNER válido
    const ownerData = ownerDoc.data();
    if (
      !ownerData ||
      ownerData.role !== 'admin' ||
      ownerData.ownerId !== targetOwnerId ||
      ownerData.appId !== 'auditoria'
    ) {
      logger.warn('Impersonate attempt for invalid owner (not a valid owner)', {
        superdevUid,
        targetOwnerId,
        ownerData: ownerData ? {
          role: ownerData.role,
          ownerId: ownerData.ownerId,
          appId: ownerData.appId,
        } : null,
      });
      return res.status(403).json({
        error: 'El UID no corresponde a un owner válido',
        code: 'INVALID_OWNER',
      });
    }

    // 4. Verificar que el owner existe en Firebase Auth
    const centralAuth = getCentralAuth();
    let authUser;
    try {
      authUser = await centralAuth.getUser(targetOwnerId);
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        logger.warn('Impersonate attempt for owner without Auth account', {
          superdevUid,
          targetOwnerId,
        });
        return res.status(404).json({
          error: 'Owner no tiene cuenta de autenticación',
          code: 'OWNER_AUTH_NOT_FOUND',
        });
      }
      throw error;
    }

    // 5. Generar Firebase Custom Token para el owner con claims reforzados
    const customToken = await centralAuth.createCustomToken(targetOwnerId, {
      appId: 'auditoria',
      role: 'admin',
      ownerId: targetOwnerId,
    });

    // 6. Logging de auditoría
    logger.info('Superdev impersonation successful', {
      superdevUid,
      superdevEmail,
      targetOwnerId,
      targetOwnerEmail: authUser.email,
      timestamp: new Date().toISOString(),
    });

    // 7. Retornar custom token
    return res.status(200).json({ customToken });

  } catch (error) {
    logger.error('Error en impersonate endpoint', {
      error: error.message,
      stack: error.stack,
      path: req.path,
    });

    return res.status(500).json({
      error: 'Error interno del servidor',
      code: 'INTERNAL_ERROR',
    });
  }
});

module.exports = router;
