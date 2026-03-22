const express = require('express');
const router = express.Router();
const admin = require('../firebaseAdmin');
const { logger } = require('../utils/logger');

const FREE_STORAGE_BYTES = 5 * 1024 * 1024 * 1024; // 5GB

/**
 * Convierte un Timestamp de Firestore a ISO string
 * Si es null, retorna null
 */
function timestampToISO(timestamp) {
  if (!timestamp) return null;
  if (timestamp instanceof admin.firestore.Timestamp) {
    return timestamp.toDate().toISOString();
  }
  if (timestamp && timestamp.toDate && typeof timestamp.toDate === 'function') {
    return timestamp.toDate().toISOString();
  }
  return null;
}

/**
 * Convierte un documento de cuenta de Firestore al formato esperado por el SDK
 * Convierte timestamps a ISO strings y agrega id opcional
 */
function formatAccountData(accountData, uid) {
  if (!accountData) return null;

  return {
    id: uid,
    ...accountData,
    createdAt: timestampToISO(accountData.createdAt),
    updatedAt: timestampToISO(accountData.updatedAt),
    paidUntil: timestampToISO(accountData.paidUntil),
    trialEndsAt: timestampToISO(accountData.trialEndsAt)
  };
}

/**
 * POST /api/accounts/ensure
 * 
 * Autenticación obligatoria (usar el middleware existente)
 * Obtener uid y email del token
 * Buscar platform/accounts/{uid}
 * Si existe → devolverla
 * Si NO existe → crearla con defaults y devolverla
 */
router.post('/ensure', async (req, res) => {
  try {
    if (!req.user || !req.user.uid) {
      return res.status(401).json({
        error: 'Usuario no autenticado',
        code: 'AUTH_REQUIRED'
      });
    }

    const { uid } = req.user;
    const email = req.user.email || '';

    const db = admin.firestore();
    const accountRef = db.collection('platform').doc('accounts').collection('accounts').doc(uid);
    const accountDoc = await accountRef.get();

    if (accountDoc.exists) {
      const accountData = accountDoc.data();
      const formatted = formatAccountData(accountData, uid);
      return res.json(formatted);
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const newAccount = {
      uid,
      email,
      status: 'active',
      planId: 'FREE_5GB',
      limits: {
        storageBytes: FREE_STORAGE_BYTES
      },
      enabledApps: {},
      paidUntil: null,
      trialEndsAt: null,
      createdAt: now,
      updatedAt: now
    };

    await accountRef.set(newAccount);

    logger.info('Cuenta creada', { uid, email });

    // Leer el documento para obtener timestamps reales del servidor
    const createdDoc = await accountRef.get();
    const createdData = createdDoc.data();
    const formatted = formatAccountData(createdData, uid);

    return res.json(formatted);

  } catch (error) {
    logger.error('Error en ensure account', { error: error.message, stack: error.stack });
    return res.status(500).json({
      error: 'Error interno del servidor',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * GET /api/accounts/me
 * 
 * Autenticación obligatoria
 * Leer platform/accounts/{uid}
 * Si no existe → devolver 404
 * Si existe → devolver el documento
 */
router.get('/me', async (req, res) => {
  try {
    if (!req.user || !req.user.uid) {
      return res.status(401).json({
        error: 'Usuario no autenticado',
        code: 'AUTH_REQUIRED'
      });
    }

    const { uid } = req.user;

    const db = admin.firestore();
    const accountRef = db.collection('platform').doc('accounts').collection('accounts').doc(uid);
    const accountDoc = await accountRef.get();

    if (!accountDoc.exists) {
      return res.status(404).json({
        error: 'Cuenta no encontrada',
        code: 'ACCOUNT_NOT_FOUND'
      });
    }

    const accountData = accountDoc.data();
    const formatted = formatAccountData(accountData, uid);
    return res.json(formatted);

  } catch (error) {
    logger.error('Error en get account', { error: error.message, stack: error.stack });
    return res.status(500).json({
      error: 'Error interno del servidor',
      code: 'INTERNAL_ERROR'
    });
  }
});

module.exports = router;