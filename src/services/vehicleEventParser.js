/**
 * Deterministic parsers for fleet email formats.
 */

const DEFAULT_TIMEZONE = "America/Argentina/Buenos_Aires";
const ARGENTINA_OFFSET = "-03:00";
const ARGENTINA_OFFSET_MINUTES = -3 * 60;

const EMAIL_TYPE_EXCESOS = "excesos";
const EMAIL_TYPE_NO_IDENTIFICADOS = "no_identificados";
const EMAIL_TYPE_CONTACTO = "contacto";

const EVENT_SOURCE_RSV = "RSV";
const EVENT_CATEGORY_DRIVER_IDENTIFICATION = "DRIVER_IDENTIFICATION";
const EVENT_CATEGORY_SPEEDING = "SPEEDING";

const EVENT_SUBTYPE_CONTACT_NO_DRIVER = "CONTACT_NO_DRIVER";
const EVENT_SUBTYPE_DRIVER_NOT_IDENTIFIED = "DRIVER_NOT_IDENTIFIED";
const EVENT_SUBTYPE_UNKNOWN_KEY = "UNKNOWN_KEY";
const EVENT_SUBTYPE_INACTIVE_DRIVER = "INACTIVE_DRIVER";
const EVENT_SUBTYPE_NO_KEY_DETECTED = "NO_KEY_DETECTED";
const EVENT_SUBTYPE_SPEED_EXCESS = "SPEED_EXCESS";

const SUBJECT_PATTERNS = {
  excesos: /excesos?\s+(del\s+)?d[\u00EDi]a/i,
  no_identificados: /no\s+identificados?\s+(del\s+)?d[\u00EDi]a/i,
  contacto: /contacto\s+sin\s+identificaci[o\u00F3]n\s+(del\s+)?d[\u00EDi]a/i,
};

const PLATE_REGEX = /([A-Z]{2}[\s-]*\d{3}[\s-]*[A-Z]{2}|[A-Z]{3}[\s-]*\d{3})/i;

function isRsvV2ParserEnabled() {
  return process.env.RSV_V2_PARSER_ENABLED === "true";
}

function isRsvV2SpeedEventsEnabled() {
  return process.env.RSV_V2_SPEED_EVENTS_ENABLED === "true";
}

function normalizeBodyLines(bodyText) {
  if (!bodyText) return [];
  return String(bodyText || "")
    .replace(/\*/g, "\n")
    .replace(/\u00A0/g, " ")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter(
      (l) =>
        !/^excesos?\s+del\s+d/i.test(l) &&
        !/^no\s+identificados?\s+del\s+d/i.test(l) &&
        !/^\u00BFtiene alguna consulta/i.test(l) &&
        !/^marca\s+modelo\s+patente\s+fecha/i.test(l),
    );
}

