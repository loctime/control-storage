const express = require('express');
const router = express.Router();
const admin = require('../firebaseAdmin');
const { logger } = require('../utils/logger');
const { syncAccessUsers, normalizeEmailArray } = require('../modules/emailUsers/emailUsers.service');
const { normalizePlate } = require('../services/vehicleEventService');

/**
 * POST /api/admin/create-user
 *
 * ⚠️ ENDPOINT DE IDENTIDAD (IAM/Core) - NO LLAMAR DESDE FRONTEND
 *
 * Este endpoint es parte de la infraestructura IAM/Core de ControlFile.
 * Su responsabilidad es SOLO identidad (Auth + Claims), NO lógica de negocio.
 *
 * ⚠️ IMPORTANTE: Este endpoint NO debe ser llamado directamente por frontends.
 * Debe ser llamado únicamente por backends de apps (ControlAudit, ControlDoc, etc.)
 * que orquestan flujos completos de creación de usuarios.
 *
 * RESPONSABILIDAD:
 * - ✅ Crear usuario en Firebase Auth (si no existe)
 * - ✅ Reutilizar UID existente (si el email ya existe en Auth)
 * - ✅ Aplicar/actualizar custom claims (appId, role, ownerId)
 * - ✅ Retornar uid del usuario (creado o reutilizado)
 *
 * LO QUE NO HACE:
 * - ❌ NO escribe Firestore de ninguna app
 * - ❌ NO valida límites de negocio
 * - ❌ NO aplica reglas de aplicación
 * - ❌ NO crea documentos de usuario en Firestore
 *
 * AUTORIZACIÓN:
 * - Authorization: Bearer <firebase-id-token>
 * - Custom claims del token:
 *   - decodedToken.appId === 'auditoria' (o la app correspondiente)
 *   - decodedToken.role in ['admin', 'supermax']
 *
 * CONTRATO FIJO:
 *
 * Inputs requeridos:
 * {
 *   email: string,        // Email del usuario
 *   password: string,     // Contraseña temporal
 *   nombre: string,       // Nombre a mostrar (se mapea internamente a displayName de Firebase Auth)
 *   role: string,         // Rol del usuario en la app
 *   appId: string         // Identificador de la app (ej: "auditoria")
 * }
 * 
 * Nota sobre naming: El parámetro es "nombre" (decisión de dominio), pero internamente
 * se mapea a "displayName" de Firebase Auth. Si se abre el endpoint a más apps en el futuro,
 * considerar estandarizar a "displayName" para alinearse con Firebase Auth.
 *
 * Output:
 * {
 *   uid: string,          // UID del usuario (creado o reutilizado)
 *   status: "created" | "reused",  // Estado de la operación
 *   source: "controlfile" // Origen de la creación
 * }
 *
 * QUIÉN DEBE LLAMARLO:
 * - ✅ Backends de apps (ControlAudit, ControlDoc, etc.)
 * - ❌ Frontends directamente
 *
 * FLUJO RECOMENDADO:
 * 1. Frontend llama a su app backend (ej: POST /api/operarios/create)
 * 2. App backend llama a este endpoint para crear identidad
 * 3. App backend escribe Firestore con lógica de negocio
 * 4. App backend aplica validaciones de negocio
 *
 * COMPORTAMIENTO MULTI-APP (Opción A - Auth global reutilizable):
 * - Si el email NO existe en Auth → crear usuario nuevo
 * - Si el email YA existe en Auth → reutilizar UID existente
 * - En ambos casos: setear/actualizar custom claims { appId, role, ownerId }
 * - NO cambiar password si el usuario ya existe
 * - NO escribir Firestore (responsabilidad de cada app)
 *
 * Referencia: docs/docs_v2/IAM_CORE_CONTRACT.md
 */
