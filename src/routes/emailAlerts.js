/**
 * Rutas para alertas diarias.
 * El backend NO env?a emails. Solo expone pendientes y permite marcarlas como enviadas.
 * Un solo email por responsable por d?a, consolidando todas las patentes en un resumen.
 *
 * GET  /api/email/get-pending-daily-alerts ? [{ responsableEmails, subject, body, alertIds }]
 * POST /api/email/mark-alert-sent ? body: { alertIds: string[] }
 */

const express = require("express");
const router = express.Router();
const admin = require("../firebaseAdmin");
const { formatDateKey, getVehicle, normalizePlate } = require("../services/vehicleEventService");
const { getDailyTotalsByType } = require("../services/dailyMetricsService");
const { syncAccessUsers } = require("../modules/emailUsers/emailUsers.service");
const { logger } = require("../utils/logger");
const {
  buildConsolidatedBody,
  buildConsolidatedSubject,
  buildGeneralGroupsBody,
  buildGeneralSubjectLastDays,
  buildGeneralSubjectSingleDate,
  buildMetaFromVehicleDocs,
  sortVehiclesByCriticity,
} = require("../services/email/emailTemplateBuilder");

const db = admin.firestore();

const DAILY_ALERTS_REF = db
  .collection("apps")
  .doc("emails")
  .collection("dailyAlerts");

/**
 * Valida x-local-token. Retorna true si v?lido.
 */
function validateLocalToken(req) {
  const token = process.env.LOCAL_EMAIL_TOKEN;
  if (!token) return false;
  return req.headers["x-local-token"] === token;
}

/**
 * Parsea y valida ?date=YYYY-MM-DD. Retorna el string dateKey o null si es inv?lido.
 */
function parseDateQuery(queryDate) {
  if (!queryDate || typeof queryDate !== "string") return null;
  const trimmed = queryDate.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const [y, m, d] = trimmed.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (isNaN(date.getTime()) || date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return trimmed;
}

function getTodayKeyArgentina() {
  const now = new Date();
  return now.toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  });
}

/** N?mero de d?as hacia atr?s para incluir alertas pendientes (hoy = 0, ayer = 1, ..., 5 d?as atr?s). */
const PENDING_ALERTS_DAYS_BACK = 5;

/**
 * Fecha de ayer en Argentina (YYYY-MM-DD). Se usa para buscar alertas diarias pendientes.
 */
function getYesterdayKeyArgentina() {
  const now = new Date();
  const argDateStr = now.toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  });
  const [y, m, d] = argDateStr.split("-").map(Number);
  const argDate = new Date(y, m - 1, d);
  argDate.setDate(argDate.getDate() - 1);
  const yy = argDate.getFullYear();
  const mm = String(argDate.getMonth() + 1).padStart(2, "0");
  const dd = String(argDate.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Devuelve las fechas (YYYY-MM-DD) de los ?ltimos n d?as en Argentina (ayer, anteayer, ..., n d?as atr?s).
 * Hoy no se incluye. ?til para filtrar alertas pendientes a enviar.
 */
function getLastNDaysDateKeysArgentina(n) {
  if (!Number.isFinite(n) || n < 1) return [];
  const argDateStr = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  });
  const [y, m, d] = argDateStr.split("-").map(Number);
  const argDate = new Date(y, m - 1, d);
  const keys = [];
  for (let i = 1; i <= n; i++) {
    const d2 = new Date(argDate);
    d2.setDate(d2.getDate() - i);
    const yy = d2.getFullYear();
    const mm = String(d2.getMonth() + 1).padStart(2, "0");
    const dd = String(d2.getDate()).padStart(2, "0");
    keys.push(`${yy}-${mm}-${dd}`);
  }
  return keys;
}

/**
 * Convierte un dateKey YYYY-MM-DD en un n?mero comparable (YYYYMMDD).
 * Devuelve NaN si el formato no es v?lido.
 */
