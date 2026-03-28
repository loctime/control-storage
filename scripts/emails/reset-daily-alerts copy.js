const admin = require("firebase-admin");
const path = require("path");

const serviceAccount = require(path.join(
  __dirname,
  "serviceAccountKey-controlfile.json"
));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const TARGET_DATES = ["2026-03-12"];

async function resetAlerts() {
  console.log("🔍 Reseteando alertas por fecha...");

  let totalUpdated = 0;

  for (const date of TARGET_DATES) {
    const vehiclesRef = db
      .collection("apps")
      .doc("emails")
      .collection("dailyAlerts")
      .doc(date)
      .collection("vehicles");

    const snapshot = await vehiclesRef.get();

    console.log(`📅 ${date} → vehículos encontrados: ${snapshot.size}`);

    for (const doc of snapshot.docs) {
      await doc.ref.update({
        alertSent: false,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(`   ✔ ${date} / ${doc.id} actualizado`);
      totalUpdated++;
    }
  }

  console.log("=================================");
  console.log(`✅ Total actualizados: ${totalUpdated}`);
  console.log("🏁 Proceso finalizado.");
}

resetAlerts().catch(console.error);