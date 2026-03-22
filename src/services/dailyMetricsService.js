/**
 * dailyMetricsService.js
 * Servicio para lectura de métricas diarias (v2). Base para métricas históricas.
 * Lee desde dailyAlerts/meta y dailyAlerts/vehicles.
 */

const admin = require("../firebaseAdmin");
const { normalizePlate } = require("./vehicleEventService");

function getDb() {
  return admin.firestore();
}

const DAILY_ALERTS_REF = () =>
  getDb().collection("apps").doc("emails").collection("dailyAlerts");

/**
 * Totales por tipo del día desde meta.
 * @param {string} dateKey - YYYY-MM-DD
 * @returns {Promise<{ excesos: number, no_identificados: number, contactos: number, llave_sin_cargar: number, conductor_inactivo: number, ...meta }>}
 */
async function getDailyTotalsByType(dateKey) {
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return {
      excesos: 0,
      no_identificados: 0,
      contactos: 0,
      llave_sin_cargar: 0,
      conductor_inactivo: 0,
      totalVehicles: 0,
      totalEvents: 0,
      totalCriticos: 0,
      totalAdvertencias: 0,
      totalAdministrativos: 0,
      vehiclesWithCritical: 0,
      totalUniqueIncidents: 0,
      totalUniqueOperationalIncidents: 0,
      totalUniqueTechnicalIncidents: 0,
      totalSpeedIncidents: 0,
      maxSpeedRecorded: 0,
      vehiclesWithSpeeding: 0,
      driversWithSpeeding: 0,
    };
  }

  const metaSnap = await DAILY_ALERTS_REF()
    .doc(dateKey)
    .collection("meta")
    .doc("meta")
    .get();

  if (!metaSnap.exists) {
    return {
      excesos: 0,
      no_identificados: 0,
      contactos: 0,
      llave_sin_cargar: 0,
      conductor_inactivo: 0,
      totalVehicles: 0,
      totalEvents: 0,
      totalCriticos: 0,
      totalAdvertencias: 0,
      totalAdministrativos: 0,
      vehiclesWithCritical: 0,
      totalUniqueIncidents: 0,
      totalUniqueOperationalIncidents: 0,
      totalUniqueTechnicalIncidents: 0,
      totalSpeedIncidents: 0,
      maxSpeedRecorded: 0,
      vehiclesWithSpeeding: 0,
      driversWithSpeeding: 0,
    };
  }

  const meta = metaSnap.data();
  return {
    excesos: meta.totalExcesos ?? 0,
    no_identificados: meta.totalNoIdentificados ?? 0,
    contactos: meta.totalContactos ?? 0,
    llave_sin_cargar: meta.totalLlaveSinCargar ?? 0,
    conductor_inactivo: meta.totalConductorInactivo ?? 0,
    totalVehicles: meta.totalVehicles ?? 0,
    totalEvents: meta.totalEvents ?? 0,
    totalCriticos: meta.totalCriticos ?? 0,
    totalAdvertencias: meta.totalAdvertencias ?? 0,
    totalAdministrativos: meta.totalAdministrativos ?? 0,
    vehiclesWithCritical: meta.vehiclesWithCritical ?? 0,
    totalUniqueIncidents: meta.totalUniqueIncidents ?? 0,
    totalUniqueOperationalIncidents: meta.totalUniqueOperationalIncidents ?? 0,
    totalUniqueTechnicalIncidents: meta.totalUniqueTechnicalIncidents ?? 0,
    totalSpeedIncidents: meta.totalSpeedIncidents ?? 0,
    maxSpeedRecorded: meta.maxSpeedRecorded ?? 0,
    vehiclesWithSpeeding: meta.vehiclesWithSpeeding ?? 0,
    driversWithSpeeding: meta.driversWithSpeeding ?? 0,
    lastUpdatedAt: meta.lastUpdatedAt ?? null,
  };
}

/**
 * Resumen diario de un vehículo para una fecha.
 * @param {string} plate - Patente (se normaliza)
 * @param {string} dateKey - YYYY-MM-DD
 * @returns {Promise<object|null>} Documento vehicle de dailyAlerts o null
 */
async function getVehicleDailySummary(plate, dateKey) {
  if (!plate || !dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;

  const normalized = normalizePlate(plate);
  const docSnap = await DAILY_ALERTS_REF()
    .doc(dateKey)
    .collection("vehicles")
    .doc(normalized)
    .get();

  if (!docSnap.exists) return null;
  return { id: docSnap.id, ...docSnap.data() };
}

/**
 * Calcula estadísticas para el dashboard de un día a partir de dailyAlerts/vehicles.
 * Usado para alimentar metrics/daily y agregaciones mensual/anual.
 *
 * @param {string} dateKey - YYYY-MM-DD
 * @returns {Promise<{ totalAlerts: number, alertsSent: number, alertsPending: number, maxRisk: number, avgRisk: number, vehiclesWithAlerts: number }>}
 */
async function getDailyStatsForAggregation(dateKey) {
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return {
      totalAlerts: 0,
      alertsSent: 0,
      alertsPending: 0,
      maxRisk: 0,
      avgRisk: 0,
      vehiclesWithAlerts: 0,
    };
  }

  const vehiclesSnap = await DAILY_ALERTS_REF()
    .doc(dateKey)
    .collection("vehicles")
    .get();

  let totalAlerts = 0;
  let alertsSent = 0;
  let alertsPending = 0;
  let maxRisk = 0;
  let riskSum = 0;
  let riskCount = 0;

  for (const doc of vehiclesSnap.docs) {
    const data = doc.data() || {};
    totalAlerts += 1;
    if (data.alertSent === true) {
      alertsSent += 1;
    } else {
      alertsPending += 1;
    }
    const risk = typeof data.riskScore === "number" ? data.riskScore : 0;
    if (risk > 0) {
      riskSum += risk;
      riskCount += 1;
      if (risk > maxRisk) maxRisk = risk;
    }
  }

  const avgRisk = riskCount > 0 ? riskSum / riskCount : 0;

  return {
    totalAlerts,
    alertsSent,
    alertsPending,
    maxRisk,
    avgRisk,
    vehiclesWithAlerts: totalAlerts,
  };
}

module.exports = {
  getDailyTotalsByType,
  getVehicleDailySummary,
  getDailyStatsForAggregation,
};
