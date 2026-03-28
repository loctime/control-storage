const admin = require("firebase-admin");
const path = require("path");

const serviceAccount = require(path.join(
  __dirname,
  "..",
  "serviceAccountKey-controlfile.json"
));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const TARGET_DATES = ["2026-03-04"];

const applyChanges = process.argv.includes("--apply");

if (!applyChanges) {
  console.log("DRY-RUN: no se escribirá nada en Firestore.");
  console.log("Pasá --apply para ejecutar los cambios reales.\n");
}

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
      if (applyChanges) {
        await doc.ref.update({
          alertSent: false,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`   ✔ ${date} / ${doc.id} actualizado`);
      } else {
        console.log(`   [DRY-RUN] ${date} / ${doc.id} → alertSent: false`);
      }
      totalUpdated++;
    }
  }

  console.log("=================================");
  if (applyChanges) {
    console.log(`✅ Total actualizados: ${totalUpdated}`);
  } else {
    console.log(`[DRY-RUN] Se actualizarían: ${totalUpdated} documentos`);
  }
  console.log("🏁 Proceso finalizado.");
}

resetAlerts().catch(console.error);
