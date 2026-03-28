const admin = require("firebase-admin");
const path = require("path");

const SERVICE_ACCOUNT_PATH = path.join(
  __dirname,
  "../serviceAccountKey-controlfile.json"
);

const serviceAccount = require(SERVICE_ACCOUNT_PATH);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

function normalizePlate(plate) {
  return plate.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().trim();
}

async function run() {
  console.log("=== AUDITORÍA VEHICLES ===");

  const ref = db
    .collection("apps")
    .doc("emails")
    .collection("vehicles");

  const snapshot = await ref.get();

  console.log("Total vehicles:", snapshot.size);

  let inconsistencies = 0;

  for (const doc of snapshot.docs) {
    const id = doc.id;
    const data = doc.data();
    const normalized = normalizePlate(id);

    if (id !== normalized) {
      console.log("❌ ID no normalizado:", id);
      inconsistencies++;
    }

    if (data.plate !== id) {
      console.log("⚠ plate field no coincide:", id, data.plate);
      inconsistencies++;
    }

    if (!Array.isArray(data.responsables)) {
      console.log("⚠ responsables no es array:", id);
      inconsistencies++;
    }

    if (data.totalEvents < 0) {
      console.log("⚠ totalEvents negativo:", id);
      inconsistencies++;
    }
  }

  console.log("Inconsistencias encontradas:", inconsistencies);
  console.log("Fin auditoría vehicles.");
}

run().catch(console.error);