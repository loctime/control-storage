const admin = require("../../../firebaseAdmin");

function getCollection() {
  return admin.firestore().collection("apps").doc("horarios").collection("recepciones_remito");
}

function getByIdRef(id) {
  return getCollection().doc(id);
}

async function getById(id) {
  const snap = await getByIdRef(id).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

async function findByRemitoId(ownerId, branchId, remitoSalidaId) {
  let query = getCollection().where("ownerId", "==", ownerId).where("remitoSalidaId", "==", remitoSalidaId);
  if (branchId) query = query.where("branchId", "==", branchId);
  const snap = await query.limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

async function findByFilters({ ownerId, branchId, estado, from, to, limit }) {
  let query = getCollection().where("ownerId", "==", ownerId);
  if (branchId) query = query.where("branchId", "==", branchId);
  if (estado) query = query.where("estado", "==", estado);
  if (from) query = query.where("recepcionAt", ">=", new Date(from));
  if (to) query = query.where("recepcionAt", "<=", new Date(to));
  query = query.orderBy("recepcionAt", "desc").limit(limit || 50);
  const snap = await query.get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

module.exports = {
  getCollection,
  getByIdRef,
  getById,
  findByRemitoId,
  findByFilters,
};