router.post('/create-user', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token de autenticación requerido' });
    }

    const token = authHeader.slice(7);

    // 🔐 Verificar token Firebase
    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(token);
    } catch (error) {
      logger.error('verifyIdToken failed', { error });
      return res.status(401).json({ error: 'Token inválido o expirado' });
    }

    // 🔒 Autorizar SOLO por custom claims del token
    if (decodedToken.appId !== 'auditoria') {
      return res.status(403).json({
        error: "No tienes permisos. Se requiere appId === 'auditoria' en custom claims.",
      });
    }

    const allowedRoles = ['admin', 'supermax'];
    if (!decodedToken.role || !allowedRoles.includes(decodedToken.role)) {
      return res.status(403).json({
        error: "No tienes permisos. Se requiere role in ['admin', 'supermax'] en custom claims.",
      });
    }

    // 📦 Validar body
    const { email, password, nombre, role, appId } = req.body || {};

    if (!email || !password || !nombre || !role || appId !== 'auditoria') {
      return res.status(400).json({ error: 'Datos inválidos o incompletos' });
    }

    // Validar formato de email básico
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Formato de email inválido' });
    }

    if (password.length < 6) {
      return res
        .status(400)
        .json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    // 🔍 Verificar si existe en Firebase Auth
    let authUser = null;
    let userExists = false;
    try {
      authUser = await admin.auth().getUserByEmail(email);
      userExists = true;
    } catch (e) {
      if (e.code !== 'auth/user-not-found') {
        throw e;
      }
    }

    let uid;
    let status;

    // OPCIÓN A: Auth global reutilizable
    if (userExists && authUser) {
      // Usuario ya existe → reutilizar UID y actualizar claims
      uid = authUser.uid;
      status = 'reused';

      // Actualizar custom claims (NO cambiar password)
      // ownerId se toma del token del admin que crea el usuario (decodedToken.uid)
      try {
        await admin.auth().setCustomUserClaims(uid, {
          appId: appId,
          role: role,
          ownerId: decodedToken.uid,
        });

        // Opcional: actualizar displayName si es diferente
        if (authUser.displayName !== nombre) {
          await admin.auth().updateUser(uid, {
            displayName: nombre,
          });
        }
      } catch (error) {
        logger.error('updating claims for existing user (admin/create-user)', { error });
        return res.status(500).json({
          error: 'Error actualizando claims del usuario',
          details: error.message,
        });
      }
    } else {
      // 🆕 Usuario NO existe → crear nuevo usuario en Firebase Auth
      try {
        const newUser = await admin.auth().createUser({
          email,
          password,
          displayName: nombre,
          emailVerified: false,
        });

        uid = newUser.uid;
        status = 'created';

        // Setear custom claims al nuevo usuario
        // ownerId se toma del token del admin que crea el usuario (decodedToken.uid)
        await admin.auth().setCustomUserClaims(uid, {
          appId: appId,
          role: role,
          ownerId: decodedToken.uid,
        });
      } catch (error) {
        // Manejar error de email ya existente (race condition)
        if (
          error.code === 'auth/email-already-exists' ||
          error.message?.includes('email-already-exists') ||
          error.message?.includes('already exists')
        ) {
          // En caso de race condition, intentar reutilizar el usuario
          try {
            authUser = await admin.auth().getUserByEmail(email);
            uid = authUser.uid;
            status = 'reused';

            await admin.auth().setCustomUserClaims(uid, {
              appId: appId,
              role: role,
              ownerId: decodedToken.uid,
            });
          } catch (retryError) {
            logger.error('retrying after race condition (admin/create-user)', { error: retryError });
            return res.status(500).json({
              error: 'Error al procesar usuario',
              details: retryError.message,
            });
          }
        } else {
          // Otros errores de Firebase Auth
          if (error.code?.startsWith('auth/')) {
            logger.error('creating user (firebase auth error)', { error });
            return res.status(400).json({
              error: error.code,
              message: error.message || 'Error al crear usuario',
            });
          }

          // Error desconocido
          throw error;
        }
      }
    }

    // NOTA: NO escribimos Firestore - Firestore owner-centric queda exclusivo de ControlAudit
    return res.status(status === 'created' ? 201 : 200).json({
      uid,
      status,
      source: 'controlfile',
    });
  } catch (error) {
    logger.error('admin/create-user failed', { error });
    return res.status(500).json({
      error: 'Error interno del servidor',
      details: error.message,
    });
  }
});

/**
 * PATCH /api/admin/vehicle-alerts
 *
 * Actualiza responsables de uno o más vehículos en apps/emails/vehicles.
 * Tras guardar, ejecuta syncAccessUsers() para mantener apps/emails/access alineado.
 *
 * Body:
 *   - { plate: string, responsables: string[] }  (un vehículo)
 *   - { vehicles: [{ plate: string, responsables: string[] }] }  (varios)
 *
 * Requiere role admin o supermax en custom claims.
 */
router.patch('/vehicle-alerts', async (req, res) => {
  try {
    const claims = req.claims || {};
    const allowedRoles = ['admin', 'supermax'];
    if (!claims.role || !allowedRoles.includes(claims.role)) {
      return res.status(403).json({
        error: "No tienes permisos. Se requiere role in ['admin', 'supermax'] en custom claims.",
      });
    }

    const body = req.body || {};
    let vehiclesToUpdate = [];

    if (body.plate != null && Array.isArray(body.responsables)) {
      vehiclesToUpdate = [{ plate: body.plate, responsables: body.responsables }];
    } else if (Array.isArray(body.vehicles)) {
      vehiclesToUpdate = body.vehicles.filter(
        (v) => v != null && v.plate != null && Array.isArray(v.responsables)
      );
    }

    if (vehiclesToUpdate.length === 0) {
      return res.status(400).json({
        error: 'Body debe ser { plate, responsables } o { vehicles: [{ plate, responsables }] }',
      });
    }

    const db = admin.firestore();
    const vehiclesRef = db.collection('apps').doc('emails').collection('vehicles');
    const now = admin.firestore.FieldValue.serverTimestamp();

    for (const { plate, responsables } of vehiclesToUpdate) {
      const normalizedPlate = normalizePlate(plate);
      if (!normalizedPlate) continue;

      const responsablesNormalized = normalizeEmailArray(responsables);
      await vehiclesRef.doc(normalizedPlate).set(
        { responsables, responsablesNormalized, updatedAt: now },
        { merge: true }
      );
    }

    const result = await syncAccessUsers();

    return res.status(200).json({
      ok: true,
      vehiclesUpdated: vehiclesToUpdate.length,
      sync: result,
    });
  } catch (error) {
    logger.error('admin/vehicle-alerts failed', { error });
    return res.status(500).json({
      error: 'Error interno del servidor',
      details: error.message,
    });
  }
});

