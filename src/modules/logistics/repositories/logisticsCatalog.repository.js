const admin = require("../../../firebaseAdmin");

function productsCollection() {
  return admin.firestore().collection("apps").doc("horarios").collection("products");
}

function stockCollection() {
  return admin.firestore().collection("apps").doc("horarios").collection("stock_actual");
}

async function getProductsByIds(ownerId, productIds) {
  const unique = Array.from(new Set(productIds.filter(Boolean)));
  const all = await Promise.all(
    unique.map(async (productId) => {
      const snap = await productsCollection()
        .where("ownerId", "==", ownerId)
        .where("productId", "==", productId)
        .limit(1)
        .get();
      if (snap.empty) return null;
      const doc = snap.docs[0];
      return { id: doc.id, ...doc.data() };
    })
  );

  const map = new Map();
  all.filter(Boolean).forEach((p) => map.set(p.productId, p));
  return map;
}

async function getStockByProduct(ownerId, branchId, productId) {
  const snap = await stockCollection()
    .where("ownerId", "==", ownerId)
    .where("branchId", "==", branchId)
    .where("productId", "==", productId)
    .limit(1)
    .get();

  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

module.exports = {
  getProductsByIds,
  getStockByProduct,
};
