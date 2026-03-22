const admin = require("../../../firebaseAdmin");

function getCollection() {
  return admin.firestore().collection("apps").doc("horarios").collection("stock_movements_v2");
}

function createMovementRef() {
  return getCollection().doc();
}

module.exports = {
  getCollection,
  createMovementRef,
};
