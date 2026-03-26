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

/**
 * Obtiene stats diarios para una fecha específica
 * @param {string} dateKey - YYYY-MM-DD
 * @returns {Promise<{totalExcessEvents: number, avgRisk: number}>}
 */
async function getDailyStats(dateKey) {
  const [metaSnap, vehiclesSnap] = await Promise.all([
    DAILY_ALERTS_REF().doc(dateKey).collection("meta").doc("meta").get(),
    DAILY_ALERTS_REF().doc(dateKey).collection("vehicles").get(),
  ]);

  const meta = metaSnap.exists ? metaSnap.data() : {};
  const vehicles = vehiclesSnap.docs.map((d) => ({ ...d.data() }));

  const totalExcessEvents = meta.totalExcesos ?? 0;

  let riskSum = 0;
  let riskCount = 0;
  for (const v of vehicles) {
    const r = typeof v.riskScore === "number" ? v.riskScore : 0;
    if (r > 0) {
      riskSum += r;
      riskCount += 1;
    }
  }
  const avgRisk = riskCount > 0 ? Math.round((riskSum / riskCount) * 10) / 10 : 0;

  return {
    totalExcessEvents,
    avgRisk,
  };
}

/**
 * Calcula dailyBreakdown para un rango de fechas
 * @param {string[]} dates - Array de fechas en formato YYYY-MM-DD
 * @returns {Promise<Array>} Array de {date, totalExcessEvents, avgRisk}
 */
async function calculateDailyBreakdown(dates) {
  const breakdown = [];

  for (const dateKey of dates) {
    try {
      const stats = await getDailyStats(dateKey);
      breakdown.push({
        date: dateKey,
        totalExcessEvents: stats.totalExcessEvents,
        avgRisk: stats.avgRisk,
      });
    } catch (err) {
      // Si no hay datos para esa fecha, agregar con valores por defecto
      breakdown.push({
        date: dateKey,
        totalExcessEvents: 0,
        avgRisk: 0,
      });
    }
  }

  return breakdown;
}

/**
 * Genera array de fechas para un período
 * @param {string} period - "day" | "week" | "month" | "year"
 * @param {string} dateParam - Fecha en formato YYYY-MM-DD (day/week), YYYY-MM (month), o YYYY (year)
 * @returns {string[]} Array de fechas YYYY-MM-DD
 */
function generateDateRange(period, dateParam) {
  const dates = [];

  if (period === "day") {
    // Solo un día
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      dates.push(dateParam);
    }
  } else if (period === "week") {
    // 7 días a partir de la fecha indicada
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      const [y, m, d] = dateParam.split("-").map(Number);
      const startDate = new Date(y, m - 1, d);
      for (let i = 0; i < 7; i++) {
        const currentDate = new Date(startDate);
        currentDate.setDate(currentDate.getDate() + i);
        const yyyy = currentDate.getFullYear();
        const mm = String(currentDate.getMonth() + 1).padStart(2, "0");
        const dd = String(currentDate.getDate()).padStart(2, "0");
        dates.push(`${yyyy}-${mm}-${dd}`);
      }
    }
  } else if (period === "month") {
    // Todos los días del mes
    if (/^\d{4}-\d{2}$/.test(dateParam)) {
      const [y, m] = dateParam.split("-").map(Number);
      const daysInMonth = new Date(y, m, 0).getDate();
      for (let d = 1; d <= daysInMonth; d++) {
        const dd = String(d).padStart(2, "0");
        dates.push(`${y}-${String(m).padStart(2, "0")}-${dd}`);
      }
    }
  } else if (period === "year") {
    // Todos los días del año
    if (/^\d{4}$/.test(dateParam)) {
      const y = Number(dateParam);
      const isLeapYear = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
      const daysInYear = isLeapYear ? 366 : 365;
      for (let dayOfYear = 1; dayOfYear <= daysInYear; dayOfYear++) {
        const date = new Date(y, 0, dayOfYear);
        const mm = String(date.getMonth() + 1).padStart(2, "0");
        const dd = String(date.getDate()).padStart(2, "0");
        dates.push(`${y}-${mm}-${dd}`);
      }
    }
  }

  return dates;
}

/**
 * Agrega datos de múltiples días en un único resultado
 * @param {Array} results - Array de resultados de getDashboardSummaryEnriched() (uno por cada día)
 * @returns {Object} Datos agregados de todos los días
 */
