/**
 * metricsAggregationService.js
 * Agrega métricas diarias en Firestore (metrics/daily, metrics/monthly, metrics/yearly)
 * para soportar dashboard con 1 lectura por día/mes/año.
 */

const admin = require("../firebaseAdmin");
const { logger } = require("../utils/logger");

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const METRICS_REF = db.collection("metrics");

/**
 * Extrae YYYY-MM del dateKey YYYY-MM-DD.
 * @param {string} dateKey - YYYY-MM-DD
 * @returns {string} YYYY-MM
 */
function dateKeyToMonthKey(dateKey) {
  if (!dateKey || typeof dateKey !== "string") return "";
  const parts = dateKey.trim().split("-");
  if (parts.length < 2) return "";
  return `${parts[0]}-${parts[1]}`;
}

/**
 * Extrae YYYY del dateKey YYYY-MM-DD.
 * @param {string} dateKey - YYYY-MM-DD
 * @returns {string} YYYY
 */
function dateKeyToYearKey(dateKey) {
  if (!dateKey || typeof dateKey !== "string") return "";
  return dateKey.trim().split("-")[0] || "";
}

/**
 * Actualiza métricas agregadas para un día.
 * - Guarda/sobrescribe el documento diario: metrics/daily/YYYY-MM-DD
 * - Si el día no existía, incrementa monthly (YYYY-MM) y yearly (YYYY) con los mismos totales.
 * Para monthly/yearly se usa increment en totales; maxRisk se actualiza con max(); avgRisk se deriva de riskSum/riskCount.
 *
 * @param {string} dateKey - YYYY-MM-DD
 * @param {object} stats - { totalAlerts, alertsSent, alertsPending, maxRisk, avgRisk, vehiclesWithAlerts }
 */
async function updateAggregatedMetrics(dateKey, stats) {
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    logger.warn("[metricsAggregation] dateKey inválido, se omite", { dateKey });
    return;
  }

  const totalAlerts = Number(stats.totalAlerts) || 0;
  const alertsSent = Number(stats.alertsSent) || 0;
  const alertsPending = Number(stats.alertsPending) || 0;
  const maxRisk = Number(stats.maxRisk) || 0;
  const avgRisk = Number(stats.avgRisk) || 0;
  const vehiclesWithAlerts = Number(stats.vehiclesWithAlerts) || 0;

  const monthKey = dateKeyToMonthKey(dateKey);
  const yearKey = dateKeyToYearKey(dateKey);
  if (!monthKey || !yearKey) {
    logger.warn("[metricsAggregation] month/year inválidos", { dateKey, monthKey, yearKey });
    return;
  }

  const dailyRef = METRICS_REF.collection("daily").doc(dateKey);
  const monthlyRef = METRICS_REF.collection("monthly").doc(monthKey);
  const yearlyRef = METRICS_REF.collection("yearly").doc(yearKey);

  try {
    const dailySnap = await dailyRef.get();
    const dailyExisted = dailySnap.exists;

    const dailyPayload = {
      totalAlerts,
      alertsSent,
      alertsPending,
      maxRisk,
      avgRisk,
      vehiclesWithAlerts,
    };
    if (!dailyExisted) {
      dailyPayload.createdAt = FieldValue.serverTimestamp();
    }

    await dailyRef.set(dailyPayload, { merge: true });
    logger.info("[metricsAggregation] Escrito metrics/daily", {
      dateKey,
      totalAlerts,
      alertsSent,
      alertsPending,
      vehiclesWithAlerts,
    });

    if (!dailyExisted) {
      const riskSumDelta = vehiclesWithAlerts > 0 ? avgRisk * vehiclesWithAlerts : 0;
      const riskCountDelta = vehiclesWithAlerts;

      const monthlyUpdate = {
        totalAlerts: FieldValue.increment(totalAlerts),
        alertsSent: FieldValue.increment(alertsSent),
        alertsPending: FieldValue.increment(alertsPending),
        vehiclesWithAlerts: FieldValue.increment(vehiclesWithAlerts),
        riskSum: FieldValue.increment(riskSumDelta),
        riskCount: FieldValue.increment(riskCountDelta),
        updatedAt: FieldValue.serverTimestamp(),
      };

      const yearlyUpdate = {
        totalAlerts: FieldValue.increment(totalAlerts),
        alertsSent: FieldValue.increment(alertsSent),
        alertsPending: FieldValue.increment(alertsPending),
        vehiclesWithAlerts: FieldValue.increment(vehiclesWithAlerts),
        riskSum: FieldValue.increment(riskSumDelta),
        riskCount: FieldValue.increment(riskCountDelta),
        updatedAt: FieldValue.serverTimestamp(),
      };

      const monthlySnap = await monthlyRef.get();
      const yearlySnap = await yearlyRef.get();

      const currentMonthlyMax = (monthlySnap.exists && monthlySnap.data().maxRisk) || 0;
      const currentYearlyMax = (yearlySnap.exists && yearlySnap.data().maxRisk) || 0;

      monthlyUpdate.maxRisk = Math.max(currentMonthlyMax, maxRisk);
      yearlyUpdate.maxRisk = Math.max(currentYearlyMax, maxRisk);

      await monthlyRef.set(monthlyUpdate, { merge: true });
      await yearlyRef.set(yearlyUpdate, { merge: true });

      logger.info("[metricsAggregation] Actualizados metrics/monthly y metrics/yearly (increment)", {
        monthKey,
        yearKey,
      });
    }
  } catch (err) {
    logger.error("[metricsAggregation] Error al escribir métricas", {
      dateKey,
      error: err && err.message ? err.message : String(err),
    });
    throw err;
  }
}

module.exports = {
  updateAggregatedMetrics,
  dateKeyToMonthKey,
  dateKeyToYearKey,
};
