// backend/src/handlers/publicHorarios.handler.js
/**
 * Endpoint público: datos completos de horarios mensuales por companySlug.
 * Estructura Firestore definida por ControlHorarios:
 *   apps/horarios/publicCompanies, schedules, employees, shifts, config
 * Usa admin.firestore() ya inicializado (auth.js al arrancar el servidor).
 * Índice compuesto requerido: schedules: ownerId ASC + weekStart DESC
 */
const admin = require('../firebaseAdmin');
const { logger } = require('../utils/logger');

const SLUG_REGEX = /^[a-z0-9-]{1,64}$/;
const SENSITIVE_KEYS = ['email', 'userId', 'userIds', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'internal', 'metadata', 'password', 'token'];

function isValidSlug(slug) {
  return typeof slug === 'string' && slug.length > 0 && SLUG_REGEX.test(slug);
}

function sanitizeDoc(data) {
  if (data === null || data === undefined) return data;
  if (typeof data !== 'object') return data;
  if (data.toDate && typeof data.toDate === 'function') return data.toDate().toISOString();
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_KEYS.includes(key)) continue;
    out[key] = sanitizeDoc(value);
  }
  return out;
}

/**
 * GET /api/horarios/publicos-completos?companySlug=empleado
 * Resuelve companySlug → ownerId vía publicCompanies, verifica active, devuelve schedules, employees, shifts, config.
 */
async function getPublicHorariosCompletos(req, res) {
  const companySlug = typeof req.query.companySlug === 'string' ? req.query.companySlug.trim() : '';

  if (!isValidSlug(companySlug)) {
    return res.status(400).json({
      error: 'companySlug inválido o faltante',
      code: 'INVALID_SLUG',
    });
  }

  try {
    const db = admin.firestore();
    const baseRef = db.collection('apps').doc('horarios');

    const publicCompanyRef = baseRef.collection('publicCompanies').doc(companySlug);
    const publicCompanySnap = await publicCompanyRef.get();

    if (!publicCompanySnap.exists) {
      return res.status(404).json({
        error: 'Empresa no encontrada',
        code: 'COMPANY_NOT_FOUND',
      });
    }

    const companyData = publicCompanySnap.data();
    if (companyData.active !== true) {
      return res.status(404).json({
        error: 'Empresa no disponible',
        code: 'COMPANY_NOT_ACTIVE',
      });
    }

    const ownerId = companyData.ownerId;
    const companyName = companyData.name ?? companyData.companyName ?? '';

    if (!ownerId || typeof ownerId !== 'string') {
      logger.warn('publicHorarios: publicCompanies doc sin ownerId', { companySlug });
      return res.status(500).json({
        error: 'Configuración de empresa inválida',
        code: 'INVALID_CONFIG',
      });
    }

    const schedulesRef = baseRef.collection('schedules');
    const employeesRef = baseRef.collection('employees');
    const shiftsRef = baseRef.collection('shifts');
    const configRef = baseRef.collection('config').doc(ownerId);

    const [
      schedulesSnap,
      employeesSnap,
      shiftsSnap,
      configSnap,
    ] = await Promise.all([
      schedulesRef.where('ownerId', '==', ownerId).orderBy('weekStart', 'desc').get(),
      employeesRef.where('ownerId', '==', ownerId).get(),
      shiftsRef.where('ownerId', '==', ownerId).get(),
      configRef.get(),
    ]);

    const schedules = schedulesSnap.docs.map(d => ({ id: d.id, ...sanitizeDoc(d.data()) }));
    const employees = employeesSnap.docs.map(d => ({ id: d.id, ...sanitizeDoc(d.data()) }));
    const shifts = shiftsSnap.docs.map(d => ({ id: d.id, ...sanitizeDoc(d.data()) }));
    const config = configSnap.exists ? sanitizeDoc(configSnap.data()) : null;

    res.json({
      companySlug,
      ownerId,
      companyName,
      schedules,
      employees,
      shifts,
      config,
    });
  } catch (err) {
    logger.error('publicHorarios error', { error: err.message, companySlug: req.query.companySlug });
    if (err.code === 8 || (err.message && err.message.includes('index'))) {
      return res.status(500).json({
        error: 'Índice Firestore requerido: schedules con ownerId ASC + weekStart DESC',
        code: 'INDEX_REQUIRED',
      });
    }
    res.status(500).json({
      error: 'Error al obtener horarios públicos',
      code: 'INTERNAL_ERROR',
    });
  }
}

module.exports = { getPublicHorariosCompletos };
