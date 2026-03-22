/**
 * GET /api/dashboard/summary
 * Resumen agregado para el dashboard de monitoreo de flota.
 * Lee desde apps/emails/dailyAlerts/{date}/meta/meta y vehicles.
 * No modifica endpoints existentes de dashboard.routes.js.
 */

const express = require("express");
const router = express.Router();
const admin = require("../firebaseAdmin");
const { logger } = require("../utils/logger");

const db = admin.firestore();
const DAILY_ALERTS_REF = () =>
  db.collection("apps").doc("emails").collection("dailyAlerts");

// Timezone del sistema: America/Argentina/Buenos_Aires (último día con datos desde Firestore)

function parseDateKey(queryDate) {
  if (!queryDate || typeof queryDate !== "string") return null;
  const trimmed = queryDate.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const [y, m, d] = trimmed.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (
    isNaN(date.getTime()) ||
    date.getFullYear() !== y ||
    date.getMonth() !== m - 1 ||
    date.getDate() !== d
  )
    return null;
  return trimmed;
}

/**
 * Obtiene el último día con datos en dailyAlerts (por ID de documento YYYY-MM-DD).
 */
async function getLastDateWithData() {
  const snapshot = await DAILY_ALERTS_REF()
    .orderBy(admin.firestore.FieldPath.documentId(), "desc")
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  const dateKey = snapshot.docs[0].id;
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey : null;
}

/**
 * GET /summary?date=YYYY-MM-DD
 * Respuesta: ok, date, summary, distribution, criticalAlerts, topVehicles, recentEvents, riskMap.
 */
router.get("/summary", async (req, res) => {
  try {
    let dateKey = parseDateKey(req.query.date);
    if (!dateKey) {
      dateKey = await getLastDateWithData();
      if (!dateKey) {
        return res.status(200).json({
          ok: true,
          date: null,
          summary: {
            totalVehicles: 0,
            vehiclesWithEvents: 0,
            totalEvents: 0,
            criticalEvents: 0,
            adminEvents: 0,
            maxRisk: 0,
            avgRisk: 0,
          },
          distribution: {
            excesos: 0,
            no_identificados: 0,
            contactos: 0,
            llave_sin_cargar: 0,
            conductor_inactivo: 0,
          },
          criticalAlerts: [],
          topVehicles: [],
          recentEvents: [],
          riskMap: [],
          message: "No hay datos disponibles para ningún día",
        });
      }
    }

    const dateRef = DAILY_ALERTS_REF().doc(dateKey);
    const [metaSnap, vehiclesSnap] = await Promise.all([
      dateRef.collection("meta").doc("meta").get(),
      dateRef.collection("vehicles").get(),
    ]);

    const meta = metaSnap.exists ? metaSnap.data() : {};
    const totalEvents = meta.totalEvents ?? 0;
    const criticalEvents = meta.totalCriticos ?? 0;
    const adminEvents = meta.totalAdministrativos ?? 0;
    const distribution = {
      excesos: meta.totalExcesos ?? 0,
      no_identificados: meta.totalNoIdentificados ?? 0,
      contactos: meta.totalContactos ?? 0,
      llave_sin_cargar: meta.totalLlaveSinCargar ?? 0,
      conductor_inactivo: meta.totalConductorInactivo ?? 0,
    };

    const vehicles = vehiclesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const totalVehicles = vehicles.length;
    const vehiclesWithEvents = vehicles.filter(
      (v) => (v.events && v.events.length > 0) || (v.riskScore && v.riskScore > 0)
    ).length;

    let maxRisk = 0;
    let riskSum = 0;
    let riskCount = 0;
    for (const v of vehicles) {
      const r = typeof v.riskScore === "number" ? v.riskScore : 0;
      if (r > 0) {
        riskSum += r;
        riskCount += 1;
        if (r > maxRisk) maxRisk = r;
      }
    }
    const avgRisk = riskCount > 0 ? Math.round(riskSum / riskCount * 10) / 10 : 0;

    const summary = {
      totalVehicles,
      vehiclesWithEvents,
      totalEvents,
      criticalEvents,
      adminEvents,
      maxRisk,
      avgRisk,
    };

    const topVehicles = [...vehicles]
      .filter((v) => (v.riskScore ?? 0) > 0)
      .sort((a, b) => (b.riskScore ?? 0) - (a.riskScore ?? 0))
      .slice(0, 10)
      .map((v) => ({
        plate: v.plate || v.id,
        riskScore: v.riskScore ?? 0,
        totalEvents: Array.isArray(v.events) ? v.events.length : 0,
        operationName: v.operationName ?? v.operacion ?? null,
      }));

    const criticalAlerts = vehicles
      .filter((v) => (v.riskScore ?? 0) >= 5)
      .map((v) => ({
        plate: v.plate || v.id,
        riskScore: v.riskScore ?? 0,
        totalEvents: Array.isArray(v.events) ? v.events.length : 0,
        operationName: v.operationName ?? v.operacion ?? null,
      }));

    const riskMap = vehicles
      .filter((v) => (v.riskScore ?? 0) > 0)
      .map((v) => ({
        plate: v.plate || v.id,
        risk: v.riskScore ?? 0,
      }));

    const allEventsWithPlate = [];
    for (const v of vehicles) {
      const plate = v.plate || v.id;
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

    logger.debug("[dashboard/summary] OK", { dateKey, totalVehicles, totalEvents });

    return res.status(200).json({
      ok: true,
      date: dateKey,
      summary,
      distribution,
      criticalAlerts,
      topVehicles,
      recentEvents,
      riskMap,
    });
  } catch (err) {
    logger.error("[dashboard/summary] Error", { error: err.message });
    return res.status(500).json({
      ok: false,
      error: "error interno",
      message: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

module.exports = router;
