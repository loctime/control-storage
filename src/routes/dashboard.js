  /**
   * GET /api/dashboard/summary
   * Resumen agregado para el dashboard de monitoreo de flota.
   * Lee desde apps/emails/dailyAlerts/{date}/meta/meta y vehicles.
   * GET /api/dashboard/enriched
   * Resumen enriquecido con datos de apps/emails/vehicles para cada vehículo.
   * GET /api/dashboard/audit?date=YYYY-MM-DD
   * Auditoría de inconsistencias entre dailyAlerts y vehicles.
   */

  const express = require("express");
  const router = express.Router();
  const admin = require("../firebaseAdmin");
  const { logger } = require("../utils/logger");
  const { auditDashboardData } = require("../services/dashboardAuditService");
  const { getDashboardSummaryEnriched, getDashboardByPeriod } = require("../services/dashboardEnrichmentService");
  const { normalizePlate } = require("../services/vehicleEventService");

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

  function normalizeDriverName(driverName) {
    return driverName == null ? "—" : String(driverName);
  }

  function normalizeKeyId(keyId) {
    return keyId == null ? "Sin llave asignada" : String(keyId);
  }

  function toIncidentCount(incident) {
    const raw = incident?.groupedEventsCount;
    const parsed = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  }

  function parseKeyInfo(raw) {
    if (raw == null) {
      return { keyNumber: null, keyLabel: "Sin llave asignada" };
    }
    const text = String(raw).trim();
    if (!text || text.toLowerCase() === "sin llave asignada") {
      return { keyNumber: null, keyLabel: "Sin llave asignada" };
    }
    const match = text.match(/llave[\s_-]*(\d+)/i) || text.match(/^(\d+)$/);
    const keyNumber = match ? Number(match[1]) : null;
    const keyLabel = keyNumber !== null ? `Llave ${keyNumber}` : `Llave ${text}`;
    return { keyNumber, keyLabel };
  }

  function buildEventLookups(events) {
    const incidentLookup = new Map();
    const eventLookup = new Map();
    const safeEvents = Array.isArray(events) ? events : [];

    for (const event of safeEvents) {
      const eventId = event?.eventId;
      if (eventId != null && !eventLookup.has(String(eventId))) {
        eventLookup.set(String(eventId), event);
      }

      const upsertIncident = (incidentRef) => {
        if (incidentRef == null) return;
        const key = String(incidentRef);
        const prev = incidentLookup.get(key) || {};
        incidentLookup.set(key, {
          keyId: prev.keyId ?? event?.keyId ?? null,
          driverName: prev.driverName ?? event?.driverName ?? null,
        });
      };

      upsertIncident(event?.incidentKey);
      upsertIncident(event?.groupedSpeedIncidentKey);
    }

    return { incidentLookup, eventLookup };
  }

  /**
   * Exceso de velocidad: modelo V2 (SPEEDING / SPEED_EXCESS) + legacy (exceso / exceso_velocidad),
   * alineado a vehicleEventService donde aplique.
   */
  function isSpeedExcessEvent(event) {
    if (!event || typeof event !== "object") return false;
    return (
      event.eventCategory === "SPEEDING" ||
      event.eventSubtype === "SPEED_EXCESS" ||
      event.eventCategory === "exceso_velocidad" ||
      event.type === "exceso" ||
      // Eventos ya marcados como parte de un grupo de exceso (merge en vehicleEventService)
      Boolean(event.groupedSpeedIncidentKey)
    );
  }

  function resolveIncidentFields(incident, lookups) {
    let keyId = incident?.keyId ?? null;
    let driverName = incident?.driverName ?? null;
    const incidentRefs = [incident?.groupedSpeedIncidentKey, incident?.incidentKey].filter(Boolean);

    for (const ref of incidentRefs) {
      const match = lookups.incidentLookup.get(String(ref));
      if (!match) continue;
      if (keyId == null && match.keyId != null) keyId = match.keyId;
      if (driverName == null && match.driverName != null) driverName = match.driverName;
      if (keyId != null && driverName != null) break;
    }

    if (keyId == null || driverName == null) {
      const incidentEventIds = Array.isArray(incident?.eventIds) ? incident.eventIds : [];
      for (const eventId of incidentEventIds) {
        const event = lookups.eventLookup.get(String(eventId));
        if (!event) continue;
        if (keyId == null && event?.keyId != null) keyId = event.keyId;
        if (driverName == null && event?.driverName != null) driverName = event.driverName;
        if (keyId != null && driverName != null) break;
      }
    }

    return { keyId, driverName };
  }

  function buildTopDriversKeysByVehicle(vehicle) {
    const speedIncidents = Array.isArray(vehicle?.speedIncidents) ? vehicle.speedIncidents : [];
    const allEvents = Array.isArray(vehicle?.events) ? vehicle.events : [];
    const eventsTruncated = Boolean(vehicle?.eventsTruncated);
    const grouped = new Map();
    const plate = vehicle?.plate || vehicle?.id || null;
    const speedEventCount = allEvents.reduce((n, e) => n + (isSpeedExcessEvent(e) ? 1 : 0), 0);

    // TEMPORAL — quitar tras confirmar formato de eventos y activación de MODO A
    if (allEvents.length > 0 && speedEventCount === 0) {
      console.log(
        "[DEBUG] MODO B forzado para",
        vehicle?.plate,
        "- sample event:",
        JSON.stringify(allEvents[0]),
      );
    }

    // MODO A: eventos completos — 1 por evento de velocidad (sin doble conteo con speedIncidents)
    if (!eventsTruncated && speedEventCount > 0) {
      for (const event of allEvents) {
        if (!isSpeedExcessEvent(event)) continue;
        const driverName = normalizeDriverName(event?.driverName);
        const keyId = normalizeKeyId(event?.keyId);
        const compositeKey = `${driverName}__${keyId}`;
        grouped.set(compositeKey, (grouped.get(compositeKey) || 0) + 1);
      }
    } else {
      // MODO B: eventos truncados o sin filas de velocidad en events — incidentes + huérfanos
      const eventLookups = buildEventLookups(vehicle?.events);
      for (const incident of speedIncidents) {
        const resolved = resolveIncidentFields(incident, eventLookups);
        const driverName = normalizeDriverName(resolved.driverName);
        const keyId = normalizeKeyId(resolved.keyId);
        const compositeKey = `${driverName}__${keyId}`;
        grouped.set(compositeKey, (grouped.get(compositeKey) || 0) + toIncidentCount(incident));
      }

      const processedEventIds = new Set();
      const speedIncidentKeys = new Set();
      for (const incident of speedIncidents) {
        const ids = Array.isArray(incident?.eventIds) ? incident.eventIds : [];
        for (const id of ids) {
          if (id != null) processedEventIds.add(String(id));
        }
        if (incident?.incidentKey != null) {
          speedIncidentKeys.add(String(incident.incidentKey));
        }
      }

      for (const event of allEvents) {
        if (!isSpeedExcessEvent(event)) continue;

        const eventId = event?.eventId;
        if (eventId != null && processedEventIds.has(String(eventId))) continue;

        const gKey = event?.groupedSpeedIncidentKey;
        if (gKey != null && speedIncidentKeys.has(String(gKey))) continue;

        const incKey = event?.incidentKey;
        if (incKey != null && speedIncidentKeys.has(String(incKey))) continue;

        const driverName = normalizeDriverName(event?.driverName);
        const keyId = normalizeKeyId(event?.keyId);
        const compositeKey = `${driverName}__${keyId}`;
        grouped.set(compositeKey, (grouped.get(compositeKey) || 0) + 1);
      }
    }

    return Array.from(grouped.entries())
      .map(([compositeKey, excessCount]) => {
        const [driverName, keyId] = compositeKey.split("__");
        const keyInfo = parseKeyInfo(keyId);
        return {
          driverName,
          keyNumber: keyInfo.keyNumber,
          keyLabel: keyInfo.keyLabel,
          plate,
          excesos: excessCount,
        };
      })
      .sort((a, b) => b.excesos - a.excesos)
      .slice(0, 5);
  }

  function buildTopDriversKeysByOperation(vehicleDetails) {
    const operationMap = new Map();

    for (const detail of vehicleDetails) {
      const operation = detail?.operacion || "Sin operación";
      if (!operationMap.has(operation)) {
        operationMap.set(operation, new Map());
      }
      const grouped = operationMap.get(operation);
      const items = Array.isArray(detail?.topDriversKeys) ? detail.topDriversKeys : [];

      for (const item of items) {
        const driverName = normalizeDriverName(item?.driverName);
        const keyInfo = item?.keyLabel
          ? { keyNumber: item?.keyNumber ?? null, keyLabel: String(item.keyLabel) }
          : parseKeyInfo(item?.keyId);
        const plate = item?.plate || detail?.plate || null;
        const compositeKey = `${driverName}__${String(keyInfo.keyNumber)}__${keyInfo.keyLabel}__${plate}`;
        const prev = grouped.get(compositeKey) || 0;
        grouped.set(compositeKey, prev + (Number(item?.excesos ?? item?.excessCount) || 0));
      }
    }

    return Array.from(operationMap.entries()).map(([operation, grouped]) => ({
      operationName: operation,
      topDriversKeys: Array.from(grouped.entries())
        .map(([compositeKey, excessCount]) => {
          const [driverName, keyNumberRaw, keyLabel, plate] = compositeKey.split("__");
          const keyNumber = keyNumberRaw === "null" ? null : Number(keyNumberRaw);
          return {
            keyNumber,
            keyLabel,
            driverName: driverName ?? "—",
            plate: plate ?? null,
            excesos: Number(excessCount) || 0,
          };
        })
        .sort((a, b) => b.excesos - a.excesos)
        .slice(0, 3),
    }));
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

  /**
   * GET /enriched?period=day|week|month|year&date=YYYY-MM-DD|YYYY-MM|YYYY
   * Resumen enriquecido con dailyBreakdown
   * period: day (default), week, month, year
   * date: YYYY-MM-DD para day/week, YYYY-MM para month, YYYY para year
   */
  router.get("/enriched", async (req, res) => {
    console.log("[AUDIT-BACK] GET /api/dashboard/enriched query.period =", req.query.period);
    console.log("[AUDIT-BACK] GET /api/dashboard/enriched query.date =", req.query.date);
    try {
      const period = (req.query.period || "day").toLowerCase();
      let dateParam = req.query.date;

      // Si no se proporciona date, obtener el último día con datos
      if (!dateParam) {
        const lastDate = await getLastDateWithData();
        dateParam = lastDate;
        if (!dateParam) {
          const dailyBreakdown = period !== "day" ? [] : null;
          const vehicleDetails = [];
          const topDriversKeysByOperation = [];
          console.log(
            "[AUDIT-BACK] GET /api/dashboard/enriched pre-response dailyBreakdown =",
            dailyBreakdown === null
              ? "null"
              : dailyBreakdown === undefined
                ? "undefined"
                : Array.isArray(dailyBreakdown)
                  ? `array(length=${dailyBreakdown.length})`
                  : typeof dailyBreakdown
          );
          console.log(
            "[AUDIT-BACK] GET /api/dashboard/enriched pre-response vehicleDetails length =",
            vehicleDetails.length
          );
          const responseObject = {
            ok: true,
            period: period,
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
            vehicleDetails: vehicleDetails,
            topDriversKeysByOperation: topDriversKeysByOperation,
            enrichmentStats: { total: 0, succeeded: 0, failed: 0 },
            dailyBreakdown: dailyBreakdown,
            message: "No hay datos disponibles para ningún día",
          };
          console.log("[AUDIT-BACK] keys enviados:", Object.keys(responseObject));
          return res.status(200).json(responseObject);
        }
      }

      const result = await getDashboardByPeriod(period, dateParam, { maxConcurrency: 10 });

      if (!result.ok) {
        return res.status(400).json(result);
      }

      // Construir vehicleDetails a partir de los vehículos enriquecidos
      const vehicleDetails = (result.vehicles || []).map((v) => ({
        plate: v.plate,
        excesos: v.summary?.excesos ?? 0,
        operacion: v.operacion || v.operationName || null,
        riskScore: v.riskScore ?? 0,
        responsable: v.responsable ?? null,
        responsables: Array.isArray(v.responsables) ? v.responsables : [],
        responsablesNormalized: Array.isArray(v.responsablesNormalized) ? v.responsablesNormalized : [],
        lastEventAt: v.lastEventAt ?? null,
        maxSpeed: v.maxSpeed ?? null,
        topSpeedEvent: v.topSpeedEvent ?? null,
        speedingDrivers: Array.isArray(v.speedingDrivers) ? v.speedingDrivers : [],
        speedIncidents: Array.isArray(v.speedIncidents) ? v.speedIncidents : [],
        topDriversKeys: buildTopDriversKeysByVehicle(v),
        llave_sin_cargar: v.llave_sin_cargar ?? 0,
        no_identificados: v.no_identificados ?? 0,
        contactos: v.contactos ?? 0,
        conductor_inactivo: v.conductor_inactivo ?? 0,
        events: Array.isArray(v.events) ? v.events : [],
        _enrichedFrom: v._enrichedFrom,
        _dataSource: v._dataSource,
      }));
      const topDriversKeysByOperation = buildTopDriversKeysByOperation(vehicleDetails);

      logger.debug("[dashboard/enriched] OK", {
        period,
        date: dateParam,
        totalVehicles: result.summary.totalVehicles,
        enrichmentStats: result.enrichmentStats,
        dailyBreakdownSize: Array.isArray(result.dailyBreakdown) ? result.dailyBreakdown.length : null,
      });

      console.log(
        "[AUDIT-BACK] GET /api/dashboard/enriched pre-response dailyBreakdown =",
        result.dailyBreakdown === null
          ? "null"
          : result.dailyBreakdown === undefined
            ? "undefined"
            : Array.isArray(result.dailyBreakdown)
              ? `array(length=${result.dailyBreakdown.length})`
              : typeof result.dailyBreakdown
      );
      console.log(
        "[AUDIT-BACK] GET /api/dashboard/enriched pre-response vehicleDetails length =",
        vehicleDetails.length
      );

      const responseObject = {
        ok: true,
        period: period,
        date: result.date,
        summary: result.summary,
        distribution: result.distribution ?? null,
        criticalAlerts: result.criticalAlerts,
        topVehicles: result.topVehicles,
        recentEvents: result.recentEvents,
        riskMap: result.riskMap,
        vehicleDetails: vehicleDetails,
        topDriversKeysByOperation: topDriversKeysByOperation,
        enrichmentStats: result.enrichmentStats,
        dailyBreakdown: result.dailyBreakdown ?? null,
      };
      console.log("[AUDIT-BACK] keys enviados:", Object.keys(responseObject));
      return res.status(200).json(responseObject);
    } catch (err) {
      logger.error("[dashboard/enriched] Error", { error: err.message });
      return res.status(500).json({
        ok: false,
        error: "error interno",
        message: process.env.NODE_ENV === "development" ? err.message : undefined,
      });
    }
  });

  /**
   * GET /audit?date=YYYY-MM-DD
   * Auditoría de datos del dashboard.
   * Devuelve inconsistencias entre dailyAlerts (legacy) y apps/emails/vehicles (correcto).
   * Respuesta:
   * {
   *   "date": "2026-03-25",
   *   "totalVehicles": 150,
   *   "vehiclesWithOperacion": 145,
   *   "vehiclesWithoutOperacion": 5,
   *   "vehiclesWithValidResponsables": 140,
   *   "vehiclesWithLegacyResponsables": 10,
   *   "legacyEmailsFound": ["controldoc@controldoc.app", ...],
   *   "mismatches": [
   *     {
   *       "plate": "ABC123",
   *       "operacionFromDailyAlerts": "Operacion A",
   *       "operacionFromVehicles": "Operacion B",
   *       "match": false
   *     }
   *   ],
   *   "summary": "X vehicles have inconsistencies..."
   * }
   */
  router.get("/audit", async (req, res) => {
    try {
      const dateKey = parseDateKey(req.query.date);
      if (!dateKey) {
        return res.status(400).json({
          error: "Query date requerido en formato YYYY-MM-DD",
          example: "?date=2026-03-25",
        });
      }

      const auditResult = await auditDashboardData(dateKey);

      if (!auditResult.ok) {
        return res.status(400).json(auditResult);
      }

      logger.info("[dashboard/audit] Audit completed", {
        dateKey,
        totalVehicles: auditResult.totalVehicles,
        mismatchesFound: auditResult.mismatches.length,
        legacyEmailsCount: auditResult.legacyEmailsFound.length,
      });

      return res.status(200).json({
        ok: true,
        ...auditResult,
      });
    } catch (err) {
      logger.error("[dashboard/audit] Error", { error: err.message });
      return res.status(500).json({
        ok: false,
        error: "error interno",
        message: process.env.NODE_ENV === "development" ? err.message : undefined,
      });
    }
  });

  /**
   * GET /audit-events?date=YYYY-MM-DD&plate=ABC123
   * Auditoría temporal: compara eventos entre dailyAlerts (dashboard) y subcolección events del vehículo (historial).
   */
  router.get("/audit-events", async (req, res) => {
    try {
      const dateKey = parseDateKey(req.query.date);
      const rawPlate = typeof req.query.plate === "string" ? req.query.plate.trim() : "";
      if (!dateKey || !rawPlate) {
        return res.status(400).json({
          error: "Parámetros requeridos: date=YYYY-MM-DD, plate=ABC123",
        });
      }

      const plate = normalizePlate(rawPlate);
      if (!plate) {
        return res.status(400).json({
          error: "Patente inválida",
        });
      }

      const dailyDoc = await db
        .collection("apps")
        .doc("emails")
        .collection("dailyAlerts")
        .doc(dateKey)
        .collection("vehicles")
        .doc(plate)
        .get();

      const dailyData = dailyDoc.exists ? dailyDoc.data() : null;
      const dailyEvents = Array.isArray(dailyData?.events) ? dailyData.events : [];
      const dailySpeedIncidents = Array.isArray(dailyData?.speedIncidents) ? dailyData.speedIncidents : [];

      const vehicleEventsSnap = await db
        .collection("apps")
        .doc("emails")
        .collection("vehicles")
        .doc(plate)
        .collection("events")
        .where("eventTimestamp", ">=", `${dateKey}T00:00:00`)
        .where("eventTimestamp", "<=", `${dateKey}T23:59:59`)
        .get();

      const vehicleEvents = vehicleEventsSnap.docs.map((d) => d.data());

      const dailyFiltered = dailyEvents.filter(isSpeedExcessEvent);
      const vehicleFiltered = vehicleEvents.filter(isSpeedExcessEvent);

      const dailyIds = new Set(dailyFiltered.map((e) => e.eventId).filter(Boolean));
      const vehicleIds = new Set(vehicleFiltered.map((e) => e.eventId).filter(Boolean));

      const onlyInDaily = dailyFiltered.filter((e) => e.eventId && !vehicleIds.has(e.eventId));
      const onlyInVehicle = vehicleFiltered.filter((e) => e.eventId && !dailyIds.has(e.eventId));
      const inBoth = dailyFiltered.filter((e) => e.eventId && vehicleIds.has(e.eventId));

      return res.status(200).json({
        ok: true,
        date: dateKey,
        plate,
        summary: {
          dailyEventsTotal: dailyEvents.length,
          dailySpeedIncidents: dailySpeedIncidents.length,
          dailyFilteredByFunction: dailyFiltered.length,
          vehicleEventsTotal: vehicleEvents.length,
          vehicleFilteredByFunction: vehicleFiltered.length,
          inBoth: inBoth.length,
          onlyInDaily: onlyInDaily.length,
          onlyInVehicle: onlyInVehicle.length,
        },
        details: {
          dailySummary: dailyData?.summary ?? null,
          onlyInDaily: onlyInDaily.map((e) => ({
            eventId: e.eventId,
            category: e.eventCategory,
            subtype: e.eventSubtype,
            type: e.type,
            hasGroupedKey: Boolean(e.groupedSpeedIncidentKey),
            hasSpeed: e.hasSpeed,
            speed: e.speed,
          })),
          onlyInVehicle: onlyInVehicle.map((e) => ({
            eventId: e.eventId,
            category: e.eventCategory,
            subtype: e.eventSubtype,
            type: e.type,
            speed: e.speed,
            timestamp: e.eventTimestamp,
          })),
        },
      });
    } catch (err) {
      logger.error("[dashboard/audit-events] Error", { error: err.message });
      return res.status(500).json({
        ok: false,
        error: "error interno",
        message: process.env.NODE_ENV === "development" ? err.message : undefined,
      });
    }
  });

  module.exports = router;
