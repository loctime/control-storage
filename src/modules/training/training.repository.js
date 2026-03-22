const admin = require("../../firebaseAdmin");

function db() {
  return admin.firestore();
}

function ownerDoc(ownerId) {
  return db().collection("apps").doc("auditoria").collection("owners").doc(ownerId);
}

function collection(ownerId, name) {
  return ownerDoc(ownerId).collection(name);
}

function docRef(ownerId, collectionName, id) {
  return collection(ownerId, collectionName).doc(id);
}

function newRef(ownerId, collectionName) {
  return collection(ownerId, collectionName).doc();
}

async function getById(ownerId, collectionName, id) {
  const snap = await docRef(ownerId, collectionName, id).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

async function findOneByField(ownerId, collectionName, field, value) {
  const snap = await collection(ownerId, collectionName).where(field, "==", value).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

async function listCatalog(ownerId, { active } = {}) {
  let query = collection(ownerId, "training_catalog");
  if (typeof active === "boolean") query = query.where("active", "==", active);
  query = query.orderBy("name", "asc");
  const snap = await query.get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function listPlans(ownerId, filters = {}) {
  let query = collection(ownerId, "training_plans");
  if (filters.year != null) query = query.where("year", "==", Number(filters.year));
  if (filters.companyId) query = query.where("companyId", "==", filters.companyId);
  if (filters.branchId) query = query.where("branchId", "==", filters.branchId);
  if (filters.status) query = query.where("status", "==", filters.status);
  query = query.orderBy("year", "desc");
  const snap = await query.get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function listPlanItems(ownerId, planId, { status } = {}) {
  let query = collection(ownerId, "training_plan_items").where("planId", "==", planId);
  if (status) query = query.where("status", "==", status);
  query = query.orderBy("plannedMonth", "asc");
  const snap = await query.get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function listSessions(ownerId, filters = {}) {
  let query = collection(ownerId, "training_sessions");
  if (filters.planId) query = query.where("planId", "==", filters.planId);
  if (filters.companyId) query = query.where("companyId", "==", filters.companyId);
  if (filters.branchId) query = query.where("branchId", "==", filters.branchId);
  if (filters.status) query = query.where("status", "==", filters.status);
  if (filters.fromDate) query = query.where("scheduledDate", ">=", new Date(filters.fromDate));
  if (filters.toDate) query = query.where("scheduledDate", "<=", new Date(filters.toDate));
  query = query.orderBy("scheduledDate", "asc");
  const snap = await query.get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function countQuery(query) {
  if (typeof query.count === "function") {
    const snap = await query.count().get();
    return snap.data().count || 0;
  }
  const snap = await query.get();
  return snap.size;
}

async function countCollection(ownerId, collectionName) {
  return countQuery(collection(ownerId, collectionName));
}

async function countPlanItemsByStatus(ownerId, status) {
  return countQuery(collection(ownerId, "training_plan_items").where("status", "==", status));
}

async function countOverdueItems(ownerId, currentMonth) {
  return countQuery(
    collection(ownerId, "training_plan_items")
      .where("status", "in", ["pending", "scheduled", "cancelled"])
      .where("plannedMonth", "<", Number(currentMonth))
  );
}

async function countSessionsByStatus(ownerId, status) {
  return countQuery(collection(ownerId, "training_sessions").where("status", "==", status));
}

async function listEmployeeTrainingRecords(ownerId, employeeId) {
  const snap = await collection(ownerId, "employee_training_records")
    .where("employeeId", "==", employeeId)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function toIso(value) {
  if (!value) return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return value;
}

function serializeDoc(doc) {
  const out = { ...doc };
  Object.keys(out).forEach((key) => {
    out[key] = toIso(out[key]);
  });
  return out;
}

module.exports = {
  db,
  collection,
  docRef,
  newRef,
  getById,
  findOneByField,
  listCatalog,
  listPlans,
  listPlanItems,
  listSessions,
  countCollection,
  countPlanItemsByStatus,
  countOverdueItems,
  countSessionsByStatus,
  listEmployeeTrainingRecords,
  serializeDoc,
};