function toDateKeyNumber(key) {
  if (!key || typeof key !== "string") return NaN;
  const trimmed = key.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return NaN;
  const [y, m, d] = trimmed.split("-").map(Number);
  if (!y || !m || !d) return NaN;
  return y * 10000 + m * 100 + d;
}

function normalizeEmail(email) {
  if (email == null || typeof email !== "string") return "";
  return email.trim().toLowerCase();
}

function normalizeEmailArray(values) {
  if (!Array.isArray(values)) return [];
  const set = new Set();
  for (const value of values) {
    const normalized = normalizeEmail(value);
    if (normalized) set.add(normalized);
  }
  return Array.from(set);
}

/**
 * Obtiene alertas pendientes de d?as anteriores a hoy (Argentina).
 * Una sola capa de filtrado: dateKey < todayKey y alertSent !== true.
 *
 * @deprecated No escala bien con muchos d?as hist?ricos. Usar getPendingAlertsForDateKey por cada dateKey de getLastNDaysDateKeysArgentina(N).
 * @param {string} todayKey - Fecha de hoy en Argentina (YYYY-MM-DD).
 * @returns {Promise<Array<{ id: string, dateKey: string, ... }>>} Documentos de veh?culos pendientes (nunca incluye el d?a actual).
 */
async function getPendingAlerts(todayKey) {
  const dateKeysSnap = await DAILY_ALERTS_REF.get();
  const allDateKeys = dateKeysSnap.docs.map((doc) => doc.id);

  const todayNum = toDateKeyNumber(todayKey);
  const pastDateKeys = allDateKeys.filter((dateKey) => {
    const num = toDateKeyNumber(dateKey);
    return Number.isFinite(num) && Number.isFinite(todayNum) && num < todayNum;
  });

  logger.info(
    "[GET-PENDING-ALERTS][DEBUG] todayKey=%s, todayNum=%s, allDateKeys=%j, pastDateKeys=%j",
    todayKey,
    String(todayNum),
    allDateKeys,
    pastDateKeys
  );

  const allAlerts = [];
  for (const dateKey of pastDateKeys) {
    try {
      const vehiclesSnap = await DAILY_ALERTS_REF.doc(dateKey).collection("vehicles").get();
      logger.info(
        "[GET-PENDING-ALERTS][DEBUG] dateKey=%s, vehicles=%d",
        dateKey,
        vehiclesSnap.docs.length
      );

      for (const vehicleDoc of vehiclesSnap.docs) {
        const data = vehicleDoc.data();
        const isPending = data.alertSent !== true;

        logger.info(
          "[GET-PENDING-ALERTS][DEBUG] Evaluando doc dateKey=%s id=%s alertSent=%s isPending=%s",
          dateKey,
          vehicleDoc.id,
          String(data.alertSent),
          String(isPending)
        );

        if (isPending) {
          allAlerts.push({ id: vehicleDoc.id, dateKey, ...data });
        }
      }
    } catch (e) {
      const errMsg = e && e.message ? e.message : String(e);
      const errCode = e && e.code !== undefined ? e.code : "n/a";
      logger.error(
        `[GET-PENDING-ALERTS][DEBUG] Error leyendo vehicles para dateKey=${dateKey}: ${errMsg} (code=${errCode})`
      );
      continue;
    }
  }

  logger.info(
    "[GET-PENDING-ALERTS][DEBUG] Total alertas pendientes devueltas: %d",
    allAlerts.length
  );

  return allAlerts;
}

/**
 * Obtiene alertas pendientes solo para un dateKey (apps/emails/dailyAlerts/{dateKey}/vehicles).
 * @param {string} dateKey - YYYY-MM-DD
 * @returns {Promise<Array<{ id: string, dateKey: string, ... }>>}
 */
