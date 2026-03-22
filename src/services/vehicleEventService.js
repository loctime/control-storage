/**
 * vehicleEventService.js
 * Servicio para persistir eventos de vehículos y actualizar resumen por patente.
 * Rutas: apps/emails/vehicleEvents/{eventId}, apps/emails/vehicles/{plate}
 */

const crypto = require("crypto");
const admin = require("../firebaseAdmin");

const MAX_BATCH_SIZE = 500;
const MAX_DAILY_EVENTS_STORED = Math.max(
  1,
  parseInt(process.env.RSV_V2_MAX_DAILY_EVENTS_STORED || "250", 10) || 250,
);
const EVENT_SOURCE_RSV = "RSV";
const EVENT_CATEGORY_DRIVER_IDENTIFICATION = "DRIVER_IDENTIFICATION";
const EVENT_CATEGORY_SPEEDING = "SPEEDING";
const EVENT_SUBTYPE_CONTACT_NO_DRIVER = "CONTACT_NO_DRIVER";
const EVENT_SUBTYPE_DRIVER_NOT_IDENTIFIED = "DRIVER_NOT_IDENTIFIED";
const EVENT_SUBTYPE_UNKNOWN_KEY = "UNKNOWN_KEY";
const EVENT_SUBTYPE_INACTIVE_DRIVER = "INACTIVE_DRIVER";
const EVENT_SUBTYPE_NO_KEY_DETECTED = "NO_KEY_DETECTED";
const EVENT_SUBTYPE_SPEED_EXCESS = "SPEED_EXCESS";
const SPEED_GROUPING_WINDOW_SECONDS = 180;

function isRsvV2ModelDualWriteEnabled() {
  return process.env.RSV_V2_EVENT_MODEL_DUAL_WRITE === "true";
}

function isRsvV2RiskModelEnabled() {
  return process.env.RSV_V2_RISK_MODEL_ENABLED === "true";
}

function isRsvV2SpeedEventsEnabled() {
  return process.env.RSV_V2_SPEED_EVENTS_ENABLED === "true";
}

function isRsvV2SpeedGroupingEnabled() {
  return process.env.RSV_V2_SPEED_GROUPING_ENABLED === "true";
}

function resolveSubtypeFromLegacyType(eventType) {
  switch (eventType) {
    case "exceso":
      return EVENT_SUBTYPE_SPEED_EXCESS;
    case "contacto":
      return EVENT_SUBTYPE_CONTACT_NO_DRIVER;
    case "llave_no_registrada":
    case "sin_llave":
      return EVENT_SUBTYPE_UNKNOWN_KEY;
    case "conductor_inactivo":
      return EVENT_SUBTYPE_INACTIVE_DRIVER;
    case "no_identificado":
    default:
      return EVENT_SUBTYPE_DRIVER_NOT_IDENTIFIED;
  }
}

function resolveDateKeyFromTimestamp(eventTimestamp) {
  if (eventTimestamp && /^\d{4}-\d{2}-\d{2}/.test(String(eventTimestamp))) {
    return String(eventTimestamp).slice(0, 10);
  }
  return formatDateKey(new Date());
}

function buildIncidentKey(plate, dateKey, eventSubtype) {
  const normalizedPlate = normalizePlate(plate);
  const subtype = eventSubtype || EVENT_SUBTYPE_DRIVER_NOT_IDENTIFIED;
  return `${normalizedPlate}_${dateKey}_${subtype}`;
}

function isSpeedingEvent(event) {
  return (
    event?.eventCategory === EVENT_CATEGORY_SPEEDING ||
    event?.eventSubtype === EVENT_SUBTYPE_SPEED_EXCESS ||
    (event?.type === "exceso" && typeof event?.speed === "number")
  );
}

