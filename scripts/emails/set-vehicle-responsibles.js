const admin = require("firebase-admin");
const path = require("path");

// service account en la misma carpeta
const SERVICE_ACCOUNT_PATH = path.join(
  __dirname,
  "serviceAccountKey-controlfile.json"
);

// ─── CONFIGURACIÓN ───────────────────────────────────────────
const DRY_RUN = true         // false para ejecutar cambios reales
const TARGET_EMAIL = "diegobertosi@gmail.com"
// ─────────────────────────────────────────────────────────────

const serviceAccount = require(SERVICE_ACCOUNT_PATH);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function run() {
  console.log("===========================================")
  console.log("Script: set-vehicle-responsibles.js")
  console.log("Descripción: Reemplaza los responsables de TODOS los vehículos por TARGET_EMAIL")
  console.log("Modo: " + (DRY_RUN ? "DRY-RUN (solo lectura)" : "⚠️  ESCRITURA REAL"))
  console.log("Variables: TARGET_EMAIL=" + TARGET_EMAIL)
  console.log("===========================================")
  await new Promise(r => setTimeout(r, 3000))

  const snapshot = await db
    .collection("apps")
    .doc("emails")
    .collection("vehicles")
    .get();

  console.log("Vehículos encontrados:", snapshot.size);

  if (snapshot.empty) {
    console.log("No hay vehículos.");
    return;
  }

  let updates = 0;

  for (const doc of snapshot.docs) {
    const plate = doc.id;
    const data = doc.data();

    const current = Array.isArray(data.responsables)
      ? data.responsables
      : [];

    // Si ya es exactamente el único email, no tocar
    if (current.length === 1 && current[0] === TARGET_EMAIL) {
      continue;
    }

    updates++;

    console.log("→", plate);
    console.log("   Responsables actuales:", current);
    console.log("   Nuevo responsable:", TARGET_EMAIL);

    if (!DRY_RUN) {
      await doc.ref.update({
        responsables: [TARGET_EMAIL],
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }

  console.log("--------------------------------------");
  console.log("Total vehículos modificados:", updates);
  console.log("Finalizado.");
}

run().catch(console.error);