function aggregateDashboardResults(results) {
  if (!results || results.length === 0) {
    return {
      ok: false,
      error: "No results to aggregate",
    };
  }

  // Trackers para agregación
  const vehicleMap = {}; // plate -> vehicle data
  const uniquePlates = new Set();
  const uniquePlatesWithEvents = new Set();
  let totalEvents = 0;
  let totalCriticos = 0;
  let totalAdministrativos = 0;
  const distributionTotals = {
    excesos: 0,
    no_identificados: 0,
    contactos: 0,
    llave_sin_cargar: 0,
    conductor_inactivo: 0,
  };
  let maxRisk = 0;
  let riskSum = 0;
  let riskCount = 0;
  const allEvents = [];

  // Iterar sobre cada día y agregar datos
  for (const result of results) {
    if (!result.ok) continue;

    // Agregar eventos
    totalEvents += result.summary?.totalEvents ?? 0;
    totalCriticos += result.summary?.criticalEvents ?? 0;
    totalAdministrativos += result.summary?.adminEvents ?? 0;

    // Agregar distribution
    Object.keys(distributionTotals).forEach((key) => {
      distributionTotals[key] += result.distribution?.[key] ?? 0;
    });

    // Agregar vehículos únicos (merge por placa, guardar con máximo riesgo)
    (result.vehicles || []).forEach((v) => {
      uniquePlates.add(v.plate);
      const currentRisk = v.riskScore ?? 0;
      if (currentRisk > 0) {
        uniquePlatesWithEvents.add(v.plate);
        riskSum += currentRisk;
        riskCount += 1;
        if (currentRisk > maxRisk) maxRisk = currentRisk;
      }
      // Guardar vehículo si no existe o tiene riesgo mayor
      if (!vehicleMap[v.plate] || (v.riskScore ?? 0) > (vehicleMap[v.plate].riskScore ?? 0)) {
        vehicleMap[v.plate] = v;
      }
    });

    // Agregar eventos recientes
    (result.recentEvents || []).forEach((e) => {
      allEvents.push(e);
    });
  }

  // Calcular promedio de riesgo
  const avgRisk = riskCount > 0 ? Math.round((riskSum / riskCount) * 10) / 10 : 0;

  // Obtener lista de vehículos agregados
  const allVehicles = Object.values(vehicleMap);

  // Generar topVehicles (top 10 por riesgo)
  const topVehicles = [...allVehicles]
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

  // Generar criticalAlerts (riesgo >= 5)
  const criticalAlerts = allVehicles
    .filter((v) => (v.riskScore ?? 0) >= 5)
    .map((v) => ({
      plate: v.plate,
      riskScore: v.riskScore ?? 0,
      totalEvents: Array.isArray(v.events) ? v.events.length : 0,
      operationName: v.operationName ?? v.operacion ?? null,
      responsables: Array.isArray(v.responsables) ? v.responsables : [],
    }));

  // Generar riskMap
  const riskMap = allVehicles
    .filter((v) => (v.riskScore ?? 0) > 0)
    .map((v) => ({
      plate: v.plate,
      risk: v.riskScore ?? 0,
    }));

  // Ordenar eventos por timestamp descendente y tomar últimos 50
  allEvents.sort((a, b) => {
    const ta = a.eventTimestamp || "";
    const tb = b.eventTimestamp || "";
    return tb.localeCompare(ta);
  });
  const recentEvents = allEvents.slice(0, 50);

  // Calcular stats de enriquecimiento (agregado de todos)
  let enrichmentTotal = 0;
  let enrichmentSucceeded = 0;
  let enrichmentFailed = 0;
  for (const result of results) {
    if (result.enrichmentStats) {
      enrichmentTotal += result.enrichmentStats.total ?? 0;
      enrichmentSucceeded += result.enrichmentStats.succeeded ?? 0;
      enrichmentFailed += result.enrichmentStats.failed ?? 0;
    }
  }

  return {
    ok: true,
    date: results[0]?.date,
    summary: {
      totalVehicles: uniquePlates.size,
      vehiclesWithEvents: uniquePlatesWithEvents.size,
      totalEvents,
      criticalEvents: totalCriticos,
      adminEvents: totalAdministrativos,
      maxRisk,
      avgRisk,
    },
    distribution: distributionTotals,
    topVehicles,
    criticalAlerts,
    riskMap,
    recentEvents,
    vehicles: allVehicles,
    enrichmentStats: {
      total: enrichmentTotal,
      succeeded: enrichmentSucceeded,
      failed: enrichmentFailed,
    },
  };
}

/**
 * Obtiene resumen enriquecido por período
 * @param {string} period - "day" | "week" | "month" | "year"
 * @param {string} dateParam - Fecha en formato apropiado
 * @param {object} options - { maxConcurrency: 10 }
 * @returns {Promise<object>}
 */
async function getDashboardByPeriod(period, dateParam, options = {}) {
  const validPeriods = ["day", "week", "month", "year"];
  if (!validPeriods.includes(period)) {
    return {
      ok: false,
      error: `Invalid period. Must be one of: ${validPeriods.join(", ")}`,
    };
  }

  const dates = generateDateRange(period, dateParam);
  if (dates.length === 0) {
    return {
      ok: false,
      error: `Invalid date format for period ${period}`,
      examples: {
        day: "date=YYYY-MM-DD",
        week: "date=YYYY-MM-DD",
        month: "date=YYYY-MM",
        year: "date=YYYY",
      },
    };
  }

  // Para day, usar la implementación existente
  if (period === "day") {
    return getDashboardSummaryEnriched(dates[0], options);
  }

  // Para week, month, year: iterar sobre todos los días y agregar
  const allResults = [];
  for (const dateKey of dates) {
    try {
      const dayResult = await getDashboardSummaryEnriched(dateKey, options);
      if (dayResult.ok) {
        allResults.push(dayResult);
      }
    } catch (err) {
      // Ignorar errores de días sin datos
      console.error(`[dashboard] Error fetching data for ${dateKey}:`, err.message);
    }
  }

  if (allResults.length === 0) {
    return {
      ok: false,
      error: `No data available for period ${period}`,
    };
  }

  // Agregar todos los resultados
  const aggregated = aggregateDashboardResults(allResults);

  if (!aggregated.ok) {
    return aggregated;
  }

  // Calcular dailyBreakdown para el período
  const dailyBreakdown = await calculateDailyBreakdown(dates);

  // Retornar respuesta con datos agregados
  return {
    ...aggregated,
    dailyBreakdown,
    period,
  };
}

module.exports = {
  getDashboardSummaryEnriched,
  getDashboardByPeriod,
  enrichVehicle,
  getVehicleData,
  getEnrichedVehicle,
  getDailyStats,
  calculateDailyBreakdown,
  generateDateRange,
  aggregateDashboardResults,
};