function normalizeLocationForIncident(location) {
  return String(location || "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function buildSpeedIncidentBaseKey(event) {
  const plate = normalizePlate(event?.plate || "");
  const dateKey = resolveDateKeyFromTimestamp(event?.eventTimestamp);
  const location = normalizeLocationForIncident(event?.locationRaw || event?.location || "");
  return `${plate}_${dateKey}_${location || "SIN_UBICACION"}_${EVENT_SUBTYPE_SPEED_EXCESS}`;
}

function toEpochMs(value) {
  if (!value) return null;
  const d = new Date(value);
  const ms = d.getTime();
  return Number.isNaN(ms) ? null : ms;
}

function isAlreadyExistsError(error) {
  return error?.code === 6 || error?.code === "already-exists" || error?.code === "ALREADY_EXISTS";
}

function sortEventsByTimestampAsc(events) {
  return [...(Array.isArray(events) ? events : [])].sort((a, b) => {
    const aTs = toEpochMs(a?.eventTimestamp);
    const bTs = toEpochMs(b?.eventTimestamp);
    if (aTs != null && bTs != null && aTs !== bTs) return aTs - bTs;
    if (aTs != null && bTs == null) return -1;
    if (aTs == null && bTs != null) return 1;
    return String(a?.eventId || "").localeCompare(String(b?.eventId || ""));
  });
}

function trimStoredEvents(events, plate, dateKey) {
  const sorted = sortEventsByTimestampAsc(events);
  if (sorted.length <= MAX_DAILY_EVENTS_STORED) {
    return {
      storedEvents: sorted,
      wasTruncated: false,
      truncatedCount: 0,
    };
  }

  const truncatedCount = sorted.length - MAX_DAILY_EVENTS_STORED;
  console.warn(
    `[RSV_V2] Truncating stored daily events for ${normalizePlate(plate)} on ${dateKey}. Keeping ${MAX_DAILY_EVENTS_STORED} newest events and dropping ${truncatedCount} oldest events from the document payload.`,
  );

  return {
    storedEvents: sorted.slice(-MAX_DAILY_EVENTS_STORED),
    wasTruncated: true,
    truncatedCount,
  };
}

function getSpeedSeverity(maxSpeed) {
  if (!Number.isFinite(maxSpeed)) return "low";
  if (maxSpeed > 150) return "critical";
  if (maxSpeed > 130) return "high";
  if (maxSpeed > 110) return "medium";
  return "low";
}

function groupSpeedingIncidents(events) {
  if (!isRsvV2SpeedGroupingEnabled()) return [];
  const speeding = (Array.isArray(events) ? events : [])
    .filter((e) => isSpeedingEvent(e) && typeof e.speed === "number")
    .map((e) => ({
      ...e,
      __ts: toEpochMs(e.eventTimestamp),
      __baseKey: buildSpeedIncidentBaseKey(e),
    }))
    .filter((e) => e.__ts != null)
    .sort((a, b) => a.__ts - b.__ts);

  const groups = [];
  const countersByBase = new Map();
  let current = null;

  for (const event of speeding) {
    if (!current) {
      current = { baseKey: event.__baseKey, events: [event], firstTs: event.__ts, lastTs: event.__ts };
      continue;
    }

    const sameBase = current.baseKey === event.__baseKey;
    const withinWindow = event.__ts - current.lastTs <= SPEED_GROUPING_WINDOW_SECONDS * 1000;

    if (sameBase && withinWindow) {
      current.events.push(event);
      current.lastTs = event.__ts;
    } else {
      groups.push(current);
      current = { baseKey: event.__baseKey, events: [event], firstTs: event.__ts, lastTs: event.__ts };
    }
  }
  if (current) groups.push(current);

  return groups
    .filter((group) => group.events.length > 1)
    .map((group) => {
    const idx = countersByBase.get(group.baseKey) || 0;
    countersByBase.set(group.baseKey, idx + 1);
    const incidentKey = idx === 0 ? group.baseKey : `${group.baseKey}_G${idx + 1}`;
    const speeds = group.events.map((e) => e.speed).filter((n) => Number.isFinite(n));
    const maxSpeed = speeds.length > 0 ? Math.max(...speeds) : null;
    const avgSpeed = speeds.length > 0 ? Math.round((speeds.reduce((a, b) => a + b, 0) / speeds.length) * 10) / 10 : null;
    const durationSeconds = Math.max(0, Math.floor((group.lastTs - group.firstTs) / 1000));
    const driver = group.events.find((e) => e.driverName)?.driverName || null;
    const keyId = group.events.find((e) => e.keyId)?.keyId || null;
    const hasNoKeyDetected = group.events.some((e) => e.eventSubtype === EVENT_SUBTYPE_NO_KEY_DETECTED);
    const hasUnidentifiedDriver = group.events.some((e) => e.eventSubtype === EVENT_SUBTYPE_DRIVER_NOT_IDENTIFIED);

      return {
        incidentKey,
        eventCategory: EVENT_CATEGORY_SPEEDING,
        eventSubtype: EVENT_SUBTYPE_SPEED_EXCESS,
        groupedEventsCount: group.events.length,
        maxSpeed,
        avgSpeed,
        durationSeconds,
        severity: getSpeedSeverity(maxSpeed),
        location: group.events[0].locationRaw || group.events[0].location || "",
        plate: normalizePlate(group.events[0].plate || ""),
        firstEventAt: group.events[0].eventTimestamp || null,
        lastEventAt: group.events[group.events.length - 1].eventTimestamp || null,
        driverName: driver,
        keyId,
        causeSubtype: hasNoKeyDetected
          ? EVENT_SUBTYPE_NO_KEY_DETECTED
          : hasUnidentifiedDriver
            ? EVENT_SUBTYPE_DRIVER_NOT_IDENTIFIED
            : null,
        eventIds: group.events.map((e) => e.eventId).filter(Boolean),
      };
    });
}

function computeIncidentSummary(events) {
  const bySubtype = {
    [EVENT_SUBTYPE_CONTACT_NO_DRIVER]: 0,
    [EVENT_SUBTYPE_DRIVER_NOT_IDENTIFIED]: 0,
    [EVENT_SUBTYPE_UNKNOWN_KEY]: 0,
    [EVENT_SUBTYPE_INACTIVE_DRIVER]: 0,
  };

  const seenIncidentKeys = new Set();
  const speedIncidents = groupSpeedingIncidents(events);
  for (const event of Array.isArray(events) ? events : []) {
    if (isSpeedingEvent(event)) continue;
    const subtype = event.eventSubtype || resolveSubtypeFromLegacyType(event.type);
    const dateKey = resolveDateKeyFromTimestamp(event.eventTimestamp);
    const incidentKey = event.incidentKey || buildIncidentKey(event.plate || "", dateKey, subtype);
    if (!incidentKey || seenIncidentKeys.has(incidentKey)) continue;
    seenIncidentKeys.add(incidentKey);
    bySubtype[subtype] = (bySubtype[subtype] || 0) + 1;
  }

  const totalUniqueIncidents =
    (bySubtype[EVENT_SUBTYPE_CONTACT_NO_DRIVER] || 0) +
    (bySubtype[EVENT_SUBTYPE_DRIVER_NOT_IDENTIFIED] || 0) +
    (bySubtype[EVENT_SUBTYPE_UNKNOWN_KEY] || 0) +
    (bySubtype[EVENT_SUBTYPE_INACTIVE_DRIVER] || 0);

  const uniqueOperationalIncidents =
    (bySubtype[EVENT_SUBTYPE_DRIVER_NOT_IDENTIFIED] || 0) +
    (bySubtype[EVENT_SUBTYPE_UNKNOWN_KEY] || 0) +
    (bySubtype[EVENT_SUBTYPE_INACTIVE_DRIVER] || 0);

  return {
    totalUniqueIncidents,
    uniqueOperationalIncidents,
    uniqueTechnicalIncidents: bySubtype[EVENT_SUBTYPE_CONTACT_NO_DRIVER] || 0,
    bySubtype,
    totalSpeedIncidents: speedIncidents.length,
    speedIncidents,
  };
}

function getDb() {
  return admin.firestore();
}

/**
 * Normaliza patente: elimina espacios, guiones y caracteres especiales, convierte a uppercase.
 * Garantiza consistencia para evitar documentos duplicados en Firestore.
 * 
 * Ejemplos:
 * - "af-999-ef" → "AF999EF"
 * - "AF 999 EF" → "AF999EF"
 * - "af 999 ef" → "AF999EF"
 * - "AB-123-CD" → "AB123CD"
 */
function normalizePlate(plate) {
  if (!plate || typeof plate !== "string") return "";
  return plate
    .replace(/[^a-zA-Z0-9]/g, "") // Elimina espacios, guiones y caracteres especiales
    .toUpperCase()
    .trim();
}

/**
 * Normaliza email: trim + toLowerCase.
 * Duplicado ligero de lógica de emailUsers.service para evitar dependencia circular.
 * @param {string} email
 * @returns {string}
 */
function normalizeEmail(email) {
  if (email == null || typeof email !== "string") return "";
  return email.trim().toLowerCase();
}

/**
 * Normaliza y deduplica un arreglo de correos.
 * @param {Array<string>} values
 * @returns {string[]}
 */
function normalizeEmailArray(values) {
  if (!Array.isArray(values)) return [];
  const set = new Set();
  for (const raw of values) {
    const n = normalizeEmail(raw);
    if (n) set.add(n);
  }
  return Array.from(set);
}

/**
 * Obtiene el documento del vehículo si existe.
 * @param {string} plate - Patente (normalizada o raw)
 * @returns {Promise<object|null>} Datos del vehículo o null si no existe
 */
async function getVehicle(plate) {
  if (!plate) return null;
  const db = getDb();
  const normalized = normalizePlate(plate);
  const docSnap = await db
    .collection("apps")
    .doc("emails")
    .collection("vehicles")
    .doc(normalized)
    .get();
  const baseVehicle = docSnap.exists ? { id: docSnap.id, ...docSnap.data() } : null;

  const masterCandidates = [
    db.collection("apps").doc("fleet").collection("vehicles").doc(normalized),
    db.collection("apps").doc("master").collection("vehicles").doc(normalized),
    db.collection("vehicles").doc(normalized),
  ];

  let masterVehicle = null;
  for (const candidate of masterCandidates) {
    const snap = await candidate.get();
    if (snap.exists) {
      masterVehicle = { id: snap.id, ...snap.data() };
      break;
    }
  }

  if (!baseVehicle && !masterVehicle) return null;

  const operationName =
    masterVehicle?.operationName ||
    masterVehicle?.operacion ||
    baseVehicle?.operationName ||
    baseVehicle?.operacion ||
    null;

  return {
    ...(baseVehicle || {}),
    ...(masterVehicle || {}),
    id: normalized,
    plate: normalized,
    operationName,
    operacion: operationName,
  };
}

/**
 * Genera un eventId determinístico para deduplicación.
 * @param {string} plate - Patente del vehículo
 * @param {string} eventTimestamp - ISO timestamp del evento (con offset)
 * @param {string} rawLine - Línea cruda del email
 * @returns {string} Hash SHA256 truncado (primeros 32 chars hex)
 */
function generateDeterministicEventId(plate, eventTimestamp, rawLine) {
  const payload = `${plate}|${eventTimestamp}|${rawLine || ""}`;
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 32);
}

