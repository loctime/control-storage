/**
 * Rutas del dashboard de métricas (emails/alertas).
 * Lectura de métricas agregadas: 1 lectura Firestore por día/mes/año.
 *
 * GET  /api/dashboard/day?date=YYYY-MM-DD   → metrics/daily/{date}
 * GET  /api/dashboard/month?month=YYYY-MM   → metrics/monthly/{month}
 * GET  /api/dashboard/year?year=YYYY        → metrics/yearly/{year}
 * POST /api/dashboard/aggregate-day?date=YYYY-MM-DD → calcula stats desde dailyAlerts y escribe en metrics (para cierre diario/cron)
 */

const express = require("express");
const router = express.Router();
const admin = require("../firebaseAdmin");
const { logger } = require("../utils/logger");
const { updateAggregatedMetrics } = require("../services/metricsAggregationService");
const { getDailyStatsForAggregation } = require("../services/dailyMetricsService");

const db = admin.firestore();
const METRICS_REF = db.collection("metrics");

function parseDateKey(queryDate) {
  if (!queryDate || typeof queryDate !== "string") return null;
  const trimmed = queryDate.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const [y, m, d] = trimmed.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (isNaN(date.getTime()) || date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d)
    return null;
  return trimmed;
}

function parseMonthKey(queryMonth) {
  if (!queryMonth || typeof queryMonth !== "string") return null;
  const trimmed = queryMonth.trim();
  if (!/^\d{4}-\d{2}$/.test(trimmed)) return null;
  const [y, m] = trimmed.split("-").map(Number);
  if (m < 1 || m > 12) return null;
  return trimmed;
}

function parseYearKey(queryYear) {
  if (!queryYear || typeof queryYear !== "string") return null;
  const trimmed = queryYear.trim();
  if (!/^\d{4}$/.test(trimmed)) return null;
  const y = parseInt(trimmed, 10);
  if (y < 2000 || y > 2100) return null;
  return trimmed;
}

/**
 * Normaliza documento de métricas a la estructura esperada por el dashboard.
 * Para monthly/yearly se calcula avgRisk desde riskSum y riskCount.
 */
function toDashboardStats(doc) {
  if (!doc || !doc.exists) return null;
  const data = doc.data() || {};
  const totalAlerts = data.totalAlerts ?? 0;
  const alertsSent = data.alertsSent ?? 0;
  const alertsPending = data.alertsPending ?? 0;
  const maxRisk = data.maxRisk ?? 0;
  const vehiclesWithAlerts = data.vehiclesWithAlerts ?? 0;
  let avgRisk = data.avgRisk;
  if (avgRisk === undefined && data.riskCount > 0 && data.riskSum !== undefined) {
    avgRisk = data.riskSum / data.riskCount;
  }
  avgRisk = typeof avgRisk === "number" ? avgRisk : 0;

  const result = {
    totalAlerts,
    alertsSent,
    alertsPending,
    maxRisk,
    avgRisk,
    vehiclesWithAlerts,
  };
  if (data.updatedAt && data.updatedAt.toDate) {
    result.updatedAt = data.updatedAt.toDate().toISOString();
  } else if (data.createdAt && data.createdAt.toDate) {
    result.updatedAt = data.createdAt.toDate().toISOString();
  }
  return result;
}

/**
 * GET /api/dashboard/day?date=YYYY-MM-DD
 * Lee metrics/daily/{date}. Una lectura. Si no existe, agrega desde dailyAlerts (lazy) y devuelve.
 */
