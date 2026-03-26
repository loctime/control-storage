/**
 * dashboardEnrichmentService.js
 * Servicio de enriquecimiento para el dashboard.
 * Lee datos desde dailyAlerts y los enriquece con datos de apps/emails/vehicles.
 * Sin que el frontend tenga que hacer lecturas adicionales.
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
 * Lee datos de un vehículo desde apps/emails/vehicles/{plate}
 * @param {string} plate - Patente (se normaliza)
 * @returns {Promise<object|null>} Vehicle data o null
 */
async function getVehicleData(plate) {
  if (!plate) return null;

  const normalized = normalizePlate(plate);
  const docSnap = await VEHICLES_REF().doc(normalized).get();

  if (!docSnap.exists) return null;
  return {
    plate: normalized,
    ...docSnap.data(),
  };
}

/**
 * Enriquece un vehículo del dailyAlerts con datos de apps/emails/vehicles
 * @param {object} dailyAlertsVehicle - Vehicle del dailyAlerts
 * @returns {Promise<object>} Vehicle enriquecido
 */
async function enrichVehicle(dailyAlertsVehicle) {
  if (!dailyAlertsVehicle) return null;

  const plate = dailyAlertsVehicle.plate || dailyAlertsVehicle.id;
  const vehicleData = await getVehicleData(plate);

  // Merge: preferir datos de apps/emails/vehicles para operacion y responsables
  const enriched = {
    ...dailyAlertsVehicle,
    // Sobrescribir con datos correctos si existen
    operacion: vehicleData?.operacion || dailyAlertsVehicle.operacion,
    operationName: vehicleData?.operationName || dailyAlertsVehicle.operationName,
    responsables: vehicleData?.responsables || dailyAlertsVehicle.responsables,
    responsablesNormalized: vehicleData?.responsablesNormalized,
    // Metadatos de enriquecimiento
    _enrichedFrom: vehicleData ? "apps/emails/vehicles" : "dailyAlerts",
    _dataSource: vehicleData ? "enriched" : "legacy",
  };

  return enriched;
}

/**
 * Obtiene resumen enriquecido del dashboard para una fecha
 * Lee todos los vehículos del dailyAlerts y los enriquece en paralelo
 * @param {string} dateKey - YYYY-MM-DD
 * @param {object} options - { maxConcurrency: 10 }
 * @returns {Promise<{vehicles: Array, stats: object, enrichmentStats: object}>}
 */