/**
 * Guarda eventos en apps/emails/vehicleEvents usando batch writes.
 * Deduplicación automática por eventId determinístico.
 * Modelo: type, sourceEmailType, reason, vehicleRegistered, speed, eventTimestamp, etc.
 * @param {Array<object>} events - Array de eventos (normalizados, con vehicleRegistered)
 * @param {string} messageId - ID del email
 * @param {string} source - Origen (ej: "outlook-local")
 * @returns {{ created: number, skipped: number }} created = escritos, skipped = 0
 */
async function saveVehicleEvents(events, messageId, source) {
  if (!events || events.length === 0) return { created: 0, skipped: 0 };

  const baseRef = getDb().collection("apps").doc("emails").collection("vehicleEvents");
  let created = 0;
  let skipped = 0;

  for (const event of events) {
    const eventId = event.eventId || generateDeterministicEventId(
      event.plate,
      event.eventTimestamp,
      event.rawLine
    );

    const docRef = baseRef.doc(eventId);
    const dateKey = resolveDateKeyFromTimestamp(event.eventTimestamp);
    const isSpeeding = isSpeedingEvent(event);
    const eventSubtype = event.eventSubtype || resolveSubtypeFromLegacyType(event.type);
    const incidentKey = event.incidentKey || (
      isSpeeding
        ? buildSpeedIncidentBaseKey(event)
        : buildIncidentKey(event.plate, dateKey, eventSubtype)
    );
    const v2DualWrite = isRsvV2ModelDualWriteEnabled();

    const docData = {
      ...event,
      type: event.type ?? (isSpeeding ? "exceso" : "no_identificado"),
      sourceEmailType: event.sourceEmailType ?? "excesos_del_dia",
      reason: event.reason ?? null,
      reasonRaw: event.reasonRaw ?? event.reason ?? null,
      rawEventType: event.rawEventType ?? null,
      speed: typeof event.speed === "number" ? event.speed : null,
      speedLimit: event.speedLimit ?? null,
      speedDelta: event.speedDelta ?? null,
      groupedEventsCount: event.groupedEventsCount ?? (isSpeeding ? 1 : null),
      maxSpeed: event.maxSpeed ?? (isSpeeding ? (typeof event.speed === "number" ? event.speed : null) : null),
      vehicleRegistered: event.vehicleRegistered ?? true,
      messageId: messageId || null,
      source: source || "outlook-local",
      eventId,
      dateKey,
      ...(v2DualWrite
        ? {
            eventSource: event.eventSource || EVENT_SOURCE_RSV,
            eventCategory: event.eventCategory || (isSpeeding ? EVENT_CATEGORY_SPEEDING : EVENT_CATEGORY_DRIVER_IDENTIFICATION),
            eventSubtype,
            incidentKey,
            timestampSource: event.timestampSource || "EMAIL_EVENT",
          }
        : {}),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    try {
      await docRef.create(docData);
      created++;
    } catch (error) {
      if (isAlreadyExistsError(error)) {
        skipped++;
        continue;
      }
      throw error;
    }
  }

  return { created, skipped };
}

/**
 * Crea el documento del vehículo en apps/emails/vehicles/{plate} con datos mínimos del evento.
 * @param {object} event - Evento parseado/normalizado
 * @returns {object} Datos del vehículo creado
 */
async function createVehicleFromEvent(event) {
  const db = getDb();
  const rawPlate = event.plate;
  if (!rawPlate) return null;

  const plate = normalizePlate(rawPlate);
  const docRef = db.collection("apps").doc("emails").collection("vehicles").doc(plate);
  const docSnap = await docRef.get();
  if (docSnap.exists) return { id: docSnap.id, ...docSnap.data() };

  const now = admin.firestore.FieldValue.serverTimestamp();
  const hasValidBrand = event.brand && String(event.brand).trim().length > 0;
  const hasValidModel = event.model && String(event.model).trim().length > 0;
  const isSpeedingEvent = event.type === "exceso" || event.eventCategory === "exceso_velocidad";

  await docRef.set({
    plate,
    brand: hasValidBrand ? event.brand.trim() : "",
    model: hasValidModel ? event.model.trim() : "",
    lastLocation: event.location || "",
    lastSpeed: event.speed ?? null,
    lastEventTimestamp: event.eventTimestamp || null,
    totalEvents: 1,
    totalSpeedingEvents: isSpeedingEvent ? 1 : 0,
    operationName: event.operationName || event.operacion || null,
    operacion: event.operationName || event.operacion || null,
    updatedAt: now,
    createdAt: now,
  });

  return { id: plate, plate, brand: event.brand || "", model: event.model || "" };
}

/**
 * Crea o actualiza el documento del vehículo en apps/emails/vehicles/{plate}.
 * No sobrescribe brand/model si el evento viene incompleto.
 * @param {object} event - Evento parseado
 */
async function upsertVehicle(event) {
  const db = getDb();
  const rawPlate = event.plate;
  if (!rawPlate) return;

  const plate = normalizePlate(rawPlate);
  const docRef = db.collection("apps").doc("emails").collection("vehicles").doc(plate);

  const docSnap = await docRef.get();
  const now = admin.firestore.FieldValue.serverTimestamp();

  const hasValidBrand = event.brand && String(event.brand).trim().length > 0;
  const hasValidModel = event.model && String(event.model).trim().length > 0;
  const isSpeedingEvent =
    event.type === "exceso" || event.eventCategory === "exceso_velocidad";

  if (!docSnap.exists) {
    await docRef.set({
      plate,
      brand: hasValidBrand ? event.brand.trim() : "",
      model: hasValidModel ? event.model.trim() : "",
      lastLocation: event.location || "",
      lastSpeed: event.speed,
      lastEventTimestamp: event.eventTimestamp,
      totalEvents: 1,
      totalSpeedingEvents: isSpeedingEvent ? 1 : 0,
      operationName: event.operationName || event.operacion || null,
      operacion: event.operationName || event.operacion || null,
      updatedAt: now,
      createdAt: now,
    });
  } else {
    const existing = docSnap.data();
    const updates = {
      lastLocation: event.location || existing.lastLocation || "",
      lastSpeed: event.speed,
      lastEventTimestamp: event.eventTimestamp,
      totalEvents: admin.firestore.FieldValue.increment(1),
      updatedAt: now,
    };

    if (hasValidBrand) updates.brand = event.brand.trim();
    if (hasValidModel) updates.model = event.model.trim();
    if (event.operationName || event.operacion) {
      updates.operationName = event.operationName || event.operacion;
      updates.operacion = event.operationName || event.operacion;
    }

    if (isSpeedingEvent) {
      updates.totalSpeedingEvents = admin.firestore.FieldValue.increment(1);
    }

    await docRef.update(updates);
  }
}

/**
 * Formatea fecha como YYYY-MM-DD.
 */
function formatDateKey(d) {
  const date = d instanceof Date ? d : new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Severidad única: todos los eventos se consideran críticos.
 * @param {string} _eventType - Tipo de evento (no usado)
 * @returns {string} "critico"
 */
function getSeverityByType(_eventType) {
  return "critico";
}

/**
 * Actualiza el documento meta del día usando FieldValue.increment.
 * Idempotente: solo debe llamarse cuando isNewEvent === true.
 *
 * Estructura meta: dateKey, totalVehicles, totalEvents, totalCriticos,
 * totalAdvertencias, totalAdministrativos, vehiclesWithCritical, lastUpdatedAt.
 *
 * @param {string} dateKey - Fecha YYYY-MM-DD
 * @param {object} eventSummary - Evento con severity
 * @param {object} opts - { isNewEvent: boolean, isNewVehicle: boolean, hadCriticalBefore: boolean }
 */
async function updateDailyMeta(dateKey, eventSummary, opts) {
  if (!opts || opts.isNewEvent !== true) return;

  const db = getDb();
  const metaRef = db
    .collection("apps")
    .doc("emails")
    .collection("dailyAlerts")
    .doc(dateKey)
    .collection("meta")
    .doc("meta");

  const FieldValue = admin.firestore.FieldValue;
  const eventType = eventSummary.type || "exceso";
  const summaryKey = normalizeEventTypeForSummary(eventType);
  const metaTypeField = getMetaFieldForType(summaryKey);

  const update = {
    dateKey,
    lastUpdatedAt: FieldValue.serverTimestamp(),
    totalEvents: FieldValue.increment(1),
    totalCriticos: FieldValue.increment(1),
    [metaTypeField]: FieldValue.increment(1),
  };

  if (opts.isNewVehicle) {
    update.totalVehicles = FieldValue.increment(1);
  }
  if (opts.isNewVehicle || !opts.hadCriticalBefore) {
    update.vehiclesWithCritical = FieldValue.increment(1);
  }

  await metaRef.set(update, { merge: true });
}

/** Tipos de evento permitidos para summary y meta. */
const SUMMARY_EVENT_TYPES = new Set([
  "excesos",
  "no_identificados",
  "contactos",
  "llave_sin_cargar",
  "conductor_inactivo",
]);

/**
 * Normaliza el tipo de evento para el summary.
 * Mapea tipos específicos a claves del summary (siempre uno de los 5 tipos).
 * @param {string} eventType - Tipo de evento original
 * @returns {string} Clave para el summary
 */
function normalizeEventTypeForSummary(eventType) {
  const typeMap = {
    exceso: "excesos",
    no_identificado: "no_identificados",
    contacto: "contactos",
    llave_no_registrada: "llave_sin_cargar",
    sin_llave: "llave_sin_cargar",
    conductor_inactivo: "conductor_inactivo",
    CONTACT_NO_DRIVER: "contactos",
    DRIVER_NOT_IDENTIFIED: "no_identificados",
    UNKNOWN_KEY: "llave_sin_cargar",
    INACTIVE_DRIVER: "conductor_inactivo",
    SPEED_EXCESS: "excesos",
  };
  return typeMap[eventType] || "no_identificados";
}

/**
 * Nombre del campo en meta del día para totales por tipo.
 * @param {string} summaryKey - excesos | no_identificados | contactos | llave_sin_cargar | conductor_inactivo
 * @returns {string}
 */
function getMetaFieldForType(summaryKey) {
  const fieldMap = {
    excesos: "totalExcesos",
    no_identificados: "totalNoIdentificados",
    contactos: "totalContactos",
    llave_sin_cargar: "totalLlaveSinCargar",
    conductor_inactivo: "totalConductorInactivo",
  };
  return fieldMap[summaryKey] || "totalNoIdentificados";
}

/**
 * Score de riesgo = total de eventos (cantidad). Sin distinción por severidad.
 * @param {object} summary - summary del documento (excesos, no_identificados, contactos, etc.)
 * @param {Array<object>} events - Array de eventSummary
 * @returns {number}
 */
function computeRiskScore(summary, events) {
  if (isRsvV2RiskModelEnabled()) {
    const incidentSummary = computeIncidentSummary(events);
    const contactIncidents = Math.min(incidentSummary.bySubtype[EVENT_SUBTYPE_CONTACT_NO_DRIVER] || 0, 2);
    const operationalIncidents =
      (incidentSummary.bySubtype[EVENT_SUBTYPE_DRIVER_NOT_IDENTIFIED] || 0) +
      (incidentSummary.bySubtype[EVENT_SUBTYPE_UNKNOWN_KEY] || 0) +
      (incidentSummary.bySubtype[EVENT_SUBTYPE_INACTIVE_DRIVER] || 0);

    const speedScore = (incidentSummary.speedIncidents || []).reduce((acc, incident) => {
      const severity = incident.severity || getSpeedSeverity(incident.maxSpeed);
      if (severity === "critical") return acc + 10;
      if (severity === "high") return acc + 6;
      if (severity === "medium") return acc + 3;
      return acc + 1;
    }, 0);

    const weightedScore = operationalIncidents * 3 + contactIncidents + speedScore;
    return Math.max(0, weightedScore);
  }

  if (Array.isArray(events) && events.length > 0) {
    return events.length;
  }
  if (summary && typeof summary === "object") {
    const total = (summary.excesos || 0) + (summary.no_identificados || 0) + (summary.contactos || 0) +
      (summary.llave_sin_cargar || 0) + (summary.conductor_inactivo || 0);
    return Math.max(0, total);
  }
  return 0;
}

const ALLOWED_EVENT_TYPES = new Set([
  "exceso",
  "no_identificado",
  "contacto",
  "llave_no_registrada",
  "sin_llave",
  "conductor_inactivo",
]);

/**
 * Construye el objeto eventSummary a partir de un evento crudo (para uso en batch).
 * @param {object} event - Evento con plate, type, severity, eventId, etc.
 * @returns {object} eventSummary para el array events del documento dailyAlerts
 */
function buildEventSummary(event) {
  let eventType = event.type || "exceso";
  if (!ALLOWED_EVENT_TYPES.has(eventType)) {
    eventType = isSpeedingEvent(event) ? "exceso" : "no_identificado";
  }
  const severity = event.severity || "critico";
  const speedVal = event.speed;
  const dateKey = resolveDateKeyFromTimestamp(event.eventTimestamp);
  const eventSubtype = event.eventSubtype || resolveSubtypeFromLegacyType(eventType);
  const incidentKey = event.incidentKey || (
    isSpeedingEvent(event)
      ? buildSpeedIncidentBaseKey(event)
      : buildIncidentKey(event.plate, dateKey, eventSubtype)
  );
  const eventId =
    event.eventId ||
    generateDeterministicEventId(event.plate, event.eventTimestamp, event.rawLine || "");

  return {
    eventId,
    plate: event.plate || null,
    type: eventType,
    reason: event.reason || null,
    reasonRaw: event.reasonRaw || event.reason || null,
    rawEventType: event.rawEventType || null,
    sourceEmailType: event.sourceEmailType || null,
    eventSource: event.eventSource || EVENT_SOURCE_RSV,
    eventCategory: event.eventCategory || (isSpeedingEvent(event) ? EVENT_CATEGORY_SPEEDING : EVENT_CATEGORY_DRIVER_IDENTIFICATION),
    eventSubtype,
    incidentKey,
    timestampSource: event.timestampSource || "EMAIL_EVENT",
    speed: typeof speedVal === "number" ? speedVal : null,
    speedLimit: event.speedLimit ?? null,
    speedDelta: event.speedDelta ?? null,
    groupedEventsCount: event.groupedEventsCount ?? (isSpeedingEvent(event) ? 1 : null),
    maxSpeed: event.maxSpeed ?? (typeof speedVal === "number" ? speedVal : null),
    hasSpeed: typeof speedVal === "number",
    eventTimestamp: event.eventTimestamp || "",
    location: event.location || "",
    locationRaw: event.locationRaw || event.location || "",
    severity,
    driverName: event.driverName || null,
    keyId: event.keyId || null,
    rawData: {
      brand: event.brand || null,
      model: event.model || null,
      timezone: event.timezone || null,
      eventCategory: event.eventCategory || null,
    },
  };
}

/**
 * Actualiza la meta del día con incrementos en lote (evita N writes por N eventos).
 * @param {string} dateKey - YYYY-MM-DD
 * @param {object} deltas - { totalEvents?, totalVehicles?, totalExcesos?, totalNoIdentificados?, totalContactos?, totalLlaveSinCargar?, totalConductorInactivo?, totalCriticos?, totalAdvertencias?, totalAdministrativos?, vehiclesWithCritical? }
 */
async function updateDailyMetaBatch(dateKey, deltas) {
  if (!deltas || typeof deltas !== "object") return;

  const db = getDb();
  const metaRef = db
    .collection("apps")
    .doc("emails")
    .collection("dailyAlerts")
    .doc(dateKey)
    .collection("meta")
    .doc("meta");

  const numericFields = [
    "totalEvents",
    "totalVehicles",
    "totalExcesos",
    "totalNoIdentificados",
    "totalContactos",
    "totalLlaveSinCargar",
    "totalConductorInactivo",
    "totalCriticos",
    "totalAdvertencias",
    "totalAdministrativos",
    "vehiclesWithCritical",
    "totalUniqueIncidents",
    "totalUniqueOperationalIncidents",
    "totalUniqueTechnicalIncidents",
    "totalSpeedIncidents",
    "vehiclesWithSpeeding",
    "driversWithSpeeding",
  ];

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(metaRef);
    const current = snap.exists ? snap.data() || {} : {};
    const next = {
      dateKey,
      lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    for (const field of numericFields) {
      const delta = Number(deltas[field] || 0);
      if (delta > 0) {
        next[field] = Number(current[field] || 0) + delta;
      }
    }

    const currentMax = Number(current.maxSpeedRecorded || 0);
    const requestedMax = Number.isFinite(deltas.maxSpeedRecorded) ? Number(deltas.maxSpeedRecorded) : null;
    if (requestedMax != null) {
      next.maxSpeedRecorded = Math.max(currentMax, requestedMax);
    }

    tx.set(metaRef, next, { merge: true });
  });
}

/**
 * Asegura que el documento padre apps/emails/dailyAlerts/{dateKey} exista con campos propios.
 * Sin esto, Firestore no considera el documento existente y DAILY_ALERTS_REF.get() devuelve vacío.
 * @param {string} dateKey - YYYY-MM-DD
 */
async function ensureDailyAlertDayDoc(dateKey) {
  const db = getDb();
  const dayRef = db
    .collection("apps")
    .doc("emails")
    .collection("dailyAlerts")
    .doc(dateKey);
  await dayRef.set(
    {
      dateKey,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Actualiza lastUpdatedAt del documento del día (apps/emails/dailyAlerts/{dateKey}).
 * @param {string} dateKey - YYYY-MM-DD
 */
async function touchDailyAlertDayDoc(dateKey) {
  const db = getDb();
  const dayRef = db
    .collection("apps")
    .doc("emails")
    .collection("dailyAlerts")
    .doc(dateKey);
  await dayRef.set(
    { lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
}

/**
 * Crea o actualiza el documento diario con todos los eventos del lote en una sola escritura.
 * Deduplica por eventId. No decrementa contadores.
 * @param {string} dateKey - YYYY-MM-DD
 * @param {string} plate - Patente normalizada
 * @param {object} vehicle - Datos del vehículo (plate, brand, model, responsables)
 * @param {Array<object>} eventSummaries - Array de eventSummary (buildEventSummary) ya deduplicado por eventId en este lote
 * @returns {{ isNewVehicle: boolean, metaDeltas: object }} para que el llamador agregue a updateDailyMetaBatch
 */
async function upsertDailyAlertBatch(dateKey, plate, vehicle, eventSummaries) {
  if (!eventSummaries || eventSummaries.length === 0) {
    return { isNewVehicle: false, metaDeltas: null };
  }

  const db = getDb();
  const normalized = normalizePlate(plate);
  const dayRef = db
    .collection("apps")
    .doc("emails")
    .collection("dailyAlerts")
    .doc(dateKey);
  const vehiclesRef = dayRef.collection("vehicles").doc(normalized);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const responsables = Array.isArray(vehicle.responsables) ? vehicle.responsables : [];
  const responsablesNormalized = normalizeEmailArray(responsables);

  const result = await db.runTransaction(async (tx) => {
    // Firestore exige que todas las lecturas ocurran antes de cualquier escritura
    const docSnap = await tx.get(vehiclesRef);
    const existingData = docSnap.exists ? docSnap.data() : null;
    const projection = buildDailyAlertVehicleProjection({
      dateKey,
      plate: normalized,
      vehicle: {
        ...vehicle,
        responsables,
        responsablesNormalized,
      },
      existingData,
      eventSummaries,
      nowValue: now,
    });

    if (!projection.metaDeltas) {
      return {
        isNewVehicle: false,
        metaDeltas: null,
        riskScore: existingData?.riskScore ?? 0,
        alertSent: existingData?.alertSent ?? false,
      };
    }

    tx.set(
      dayRef,
      {
        dateKey,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    tx.set(vehiclesRef, projection.docPayload, { merge: true });
    tx.set(dayRef, { lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

    return {
      isNewVehicle: projection.isNewVehicle,
      metaDeltas: projection.metaDeltas,
      riskScore: projection.riskScore,
      alertSent: projection.alertSent === true,
    };
  });

  // Índice de ownership por responsable:
  // apps/emails/responsables/{email}/alerts/{alertId}
  // Fuente de verdad sigue siendo dailyAlerts; este índice es solo para lectura rápida.
  const indexResponsables =
    responsablesNormalized.length > 0 ? responsablesNormalized : normalizeEmailArray(responsables);
  const alertId = `${dateKey}_${normalized}`;
  const encodedAlertId = encodeURIComponent(alertId);

  for (const email of indexResponsables) {
    const encodedEmail = encodeURIComponent(email);
    const alertRef = db
      .collection("apps")
      .doc("emails")
      .collection("responsables")
      .doc(encodedEmail)
      .collection("alerts")
      .doc(encodedAlertId);

    await alertRef.set(
      {
        plate: normalized,
        dateKey,
        riskScore: result.riskScore,
        alertSent: result.alertSent === true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  return {
    isNewVehicle: result.isNewVehicle,
    metaDeltas: result.metaDeltas,
  };
}

function createSummaryCounts(summary = {}) {
  return {
    excesos: summary?.excesos ?? 0,
    no_identificados: summary?.no_identificados ?? 0,
    contactos: summary?.contactos ?? 0,
    llave_sin_cargar: summary?.llave_sin_cargar ?? 0,
    conductor_inactivo: summary?.conductor_inactivo ?? 0,
  };
}

function buildDailyAlertVehicleProjection({
  dateKey,
  plate,
  vehicle = {},
  existingData = null,
  eventSummaries = [],
  nowValue = null,
}) {
  const normalized = normalizePlate(plate);
  const existingEvents = Array.isArray(existingData?.events) ? existingData.events : [];
  const existingEventIds = new Set([
    ...existingEvents.map((e) => e.eventId).filter(Boolean),
    ...(Array.isArray(existingData?.eventIdsSeen) ? existingData.eventIdsSeen.filter(Boolean) : []),
  ]);
  const newSummaries = (Array.isArray(eventSummaries) ? eventSummaries : []).filter(
    (eventSummary) => !existingEventIds.has(eventSummary.eventId),
  );

  if (newSummaries.length === 0) {
    return {
      normalizedPlate: normalized,
      isNewVehicle: false,
      newSummaries: [],
      mergedEvents: existingEvents,
      speedIncidents: Array.isArray(existingData?.speedIncidents) ? existingData.speedIncidents : [],
      summaryCounts: createSummaryCounts(existingData?.summary),
      incidentSummary: existingData?.incidentSummary || computeIncidentSummary(existingEvents),
      riskScore: existingData?.riskScore ?? 0,
      docPayload: existingData,
      metaDeltas: null,
      alertSent: existingData?.alertSent === true,
      eventIdsSeen: Array.isArray(existingData?.eventIdsSeen) ? existingData.eventIdsSeen : [],
    };
  }

  const mergedEvents = [...existingEvents];
  const summaryCounts = createSummaryCounts(existingData?.summary);
  const hadCriticalBefore = existingEvents.some((e) => e.severity === "critico");

  for (const eventSummary of newSummaries) {
    mergedEvents.push(eventSummary);
    const key = normalizeEventTypeForSummary(eventSummary.type);
    summaryCounts[key] = (summaryCounts[key] || 0) + 1;
  }

  const eventIdsSeen = Array.from(
    new Set([
      ...existingEventIds,
      ...newSummaries.map((eventSummary) => eventSummary.eventId).filter(Boolean),
    ]),
  );

  const speedIncidents = groupSpeedingIncidents(mergedEvents);
  const speedByEventId = new Map();
  for (const incident of speedIncidents) {
    for (const eventId of incident.eventIds || []) {
      speedByEventId.set(eventId, incident);
    }
  }

  const mergedEventsWithSpeedGroups = mergedEvents.map((event) => {
    const incident = speedByEventId.get(event.eventId);
    if (!incident) {
      if (event?.groupedSpeedIncidentKey) {
        const { groupedSpeedIncidentKey, ...rest } = event;
        return rest;
      }
      return event;
    }
    return {
      ...event,
      incidentKey: incident.incidentKey,
      groupedEventsCount: incident.groupedEventsCount,
      maxSpeed: incident.maxSpeed,
      speedSeverity: incident.severity,
      groupedSpeedIncidentKey: incident.incidentKey,
    };
  });

  const { storedEvents, wasTruncated, truncatedCount } = trimStoredEvents(
    mergedEventsWithSpeedGroups,
    normalized,
    dateKey,
  );
  const riskScore = computeRiskScore(summaryCounts, mergedEventsWithSpeedGroups);
  const incidentSummary = computeIncidentSummary(mergedEventsWithSpeedGroups);
  const previousIncidentSummary = existingData?.incidentSummary || {
    totalUniqueIncidents: 0,
    uniqueOperationalIncidents: 0,
    uniqueTechnicalIncidents: 0,
  };
  const previousSpeedIncidents = Array.isArray(existingData?.speedIncidents) ? existingData.speedIncidents : [];
  const previousSpeedIncidentCount = previousSpeedIncidents.length;
  const previousMaxSpeed = previousSpeedIncidents.reduce((max, speedIncident) => {
    return Math.max(max, Number(speedIncident?.maxSpeed || 0));
  }, 0);
  const previousSpeedingDrivers = new Set(Array.isArray(existingData?.speedingDrivers) ? existingData.speedingDrivers : []);
  const currentSpeedingDrivers = new Set(
    speedIncidents.map((incident) => incident.driverName).filter((name) => typeof name === "string" && name.trim().length > 0),
  );
  const isNewVehicle = !existingData;
  const incomingResponsables = Array.isArray(vehicle.responsables) ? vehicle.responsables : [];
  const persistedResponsables = Array.isArray(existingData?.responsables) ? existingData.responsables : [];
  const incomingResponsablesNormalized =
    Array.isArray(vehicle.responsablesNormalized) && vehicle.responsablesNormalized.length > 0
      ? vehicle.responsablesNormalized
      : normalizeEmailArray(incomingResponsables);
  const persistedResponsablesNormalized = Array.isArray(existingData?.responsablesNormalized)
    ? existingData.responsablesNormalized
    : normalizeEmailArray(persistedResponsables);

  const docPayload = {
    plate: normalized,
    dateKey,
    brand: vehicle.brand || existingData?.brand || "",
    model: vehicle.model || existingData?.model || "",
    operationName: vehicle.operationName || vehicle.operacion || existingData?.operationName || existingData?.operacion || null,
    operacion: vehicle.operationName || vehicle.operacion || existingData?.operationName || existingData?.operacion || null,
    responsables: incomingResponsables.length > 0 ? incomingResponsables : persistedResponsables,
    responsablesNormalized:
      incomingResponsablesNormalized.length > 0 ? incomingResponsablesNormalized : persistedResponsablesNormalized,
    alertSent: existingData?.alertSent ?? false,
    sentAt: existingData?.sentAt ?? null,
    lastEventAt: nowValue,
    summary: summaryCounts,
    incidentSummary,
    speedIncidents,
    speedingDrivers: Array.from(currentSpeedingDrivers),
    events: storedEvents,
    eventIdsSeen,
    totalEventsCount: mergedEventsWithSpeedGroups.length,
    storedEventsCount: storedEvents.length,
    eventsTruncated: wasTruncated,
    truncatedEventsCount: truncatedCount,
    riskScore,
  };

  if (isNewVehicle) {
    docPayload.createdAt = nowValue;
  }

  const metaDeltas = {
    totalEvents: newSummaries.length,
    totalExcesos: summaryCounts.excesos - (existingData?.summary?.excesos ?? 0),
    totalNoIdentificados: summaryCounts.no_identificados - (existingData?.summary?.no_identificados ?? 0),
    totalContactos: summaryCounts.contactos - (existingData?.summary?.contactos ?? 0),
    totalLlaveSinCargar: summaryCounts.llave_sin_cargar - (existingData?.summary?.llave_sin_cargar ?? 0),
    totalConductorInactivo: summaryCounts.conductor_inactivo - (existingData?.summary?.conductor_inactivo ?? 0),
    totalCriticos: newSummaries.length,
    totalAdvertencias: 0,
    totalAdministrativos: 0,
    totalVehicles: isNewVehicle ? 1 : 0,
    vehiclesWithCritical: isNewVehicle ? 1 : hadCriticalBefore ? 0 : 1,
    totalUniqueIncidents:
      (incidentSummary.totalUniqueIncidents || 0) -
      (previousIncidentSummary.totalUniqueIncidents || 0),
    totalUniqueOperationalIncidents:
      (incidentSummary.uniqueOperationalIncidents || 0) -
      (previousIncidentSummary.uniqueOperationalIncidents || 0),
    totalUniqueTechnicalIncidents:
      (incidentSummary.uniqueTechnicalIncidents || 0) -
      (previousIncidentSummary.uniqueTechnicalIncidents || 0),
    totalSpeedIncidents: speedIncidents.length - previousSpeedIncidentCount,
    vehiclesWithSpeeding: previousSpeedIncidentCount === 0 && speedIncidents.length > 0 ? 1 : 0,
    driversWithSpeeding: Math.max(0, currentSpeedingDrivers.size - previousSpeedingDrivers.size),
    maxSpeedRecorded: Math.max(previousMaxSpeed, ...speedIncidents.map((incident) => Number(incident.maxSpeed || 0))),
  };

  return {
    normalizedPlate: normalized,
    isNewVehicle,
    newSummaries,
    mergedEvents: mergedEventsWithSpeedGroups,
    speedIncidents,
    summaryCounts,
    incidentSummary,
    riskScore,
    docPayload,
    metaDeltas,
    alertSent: docPayload.alertSent === true,
    eventIdsSeen,
  };
}

/**
 * Crea o actualiza el documento diario en
 * /apps/emails/dailyAlerts/{YYYY-MM-DD}/vehicles/{plate}
 * Un solo evento (mantener para compatibilidad; preferir upsertDailyAlertBatch).
 * @param {string} dateKey - Fecha en formato YYYY-MM-DD
 * @param {string} plate - Patente normalizada
 * @param {object} vehicle - Datos del vehículo (plate, brand, model, responsables)
 * @param {object} event - Evento a agregar
 */
async function upsertDailyAlert(dateKey, plate, vehicle, event) {
  const eventSummary = buildEventSummary(event);
  const result = await upsertDailyAlertBatch(dateKey, plate, vehicle, [eventSummary]);
  if (result.metaDeltas) {
    await updateDailyMetaBatch(dateKey, result.metaDeltas);
  }
}

/**
 * Verifica si el email from pertenece a dominios permitidos.
 * @param {string} from - Campo from del email (ej: "alerta@pluspetrol.com")
 * @param {string} allowedDomains - Dominios separados por coma (ej: "pluspetrol.com,otro.com")
 * @returns {boolean}
 */
function isFromAllowedDomain(from, allowedDomains) {
  if (!from || !allowedDomains) return false;
  const email = String(from).trim().toLowerCase();
  const match = email.match(/@([^@\s]+)/);
  if (!match) return false;
  const domain = match[1];
  const domains = allowedDomains.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
  return domains.some((d) => domain === d || domain.endsWith("." + d));
}

/**
 * Crea o actualiza el documento mensual en
 * apps/emails/monthlyHistory/{YYYY-MM}/vehicles/{plate}
 * Deduplicación por eventId. Solo agrega eventos nuevos.
 * @param {string} dateKey - Fecha YYYY-MM-DD
 * @param {string} plate - Patente ya normalizada
 * @param {object} vehicle - { brand, model, operationName, responsables, responsablesNormalized }
 * @param {Array<object>} eventSummaries - Array de eventSummary (mismo formato que upsertDailyAlertBatch)
 */
async function upsertMonthlyHistoryBatch(dateKey, plate, vehicle, eventSummaries) {
  if (!eventSummaries || eventSummaries.length === 0) return;

  const db = getDb();
  const monthKey = dateKey.slice(0, 7);
  const normalized = normalizePlate(plate);

  const vehicleRef = db
    .collection("apps")
    .doc("emails")
    .collection("monthlyHistory")
    .doc(monthKey)
    .collection("vehicles")
    .doc(normalized);

  const responsables = Array.isArray(vehicle.responsables) ? vehicle.responsables : [];
  const responsablesNormalized =
    Array.isArray(vehicle.responsablesNormalized) && vehicle.responsablesNormalized.length > 0
      ? vehicle.responsablesNormalized
      : normalizeEmailArray(responsables);

  await db.runTransaction(async (tx) => {
    const docSnap = await tx.get(vehicleRef);
    const existingData = docSnap.exists ? docSnap.data() : null;
    const existingEventIds = new Set(
      Array.isArray(existingData?.eventIdsSeen) ? existingData.eventIdsSeen.filter(Boolean) : []
    );

    const newSummaries = (Array.isArray(eventSummaries) ? eventSummaries : []).filter(
      (e) => e.eventId && !existingEventIds.has(e.eventId)
    );

    if (newSummaries.length === 0) return;

    const newEventIds = newSummaries.map((e) => e.eventId).filter(Boolean);
    const FieldValue = admin.firestore.FieldValue;

    const payload = {
      plate: normalized,
      monthKey,
      brand: vehicle.brand || existingData?.brand || "",
      model: vehicle.model || existingData?.model || "",
      operationName: vehicle.operationName || vehicle.operacion || existingData?.operationName || existingData?.operacion || null,
      responsables: responsables.length > 0 ? responsables : (existingData?.responsables ?? []),
      responsablesNormalized: responsablesNormalized.length > 0 ? responsablesNormalized : (existingData?.responsablesNormalized ?? []),
      events: FieldValue.arrayUnion(...newSummaries),
      eventIdsSeen: FieldValue.arrayUnion(...newEventIds),
      totalEventsCount: (existingData?.totalEventsCount ?? 0) + newSummaries.length,
      lastEventAt: FieldValue.serverTimestamp(),
    };

    if (!existingData) {
      payload.createdAt = FieldValue.serverTimestamp();
    }

    tx.set(vehicleRef, payload, { merge: true });
  });
}

module.exports = {
  generateDeterministicEventId,
  saveVehicleEvents,
  upsertVehicle,
  getVehicle,
  createVehicleFromEvent,
  upsertDailyAlert,
  upsertDailyAlertBatch,
  updateDailyMetaBatch,
  buildEventSummary,
  formatDateKey,
  normalizePlate,
  isFromAllowedDomain,
  computeRiskScore,
  computeIncidentSummary,
  groupSpeedingIncidents,
  getSpeedSeverity,
  buildDailyAlertVehicleProjection,
  upsertMonthlyHistoryBatch,
};
