const {
  parseVehicleEventsFromEmail,
} = require("./vehicleEventParser");
const {
  buildEventSummary,
  buildDailyAlertVehicleProjection,
  computeIncidentSummary,
  computeRiskScore,
  groupSpeedingIncidents,
  generateDeterministicEventId,
  formatDateKey,
  normalizePlate,
} = require("./vehicleEventService");
const {
  buildConsolidatedBody,
  buildMetaFromVehicleDocs,
  sortVehiclesByCriticity,
} = require("./email/emailTemplateBuilder");

function createEmptySummary() {
  return {
    excesos: 0,
    no_identificados: 0,
    contactos: 0,
    llave_sin_cargar: 0,
    conductor_inactivo: 0,
  };
}

function buildCandidateLinePattern(sourceEmailType) {
  if (sourceEmailType === "excesos") return /km\/h/i;
  if (sourceEmailType === "no_identificados") return /\d{2}\/\d{2}\/\d{2}/;
  if (sourceEmailType === "contacto") return /\d{2}-\d{2}-\d{4}/;
  return /\d{2}[:/-]\d{2}/;
}

function buildRenderDateKey(dateKeys) {
  if (!Array.isArray(dateKeys) || dateKeys.length === 0) {
    return formatDateKey(new Date());
  }
  if (dateKeys.length === 1) return dateKeys[0];
  return `${dateKeys[0]} a ${dateKeys[dateKeys.length - 1]}`;
}

function buildVehicleFromEvents(events, operationName) {
  const firstWithBrand = events.find((event) => event.brand || event.model) || events[0] || {};
  return {
    plate: normalizePlate(firstWithBrand.plate || ""),
    brand: firstWithBrand.brand || "",
    model: firstWithBrand.model || "",
    operationName: operationName || null,
    operacion: operationName || null,
    responsables: [],
    responsablesNormalized: [],
  };
}

function simulateAlertFromEmail({ subject = "", body = "", receivedAt = null } = {}) {
  const fallbackTimestamp = receivedAt || new Date().toISOString();
  const { events: parsedEvents, sourceEmailType, operationName } = parseVehicleEventsFromEmail(
    subject,
    body,
    {
      parserV2Enabled: process.env.RSV_V2_PARSER_ENABLED === "true",
      fallbackTimestamp,
    },
  );

  const events = parsedEvents.map((event) => ({
    ...event,
    plate: normalizePlate(event.plate || ""),
    eventId: generateDeterministicEventId(
      normalizePlate(event.plate || ""),
      event.eventTimestamp,
      event.rawLine || "",
    ),
    vehicleRegistered: true,
  }));

  const eventSummaries = events.map((event) => buildEventSummary(event));
  const buckets = new Map();

  for (const eventSummary of eventSummaries) {
    const dateKey =
      eventSummary.eventTimestamp && /^\d{4}-\d{2}-\d{2}/.test(String(eventSummary.eventTimestamp))
        ? String(eventSummary.eventTimestamp).slice(0, 10)
        : formatDateKey(new Date());
    const plate = normalizePlate(eventSummary.plate || "");
    const bucketKey = `${dateKey}|${plate}`;
    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, {
        dateKey,
        plate,
        eventSummaries: [],
      });
    }
    buckets.get(bucketKey).eventSummaries.push(eventSummary);
  }

  const plateGrouping = [];
  const vehicleDocs = [];

  for (const bucket of buckets.values()) {
    const sourceEvents = events.filter((event) => {
      return normalizePlate(event.plate || "") === bucket.plate &&
        String(event.eventTimestamp || "").slice(0, 10) === bucket.dateKey;
    });
    const vehicle = buildVehicleFromEvents(sourceEvents, operationName);
    const projection = buildDailyAlertVehicleProjection({
      dateKey: bucket.dateKey,
      plate: bucket.plate,
      vehicle,
      existingData: null,
      eventSummaries: bucket.eventSummaries,
      nowValue: fallbackTimestamp,
    });

    vehicleDocs.push(projection.docPayload);
    plateGrouping.push({
      dateKey: bucket.dateKey,
      plate: bucket.plate,
      eventCount: bucket.eventSummaries.length,
      riskScore: projection.riskScore,
      summary: projection.summaryCounts,
      incidentSummary: projection.incidentSummary,
      speedIncidents: projection.speedIncidents,
    });
  }

  const aggregateSummary = createEmptySummary();
  for (const eventSummary of eventSummaries) {
    if (eventSummary.type === "exceso") aggregateSummary.excesos += 1;
    else if (eventSummary.type === "contacto") aggregateSummary.contactos += 1;
    else if (eventSummary.type === "llave_no_registrada" || eventSummary.type === "sin_llave") aggregateSummary.llave_sin_cargar += 1;
    else if (eventSummary.type === "conductor_inactivo") aggregateSummary.conductor_inactivo += 1;
    else aggregateSummary.no_identificados += 1;
  }

  const speedIncidents = groupSpeedingIncidents(eventSummaries);
  const incidentSummary = computeIncidentSummary(eventSummaries);
  const riskScore = vehicleDocs.reduce((total, doc) => total + Number(doc?.riskScore || 0), 0);
  const sortedVehicleDocs = sortVehiclesByCriticity(vehicleDocs);
  const meta = buildMetaFromVehicleDocs(sortedVehicleDocs);
  const dateKeys = Array.from(new Set(vehicleDocs.map((doc) => doc.dateKey).filter(Boolean))).sort();
  const renderDateKey = buildRenderDateKey(dateKeys);
  const emailHtml = buildConsolidatedBody(meta, sortedVehicleDocs, renderDateKey);

  const parsedRawLines = new Set(events.map((event) => String(event.rawLine || "").trim()).filter(Boolean));
  const candidatePattern = buildCandidateLinePattern(sourceEmailType);
  const unparsedLines = String(body || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => candidatePattern.test(line))
    .filter((line) => !parsedRawLines.has(line));

  return {
    detectedEmailType: sourceEmailType,
    operationName: operationName || null,
    receivedAt: fallbackTimestamp,
    events,
    eventSummaries,
    speedIncidents,
    summary: aggregateSummary,
    incidentSummary,
    riskScore: computeRiskScore(aggregateSummary, eventSummaries) || riskScore,
    emailHtml,
    meta,
    plateGrouping,
    eventCounts: {
      totalEvents: events.length,
      totalVehicles: sortedVehicleDocs.length,
      totalSpeedIncidents: speedIncidents.length,
    },
    unparsedLines,
  };
}

module.exports = {
  simulateAlertFromEmail,
};
