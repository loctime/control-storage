const admin = require("../../../firebaseAdmin");

function getCollection() {
  return admin.firestore().collection("apps").doc("horarios").collection("devoluciones_remito");
}

function getByIdRef(id) {
  return getCollection().doc(id);
}

async function getById(id) {
  const snap = await getByIdRef(id).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

async function findByFilters({ ownerId, branchId, estado, from, to, limit }) {
  let query = getCollection().where("ownerId", "==", ownerId);
  if (branchId) query = query.where("branchId", "==", branchId);
  if (estado) query = query.where("estado", "==", estado);
  if (from) query = query.where("creadaAt", ">=", new Date(from));
  if (to) query = query.where("creadaAt", "<=", new Date(to));
  query = query.orderBy("creadaAt", "desc").limit(limit || 50);
  const snap = await query.get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

module.exports = {
  getCollection,
  getByIdRef,
  getById,
  findByFilters,
};