router.get("/dashboard/day", async (req, res) => {
  try {
    const dateKey = parseDateKey(req.query.date);
    if (!dateKey) {
      return res.status(400).json({
        error: "Query date requerido en formato YYYY-MM-DD",
        example: "?date=2026-03-04",
      });
    }
    const docRef = METRICS_REF.collection("daily").doc(dateKey);
    let doc = await docRef.get();
    if (!doc.exists && req.query.aggregate !== "false") {
      try {
        const stats = await getDailyStatsForAggregation(dateKey);
        if (stats.totalAlerts > 0 || stats.vehiclesWithAlerts > 0) {
          await updateAggregatedMetrics(dateKey, stats);
          doc = await docRef.get();
          logger.info("[dashboard] GET day: métricas agregadas (lazy)", { dateKey });
        }
      } catch (aggErr) {
        logger.warn("[dashboard] GET day: fallo agregación lazy", { dateKey, error: aggErr.message });
      }
    }
    const stats = toDashboardStats(doc);
    if (!stats) {
      return res.status(200).json({
        ok: true,
        dateKey,
        metrics: null,
        message: "No hay métricas agregadas para esta fecha",
      });
    }
    logger.debug("[dashboard] GET day", { dateKey });
    return res.status(200).json({ ok: true, dateKey, metrics: stats });
  } catch (err) {
    logger.error("[dashboard] Error GET day", { error: err.message });
    return res.status(500).json({
      error: "error interno",
      message: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

/**
 * GET /api/dashboard/month?month=YYYY-MM
 * Lee metrics/monthly/{month}. Una lectura.
 */
router.get("/dashboard/month", async (req, res) => {
  try {
    const monthKey = parseMonthKey(req.query.month);
    if (!monthKey) {
      return res.status(400).json({
        error: "Query month requerido en formato YYYY-MM",
        example: "?month=2026-03",
      });
    }
    const docRef = METRICS_REF.collection("monthly").doc(monthKey);
    const doc = await docRef.get();
    const stats = toDashboardStats(doc);
    if (!stats) {
      return res.status(200).json({
        ok: true,
        monthKey,
        metrics: null,
        message: "No hay métricas agregadas para este mes",
      });
    }
    logger.debug("[dashboard] GET month", { monthKey });
    return res.status(200).json({ ok: true, monthKey, metrics: stats });
  } catch (err) {
    logger.error("[dashboard] Error GET month", { error: err.message });
    return res.status(500).json({
      error: "error interno",
      message: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

/**
 * GET /api/dashboard/year?year=YYYY
 * Lee metrics/yearly/{year}. Una lectura.
 */
router.get("/dashboard/year", async (req, res) => {
  try {
    const yearKey = parseYearKey(req.query.year);
    if (!yearKey) {
      return res.status(400).json({
        error: "Query year requerido en formato YYYY",
        example: "?year=2026",
      });
    }
    const docRef = METRICS_REF.collection("yearly").doc(yearKey);
    const doc = await docRef.get();
    const stats = toDashboardStats(doc);
    if (!stats) {
      return res.status(200).json({
        ok: true,
        yearKey,
        metrics: null,
        message: "No hay métricas agregadas para este año",
      });
    }
    logger.debug("[dashboard] GET year", { yearKey });
    return res.status(200).json({ ok: true, yearKey, metrics: stats });
  } catch (err) {
    logger.error("[dashboard] Error GET year", { error: err.message });
    return res.status(500).json({
      error: "error interno",
      message: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

/**
 * POST /api/dashboard/aggregate-day?date=YYYY-MM-DD
 * Calcula estadísticas del día desde dailyAlerts y escribe en metrics (daily + increment monthly/yearly si el día no estaba agregado).
 * Para uso de cron o cierre diario. Requiere auth.
 */
router.post("/dashboard/aggregate-day", async (req, res) => {
  try {
    const dateKey = parseDateKey(req.query.date);
    if (!dateKey) {
      return res.status(400).json({
        error: "Query date requerido en formato YYYY-MM-DD",
        example: "?date=2026-03-04",
      });
    }
    const stats = await getDailyStatsForAggregation(dateKey);
    await updateAggregatedMetrics(dateKey, stats);
    logger.info("[dashboard] aggregate-day completado", { dateKey, totalAlerts: stats.totalAlerts });
    return res.status(200).json({
      ok: true,
      dateKey,
      aggregated: stats,
    });
  } catch (err) {
    logger.error("[dashboard] Error aggregate-day", { dateKey: req.query.date, error: err.message });
    return res.status(500).json({
      error: "error interno",
      message: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

module.exports = router;
