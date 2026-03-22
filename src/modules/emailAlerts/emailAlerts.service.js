const admin = require("../../firebaseAdmin");
const { normalizeEmail } = require("../emailUsers/emailUsers.service");

const db = admin.firestore();

const RESPONSABLES_BASE_REF = db
  .collection("apps")
  .doc("emails")
  .collection("responsables");

const VEHICLES_REF = db.collection("apps").doc("emails").collection("vehicles");

function getResponsableAlertsRef(normalizedEmail) {
  const encodedEmail = encodeURIComponent(normalizedEmail);
  return RESPONSABLES_BASE_REF.doc(encodedEmail).collection("alerts");
}

/**
 * Obtiene una página de alertas para un responsable dado.
 * Solo usa el índice apps/emails/responsables/{email}/alerts.
 *
 * @param {string} emailRaw
 * @param {{ limit?: number, startAfter?: string }} options
 * @returns {Promise<Array<{ plate: string, dateKey: string, riskScore: number, alertSent: boolean }>>}
 */
async function getMyAlertsPage(emailRaw, options = {}) {
  const normalized = normalizeEmail(emailRaw);
  if (!normalized) return [];

  const { limit = 50, startAfter } = options;
  const safeLimit = Number.isFinite(limit) && limit > 0 && limit <= 200 ? limit : 50;

  let alertsRef = getResponsableAlertsRef(normalized)
    .orderBy("createdAt", "desc")
    .limit(safeLimit);

  if (startAfter) {
    const encodedAlertId = encodeURIComponent(startAfter);
    const cursorRef = getResponsableAlertsRef(normalized).doc(encodedAlertId);
    const cursorSnap = await cursorRef.get();
    if (cursorSnap.exists) {
      alertsRef = alertsRef.startAfter(cursorSnap);
    }
  }

  const snap = await alertsRef.get();

  return snap.docs.map((doc) => {
    const data = doc.data() || {};
    return {
      plate: data.plate || "",
      dateKey: data.dateKey || "",
      riskScore: typeof data.riskScore === "number" ? data.riskScore : 0,
      alertSent: data.alertSent === true,
    };
  });
}

/**
 * Obtiene todas las alertas de un responsable (sin paginación) para estadísticas.
 * Usa solo apps/emails/responsables/{email}/alerts.
 *
 * @param {string} emailRaw
 * @returns {Promise<Array<object>>}
 */
async function getAllAlertsForStats(emailRaw) {
  const normalized = normalizeEmail(emailRaw);
  if (!normalized) return [];

  const alertsRef = getResponsableAlertsRef(normalized);
  const snap = await alertsRef.get();
  return snap.docs.map((doc) => doc.data() || {});
}

/**
 * Calcula estadísticas agregadas para un responsable.
 *
 * @param {string} emailRaw
 * @returns {Promise<{
 *  totalAlerts: number,
 *  alertsToday: number,
 *  alertsPending: number,
 *  alertsSent: number,
 *  maxRisk: number,
 *  avgRisk: number
 * }>}
 */
async function getMyStats(emailRaw) {
  const alerts = await getAllAlertsForStats(emailRaw);
  if (alerts.length === 0) {
    return {
      totalAlerts: 0,
      alertsToday: 0,
      alertsPending: 0,
      alertsSent: 0,
      maxRisk: 0,
      avgRisk: 0,
    };
  }

  const todayKey = new Date().toISOString().slice(0, 10);

  let totalAlerts = 0;
  let alertsToday = 0;
  let alertsPending = 0;
  let alertsSent = 0;
  let maxRisk = 0;
  let riskSum = 0;
  let riskCount = 0;

  for (const a of alerts) {
    totalAlerts += 1;
    const risk = typeof a.riskScore === "number" ? a.riskScore : 0;
    const sent = a.alertSent === true;
    const dateKey = typeof a.dateKey === "string" ? a.dateKey : "";

    if (dateKey === todayKey) {
      alertsToday += 1;
    }
    if (sent) {
      alertsSent += 1;
    } else {
      alertsPending += 1;
    }

    if (risk > 0) {
      riskSum += risk;
      riskCount += 1;
      if (risk > maxRisk) {
        maxRisk = risk;
      }
    }
  }

  const avgRisk = riskCount > 0 ? riskSum / riskCount : 0;

  return {
    totalAlerts,
    alertsToday,
    alertsPending,
    alertsSent,
    maxRisk,
    avgRisk,
  };
}

