const admin = require("../../../firebaseAdmin");

function getCollection() {
  return admin.firestore().collection("apps").doc("horarios").collection("pedidos_internos");
}

function getByIdRef(id) {
  return getCollection().doc(id);
}

async function getById(id) {
  const snap = await getByIdRef(id).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

module.exports = {
  getCollection,
  getByIdRef,
  getById,
};