function normalizePlate(plate) {
  if (!plate || typeof plate !== "string") return "";
  return plate.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

function formatLocalTimestamp(year, month, day, hh, min, ss) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hh).padStart(2, "0")}:${String(min).padStart(2, "0")}:${String(ss).padStart(2, "0")}${ARGENTINA_OFFSET}`;
}

function toArgentinaIsoFromDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const adjusted = new Date(date.getTime() + ARGENTINA_OFFSET_MINUTES * 60 * 1000);
  return formatLocalTimestamp(
    adjusted.getUTCFullYear(),
    adjusted.getUTCMonth() + 1,
    adjusted.getUTCDate(),
    adjusted.getUTCHours(),
    adjusted.getUTCMinutes(),
    adjusted.getUTCSeconds(),
  );
}

function isValidLocalTimestampParts(year, month, day, hh, min, ss) {
  const iso = formatLocalTimestamp(year, month, day, hh, min, ss);
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return false;

  const adjusted = new Date(parsed.getTime() + ARGENTINA_OFFSET_MINUTES * 60 * 1000);
  return (
    adjusted.getUTCFullYear() === year &&
    adjusted.getUTCMonth() + 1 === month &&
    adjusted.getUTCDate() === day &&
    adjusted.getUTCHours() === hh &&
    adjusted.getUTCMinutes() === min &&
    adjusted.getUTCSeconds() === ss
  );
}

function parseDateTimeToIso(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const normalizedDate = String(dateStr).trim();
  const normalizedTime = String(timeStr).trim();
  if (!/^\d{2}\/\d{2}\/(\d{2}|\d{4})$/.test(normalizedDate)) return null;
  if (!/^\d{2}:\d{2}:\d{2}$/.test(normalizedTime)) return null;

  let day;
  let month;
  let year;

  if (/^\d{2}\/\d{2}\/\d{2}$/.test(normalizedDate)) {
    const [dd, mm, yy] = normalizedDate.split("/").map((v) => parseInt(v, 10));
    day = dd;
    month = mm;
    year = 2000 + yy;
  } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(normalizedDate)) {
    const [dd, mm, yyyy] = normalizedDate.split("/").map((v) => parseInt(v, 10));
    day = dd;
    month = mm;
    year = yyyy;
  } else {
    return null;
  }

  const [hh, min, ss] = normalizedTime.split(":").map((v) => parseInt(v, 10));
  if ([day, month, year, hh, min, ss].some((n) => Number.isNaN(n))) return null;
  if (!isValidLocalTimestampParts(year, month, day, hh, min, ss)) return null;
  return formatLocalTimestamp(year, month, day, hh, min, ss);
}

function buildFallbackTimestamp(fallbackTimestamp) {
  if (!fallbackTimestamp) return null;
  const raw = String(fallbackTimestamp).trim();
  if (!raw) return null;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return toArgentinaIsoFromDate(parsed);
}

function classifyReason(reason) {
  const r = String(reason || "");
  if (/llave\s+sin\s+cargar/i.test(r)) {
    return {
      legacyType: "llave_no_registrada",
      rawEventType: "Llave sin cargar",
      eventSubtype: EVENT_SUBTYPE_UNKNOWN_KEY,
    };
  }
  if (/conductor\s+inactivo/i.test(r)) {
    return {
      legacyType: "conductor_inactivo",
      rawEventType: "Conductor inactivo",
      eventSubtype: EVENT_SUBTYPE_INACTIVE_DRIVER,
    };
  }
  if (/sin\s+llave/i.test(r)) {
    return {
      legacyType: "sin_llave",
      rawEventType: "Sin llave",
      eventSubtype: EVENT_SUBTYPE_UNKNOWN_KEY,
    };
  }
  return {
    legacyType: "no_identificado",
    rawEventType: "No identificado",
    eventSubtype: EVENT_SUBTYPE_DRIVER_NOT_IDENTIFIED,
  };
}

function classifyTypeFromReason(reason) {
  return classifyReason(reason).legacyType;
}

function toRawEventType(reason) {
  const r = String(reason || "").trim();
  if (!r) return "No identificado";
  return classifyReason(r).rawEventType;
}

function toEventSubtypeFromLegacyType(type) {
  switch (type) {
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

function extractKeyIdFromReason(reason) {
  const reasonText = String(reason || "").trim();
  const keyIdMatch =
    reasonText.match(/llave\s+sin\s+cargar\s*:\s*([A-Z0-9]+)/i) ||
    reasonText.match(/^([A-Z0-9]{5,})$/i);
  return keyIdMatch ? keyIdMatch[1].toUpperCase() : null;
}

function extractDriverNameFromReason(reason) {
  const reasonText = String(reason || "").trim();
  const match = reasonText.match(/conductor\s+inactivo\s*:\s*(.+)$/i);
  if (!match || !match[1]) return null;
  const driver = match[1].replace(/\s+/g, " ").trim();
  return driver || null;
}

function extractLocation(restText) {
  const locationRegex = /\b(RP\s*\d+|RN\s*\d+|DESCONOCIDO|RUTA|AV\.?|CALLE|KM)\b/i;
  const match = restText.match(locationRegex);
  if (!match || match.index == null) {
    return { descriptor: restText.trim(), locationRaw: null, locationShort: null };
  }

  const descriptor = restText.slice(0, match.index).trim();
  const locationRaw = restText.slice(match.index).trim();
  const shortMatch =
    locationRaw.match(/\b(RP\s*\d+|RN\s*\d+)\b/i) ||
    locationRaw.match(/\b(DESCONOCIDO)\b/i);
  const locationShort = shortMatch ? shortMatch[1].replace(/\s+/g, "").toUpperCase() : null;

  return {
    descriptor,
    locationRaw,
    locationShort: locationShort === "DESCONOCIDO" ? "Desconocido" : locationShort,
  };
}

function extractSpeedingLocation(restText) {
  const match = String(restText || "").match(/\b(RP\s*\d+|RN\s*\d+)\b/i);
  if (!match || match.index == null) {
    const generic = extractLocation(restText);
    return {
      descriptor: generic.descriptor,
      locationRaw: generic.locationRaw || generic.locationShort || null,
      locationShort: generic.locationShort || null,
    };
  }

  const descriptor = restText.slice(0, match.index).trim();
  const locationRaw = restText.slice(match.index).trim();
  const locationShort = match[1].replace(/\s+/g, "").toUpperCase();
  return { descriptor, locationRaw, locationShort };
}

function parseBrandModelDriverAndKey(descriptor) {
  const text = String(descriptor || "").replace(/\s+/g, " ").trim();
  if (!text) return { brand: "", model: "", driverName: null, keyId: null };

  const parenKeyMatch = text.match(/\(([A-Z0-9]{5,})\)/i);
  let keyId = parenKeyMatch ? parenKeyMatch[1].toUpperCase() : null;

  let baseText = text.replace(/\([^)]+\)/g, " ").replace(/\s+/g, " ").trim();
  let tokens = baseText.split(" ").filter(Boolean);

  if (!keyId) {
    const idx = tokens.findIndex((token) => /^[0-9A-F]{6,}$/i.test(token));
    if (idx >= 0) {
      keyId = tokens[idx].toUpperCase();
      tokens.splice(idx, 1);
    }
  } else {
    tokens = tokens.filter((token) => token.toUpperCase() !== keyId);
  }

  const brand = tokens[0] || "";
  let modelTokens = tokens.slice(1);
  let driverName = null;

  if (keyId && modelTokens.length >= 3) {
    const suffix = [];
    for (let i = modelTokens.length - 1; i >= 0; i--) {
      const token = modelTokens[i];
      const isNameWord = /^[A-Z\u00C1\u00C9\u00CD\u00D3\u00DA\u00D1]+$/u.test(token);
      if (isNameWord) suffix.unshift(token);
      else break;
    }

    if (suffix.length >= 2 && suffix.length < modelTokens.length) {
      driverName = suffix.join(" ");
      modelTokens = modelTokens.slice(0, modelTokens.length - suffix.length);
    }
  }

  return { brand, model: modelTokens.join(" "), driverName, keyId };
}

function detectEmailType(subject) {
  if (!subject || typeof subject !== "string") return null;
  const s = subject.trim();
  if (!s) return null;

  const normalized = s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ");

  if (SUBJECT_PATTERNS.contacto.test(s) || /contacto\s+sin\s+identific/i.test(normalized)) return EMAIL_TYPE_CONTACTO;
  if (
    SUBJECT_PATTERNS.no_identificados.test(s) ||
    /no\s+identific/i.test(normalized) ||
    /falta\s+(de\s+)?identific/i.test(normalized) ||
    /sin\s+identific/i.test(normalized)
  ) return EMAIL_TYPE_NO_IDENTIFICADOS;
  if (SUBJECT_PATTERNS.excesos.test(s) || /exceso/i.test(normalized) || /velocidad/i.test(normalized)) return EMAIL_TYPE_EXCESOS;

  return null;
}

function buildCommonEvent(raw) {
  const plateRaw = raw.plate || "";
  const plateNormalized = normalizePlate(plateRaw);
  return {
    type: raw.type,
    speed: raw.speed ?? null,
    hasSpeed: Boolean(raw.hasSpeed),
    plate: plateRaw,
    plateNormalized,
    brand: raw.brand || "",
    model: raw.model || "",
    driverName: raw.driverName ?? null,
    keyId: raw.keyId ?? null,
    reasonRaw: raw.reasonRaw ?? null,
    rawEventType: raw.rawEventType ?? null,
    eventSubtype: raw.eventSubtype ?? null,
    timestampSource: raw.timestampSource || "EMAIL_EVENT",
    locationShort: raw.locationShort ?? null,
    locationRaw: raw.locationRaw ?? null,
    location: raw.location || raw.locationRaw || raw.locationShort || "",
    eventTimestamp: raw.eventTimestamp || null,
    severity: "critico",
    timezone: DEFAULT_TIMEZONE,
    rawLine: raw.rawLine || "",
  };
}

function parseExcesos(bodyText, options = {}) {
  if (!bodyText || typeof bodyText !== "string") return [];

  const regex = /^(\d+)\s*Km\/h\s+(\d{2}\/\d{2}\/\d{2})\s+(\d{2}:\d{2}:\d{2})\s+(.+?)\s*-\s+(.+)$/i;
  const speedEventsEnabled = isRsvV2SpeedEventsEnabled();

  return normalizeBodyLines(bodyText)
    .map((line) => {
      const match = line.match(regex);
      if (!match) return null;

      const speed = parseInt(match[1], 10);
      const parsedTimestamp = parseDateTimeToIso(match[2], match[3]);
      const fallbackTimestamp = parsedTimestamp ? null : buildFallbackTimestamp(options.fallbackTimestamp);
      const eventTimestamp = parsedTimestamp || fallbackTimestamp;
      const timestampSource = parsedTimestamp ? "EMAIL_EVENT" : fallbackTimestamp ? "INGEST_FALLBACK" : null;
      if (!eventTimestamp || !timestampSource) return null;
      const plateRaw = match[4].trim();
      const rest = match[5].trim();

      const { descriptor, locationRaw, locationShort } = extractSpeedingLocation(rest);
      const parsed = parseBrandModelDriverAndKey(descriptor);
      const containsUnknownNoKey = /desconocido\s*\(\s*sin\s+llave\s*\)/i.test(rest);
      const eventSubtype = containsUnknownNoKey ? EVENT_SUBTYPE_NO_KEY_DETECTED : EVENT_SUBTYPE_SPEED_EXCESS;

      return buildCommonEvent({
        type: containsUnknownNoKey ? "no_identificado" : "exceso",
        speed,
        hasSpeed: true,
        plate: plateRaw,
        brand: parsed.brand,
        model: containsUnknownNoKey ? parsed.model.replace(/\bDesconocido\b/i, "").trim() : parsed.model,
        driverName: containsUnknownNoKey ? null : parsed.driverName,
        keyId: containsUnknownNoKey ? null : parsed.keyId,
        eventSubtype: speedEventsEnabled ? eventSubtype : toEventSubtypeFromLegacyType("no_identificado"),
        rawEventType: containsUnknownNoKey ? "Sin llave" : "Exceso de velocidad",
        reasonRaw: containsUnknownNoKey ? "Conductor no identificado (SIN LLAVE)" : null,
        locationShort,
        locationRaw,
        location: locationRaw || locationShort || "",
        eventTimestamp,
        timestampSource,
        rawLine: line,
      });
    })
    .filter(Boolean);
}

function parseNoIdentificadosLine(line, opts = {}) {
  const reasonMatch = line.match(/\(([^()]+)\)\s*$/);
  if (!reasonMatch) return null;

  const reasonRaw = reasonMatch[1].trim();
  const beforeReason = line.slice(0, reasonMatch.index).trim();
  const reasonData = classifyReason(reasonRaw);

  const fullMatch = beforeReason.match(/^(\d{2}\/\d{2}\/\d{2})\s+(\d{2}:\d{2}:\d{2})\s+(.+)$/i);

  let eventTimestamp = null;
  let plateRaw = null;
  let vehiclePart = null;
  let timestampSource = "EMAIL_EVENT";

  if (fullMatch) {
    const [, datePart, timePart, restAfterTime] = fullMatch;
    const separatorIdx = restAfterTime.lastIndexOf(" - ");
    if (separatorIdx <= 0) return null;

    const plateMatch = restAfterTime.match(PLATE_REGEX);
    if (!plateMatch) return null;
    plateRaw = plateMatch[1];
    vehiclePart = restAfterTime.slice(separatorIdx + 3).trim();
    eventTimestamp = parseDateTimeToIso(datePart, timePart);
    if (!eventTimestamp) {
      eventTimestamp = buildFallbackTimestamp(opts.fallbackTimestamp);
      timestampSource = eventTimestamp ? "INGEST_FALLBACK" : "EMAIL_EVENT";
    }
    if (!eventTimestamp) return null;
  } else {
    if (!opts.allowSummaryFormat) return null;

    const separatorIdx = beforeReason.lastIndexOf(" - ");
    if (separatorIdx <= 0) return null;

    const plateCandidate = beforeReason.slice(0, separatorIdx).trim();
    const plateMatch = plateCandidate.match(PLATE_REGEX);
    if (!plateMatch) return null;

    plateRaw = plateMatch[1];
    vehiclePart = beforeReason.slice(separatorIdx + 3).trim();
    eventTimestamp = buildFallbackTimestamp(opts.fallbackTimestamp);
    if (!eventTimestamp) return null;
    timestampSource = "INGEST_FALLBACK";
  }

  const [brand = "", ...modelParts] = vehiclePart.trim().split(/\s+/);

  return buildCommonEvent({
    type: reasonData.legacyType,
    speed: null,
    hasSpeed: false,
    plate: plateRaw,
    brand,
    model: modelParts.join(" "),
    driverName: extractDriverNameFromReason(reasonRaw),
    keyId: extractKeyIdFromReason(reasonRaw),
    reasonRaw,
    rawEventType: reasonData.rawEventType,
    eventSubtype: reasonData.eventSubtype,
    locationShort: null,
    locationRaw: null,
    eventTimestamp,
    timestampSource,
    rawLine: line,
  });
}

function parseNoIdentificados(bodyText, options = {}) {
  if (!bodyText || typeof bodyText !== "string") return [];

  const parserV2Enabled = options.parserV2Enabled === true || isRsvV2ParserEnabled();
  const lineOptions = {
    allowSummaryFormat: parserV2Enabled,
    fallbackTimestamp: options.fallbackTimestamp || null,
  };

  return normalizeBodyLines(bodyText)
    .map((line) => parseNoIdentificadosLine(line, lineOptions))
    .filter(Boolean);
}

function parseContactoSinIdentificacion(bodyText, options = {}) {
  if (!bodyText || typeof bodyText !== "string") return [];

  const regex = /^(.*?)\s{2,}(.*?)\s{2,}([A-Z0-9\-\s]+?)\s{2,}(\d{2}-\d{2}-\d{4})\s+(\d{2}:\d{2}:\d{2})$/i;

  return normalizeBodyLines(bodyText)
    .map((line) => {
      const match = line.match(regex);
      if (!match) return null;

      const [, brand, model, plateGroup, datePart, timePart] = match;
      const parsedTimestamp = parseDateTimeToIso(datePart.replace(/-/g, "/"), timePart);
      const fallbackTimestamp = parsedTimestamp ? null : buildFallbackTimestamp(options.fallbackTimestamp);
      const eventTimestamp = parsedTimestamp || fallbackTimestamp;
      const timestampSource = parsedTimestamp ? "EMAIL_EVENT" : fallbackTimestamp ? "INGEST_FALLBACK" : null;
      if (!eventTimestamp || !timestampSource) return null;

      let plateRaw = plateGroup.trim();
      const plateMatch = plateRaw.match(PLATE_REGEX);
      if (plateMatch) plateRaw = plateMatch[1];

      return buildCommonEvent({
        type: "contacto",
        speed: null,
        hasSpeed: false,
        plate: plateRaw,
        brand: brand.trim(),
        model: model.trim(),
        eventSubtype: EVENT_SUBTYPE_CONTACT_NO_DRIVER,
        rawEventType: "Contacto sin identificacion",
        locationShort: null,
        locationRaw: null,
        eventTimestamp,
        timestampSource,
        rawLine: line,
      });
    })
    .filter(Boolean);
}

function normalizarEvento(raw, sourceEmailType) {
  const speedEventsEnabled = isRsvV2SpeedEventsEnabled();
  const isSpeeding = raw.hasSpeed === true && speedEventsEnabled;

  const eventSubtype = isSpeeding
    ? raw.eventSubtype || EVENT_SUBTYPE_SPEED_EXCESS
    : raw.eventSubtype || toEventSubtypeFromLegacyType(raw.type);

  const reasonRaw = raw.reasonRaw ?? raw.reason ?? null;

  return {
    ...raw,
    sourceEmailType: sourceEmailType ?? "excesos_del_dia",
    reason: raw.reason ?? reasonRaw,
    reasonRaw,
    rawEventType: raw.rawEventType || toRawEventType(reasonRaw),
    eventSource: raw.eventSource || EVENT_SOURCE_RSV,
    eventCategory: isSpeeding ? EVENT_CATEGORY_SPEEDING : EVENT_CATEGORY_DRIVER_IDENTIFICATION,
    eventSubtype,
    speedLimit: raw.speedLimit ?? null,
    speedDelta: raw.speedLimit != null && raw.speed != null ? Math.max(0, raw.speed - raw.speedLimit) : null,
    timestampSource: raw.timestampSource || "EMAIL_EVENT",
    fecha: null,
    hora: null,
    eventDate: null,
    eventTime: null,
  };
}

function extractOperationFromBody(bodyText) {
  if (!bodyText || typeof bodyText !== "string") return null;
  const lines = bodyText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const re = /^Operaci[o\u00F3]n\s*:\s*(.+)$/i;
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const m = lines[i].match(re);
    if (m && m[1]) {
      const name = m[1].trim();
      return name.length > 0 ? name : null;
    }
  }
  return null;
}

function parseVehicleEventsFromEmail(subject, bodyText, options = {}) {
  const sourceEmailType = detectEmailType(subject);
  let rawEvents = [];
  let detectedType = sourceEmailType;

  const parserOptions = {
    parserV2Enabled: options.parserV2Enabled === true || isRsvV2ParserEnabled(),
    fallbackTimestamp: options.fallbackTimestamp || null,
  };

  if (sourceEmailType === EMAIL_TYPE_EXCESOS) {
    rawEvents = parseExcesos(bodyText, parserOptions);
  } else if (sourceEmailType === EMAIL_TYPE_NO_IDENTIFICADOS) {
    rawEvents = parseNoIdentificados(bodyText, parserOptions);
  } else if (sourceEmailType === EMAIL_TYPE_CONTACTO) {
    rawEvents = parseContactoSinIdentificacion(bodyText, parserOptions);
  } else {
    const excesos = parseExcesos(bodyText, parserOptions);
    const noIds = parseNoIdentificados(bodyText, parserOptions);
    const contactos = parseContactoSinIdentificacion(bodyText, parserOptions);
    if (excesos.length >= noIds.length && excesos.length >= contactos.length) {
      rawEvents = excesos;
      detectedType = EMAIL_TYPE_EXCESOS;
    } else if (noIds.length >= contactos.length) {
      rawEvents = noIds;
      detectedType = EMAIL_TYPE_NO_IDENTIFICADOS;
    } else {
      rawEvents = contactos;
      detectedType = EMAIL_TYPE_CONTACTO;
    }
  }

  const sourceEmailTypeKey =
    detectedType === EMAIL_TYPE_EXCESOS
      ? "excesos_del_dia"
      : detectedType === EMAIL_TYPE_NO_IDENTIFICADOS
        ? "no_identificados_del_dia"
        : detectedType === EMAIL_TYPE_CONTACTO
          ? "contacto_sin_identificacion"
          : "excesos_del_dia";

  const operationName = extractOperationFromBody(bodyText);

  return {
    events: rawEvents.map((raw) => normalizarEvento(raw, sourceEmailTypeKey)),
    sourceEmailType: detectedType,
    operationName: operationName || null,
  };
}

function parseVehicleEventsFromBody(bodyText, subject = "") {
  return parseVehicleEventsFromEmail(subject, bodyText || "").events;
}

function parseLine(line) {
  const events = parseExcesos(String(line || ""));
  return events[0] || null;
}

function getSubjectPatterns() {
  return { ...SUBJECT_PATTERNS };
}

module.exports = {
  parseLine,
  parseVehicleEventsFromBody,
  parseExcesos,
  parseNoIdentificados,
  parseContactoSinIdentificacion,
  parseVehicleEventsFromEmail,
  extractOperationFromBody,
  normalizarEvento,
  classifyTypeFromReason,
  extractDriverNameFromReason,
  extractKeyIdFromReason,
  detectEmailType,
  getSubjectPatterns,
  DEFAULT_TIMEZONE,
  EMAIL_TYPE_EXCESOS,
  EMAIL_TYPE_NO_IDENTIFICADOS,
  EMAIL_TYPE_CONTACTO,
  EVENT_SOURCE_RSV,
  EVENT_CATEGORY_DRIVER_IDENTIFICATION,
  EVENT_CATEGORY_SPEEDING,
  EVENT_SUBTYPE_CONTACT_NO_DRIVER,
  EVENT_SUBTYPE_DRIVER_NOT_IDENTIFIED,
  EVENT_SUBTYPE_UNKNOWN_KEY,
  EVENT_SUBTYPE_INACTIVE_DRIVER,
  EVENT_SUBTYPE_NO_KEY_DETECTED,
  EVENT_SUBTYPE_SPEED_EXCESS,
};


