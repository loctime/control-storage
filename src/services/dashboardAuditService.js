/**
 * dashboardAuditService.js
 * Servicio de auditoría para detectar inconsistencias en datos del dashboard.
 * Compara datos de dailyAlerts (legacy) vs apps/emails/vehicles (correcto).
 */

const admin = require("../firebaseAdmin");
const { normalizePlate } = require("./vehicleEventService");

function getDb() {
  return admin.firestore();
}

const DAILY_ALERTS_REF = () =>
  getDb().collection("apps").doc("emails").collection("dailyAlerts");

const VEHICLES_REF = () =>
  getDb().collection("apps").doc("emails").collection("vehicles");

/**
 * Lee vehículos desde dailyAlerts/{date}/vehicles (source legacy)
 * @param {string} dateKey - YYYY-MM-DD
 * @returns {Promise<Array>} Array de vehículos legacy con su data
 */
async function getLegacyDailyAlertsVehicles(dateKey) {
  const snapshot = await DAILY_ALERTS_REF()
    .doc(dateKey)
    .collection("vehicles")
    .get();

  return snapshot.docs.map((doc) => ({
    plate: doc.id,
    ...doc.data(),
  }));
}

/**
 * Lee vehículos desde apps/emails/vehicles (source correcto)
 * @param {Array<string>} plates - Array de patentes normalizadas
 * @returns {Promise<Map>} Map de plate -> vehicle data
 */
async function getCorrectVehicles(plates) {
  const vehicleMap = new Map();

  // Lee en batches para no exceder límites
  const batchSize = 100;
  for (let i = 0; i < plates.length; i += batchSize) {
    const batch = plates.slice(i, i + batchSize);
    const snapshot = await VEHICLES_REF()
      .where(admin.firestore.FieldPath.documentId(), "in", batch)
      .get();

    for (const doc of snapshot.docs) {
      vehicleMap.set(doc.id, {
        plate: doc.id,
        ...doc.data(),
      });
    }
  }

  return vehicleMap;
}

/**
 * Normaliza emails en array (desde responsables o responsablesNormalized)
 * @param {any} value - Valor a normalizar
 * @returns {Array<string>} Array de emails normalizados
 */
function normalizeEmailArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((e) => String(e || "").trim().toLowerCase())
      .filter((e) => e.length > 0 && e.includes("@"));
  }
  if (typeof value === "string") {
    const email = value.trim().toLowerCase();
    return email.length > 0 && email.includes("@") ? [email] : [];
  }
  return [];
}

/**
 * Detecta si responsables son legacy (contienen emails legacy comunes)
 * @param {any} responsables - Array o string de responsables
 * @returns {boolean}
 */
function isLegacyResponsables(responsables) {
  const legacyPatterns = [
    "controldoc@controldoc.app",
    "info@controldoc.app",
    "system@",
    "admin@",
  ];
  const normalized = normalizeEmailArray(responsables);
  return normalized.some((email) =>
    legacyPatterns.some((pattern) => email.includes(pattern))
  );
}

/**
 * Auditoría de inconsistencias entre dailyAlerts y vehicles
 * @param {string} dateKey - YYYY-MM-DD
 * @returns {Promise<object>} Reporte de auditoría
 */
async function auditDashboardData(dateKey) {
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return {
      ok: false,
      error: "Invalid date format. Expected YYYY-MM-DD",
      date: dateKey,
    };
  }

  const legacyVehicles = await getLegacyDailyAlertsVehicles(dateKey);

  if (legacyVehicles.length === 0) {
    return {
      ok: true,
      date: dateKey,
      totalVehicles: 0,
      vehiclesWithOperacion: 0,
      vehiclesWithoutOperacion: 0,
      vehiclesWithValidResponsables: 0,
      vehiclesWithLegacyResponsables: 0,
      legacyEmailsFound: [],
      mismatches: [],
      summary: "No vehicles found for this date",
    };
  }

  // Normalizar todas las patentes y buscar datos correctos
  const normalizedPlates = legacyVehicles.map((v) => normalizePlate(v.plate));
  const correctVehicles = await getCorrectVehicles(normalizedPlates);

  // Análisis
  let vehiclesWithOperacion = 0;
  let vehiclesWithValidResponsables = 0;
  let vehiclesWithLegacyResponsables = 0;
  const legacyEmailsSet = new Set();
  const mismatches = [];

  for (const legacyVehicle of legacyVehicles) {
    const normalizedPlate = normalizePlate(legacyVehicle.plate);
    const correctVehicle = correctVehicles.get(normalizedPlate);

    // Check operacion
    const operacionFromLegacy = legacyVehicle.operacion || legacyVehicle.operationName;
    const operacionFromCorrect = correctVehicle?.operacion || correctVehicle?.operationName;

    if (operacionFromLegacy) {
      vehiclesWithOperacion++;
    }

    // Check responsables
    const responsablesFromLegacy = legacyVehicle.responsables;
    if (responsablesFromLegacy) {
      if (isLegacyResponsables(responsablesFromLegacy)) {
        vehiclesWithLegacyResponsables++;
        const normalized = normalizeEmailArray(responsablesFromLegacy);
        normalized.forEach((e) => legacyEmailsSet.add(e));
      } else {
        vehiclesWithValidResponsables++;
      }
    }

    // Check mismatches
    if (operacionFromLegacy && operacionFromCorrect && operacionFromLegacy !== operacionFromCorrect) {
      mismatches.push({
        plate: normalizedPlate,
        operacionFromDailyAlerts: operacionFromLegacy,
        operacionFromVehicles: operacionFromCorrect,
        match: false,
      });
    }
  }

  return {
    ok: true,
    date: dateKey,
    totalVehicles: legacyVehicles.length,
    vehiclesWithOperacion,
    vehiclesWithoutOperacion: legacyVehicles.length - vehiclesWithOperacion,
    vehiclesWithValidResponsables,
    vehiclesWithLegacyResponsables,
    legacyEmailsFound: Array.from(legacyEmailsSet).sort(),
    mismatches,
    summary:
      mismatches.length > 0
        ? `${mismatches.length} vehicles have inconsistencies between dailyAlerts and /vehicles`
        : "No inconsistencies detected",
  };
}

module.exports = {
  auditDashboardData,
  getLegacyDailyAlertsVehicles,
  getCorrectVehicles,
  isLegacyResponsables,
};