async function getDashboardSummaryEnriched(dateKey, options = {}) {
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return {
      ok: false,
      error: "Invalid date format. Expected YYYY-MM-DD",
      date: dateKey,
    };
  }

  const maxConcurrency = options.maxConcurrency || 10;

  // Lectura 1: meta del día
  const [metaSnap, vehiclesSnap] = await Promise.all([
    DAILY_ALERTS_REF().doc(dateKey).collection("meta").doc("meta").get(),
    DAILY_ALERTS_REF().doc(dateKey).collection("vehicles").get(),
  ]);

  const meta = metaSnap.exists ? metaSnap.data() : {};
  const dailyVehicles = vehiclesSnap.docs.map((d) => ({
    plate: d.id,
    ...d.data(),
  }));

  // Enriquecimiento en paralelo (con control de concurrencia)
  let enrichedVehicles = [];
  let enrichmentFailed = 0;
  let enrichmentSucceeded = 0;

  for (let i = 0; i < dailyVehicles.length; i += maxConcurrency) {
    const batch = dailyVehicles.slice(i, i + maxConcurrency);
    const enrichPromises = batch.map(async (vehicle) => {
      try {
        const enriched = await enrichVehicle(vehicle);
        enrichmentSucceeded++;
        return enriched;
      } catch (err) {
        enrichmentFailed++;
        console.error(`[dashboard] Failed to enrich vehicle ${vehicle.plate}:`, err.message);
        return vehicle; // Fallback a datos legacy si falla el enriquecimiento
      }
    });

    const batchEnriched = await Promise.all(enrichPromises);
    enrichedVehicles = enrichedVehicles.concat(batchEnriched);
  }

  // Estadísticas
  const totalVehicles = enrichedVehicles.length;
  const vehiclesWithEvents = enrichedVehicles.filter(
    (v) => (v.events && v.events.length > 0) || (v.riskScore && v.riskScore > 0)
  ).length;

  let maxRisk = 0;
  let riskSum = 0;
  let riskCount = 0;
  for (const v of enrichedVehicles) {
    const r = typeof v.riskScore === "number" ? v.riskScore : 0;
    if (r > 0) {
      riskSum += r;
      riskCount += 1;
      if (r > maxRisk) maxRisk = r;
    }
  }
  const avgRisk = riskCount > 0 ? Math.round((riskSum / riskCount) * 10) / 10 : 0;

  const summary = {
    totalVehicles,
    vehiclesWithEvents,
    totalEvents: meta.totalEvents ?? 0,
    criticalEvents: meta.totalCriticos ?? 0,
    adminEvents: meta.totalAdministrativos ?? 0,
    maxRisk,
    avgRisk,
  };

  const distribution = {
    excesos: meta.totalExcesos ?? 0,
    no_identificados: meta.totalNoIdentificados ?? 0,
    contactos: meta.totalContactos ?? 0,
    llave_sin_cargar: meta.totalLlaveSinCargar ?? 0,
    conductor_inactivo: meta.totalConductorInactivo ?? 0,
  };

  const topVehicles = [...enrichedVehicles]
    .filter((v) => (v.riskScore ?? 0) > 0)
    .sort((a, b) => (b.riskScore ?? 0) - (a.riskScore ?? 0))
    .slice(0, 10)
    .map((v) => ({
      plate: v.plate,
      riskScore: v.riskScore ?? 0,
      totalEvents: Array.isArray(v.events) ? v.events.length : 0,
      operationName: v.operationName ?? v.operacion ?? null,
      responsables: Array.isArray(v.responsables) ? v.responsables : [],
    }));

  const criticalAlerts = enrichedVehicles
    .filter((v) => (v.riskScore ?? 0) >= 5)
    .map((v) => ({
      plate: v.plate,
      riskScore: v.riskScore ?? 0,
      totalEvents: Array.isArray(v.events) ? v.events.length : 0,
      operationName: v.operationName ?? v.operacion ?? null,
      responsables: Array.isArray(v.responsables) ? v.responsables : [],
    }));

  const riskMap = enrichedVehicles
    .filter((v) => (v.riskScore ?? 0) > 0)
    .map((v) => ({
      plate: v.plate,
      risk: v.riskScore ?? 0,
    }));

  const allEventsWithPlate = [];
  for (const v of enrichedVehicles) {
    const plate = v.plate;
    const events = Array.isArray(v.events) ? v.events : [];
    for (const e of events) {
      allEventsWithPlate.push({
        ...e,
        plate,
        eventTimestamp: e.eventTimestamp || "",
      });
    }
  }
  allEventsWithPlate.sort((a, b) => {
    const ta = a.eventTimestamp || "";
    const tb = b.eventTimestamp || "";
    return tb.localeCompare(ta);
  });
  const recentEvents = allEventsWithPlate.slice(0, 50);

  return {
    ok: true,
    date: dateKey,
    summary,
    distribution,
    criticalAlerts,
    topVehicles,
    recentEvents,
    riskMap,
    vehicles: enrichedVehicles, // Full vehicle data if needed
    enrichmentStats: {
      total: dailyVehicles.length,
      succeeded: enrichmentSucceeded,
      failed: enrichmentFailed,
    },
  };
}

/**
 * Obtiene solo un vehículo enriquecido
 * @param {string} plate - Patente
 * @param {string} dateKey - YYYY-MM-DD (opcional, para buscar en dailyAlerts primero)
 * @returns {Promise<object>}
 */
async function getEnrichedVehicle(plate, dateKey = null) {
  let vehicle = null;

  // Primero busca en dailyAlerts si se proporciona dateKey
  if (dateKey && /^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    const normalized = normalizePlate(plate);
    const snap = await DAILY_ALERTS_REF()
      .doc(dateKey)
      .collection("vehicles")
      .doc(normalized)
      .get();
    if (snap.exists) {
      vehicle = { plate: normalized, ...snap.data() };
    }
  }

  // Si no encontró en dailyAlerts, usa datos actuales
  if (!vehicle) {
    vehicle = await getVehicleData(plate);
  }

  if (!vehicle) return null;
  return enrichVehicle(vehicle);
}

module.exports = {
  getDashboardSummaryEnriched,
  enrichVehicle,
  getVehicleData,
  getEnrichedVehicle,
};