async function getPendingAlertsForDateKey(dateKey) {
  const allAlerts = [];
  try {
    const vehiclesSnap = await DAILY_ALERTS_REF.doc(dateKey).collection("vehicles").get();
    logger.info("[DEBUG] vehiclesSnap size:", vehiclesSnap.size);
    for (const vehicleDoc of vehiclesSnap.docs) {
      const data = vehicleDoc.data();
      logger.info("[DEBUG] vehicle doc:", vehicleDoc.id, vehicleDoc.data());
      if (data.alertSent !== true) {
        allAlerts.push({ id: vehicleDoc.id, dateKey, ...data });
      }
    }
  } catch (e) {
    const errMsg = e && e.message ? e.message : String(e);
    const errCode = e && e.code !== undefined ? e.code : "n/a";
    logger.error(
      `[GET-PENDING-ALERTS][DEBUG] Error leyendo vehicles para dateKey=${dateKey}: ${errMsg} (code=${errCode})`
    );
  }
  return allAlerts;
}

/**
 * Obtiene el documento meta del d?a (apps/emails/dailyAlerts/{dateKey}/meta/meta).
 * Retorna null si no existe; los contadores se tratan como 0.
 */
async function getDailyMeta(dateKey) {
  const metaSnap = await DAILY_ALERTS_REF.doc(dateKey).collection("meta").doc("meta").get();
  if (!metaSnap.exists) return null;
  return metaSnap.data();
}

/**
 * Agrupa alertas pendientes por responsable (email).
 * Una patente puede estar en varios responsables; dentro del mismo responsable no se duplica patente.
 * Retorna: Array<{ dateKey, responsableEmail, docs: vehicleDoc[] }>
 */
function groupAlertsByResponsable(pendingDocs) {
  const byKey = new Map();

  for (const doc of pendingDocs) {
    const plate = normalizePlate(doc.plate || doc.id);
    const dateKey = doc.dateKey;
    const responsables = Array.isArray(doc.responsables)
      ? doc.responsables.filter((e) => typeof e === "string" && e.includes("@"))
      : [];

    for (const email of responsables) {
      const key = `${dateKey}|${email.trim().toLowerCase()}`;
      if (!byKey.has(key)) {
        byKey.set(key, { dateKey, responsableEmail: email.trim(), plates: new Set(), docs: [] });
      }
      const group = byKey.get(key);
      if (!group.plates.has(plate)) {
        group.plates.add(plate);
        group.docs.push(doc);
      }
    }
  }

  return Array.from(byKey.values()).map((g) => ({ dateKey: g.dateKey, responsableEmail: g.responsableEmail, docs: g.docs }));
}

/**
 * Agrupa alertas pendientes por conjunto de responsables (mismo d?a + mismos emails).
 * Si m?ltiples veh?culos comparten exactamente el mismo conjunto de responsables, se genera un solo grupo consolidado.
 * Retorna: Array<{ dateKey, responsableEmails: string[], plates: Set<string>, docs: vehicleDoc[] }>
 */