/**
 * GET /api/admin/email-config
 *
 * Lee la configuración de destinatarios globales del sistema de alertas por email
 * (apps/emails/config/config). Si el documento no existe devuelve arrays vacíos.
 *
 * Respuesta: { ok: true, config: { generalRecipients, ccRecipients, reportRecipients } }
 *
 * Requiere role admin o supermax en custom claims.
 */
router.get('/email-config', async (req, res) => {
  try {
    const claims = req.claims || {};
    const allowedRoles = ['admin', 'supermax'];
    if (!claims.role || !allowedRoles.includes(claims.role)) {
      return res.status(403).json({
        error: "No tienes permisos. Se requiere role in ['admin', 'supermax'] en custom claims.",
      });
    }

    const db = admin.firestore();
    const configRef = db.collection('apps').doc('emails').collection('config').doc('config');
    const doc = await configRef.get();

    const defaultConfig = {
      generalRecipients: [],
      ccRecipients: [],
      reportRecipients: [],
    };

    if (!doc.exists) {
      return res.status(200).json({
        ok: true,
        config: defaultConfig,
      });
    }

    const data = doc.data() || {};
    const config = {
      generalRecipients: Array.isArray(data.generalRecipients) ? data.generalRecipients : defaultConfig.generalRecipients,
      ccRecipients: Array.isArray(data.ccRecipients) ? data.ccRecipients : defaultConfig.ccRecipients,
      reportRecipients: Array.isArray(data.reportRecipients) ? data.reportRecipients : defaultConfig.reportRecipients,
    };

    return res.status(200).json({
      ok: true,
      config,
    });
  } catch (error) {
    logger.error('admin/email-config GET failed', { error });
    return res.status(500).json({
      error: 'Error interno del servidor',
    });
  }
});

/**
 * PATCH /api/admin/email-config
 *
 * Actualiza la configuración de alertas por email (apps/emails/config/config).
 * Acepta generalRecipients, ccRecipients, reportRecipients (arrays de emails).
 * Tras guardar, ejecuta syncAccessUsers() para mantener apps/emails/access alineado.
 *
 * Body: { generalRecipients?: string[], ccRecipients?: string[], reportRecipients?: string[], ... }
 *
 * Requiere role admin o supermax en custom claims.
 */
router.patch('/email-config', async (req, res) => {
  try {
    const claims = req.claims || {};
    const allowedRoles = ['admin', 'supermax'];
    if (!claims.role || !allowedRoles.includes(claims.role)) {
      return res.status(403).json({
        error: "No tienes permisos. Se requiere role in ['admin', 'supermax'] en custom claims.",
      });
    }

    const body = req.body || {};
    const updates = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };

    if (Array.isArray(body.generalRecipients)) {
      updates.generalRecipients = normalizeEmailArray(body.generalRecipients);
    }
    if (Array.isArray(body.ccRecipients)) {
      updates.ccRecipients = normalizeEmailArray(body.ccRecipients);
    }
    if (Array.isArray(body.reportRecipients)) {
      updates.reportRecipients = normalizeEmailArray(body.reportRecipients);
    }

    if (Object.keys(updates).length <= 1) {
      return res.status(400).json({
        error: 'Body debe incluir al menos uno de: generalRecipients, ccRecipients, reportRecipients (arrays)',
      });
    }

    const db = admin.firestore();
    const configRef = db.collection('apps').doc('emails').collection('config').doc('config');
    await configRef.set(updates, { merge: true });

    const result = await syncAccessUsers();

    return res.status(200).json({
      ok: true,
      sync: result,
    });
  } catch (error) {
    logger.error('admin/email-config failed', { error });
    return res.status(500).json({
      error: 'Error interno del servidor',
      details: error.message,
    });
  }
});

/**
 * POST /api/admin/sync-access-users
 *
 * Sincroniza usuarios de acceso al sistema de alertas de vehículos.
 * Protegido por authMiddleware (Firebase ID token) a nivel de /api/admin
 * y adicionalmente restringido por custom claims de role.
 */
router.post('/sync-access-users', async (req, res) => {
  try {
    const claims = req.claims || {};
    const allowedRoles = ['admin', 'supermax'];

    if (!claims.role || !allowedRoles.includes(claims.role)) {
      return res.status(403).json({
        error: "No tienes permisos para sincronizar accesos. Se requiere role in ['admin', 'supermax'] en custom claims.",
      });
    }

    const result = await syncAccessUsers();

    return res.status(200).json({
      ok: true,
      ...result,
    });
  } catch (error) {
    logger.error('admin/sync-access-users failed', { error });
    return res.status(500).json({
      error: 'Error interno del servidor',
      details: error.message,
    });
  }
});

module.exports = router;

