const admin = require("firebase-admin");
const path = require("path");

// service account en la misma carpeta
const SERVICE_ACCOUNT_PATH = path.join(
  __dirname,
  "serviceAccountKey-controlfile.json"
);

const NEW_RESPONSABLE = "diegobertosi@gmail.com";

const APPLY_CHANGES = true; // false = solo ver cambios

const serviceAccount = require(SERVICE_ACCOUNT_PATH);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function run() {
  console.log("======================================");
  console.log("REEMPLAZO TOTAL DE RESPONSABLES");
  console.log("Modo:", APPLY_CHANGES ? "WRITE" : "DRY RUN");
  console.log("======================================");

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
    if (current.length === 1 && current[0] === NEW_RESPONSABLE) {
      continue;
    }

    updates++;

    console.log("→", plate);
    console.log("   Responsables actuales:", current);
    console.log("   Nuevo responsable:", NEW_RESPONSABLE);

    if (APPLY_CHANGES) {
      await doc.ref.update({
        responsables: [NEW_RESPONSABLE],
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }

  console.log("--------------------------------------");
  console.log("Total vehículos modificados:", updates);
  console.log("Finalizado.");
}

run().catch(console.error);