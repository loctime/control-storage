const admin = require("../../firebaseAdmin");
const repo = require("./training.repository");

const PLAN_STATUSES = new Set(["draft", "active", "closed"]);
const ITEM_STATUSES = new Set(["pending", "scheduled", "completed", "cancelled"]);
const SESSION_STATUSES = new Set(["planned", "executed", "cancelled"]);
const ATTENDANCE_STATUSES = new Set(["present", "absent"]);
const RECORD_STATUSES = new Set(["valid", "expired"]);

function httpError(status, code, message, details) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw httpError(400, "VALIDATION_ERROR", `${field} es requerido`);
  }
  return value.trim();
}

function optionalString(value) {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function requireNumber(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw httpError(400, "VALIDATION_ERROR", `${field} debe ser numérico`);
  return n;
}

function parseDateMaybe(value, field, required = false) {
  if (value == null || value === "") {
    if (required) throw httpError(400, "VALIDATION_ERROR", `${field} es requerido`);
    return null;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw httpError(400, "VALIDATION_ERROR", `${field} inválido`);
  return d;
}

function validateInSet(value, field, allowed) {
  if (!allowed.has(value)) {
    throw httpError(400, "VALIDATION_ERROR", `${field} inválido`, {
      field,
      allowed: Array.from(allowed),
    });
  }
}

function pendingBucket(status) {
  return status === "pending" || status === "scheduled";
}

function completedBucket(status) {
  return status === "completed";
}

function counterDeltaForStatusChange(fromStatus, toStatus) {
  const delta = {
    itemsCompleted: 0,
    itemsPending: 0,
  };

  if (fromStatus != null) {
    if (completedBucket(fromStatus)) delta.itemsCompleted -= 1;
    if (pendingBucket(fromStatus)) delta.itemsPending -= 1;
  }
  if (toStatus != null) {
    if (completedBucket(toStatus)) delta.itemsCompleted += 1;
    if (pendingBucket(toStatus)) delta.itemsPending += 1;
  }

  return delta;
}

function ensureOwnerId(ownerId) {
  if (!ownerId) throw httpError(400, "VALIDATION_ERROR", "ownerId no resuelto");
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

async function listCatalog(ownerId, query = {}) {
  ensureOwnerId(ownerId);
  const active = query.active == null ? undefined : query.active === "true";
  const docs = await repo.listCatalog(ownerId, { active });
  return docs.map((d) => repo.serializeDoc(d));
}

async function createCatalog(ownerId, payload = {}) {
  ensureOwnerId(ownerId);
  const now = new Date();

  const name = requireString(payload.name, "name");
  const data = {
    id: "",
    name,
    description: optionalString(payload.description),
    category: optionalString(payload.category),
    riskLevel: optionalString(payload.riskLevel),
    recurrenceMonths: payload.recurrenceMonths == null ? null : requireNumber(payload.recurrenceMonths, "recurrenceMonths"),
    active: payload.active == null ? true : Boolean(payload.active),
    createdAt: now,
    updatedAt: now,
  };

  const ref = repo.newRef(ownerId, "training_catalog");
  data.id = ref.id;
  await ref.set(data);
  return repo.serializeDoc(data);
}

async function patchCatalog(ownerId, id, payload = {}) {
  ensureOwnerId(ownerId);
  const current = await repo.getById(ownerId, "training_catalog", id);
  if (!current) throw httpError(404, "NOT_FOUND", "Tipo de capacitación no encontrado");

  const updates = { updatedAt: new Date() };
  if (payload.name != null) updates.name = requireString(payload.name, "name");
  if (payload.description !== undefined) updates.description = optionalString(payload.description);
  if (payload.category !== undefined) updates.category = optionalString(payload.category);
  if (payload.riskLevel !== undefined) updates.riskLevel = optionalString(payload.riskLevel);
  if (payload.recurrenceMonths !== undefined) {
    updates.recurrenceMonths = payload.recurrenceMonths == null ? null : requireNumber(payload.recurrenceMonths, "recurrenceMonths");
  }
  if (payload.active !== undefined) updates.active = Boolean(payload.active);

  await repo.docRef(ownerId, "training_catalog", id).set(updates, { merge: true });
  const updated = await repo.getById(ownerId, "training_catalog", id);
  return repo.serializeDoc(updated);
}

async function deleteCatalog(ownerId, id) {
  ensureOwnerId(ownerId);
  const current = await repo.getById(ownerId, "training_catalog", id);
  if (!current) throw httpError(404, "NOT_FOUND", "Tipo de capacitación no encontrado");

  const itemInUse = await repo.findOneByField(ownerId, "training_plan_items", "trainingTypeId", id);
  if (itemInUse) {
    throw httpError(409, "CATALOG_IN_USE", "No se puede eliminar: existen items asociados");
  }
  const sessionInUse = await repo.findOneByField(ownerId, "training_sessions", "trainingTypeId", id);
  if (sessionInUse) {
    throw httpError(409, "CATALOG_IN_USE", "No se puede eliminar: existen sesiones asociadas");
  }

  await repo.docRef(ownerId, "training_catalog", id).delete();
  return { deleted: true, id };
}

async function listPlans(ownerId, filters = {}) {
  ensureOwnerId(ownerId);
  const docs = await repo.listPlans(ownerId, filters);
  return docs.map((d) => repo.serializeDoc(d));
}

async function createPlan(ownerId, payload = {}) {
  ensureOwnerId(ownerId);
  const now = new Date();
  const year = Math.trunc(requireNumber(payload.year, "year"));
  const status = payload.status || "draft";
  validateInSet(status, "status", PLAN_STATUSES);

  const planRef = repo.newRef(ownerId, "training_plans");
  const data = {
    id: planRef.id,
    ownerId,
    year,
    companyId: requireString(payload.companyId, "companyId"),
    branchId: requireString(payload.branchId, "branchId"),
    status,
    itemsTotal: 0,
    itemsCompleted: 0,
    itemsPending: 0,
    createdAt: now,
    updatedAt: now,
  };

  await planRef.set(data);
  return repo.serializeDoc(data);
}

async function patchPlan(ownerId, id, payload = {}) {
  ensureOwnerId(ownerId);
  const current = await repo.getById(ownerId, "training_plans", id);
  if (!current) throw httpError(404, "NOT_FOUND", "Plan no encontrado");

  const updates = { updatedAt: new Date() };
  if (payload.year !== undefined) updates.year = Math.trunc(requireNumber(payload.year, "year"));
  if (payload.companyId !== undefined) updates.companyId = requireString(payload.companyId, "companyId");
  if (payload.branchId !== undefined) updates.branchId = requireString(payload.branchId, "branchId");
  if (payload.status !== undefined) {
    validateInSet(payload.status, "status", PLAN_STATUSES);
    updates.status = payload.status;
  }

  delete updates.itemsTotal;
  delete updates.itemsCompleted;
  delete updates.itemsPending;
  delete updates.ownerId;
  delete updates.id;

  await repo.docRef(ownerId, "training_plans", id).set(updates, { merge: true });
  const updated = await repo.getById(ownerId, "training_plans", id);
  return repo.serializeDoc(updated);
}

async function listPlanItems(ownerId, planId, query = {}) {
  ensureOwnerId(ownerId);
  const plan = await repo.getById(ownerId, "training_plans", planId);
  if (!plan) throw httpError(404, "NOT_FOUND", "Plan no encontrado");
  const items = await repo.listPlanItems(ownerId, planId, { status: query.status });
  return items.map((d) => repo.serializeDoc(d));
}

async function createPlanItem(ownerId, payload = {}) {
  ensureOwnerId(ownerId);
  const planId = requireString(payload.planId, "planId");
  const trainingTypeId = requireString(payload.trainingTypeId, "trainingTypeId");
  const plannedMonth = Math.trunc(requireNumber(payload.plannedMonth, "plannedMonth"));
  if (plannedMonth < 1 || plannedMonth > 12) {
    throw httpError(400, "VALIDATION_ERROR", "plannedMonth debe estar entre 1 y 12");
  }
  const status = payload.status || "pending";
  validateInSet(status, "status", ITEM_STATUSES);

  const trainingType = await repo.getById(ownerId, "training_catalog", trainingTypeId);
  if (!trainingType) throw httpError(404, "NOT_FOUND", "trainingTypeId no existe");

  const db = repo.db();
  const now = new Date();
  const itemRef = repo.newRef(ownerId, "training_plan_items");
  const planRef = repo.docRef(ownerId, "training_plans", planId);

  await db.runTransaction(async (tx) => {
    const planSnap = await tx.get(planRef);
    if (!planSnap.exists) throw httpError(404, "NOT_FOUND", "planId no existe");

    const delta = counterDeltaForStatusChange(null, status);
    const data = {
      id: itemRef.id,
      planId,
      trainingTypeId,
      plannedMonth,
      status,
      sessionId: null,
      createdAt: now,
      updatedAt: now,
    };

    tx.set(itemRef, data);
    tx.set(
      planRef,
      {
        updatedAt: now,
        itemsTotal: admin.firestore.FieldValue.increment(1),
        itemsCompleted: admin.firestore.FieldValue.increment(delta.itemsCompleted),
        itemsPending: admin.firestore.FieldValue.increment(delta.itemsPending),
      },
      { merge: true }
    );
  });

  const created = await repo.getById(ownerId, "training_plan_items", itemRef.id);
  return repo.serializeDoc(created);
}

async function patchPlanItem(ownerId, id, payload = {}) {
  ensureOwnerId(ownerId);
  const db = repo.db();
  const itemRef = repo.docRef(ownerId, "training_plan_items", id);
  const now = new Date();

  await db.runTransaction(async (tx) => {
    const itemSnap = await tx.get(itemRef);
    if (!itemSnap.exists) throw httpError(404, "NOT_FOUND", "Item no encontrado");
    const item = itemSnap.data();

    const planRef = repo.docRef(ownerId, "training_plans", item.planId);
    const planSnap = await tx.get(planRef);
    if (!planSnap.exists) throw httpError(404, "NOT_FOUND", "planId del item no existe");

    const updates = { updatedAt: now };
    let nextStatus = item.status;

    if (payload.trainingTypeId !== undefined) {
      const trainingTypeId = requireString(payload.trainingTypeId, "trainingTypeId");
      const trainingType = await repo.getById(ownerId, "training_catalog", trainingTypeId);
      if (!trainingType) throw httpError(404, "NOT_FOUND", "trainingTypeId no existe");
      updates.trainingTypeId = trainingTypeId;
    }
    if (payload.plannedMonth !== undefined) {
      const plannedMonth = Math.trunc(requireNumber(payload.plannedMonth, "plannedMonth"));
      if (plannedMonth < 1 || plannedMonth > 12) {
        throw httpError(400, "VALIDATION_ERROR", "plannedMonth debe estar entre 1 y 12");
      }
      updates.plannedMonth = plannedMonth;
    }
    if (payload.sessionId !== undefined) updates.sessionId = optionalString(payload.sessionId);
    if (payload.status !== undefined) {
      validateInSet(payload.status, "status", ITEM_STATUSES);
      nextStatus = payload.status;
      updates.status = nextStatus;
    }

    if (updates.sessionId) {
      const sessionSnap = await tx.get(repo.docRef(ownerId, "training_sessions", updates.sessionId));
      if (!sessionSnap.exists) throw httpError(404, "NOT_FOUND", "sessionId no existe");
      const sessionData = sessionSnap.data();
      if (sessionData.planItemId !== id) {
        throw httpError(409, "DATA_INTEGRITY", "sessionId no pertenece al plan item");
      }
    }

    tx.set(itemRef, updates, { merge: true });

    if (item.status !== nextStatus) {
      const delta = counterDeltaForStatusChange(item.status, nextStatus);
      tx.set(
        planRef,
        {
          updatedAt: now,
          itemsCompleted: admin.firestore.FieldValue.increment(delta.itemsCompleted),
          itemsPending: admin.firestore.FieldValue.increment(delta.itemsPending),
        },
        { merge: true }
      );
    }
  });

  const updated = await repo.getById(ownerId, "training_plan_items", id);
  return repo.serializeDoc(updated);
}

async function deletePlanItem(ownerId, id) {
  ensureOwnerId(ownerId);
  const db = repo.db();
  const itemRef = repo.docRef(ownerId, "training_plan_items", id);
  const now = new Date();

  await db.runTransaction(async (tx) => {
    const itemSnap = await tx.get(itemRef);
    if (!itemSnap.exists) throw httpError(404, "NOT_FOUND", "Item no encontrado");
    const item = itemSnap.data();

    const planRef = repo.docRef(ownerId, "training_plans", item.planId);
    const planSnap = await tx.get(planRef);
    if (!planSnap.exists) throw httpError(404, "NOT_FOUND", "planId del item no existe");

    const sessionQuery = repo
      .collection(ownerId, "training_sessions")
      .where("planItemId", "==", id)
      .limit(1);
    const sessionSnap = await tx.get(sessionQuery);
    if (!sessionSnap.empty) {
      throw httpError(409, "ITEM_HAS_SESSIONS", "No se puede eliminar el item: tiene sesiones asociadas");
    }

    const delta = counterDeltaForStatusChange(item.status, null);
    tx.delete(itemRef);
    tx.set(
      planRef,
      {
        updatedAt: now,
        itemsTotal: admin.firestore.FieldValue.increment(-1),
        itemsCompleted: admin.firestore.FieldValue.increment(delta.itemsCompleted),
        itemsPending: admin.firestore.FieldValue.increment(delta.itemsPending),
      },
      { merge: true }
    );
  });

  return { deleted: true, id };
}

function mapSessionStatusToItemStatus(sessionStatus) {
  if (sessionStatus === "executed") return "completed";
  if (sessionStatus === "cancelled") return "cancelled";
  return "scheduled";
}

async function listSessions(ownerId, query = {}) {
  ensureOwnerId(ownerId);
  const sessions = await repo.listSessions(ownerId, query);
  return sessions.map((d) => repo.serializeDoc(d));
}

async function createSession(ownerId, payload = {}) {
  ensureOwnerId(ownerId);
  const trainingTypeId = requireString(payload.trainingTypeId, "trainingTypeId");
  const planId = requireString(payload.planId, "planId");
  const planItemId = requireString(payload.planItemId, "planItemId");
  const companyId = requireString(payload.companyId, "companyId");
  const branchId = requireString(payload.branchId, "branchId");
  const scheduledDate = parseDateMaybe(payload.scheduledDate, "scheduledDate", true);
  const executedDate = parseDateMaybe(payload.executedDate, "executedDate");
  const status = payload.status || "planned";
  validateInSet(status, "status", SESSION_STATUSES);

  const db = repo.db();
  const now = new Date();
  const sessionRef = repo.newRef(ownerId, "training_sessions");
  const planRef = repo.docRef(ownerId, "training_plans", planId);
  const planItemRef = repo.docRef(ownerId, "training_plan_items", planItemId);

  await db.runTransaction(async (tx) => {
    const [planSnap, itemSnap, typeSnap] = await Promise.all([
      tx.get(planRef),
      tx.get(planItemRef),
      tx.get(repo.docRef(ownerId, "training_catalog", trainingTypeId)),
    ]);

    if (!planSnap.exists) throw httpError(404, "NOT_FOUND", "planId no existe");
    if (!itemSnap.exists) throw httpError(404, "NOT_FOUND", "planItemId no existe");
    if (!typeSnap.exists) throw httpError(404, "NOT_FOUND", "trainingTypeId no existe");

    const itemData = itemSnap.data();
    if (itemData.planId !== planId) {
      throw httpError(409, "DATA_INTEGRITY", "El planItem no pertenece al plan indicado");
    }

    const sessionData = {
      id: sessionRef.id,
      trainingTypeId,
      planId,
      planItemId,
      companyId,
      branchId,
      scheduledDate,
      executedDate,
      instructor: optionalString(payload.instructor),
      status,
      createdAt: now,
      updatedAt: now,
    };
    tx.set(sessionRef, sessionData);

    const nextItemStatus = mapSessionStatusToItemStatus(status);
    const delta = counterDeltaForStatusChange(itemData.status, nextItemStatus);
    tx.set(
      planItemRef,
      {
        sessionId: sessionRef.id,
        status: nextItemStatus,
        updatedAt: now,
      },
      { merge: true }
    );
    if (itemData.status !== nextItemStatus) {
      tx.set(
        planRef,
        {
          updatedAt: now,
          itemsCompleted: admin.firestore.FieldValue.increment(delta.itemsCompleted),
          itemsPending: admin.firestore.FieldValue.increment(delta.itemsPending),
        },
        { merge: true }
      );
    }
  });

  const created = await repo.getById(ownerId, "training_sessions", sessionRef.id);
  return repo.serializeDoc(created);
}

async function patchSession(ownerId, id, payload = {}) {
  ensureOwnerId(ownerId);
  const db = repo.db();
  const now = new Date();
  const sessionRef = repo.docRef(ownerId, "training_sessions", id);

  await db.runTransaction(async (tx) => {
    const sessionSnap = await tx.get(sessionRef);
    if (!sessionSnap.exists) throw httpError(404, "NOT_FOUND", "Sesión no encontrada");
    const sessionData = sessionSnap.data();

    const updates = { updatedAt: now };
    let nextSessionStatus = sessionData.status;
    if (payload.scheduledDate !== undefined) updates.scheduledDate = parseDateMaybe(payload.scheduledDate, "scheduledDate", true);
    if (payload.executedDate !== undefined) updates.executedDate = parseDateMaybe(payload.executedDate, "executedDate");
    if (payload.instructor !== undefined) updates.instructor = optionalString(payload.instructor);
    if (payload.companyId !== undefined) updates.companyId = requireString(payload.companyId, "companyId");
    if (payload.branchId !== undefined) updates.branchId = requireString(payload.branchId, "branchId");

    if (payload.status !== undefined) {
      validateInSet(payload.status, "status", SESSION_STATUSES);
      updates.status = payload.status;
      nextSessionStatus = payload.status;
    }

    tx.set(sessionRef, updates, { merge: true });

    if (sessionData.planItemId) {
      const itemRef = repo.docRef(ownerId, "training_plan_items", sessionData.planItemId);
      const itemSnap = await tx.get(itemRef);
      if (!itemSnap.exists) throw httpError(409, "DATA_INTEGRITY", "La sesión apunta a un plan item inexistente");
      const itemData = itemSnap.data();
      if (itemData.planId !== sessionData.planId) {
        throw httpError(409, "DATA_INTEGRITY", "La sesión apunta a un plan item de otro plan");
      }

      const nextItemStatus = mapSessionStatusToItemStatus(nextSessionStatus);
      if (itemData.status !== nextItemStatus) {
        const planRef = repo.docRef(ownerId, "training_plans", sessionData.planId);
        const planSnap = await tx.get(planRef);
        if (!planSnap.exists) throw httpError(409, "DATA_INTEGRITY", "El plan de la sesión no existe");

        const delta = counterDeltaForStatusChange(itemData.status, nextItemStatus);
        tx.set(itemRef, { status: nextItemStatus, updatedAt: now }, { merge: true });
        tx.set(
          planRef,
          {
            updatedAt: now,
            itemsCompleted: admin.firestore.FieldValue.increment(delta.itemsCompleted),
            itemsPending: admin.firestore.FieldValue.increment(delta.itemsPending),
          },
          { merge: true }
        );
      }
    }
  });

  const updated = await repo.getById(ownerId, "training_sessions", id);
  return repo.serializeDoc(updated);
}

async function registerAttendance(ownerId, sessionId, payload = {}) {
  ensureOwnerId(ownerId);
  const records = Array.isArray(payload.records) ? payload.records : [];
  if (records.length === 0) {
    throw httpError(400, "VALIDATION_ERROR", "records es requerido y debe contener elementos");
  }

  const session = await repo.getById(ownerId, "training_sessions", sessionId);
  if (!session) throw httpError(404, "NOT_FOUND", "Sesión no encontrada");
  if (session.status !== "executed") {
    throw httpError(409, "INVALID_STATE", "Solo se puede registrar asistencia para sesiones ejecutadas");
  }

  const trainingType = await repo.getById(ownerId, "training_catalog", session.trainingTypeId);
  if (!trainingType) throw httpError(409, "DATA_INTEGRITY", "trainingType de la sesión no existe");

  const now = new Date();
  const recurrenceMonths = Number(trainingType.recurrenceMonths || 0);
  const baseDate = parseDateMaybe(session.executedDate || session.scheduledDate, "sessionDate", true);
  const batch = repo.db().batch();

  records.forEach((entry) => {
    const employeeId = requireString(entry.employeeId, "employeeId");
    const status = requireString(entry.status, "status");
    validateInSet(status, "status", ATTENDANCE_STATUSES);
    const score = entry.score == null ? null : requireNumber(entry.score, "score");

    const attendanceRef = repo.newRef(ownerId, "training_attendance");
    batch.set(attendanceRef, {
      id: attendanceRef.id,
      sessionId,
      employeeId,
      status,
      score,
      createdAt: now,
    });

    if (status === "present") {
      const expiryDate = recurrenceMonths > 0
        ? new Date(baseDate.getFullYear(), baseDate.getMonth() + recurrenceMonths, baseDate.getDate())
        : null;
      const recordRef = repo.docRef(ownerId, "employee_training_records", `${employeeId}_${session.trainingTypeId}`);
      batch.set(
        recordRef,
        {
          id: recordRef.id,
          employeeId,
          trainingTypeId: session.trainingTypeId,
          lastSessionId: sessionId,
          lastDate: baseDate,
          expiryDate,
          status: "valid",
          updatedAt: now,
        },
        { merge: true }
      );
    }
  });

  await batch.commit();
  return {
    sessionId,
    recordsProcessed: records.length,
  };
}

async function getDashboard(ownerId) {
  ensureOwnerId(ownerId);
  const currentMonth = new Date().getMonth() + 1;

  const [
    totalPlans,
    totalItems,
    completedItems,
    pendingItems,
    overdueItems,
    scheduledSessions,
    executedSessions,
  ] = await Promise.all([
    repo.countCollection(ownerId, "training_plans"),
    repo.countCollection(ownerId, "training_plan_items"),
    repo.countPlanItemsByStatus(ownerId, "completed"),
    repo.countPlanItemsByStatus(ownerId, "pending"),
    repo.countOverdueItems(ownerId, currentMonth),
    repo.countSessionsByStatus(ownerId, "planned"),
    repo.countSessionsByStatus(ownerId, "executed"),
  ]);

  const complianceRate = totalItems > 0 ? completedItems / totalItems : 0;
  return {
    totalPlans,
    totalItems,
    completedItems,
    pendingItems,
    overdueItems,
    scheduledSessions,
    executedSessions,
    complianceRate,
  };
}

async function getEmployeeTrainingStatus(ownerId, employeeId) {
  ensureOwnerId(ownerId);
  const normalizedEmployeeId = requireString(employeeId, "employeeId");

  const [catalog, records] = await Promise.all([
    repo.listCatalog(ownerId),
    repo.listEmployeeTrainingRecords(ownerId, normalizedEmployeeId),
  ]);

  const recordByType = new Map();
  records.forEach((record) => {
    if (record.trainingTypeId) recordByType.set(record.trainingTypeId, record);
  });

  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  return catalog.map((trainingType) => {
    const record = recordByType.get(trainingType.id);
    if (!record) {
      return {
        trainingTypeId: trainingType.id,
        trainingName: trainingType.name || null,
        lastSessionId: null,
        lastDate: null,
        expiryDate: null,
        status: "never",
      };
    }

    const expiryDate = toDate(record.expiryDate);
    let status = "valid";
    if (expiryDate && expiryDate < now) {
      status = "expired";
    } else if (expiryDate && expiryDate <= in30Days) {
      status = "expiring";
    }

    return {
      trainingTypeId: trainingType.id,
      trainingName: trainingType.name || null,
      lastSessionId: record.lastSessionId || null,
      lastDate: record.lastDate ? repo.serializeDoc({ value: record.lastDate }).value : null,
      expiryDate: record.expiryDate ? repo.serializeDoc({ value: record.expiryDate }).value : null,
      status,
    };
  });
}

module.exports = {
  httpError,
  listCatalog,
  createCatalog,
  patchCatalog,
  deleteCatalog,
  listPlans,
  createPlan,
  patchPlan,
  listPlanItems,
  createPlanItem,
  patchPlanItem,
  deletePlanItem,
  listSessions,
  createSession,
  patchSession,
  registerAttendance,
  getDashboard,
  getEmployeeTrainingStatus,
  constants: {
    PLAN_STATUSES: Array.from(PLAN_STATUSES),
    ITEM_STATUSES: Array.from(ITEM_STATUSES),
    SESSION_STATUSES: Array.from(SESSION_STATUSES),
    ATTENDANCE_STATUSES: Array.from(ATTENDANCE_STATUSES),
    RECORD_STATUSES: Array.from(RECORD_STATUSES),
  },
};