/**
 * Agrupa alertas por vehículo (plate) para un responsable.
 *
 * @param {string} emailRaw
 * @returns {Promise<Array<{ plate: string, alerts: number, maxRisk: number }>>}
 */
async function getMyRiskByVehicle(emailRaw) {
  const alerts = await getAllAlertsForStats(emailRaw);
  if (alerts.length === 0) return [];

  const byPlate = new Map();

  for (const a of alerts) {
    const plate = typeof a.plate === "string" && a.plate ? a.plate : "";
    if (!plate) continue;

    const risk = typeof a.riskScore === "number" ? a.riskScore : 0;

    if (!byPlate.has(plate)) {
      byPlate.set(plate, { plate, alerts: 0, maxRisk: 0 });
    }
    const agg = byPlate.get(plate);
    agg.alerts += 1;
    if (risk > agg.maxRisk) {
      agg.maxRisk = risk;
    }
  }

  const result = Array.from(byPlate.values());
  result.sort((a, b) => {
    if (b.maxRisk !== a.maxRisk) {
      return b.maxRisk - a.maxRisk;
    }
    return a.plate.localeCompare(b.plate);
  });

  return result;
}

/**
 * Devuelve los vehículos visibles para el responsable actual,
 * enriquecidos con información de riesgo desde el índice de alertas.
 *
 * @param {string} emailRaw
 * @returns {Promise<Array<{ plate: string, operationName: string|null, lastEvent: string|null, riskScore: number }>>}
 */
async function getMyVehiclesWithRisk(emailRaw) {
  const normalized = normalizeEmail(emailRaw);
  if (!normalized) return [];

  // Construir mapa plate -> { alerts, maxRisk, lastDateKey } desde el índice
  const alertsRef = getResponsableAlertsRef(normalized);
  const alertsSnap = await alertsRef.get();

  const byPlate = new Map();
  alertsSnap.forEach((doc) => {
    const data = doc.data() || {};
    const plate = typeof data.plate === "string" && data.plate ? data.plate : "";
    if (!plate) return;

    const risk = typeof data.riskScore === "number" ? data.riskScore : 0;
    const dateKey = typeof data.dateKey === "string" ? data.dateKey : "";

    if (!byPlate.has(plate)) {
      byPlate.set(plate, { alerts: 0, maxRisk: 0, lastDateKey: dateKey || null });
    }
    const agg = byPlate.get(plate);
    agg.alerts += 1;
    if (risk > agg.maxRisk) {
      agg.maxRisk = risk;
    }
    if (dateKey && (!agg.lastDateKey || dateKey > agg.lastDateKey)) {
      agg.lastDateKey = dateKey;
    }
  });

  // Obtener vehículos donde el usuario es responsable
  const vehiclesSnap = await VEHICLES_REF.where(
    "responsablesNormalized",
    "array-contains",
    normalized
  ).get();

  return vehiclesSnap.docs.map((doc) => {
    const data = doc.data() || {};
    const plate = data.plate || doc.id;
    const riskInfo = byPlate.get(plate) || { maxRisk: 0, lastDateKey: null };

    return {
      plate,
      operationName: data.operationName || data.operacion || null,
      lastEvent: riskInfo.lastDateKey,
      riskScore: riskInfo.maxRisk,
    };
  });
}

module.exports = {
  getMyAlertsPage,
  getMyStats,
  getMyRiskByVehicle,
  getMyVehiclesWithRisk,
};

