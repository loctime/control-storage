const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/auth");
const admin = require("../../firebaseAdmin");

const db = admin.firestore();

const VALID_EVENT_TYPES = new Set([
  "SPEED_EXCESS",
  "DRIVER_NOT_IDENTIFIED",
  "CONTACT_NO_DRIVER",
  "UNKNOWN_KEY",
  "INACTIVE_DRIVER",
  "NO_KEY_DETECTED",
]);

/**
 * Genera un array de dateKeys (YYYY-MM-DD) entre dateFrom y dateTo inclusive.
 * Opera sobre strings de fecha sin conversión de timezone para evitar drift.
 */
function getDateKeys(dateFrom, dateTo) {
  const keys = [];
  const cursor = new Date(`${dateFrom}T00:00:00`);
  const end = new Date(`${dateTo}T00:00:00`);

  while (cursor <= end) {
    const yyyy = cursor.getFullYear();
    const mm = String(cursor.getMonth() + 1).padStart(2, "0");
    const dd = String(cursor.getDate()).padStart(2, "0");
    keys.push(`${yyyy}-${mm}-${dd}`);
    cursor.setDate(cursor.getDate() + 1);
  }

  return keys;
}

/**
 * Devuelve true si el string tiene formato YYYY-MM-DD válido (fecha real).
 */
function isValidDate(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const d = new Date(`${str}T00:00:00`);
  return !isNaN(d.getTime());
}

/**
 * GET /api/vehicles/events
 *
 * Devuelve eventos de vehículos desde apps/emails/dailyAlerts/{dateKey}/vehicles/{plate}.
 *
 * Query params:
 *   dateFrom   YYYY-MM-DD  requerido
 *   dateTo     YYYY-MM-DD  requerido
 *   plate      string      opcional — filtra una patente específica
 *   eventType  string      opcional — uno o más separados por coma (ej: SPEED_EXCESS,UNKNOWN_KEY)
 *   limit      number      opcional, default 100
 *   page       number      opcional, default 1
 *
 * Auth: Firebase ID Token (Authorization: Bearer ...)
 */
router.get("/vehicles/events", authMiddleware, async (req, res) => {
  try {
    const { dateFrom, dateTo, plate, eventType, limit: limitParam, page: pageParam } = req.query;

    // ── Validación de params requeridos ─────────────────────────────────────
    if (!dateFrom || !dateTo) {
      return res.status(400).json({
        ok: false,
        error: "dateFrom y dateTo son requeridos (formato YYYY-MM-DD)",
      });
    }

    if (!isValidDate(dateFrom) || !isValidDate(dateTo)) {
      return res.status(400).json({
        ok: false,
        error: "Formato de fecha inválido. Usar YYYY-MM-DD",
      });
    }

    if (dateFrom > dateTo) {
      return res.status(400).json({
        ok: false,
        error: "dateFrom no puede ser mayor que dateTo",
      });
    }

    const dateKeys = getDateKeys(dateFrom, dateTo);

    if (dateKeys.length > 31) {
      return res.status(400).json({
        ok: false,
        error: "El rango máximo permitido es 31 días",
      });
    }

    // ── Paginación ───────────────────────────────────────────────────────────
    const limit = Math.min(
      Number.isFinite(parseInt(limitParam, 10)) && parseInt(limitParam, 10) > 0
        ? parseInt(limitParam, 10)
        : 100,
      500
    );
    const page = Math.max(
      Number.isFinite(parseInt(pageParam, 10)) && parseInt(pageParam, 10) > 0
        ? parseInt(pageParam, 10)
        : 1,
      1
    );

    // ── Filtro de eventType ──────────────────────────────────────────────────
    const eventTypeFilter =
      typeof eventType === "string" && eventType.trim()
        ? eventType
            .split(",")
            .map((t) => t.trim().toUpperCase())
            .filter((t) => t.length > 0)
        : null;

    // ── Consulta Firestore ───────────────────────────────────────────────────
    const dailyAlertsRef = db.collection("apps").doc("emails").collection("dailyAlerts");

    const allEvents = [];
    const platesFound = new Set();

    for (const dateKey of dateKeys) {
      const vehiclesRef = dailyAlertsRef.doc(dateKey).collection("vehicles");

      let vehicleDocs;

      if (typeof plate === "string" && plate.trim()) {
        const normalizedPlate = plate.trim().toUpperCase().replace(/[\s-]/g, "");
        const snap = await vehiclesRef.doc(normalizedPlate).get();
        vehicleDocs = snap.exists ? [snap] : [];
      } else {
        const snap = await vehiclesRef.get();
        vehicleDocs = snap.docs;
      }

      for (const doc of vehicleDocs) {
        const data = doc.data() || {};
        const docPlate = data.plate || doc.id;
        const operationName = data.operationName || data.operacion || null;
        const rawEvents = Array.isArray(data.events) ? data.events : [];

        for (const event of rawEvents) {
          // Filtrar por eventType si se especificó
          if (eventTypeFilter) {
            const subtype = (event.eventSubtype || "").toUpperCase();
            if (!eventTypeFilter.includes(subtype)) continue;
          }

          platesFound.add(docPlate);

          allEvents.push({
            plate: docPlate,
            operationName,
            dateKey,
            eventType: event.eventSubtype || event.type || null,
            eventTimestamp: event.eventTimestamp || null,
            speed: event.speed ?? null,
            speedLimit: event.speedLimit ?? null,
            speedDelta: event.speedDelta ?? null,
            maxSpeed: event.maxSpeed ?? null,
            groupedEventsCount: event.groupedEventsCount ?? null,
            hasSpeed: event.hasSpeed ?? false,
            severity: event.severity || null,
            location: event.location || null,
            locationRaw: event.locationRaw || null,
            driverName: event.driverName || null,
            keyId: event.keyId || null,
            reason: event.reason || null,
            rawEventType: event.rawEventType || null,
            eventId: event.eventId || null,
            eventCategory: event.eventCategory || null,
            incidentKey: event.incidentKey || null,
            sourceEmailType: event.sourceEmailType || null,
          });
        }
      }
    }

    // ── Paginación en memoria ────────────────────────────────────────────────
    const total = allEvents.length;
    const offset = (page - 1) * limit;
    const paginated = allEvents.slice(offset, offset + limit);

    return res.json({
      ok: true,
      events: paginated,
      total,
      page,
      limit,
      plates: Array.from(platesFound).sort(),
      dateRange: { from: dateFrom, to: dateTo },
    });
  } catch (err) {
    console.error("[vehicles] events error:", err);
    return res.status(500).json({
      ok: false,
      error: err && err.message ? err.message : "Error interno",
    });
  }
});

module.exports = router;
