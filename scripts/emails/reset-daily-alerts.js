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

// ─── CONFIGURACIÓN ───────────────────────────────────────────
const DRY_RUN = true         // false para ejecutar cambios reales
const TARGET_DATE = "2026-03-04"
// ─────────────────────────────────────────────────────────────

const TARGET_DATES = [TARGET_DATE];
const applyChanges = !DRY_RUN && process.argv.includes("--apply");

async function resetAlerts() {
  console.log("===========================================")
  console.log("Script: reset-daily-alerts.js")
  console.log("Descripción: Resetea alertSent=false en dailyAlerts/{fecha}/vehicles para TARGET_DATE")
  console.log("Modo: " + (applyChanges ? "⚠️  ESCRITURA REAL" : "DRY-RUN (solo lectura)"))
  console.log("Variables: TARGET_DATE=" + TARGET_DATE)
  console.log("===========================================")
  await new Promise(r => setTimeout(r, 3000))

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
