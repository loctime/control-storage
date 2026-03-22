const admin = require("../../../firebaseAdmin");

function getCountersCollection() {
  return admin.firestore().collection("apps").doc("horarios").collection("counters");
}

function padCounter(value) {
  return String(value).padStart(6, "0");
}

function buildRemitoNumber({ branchId, year, value }) {
  const branch = (branchId || "SUC").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) || "SUC";
  return `REM-${branch}-${year}-${padCounter(value)}`;
}

async function reserveRemitoNumber(tx, { ownerId, branchId, date }) {
  const now = date || new Date();
  const year = now.getUTCFullYear();
  const counterId = `remito_${ownerId}_${branchId}_${year}`;
  const ref = getCountersCollection().doc(counterId);
  const snap = await tx.get(ref);

  let nextValue = 1;
  if (!snap.exists) {
    tx.set(ref, {
      ownerId,
      branchId,
      year,
      nextValue: 2,
      updatedAt: now,
    });
  } else {
    const data = snap.data();
    nextValue = Number(data.nextValue) || 1;
    tx.update(ref, {
      nextValue: nextValue + 1,
      updatedAt: now,
    });
  }

  return buildRemitoNumber({ branchId, year, value: nextValue });
}

module.exports = {
  reserveRemitoNumber,
  buildRemitoNumber,
};