function groupAlertsByResponsableSet(pendingDocs) {
  const byKey = new Map();

  for (const doc of pendingDocs) {
    const plate = normalizePlate(doc.plate || doc.id);
    const dateKey = doc.dateKey;
    const raw = Array.isArray(doc.responsables) ? doc.responsables : [];
    const responsableEmails = [...new Set(
      raw
        .filter((e) => typeof e === "string" && e.includes("@"))
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.length > 0)
    )].sort();

    if (responsableEmails.length === 0) {
      logger.warn("[DEBUG] skipping alert without responsables", {
        plate,
        dateKey,
        rawResponsables: raw,
      });
      continue;
    }

    const key = `${dateKey}|${responsableEmails.join(",")}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        dateKey,
        responsableEmails,
        plates: new Set(),
        docs: [],
      });
    }
    const group = byKey.get(key);
    group.plates.add(plate);
    group.docs.push(doc);
  }

  return Array.from(byKey.values()).map((g) => ({
    dateKey: g.dateKey,
    responsableEmails: g.responsableEmails,
    plates: g.plates,
    docs: g.docs,
  }));
}

/**
 * Parsea alertId (formato: YYYY-MM-DD_PLATE) en { dateKey, plate }.
 * Normaliza la patente para garantizar consistencia.
 */
function parseAlertId(alertId) {
  if (!alertId || typeof alertId !== "string") return null;
  const idx = alertId.indexOf("_");
  if (idx <= 0 || idx >= alertId.length - 1) return null;
  const rawPlate = alertId.slice(idx + 1).trim();
  return {
    dateKey: alertId.slice(0, idx),
    plate: normalizePlate(rawPlate), // Normalizar patente
  };
}

/**
 * Marca una alerta como enviada (un documento vehicle).
 */
async function markAlertAsSent(dateKey, plate) {
  const normalizedPlate = normalizePlate(plate);
  const docRef = DAILY_ALERTS_REF.doc(dateKey).collection("vehicles").doc(normalizedPlate);
  await docRef.update({
    alertSent: true,
    sentAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

/**
 * Marca m?ltiples alertas como enviadas en batch (m?x 500 por batch).
 */
async function markAlertsAsSentBatch(alertIds) {
  const parsed = alertIds
    .map((id) => parseAlertId(id))
    .filter(Boolean);
  const uniqueKeys = new Map();
  for (const { dateKey, plate } of parsed) {
    uniqueKeys.set(`${dateKey}|${plate}`, { dateKey, plate });
  }
  const toUpdate = Array.from(uniqueKeys.values());
  const BATCH_SIZE = 500;
  for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
    const chunk = toUpdate.slice(i, i + BATCH_SIZE);
    const docRefs = chunk.map(({ dateKey, plate }) =>
      DAILY_ALERTS_REF.doc(dateKey).collection("vehicles").doc(plate)
    );
    const docSnaps = await db.getAll(...docRefs);

    const batch = db.batch();

    for (let j = 0; j < chunk.length; j += 1) {
      const { dateKey, plate } = chunk[j];
      const vehicleSnap = docSnaps[j];
      const ref = DAILY_ALERTS_REF.doc(dateKey).collection("vehicles").doc(plate);
      batch.update(ref, {
        alertSent: true,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const vehicleData = vehicleSnap.exists ? vehicleSnap.data() || {} : {};
      const responsables = normalizeEmailArray(
        Array.isArray(vehicleData.responsablesNormalized) && vehicleData.responsablesNormalized.length > 0
          ? vehicleData.responsablesNormalized
          : vehicleData.responsables
      );
      const encodedAlertId = encodeURIComponent(`${dateKey}_${plate}`);

      for (const email of responsables) {
        const indexRef = db
          .collection("apps")
          .doc("emails")
          .collection("responsables")
          .doc(encodeURIComponent(email))
          .collection("alerts")
          .doc(encodedAlertId);

        batch.set(
          indexRef,
          {
            alertSent: true,
          },
          { merge: true }
        );
      }
    }

    await batch.commit();
  }
  return toUpdate.length;
}

/**
 * GET /email/get-pending-daily-alerts
 *
 * Requiere: x-local-token.
 * Agrupa por conjunto de responsables (mismo d?a + mismos emails): un solo email por grupo consolidado.
 * Respuesta: [{ responsableEmails, subject, body, alertIds }].
 */
const EMAIL_CONFIG_REF = db
  .collection("apps")
  .doc("emails")
  .collection("config")
  .doc("config");

/**
 * Lee la configuraci?n de email (destinatarios general, CC, reporte). Si no existe, devuelve arrays vac?os.
 */
async function getEmailConfig() {
  const snap = await EMAIL_CONFIG_REF.get();
  const config = snap.exists && snap.data() ? snap.data() : {};
  return {
    to: Array.isArray(config.generalRecipients) ? config.generalRecipients : [],
    cc: Array.isArray(config.ccRecipients) ? config.ccRecipients : [],
    reportRecipients: Array.isArray(config.reportRecipients) ? config.reportRecipients : [],
  };
}

router.get("/email/get-pending-daily-alerts", async (req, res) => {
  try {
    if (!validateLocalToken(req)) {
      logger.warn("[GET-PENDING-ALERTS] Intento no autorizado desde:", req.ip);
      return res.status(401).json({ error: "no autorizado" });
    }

    const emailConfig = await getEmailConfig();

    const allowedDateKeys = getLastNDaysDateKeysArgentina(PENDING_ALERTS_DAYS_BACK);
    logger.info("[GET-PENDING-ALERTS] searching alerts for last %d days (Argentina): %j", PENDING_ALERTS_DAYS_BACK, allowedDateKeys);

    const docs = [];
    for (const dateKey of allowedDateKeys) {
      const alerts = await getPendingAlertsForDateKey(dateKey);
      docs.push(...alerts);
    }

    logger.info(`[GET-PENDING-ALERTS] Alertas pendientes (documentos) en ?ltimos ${PENDING_ALERTS_DAYS_BACK} d?as: ${docs.length}`);

    if (docs.length === 0) {
      const lastDayInWindow = getLastNDaysDateKeysArgentina(PENDING_ALERTS_DAYS_BACK)[0] || getYesterdayKeyArgentina();
      const generalBody = buildGeneralGroupsBody([], lastDayInWindow);
      return res.status(200).json({
        ok: true,
        alerts: [],
        general: {
          to: emailConfig.to,
          cc: emailConfig.cc,
          reportRecipients: emailConfig.reportRecipients,
          subject: buildGeneralSubjectLastDays(PENDING_ALERTS_DAYS_BACK),
          body: generalBody,
        },
      });
    }

    // Cargar todos los veh?culos una sola vez (apps/emails/vehicles)
    const vehiclesSnap = await db
      .collection("apps")
      .doc("emails")
      .collection("vehicles")
      .get();

    const vehiclesMap = new Map();
    vehiclesSnap.docs.forEach((doc) => {
      vehiclesMap.set(normalizePlate(doc.id), doc.data());
    });
    logger.info("[DEBUG] vehiclesMap size:", vehiclesMap.size);

    // Enriquecer con responsables y operationName desde vehiclesMap (en memoria)
    const enriched = docs.map((doc) => {
      const plate = normalizePlate(doc.plate || doc.id);
      logger.info("[DEBUG] processing alert", {
        rawPlate: doc.plate || doc.id,
        normalizedPlate: plate,
      });

      const vehicle = vehiclesMap.get(plate) || null;
      logger.info("[DEBUG] vehicle lookup result", {
        plate,
        found: !!vehicle,
      });

      let responsables = [];
      if (Array.isArray(vehicle?.responsables)) {
        responsables = vehicle.responsables;
      } else if (Array.isArray(doc.responsables)) {
        responsables = doc.responsables;
      }
      responsables = responsables.filter(
        (e) => typeof e === "string" && e.includes("@")
      );
      logger.info("[DEBUG] responsables resolved", {
        plate,
        responsables,
      });

      const operationName = vehicle?.operationName || vehicle?.operacion || doc.operationName || doc.operacion || null;
      return { ...doc, plate, responsables, operationName, operacion: operationName };
    });

    logger.info("[DEBUG] enriched alerts count", enriched.length);
    const groups = groupAlertsByResponsableSet(enriched);
    logger.info(`[GET-PENDING-ALERTS] Agrupamiento por conjunto de responsables: ${groups.length} grupo(s)`);
    groups.forEach((g, i) => {
      logger.info(`[GET-PENDING-ALERTS] Grupo ${i + 1}: responsables [${g.responsableEmails.join(", ")}], patentes: ${g.docs.length}`);
    });

    const alerts = groups.map((group) => {
      const sortedDocs = sortVehiclesByCriticity(group.docs);
      const metaForRecipient = buildMetaFromVehicleDocs(sortedDocs);
      const alertIds = sortedDocs.map((d) => `${group.dateKey}_${normalizePlate(d.plate || d.id)}`);
      const responsableEmails = group.responsableEmails;
      return {
        responsableEmails,
        // Backward compatibility for existing PowerShell scripts.
        responsableEmail: responsableEmails.length > 0 ? responsableEmails[0] : null,
        subject: buildConsolidatedSubject(group.dateKey),
        body: buildConsolidatedBody(metaForRecipient, sortedDocs, group.dateKey),
        alertIds,
      };
    });

    logger.info("[DEBUG] alerts before final response:", alerts.length, "groups:", groups.length);
    const uniqueDates = [...new Set(groups.map((g) => g.dateKey))];
    const dateKeyForGeneral = uniqueDates[0] || getYesterdayKeyArgentina();
    const generalBody = buildGeneralGroupsBody(groups, dateKeyForGeneral);
    const generalSubject =
      uniqueDates.length > 1
        ? buildGeneralSubjectLastDays(PENDING_ALERTS_DAYS_BACK)
        : buildGeneralSubjectSingleDate(uniqueDates[0]);

    logger.info(`[GET-PENDING-ALERTS] Respuesta: ${alerts.length} email(s) consolidado(s)`);
    return res.status(200).json({
      ok: true,
      general: {
        to: emailConfig.to,
        cc: emailConfig.cc,
        reportRecipients: emailConfig.reportRecipients,
        subject: generalSubject,
        body: generalBody,
      },
      alerts,
    });
  } catch (err) {
    const isUnauth = (err && (err.code === 16 || (err.message && String(err.message).includes("UNAUTHENTICATED"))));
    if (isUnauth) {
      logger.error(
        "[GET-PENDING-ALERTS] Firestore UNAUTHENTICATED: Revisa que la cuenta de servicio (FB_ADMIN_APPDATA o GOOGLE_SERVICE_ACCOUNT_KEY) sea del mismo proyecto donde est? tu Firestore, que tenga permisos de Firestore y que la clave privada tenga los \\n correctos."
      );
    }
    logger.error("[GET-PENDING-ALERTS] Error no controlado", {
      error: err && err.message ? err.message : String(err),
      stack: err && err.stack ? err.stack : undefined,
    });
    const generalBody = buildGeneralGroupsBody([], getTodayKeyArgentina());
    let fallbackConfig = { to: [], cc: [], reportRecipients: [] };
    try {
      fallbackConfig = await getEmailConfig();
    } catch (_) {
      // Si falla la lectura de config en catch, usar arrays vac�os
    }
    return res.status(200).json({
      ok: true,
      alerts: [],
      general: {
        to: fallbackConfig.to,
        cc: fallbackConfig.cc,
        reportRecipients: fallbackConfig.reportRecipients,
        subject: buildGeneralSubjectLastDays(PENDING_ALERTS_DAYS_BACK),
        body: generalBody,
      },
    });
  }
});

/**
 * POST /email/mark-alert-sent
 *
 * Requiere: x-local-token.
 * Body: { alertIds: string[] } o { alertId: string } (compatibilidad).
 */
router.post("/email/mark-alert-sent", async (req, res) => {
  try {
    if (!validateLocalToken(req)) {
      logger.warn("[MARK-ALERT-SENT] Intento no autorizado desde:", req.ip);
      return res.status(401).json({ error: "no autorizado" });
    }

    const body = req.body || {};
    let ids = Array.isArray(body.alertIds) ? body.alertIds : [];
    if (ids.length === 0 && body.alertId) {
      ids = [String(body.alertId)];
    }

    if (ids.length === 0) {
      return res.status(400).json({
        error: "Se requiere alertIds (array) o alertId (string)",
        expected: "alertIds: ['YYYY-MM-DD_PLATE', ...] o alertId: 'YYYY-MM-DD_PLATE'",
      });
    }

    const count = await markAlertsAsSentBatch(ids);
    logger.info(`[MARK-ALERT-SENT] Marcadas ${count} alerta(s) como enviadas`);
    return res.status(200).json({
      ok: true,
      alertIds: ids,
      marked: count,
    });
  } catch (err) {
    logger.error("[MARK-ALERT-SENT] Error:", err.message, err.stack);
    return res.status(500).json({
      error: "error interno",
      message: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

/**
 * POST /email/sync-access-users
 *
 * Sincroniza usuarios de acceso (mismo efecto que /api/admin/sync-access-users).
 * Requiere: x-local-token. Para uso desde scripts/cron (ej. enviar-email.ps1).
 */
router.post("/email/sync-access-users", async (req, res) => {
  try {
    if (!validateLocalToken(req)) {
      logger.warn("[SYNC-ACCESS-USERS] Intento no autorizado desde:", req.ip);
      return res.status(401).json({ error: "no autorizado" });
    }
    const result = await syncAccessUsers();
    return res.status(200).json({
      ok: true,
      ...result,
    });
  } catch (err) {
    logger.error("[SYNC-ACCESS-USERS] Error:", err.message, err.stack);
    return res.status(500).json({
      error: "error interno",
      message: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

/**
 * Compara total de eventos en meta del d?a con la suma de events en cada vehicle.
 * ?til para detectar posibles p?rdidas o inconsistencias (v2).
 * @param {string} dateKey - YYYY-MM-DD
 * @returns {{ ok: boolean, totalInMeta: number, totalInAlerts: number, diff: number }}
 */
async function getDailyConsistency(dateKey) {
  const meta = await getDailyMeta(dateKey);
  const totalInMeta = meta ? (meta.totalEvents ?? 0) : 0;

  const vehiclesSnap = await DAILY_ALERTS_REF.doc(dateKey).collection("vehicles").get();
  let totalInAlerts = 0;
  for (const doc of vehiclesSnap.docs) {
    const data = doc.data();
    const events = Array.isArray(data.events) ? data.events : [];
    totalInAlerts += events.length;
  }

  const diff = totalInMeta - totalInAlerts;
  return {
    ok: diff === 0,
    totalInMeta,
    totalInAlerts,
    diff,
  };
}

/**
 * GET /email/daily-metrics?date=YYYY-MM-DD
 * M?tricas del d?a (totales por tipo y por severidad) para dashboard o scripts (v2).
 */
router.get("/email/daily-metrics", async (req, res) => {
  try {
    if (!validateLocalToken(req)) {
      return res.status(401).json({ error: "no autorizado" });
    }
    const dateKey = parseDateQuery(req.query.date);
    if (!dateKey) {
      return res.status(400).json({ error: "Query date requerido en formato YYYY-MM-DD" });
    }
    const metrics = await getDailyTotalsByType(dateKey);
    return res.status(200).json({ ok: true, dateKey, metrics });
  } catch (err) {
    logger.error("[DAILY-METRICS] Error:", err.message, err.stack);
    return res.status(500).json({
      error: "error interno",
      message: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

/**
 * GET /email/daily-consistency?date=YYYY-MM-DD
 * Sanity check: compara totalEvents en meta con suma de events por vehicle ese d?a.
 */
router.get("/email/daily-consistency", async (req, res) => {
  try {
    if (!validateLocalToken(req)) {
      return res.status(401).json({ error: "no autorizado" });
    }
    const dateKey = parseDateQuery(req.query.date);
    if (!dateKey) {
      return res.status(400).json({ error: "Query date requerido en formato YYYY-MM-DD" });
    }
    const result = await getDailyConsistency(dateKey);
    return res.status(200).json({ ok: true, dateKey, ...result });
  } catch (err) {
    logger.error("[DAILY-CONSISTENCY] Error:", err.message, err.stack);
    return res.status(500).json({
      error: "error interno",
      message: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

/**
 * GET /email/debug-pending-alerts
 * Endpoint temporal de debug para verificar qu? est? pasando
 */
router.get("/email/debug-pending-alerts", async (req, res) => {
  try {
    if (!validateLocalToken(req)) {
      return res.status(401).json({ error: "no autorizado" });
    }

    const dateKeysSnap = await DAILY_ALERTS_REF.get();
    const debugInfo = {
      totalDateKeys: dateKeysSnap.docs.length,
      dateKeys: dateKeysSnap.docs.map((d) => d.id),
      vehiclesByDate: {},
    };

    for (const dateDoc of dateKeysSnap.docs) {
      const dateKey = dateDoc.id;
      const vehiclesSnap = await dateDoc.ref.collection("vehicles").get();
      
      const vehicles = vehiclesSnap.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          plate: data.plate || doc.id,
          alertSent: data.alertSent,
          alertSentType: typeof data.alertSent,
          eventCount: data.eventCount || 0,
          eventsLength: Array.isArray(data.events) ? data.events.length : 0
        };
      });
      
      debugInfo.vehiclesByDate[dateKey] = {
        total: vehiclesSnap.docs.length,
        pending: vehicles.filter(v => v.alertSent === false || v.alertSent === undefined || v.alertSent === null).length,
        vehicles: vehicles
      };
    }

    return res.status(200).json({ ok: true, debug: debugInfo });
  } catch (err) {
    logger.error("[DEBUG-PENDING-ALERTS] Error:", err.message, err.stack);
    return res.status(500).json({
      error: "error interno",
      message: err.message
    });
  }
});

/**
 * GET /email/vehicles/events-history
 *
 * Devuelve el historial de eventos de vehículos agrupados por mes.
 * Query params:
 *   - months: número entero (default 6, máximo 12)
 *   - plate: string opcional (filtra una patente específica)
 */
router.get("/email/vehicles/events-history", async (req, res) => {
  try {
    if (!validateLocalToken(req)) {
      logger.warn("[EVENTS-HISTORY] Intento no autorizado desde:", req.ip);
      return res.status(401).json({ error: "no autorizado" });
    }

    const rawMonths = parseInt(req.query.months, 10);
    const months = Number.isFinite(rawMonths) && rawMonths >= 1 ? Math.min(rawMonths, 12) : 6;
    const plateFilter = typeof req.query.plate === "string" && req.query.plate.trim().length > 0
      ? normalizePlate(req.query.plate.trim())
      : null;

    // Calcular monthKeys desde hace (months-1) meses hasta el mes actual inclusive
    const argNow = new Date().toLocaleDateString("en-CA", {
      timeZone: "America/Argentina/Buenos_Aires",
    });
    const [cy, cm] = argNow.split("-").map(Number);
    const monthKeys = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(cy, cm - 1 - i, 1);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      monthKeys.push(`${y}-${m}`);
    }

    const MONTHLY_HISTORY_REF = db
      .collection("apps")
      .doc("emails")
      .collection("monthlyHistory");

    const allEvents = [];

    for (const monthKey of monthKeys) {
      try {
        if (plateFilter) {
          const docSnap = await MONTHLY_HISTORY_REF.doc(monthKey)
            .collection("vehicles")
            .doc(plateFilter)
            .get();
          if (docSnap.exists) {
            const data = docSnap.data();
            const events = Array.isArray(data.events) ? data.events : [];
            allEvents.push(...events);
          }
        } else {
          const vehiclesSnap = await MONTHLY_HISTORY_REF.doc(monthKey)
            .collection("vehicles")
            .get();
          for (const vehicleDoc of vehiclesSnap.docs) {
            const data = vehicleDoc.data();
            const events = Array.isArray(data.events) ? data.events : [];
            allEvents.push(...events);
          }
        }
      } catch (monthErr) {
        logger.error(
          `[EVENTS-HISTORY] Error leyendo monthKey=${monthKey}: ${monthErr.message}`
        );
      }
    }

    return res.status(200).json({
      ok: true,
      events: allEvents,
      total: allEvents.length,
      monthKeys,
      plate: plateFilter,
    });
  } catch (err) {
    logger.error("[EVENTS-HISTORY] Error:", err.message, err.stack);
    return res.status(500).json({
      error: "error interno",
      message: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

module.exports = router;

