/**
 * emailUsers.service.js
 * Servicio de acceso al panel de alertas de vehículos.
 * Colecciones:
 * - apps/emails/access/{email}
 * - apps/emails/vehicles/{plate}
 * - apps/emails/config (documento de configuración global)
 */

const admin = require("../../firebaseAdmin");

const db = admin.firestore();

const ACCESS_REF = db.collection("apps").doc("emails").collection("access");
const VEHICLES_REF = db.collection("apps").doc("emails").collection("vehicles");
// apps/emails/config → se modela como colección "config" con doc "config"
const CONFIG_DOC_REF = db
  .collection("apps")
  .doc("emails")
  .collection("config")
  .doc("config");

/**
 * Normaliza email: trim y toLowerCase.
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
 * Asegura que el usuario de acceso exista en apps/emails/access/{email}.
 * Si no existe: crea con email, role, active/enabled: true, createdAt/updatedAt.
 * Si existe: merge sin modificar role si ya está definido.
 * @param {string} email - Email (se normaliza internamente)
 * @param {string} role - "admin" | "general" | "report" | "responsable"
 * @returns {Promise<void>}
 */
async function ensureUser(email, role) {
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error("email requerido");

  const validRoles = ["admin", "general", "report", "responsable"];
  if (!role || !validRoles.includes(role)) {
    throw new Error("role debe ser 'admin', 'general', 'report' o 'responsable'");
  }

  const docRef = ACCESS_REF.doc(normalized);
  const docSnap = await docRef.get();

  if (!docSnap.exists) {
    const now = admin.firestore.FieldValue.serverTimestamp();
    await docRef.set({
      email: normalized,
      role,
      active: true,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    return;
  }

  const data = docSnap.data() || {};
  const update = {};

  // Asegurar email normalizado
  if (!data.email) {
    update.email = normalized;
  }
  // No forzar role si ya existe: la promoción/degradación se hace explícitamente
  if (data.role == null || data.role === "") {
    update.role = role;
  }

  // Mantener active/enabled alineados para compatibilidad.
  if (data.active == null && data.enabled == null) {
    update.active = true;
    update.enabled = true;
  } else if (data.active == null && data.enabled != null) {
    update.active = data.enabled === true;
  } else if (data.enabled == null && data.active != null) {
    update.enabled = data.active === true;
  } else if (data.active != null && data.enabled != null && (data.active === true) !== (data.enabled === true)) {
    update.enabled = data.active === true;
  }

  if (Object.keys(update).length > 0) {
    update.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    await docRef.set(update, { merge: true });
  }
}

/**
 * Obtiene el usuario autorizado por email desde apps/emails/access.
 * Requiere active/enabled === true; si no, retorna null.
 * @param {string} email
 * @returns {Promise<{ email: string, role: string } | null>}
 */
async function getMe(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  const docSnap = await ACCESS_REF.doc(normalized).get();
  if (!docSnap.exists) return null;

  const data = docSnap.data() || {};
  const isEnabled = data.enabled === true || data.active === true;
  if (!isEnabled) return null;

  return {
    email: data.email || normalized,
    role: data.role || "responsable",
  };
}

/**
 * Obtiene los vehículos visibles para el usuario según su role.
 * admin/general/report: toda la colección apps/emails/vehicles.
 * responsable: documentos donde responsablesNormalized array-contains email.
 * @param {string} email
 * @param {string} role - "admin" | "general" | "report" | "responsable"
 * @returns {Promise<Array<object>>}
 */
async function getMyVehicles(email, role) {
  const normalized = normalizeEmail(email);
  if (!normalized) return [];

  if (role === "admin" || role === "general" || role === "report") {
    const snap = await VEHICLES_REF.get();
    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }

  if (role === "responsable") {
    // Preferimos responsablesNormalized para consultas eficientes.
    let snap = await VEHICLES_REF.where("responsablesNormalized", "array-contains", normalized).get();

    // Compatibilidad: si aún no se migró el campo, intentar con responsables.
    if (snap.empty) {
      snap = await VEHICLES_REF.where("responsables", "array-contains", normalized).get();
    }

    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }

  return [];
}

/**
 * Sincroniza usuarios de acceso a partir de:
 * - apps/emails/vehicles (responsables/responsablesNormalized)
 * - apps/emails/config (generalRecipients, ccRecipients, reportRecipients)
 *
 * Crea/actualiza documentos en apps/emails/access/{email}.
 * No cambia roles ya asignados explícitamente, solo completa datos faltantes.
 *
 * @returns {Promise<{ created: number, updated: number, totalEmails: number }>}
 */
async function syncAccessUsers() {
  const allEmailsSet = new Set();
  const candidateRoles = new Map(); // email -> desiredRole (solo para nuevos docs)

  // 1) Recorrer todos los vehículos de forma paginada y normalizar responsables/responsablesNormalized
  const PAGE_SIZE = 500;
  let lastDoc = null;

  // Paginar por documentId para evitar cargar toda la colección en memoria
  // y aplicar updates en batches por página.
  // orderBy(FieldPath.documentId()) requiere usar el id del último doc con startAfter.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let query = VEHICLES_REF.orderBy(admin.firestore.FieldPath.documentId()).limit(PAGE_SIZE);
    if (lastDoc) {
      query = query.startAfter(lastDoc.id);
    }

    const snap = await query.get();
    if (snap.empty) break;

    const batch = db.batch();
    let batchOps = 0;

    snap.forEach((doc) => {
      const data = doc.data() || {};
      const rawResponsables = Array.isArray(data.responsables) ? data.responsables : [];
      const storedNormalized = Array.isArray(data.responsablesNormalized)
        ? data.responsablesNormalized
        : [];

      // Fuente de verdad: solo responsables. responsablesNormalized = normalize(responsables).
      const canonicalNormalized = normalizeEmailArray(rawResponsables);
      canonicalNormalized.forEach((email) => allEmailsSet.add(email));

      // Corregir responsablesNormalized si está desincronizado (p. ej. emails obsoletos).
      const normalizedStored = normalizeEmailArray(storedNormalized);
      const arraysEqual =
        canonicalNormalized.length === normalizedStored.length &&
        canonicalNormalized.every((e, idx) => e === normalizedStored[idx]);
      const needsUpdate = !arraysEqual;

      if (needsUpdate) {
        batch.set(doc.ref, { responsablesNormalized: canonicalNormalized }, { merge: true });
        batchOps += 1;
      }
    });

    if (batchOps > 0) {
      await batch.commit();
    }

    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE_SIZE) {
      break;
    }
  }

  // 2) Leer configuración global apps/emails/config
  const configSnap = await CONFIG_DOC_REF.get();
  if (configSnap.exists) {
    const cfg = configSnap.data() || {};
    const general = normalizeEmailArray(cfg.generalRecipients || []);
    const cc = normalizeEmailArray(cfg.ccRecipients || []);
    const report = normalizeEmailArray(cfg.reportRecipients || []);

    const preferRole = (email, role) => {
      // Preferencia básica: admin > general > report > responsable
      const order = { admin: 3, general: 2, report: 1, responsable: 0 };
      const current = candidateRoles.get(email);
      if (!current || order[role] > order[current]) {
        candidateRoles.set(email, role);
      }
    };

    general.forEach((email) => {
      allEmailsSet.add(email);
      preferRole(email, "general");
    });
    cc.forEach((email) => {
      allEmailsSet.add(email);
      preferRole(email, "general");
    });
    report.forEach((email) => {
      allEmailsSet.add(email);
      preferRole(email, "report");
    });
  }

  const allEmails = Array.from(allEmailsSet);

  // 3) Cargar todos los usuarios existentes de access en memoria (evita lecturas repetidas)
  const existingUsers = new Map();
  const accessSnap = await ACCESS_REF.get();
  accessSnap.forEach((doc) => {
    existingUsers.set(doc.id, doc.data() || {});
  });

  // 4) Asegurar documentos en apps/emails/access/{email} usando batch writes
  let created = 0;
  let updated = 0;
  const MAX_BATCH = 500;
  let batch = db.batch();
  let batchOps = 0;

  async function commitIfNeeded() {
    if (batchOps > 0) {
      await batch.commit();
      batch = db.batch();
      batchOps = 0;
    }
  }

  for (const email of allEmails) {
    const docRef = ACCESS_REF.doc(email);
    const existing = existingUsers.get(email);

    if (!existing) {
      const role = candidateRoles.get(email) || "responsable";
      const now = admin.firestore.FieldValue.serverTimestamp();
      batch.set(docRef, {
        email,
        role,
        active: true,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      });
      created += 1;
      batchOps += 1;
    } else {
      const update = {};

      if (!existing.email) {
        update.email = email;
      }
      if (existing.active == null && existing.enabled == null) {
        update.active = true;
        update.enabled = true;
      } else if (existing.active == null && existing.enabled != null) {
        update.active = existing.enabled === true;
      } else if (existing.enabled == null && existing.active != null) {
        update.enabled = existing.active === true;
      } else if (existing.active != null && existing.enabled != null && (existing.active === true) !== (existing.enabled === true)) {
        update.enabled = existing.active === true;
      }

      // No sobreescribimos role si ya existe; si esta vacio, usamos el candidato si hay.
      if (existing.role == null || existing.role === "") {
        const candidateRole = candidateRoles.get(email) || "responsable";
        update.role = candidateRole;
      }

      if (Object.keys(update).length > 0) {
        update.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        batch.set(docRef, update, { merge: true });
        updated += 1;
        batchOps += 1;
      }
    }

    if (batchOps >= MAX_BATCH) {
      // eslint-disable-next-line no-await-in-loop
      await commitIfNeeded();
    }
  }

  await commitIfNeeded();

  // 5) Deshabilitar usuarios que ya no están en ninguna fuente (vehicles.responsables, config recipients)
  let disabled = 0;
  for (const [email, data] of existingUsers) {
    if (allEmailsSet.has(email)) continue;
    const isCurrentlyEnabled = data.enabled === true || data.active === true;
    if (!isCurrentlyEnabled) continue;

    const docRef = ACCESS_REF.doc(email);
    batch.set(docRef, {
      enabled: false,
      active: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    disabled += 1;
    batchOps += 1;

    if (batchOps >= MAX_BATCH) {
      await commitIfNeeded();
    }
  }

  await commitIfNeeded();

  return { created, updated, disabled, totalEmails: allEmails.length };
}

module.exports = {
  normalizeEmail,
  normalizeEmailArray,
  ensureUser,
  getMe,
  getMyVehicles,
  syncAccessUsers,
};
