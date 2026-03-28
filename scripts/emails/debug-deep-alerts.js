// debug-firestore-paths.js
const admin = require("firebase-admin");
const path = require("path");

const KEY_PATH = path.join(__dirname, "serviceAccountKey-controlfile.json");

admin.initializeApp({
  credential: admin.credential.cert(require(KEY_PATH)),
});

const db = admin.firestore();

async function safeListDocs(ref, label) {
  try {
    const snap = await ref.get();
    console.log(`\n${label} -> count=${snap.size}`);
    console.log(snap.docs.map(d => d.id));
    return snap.docs.map(d => d.id);
  } catch (e) {
    console.log(`\n${label} -> ERROR:`, e.message);
    return [];
  }
}

async function safeGetDoc(ref, label) {
  try {
    const snap = await ref.get();
    console.log(`\n${label} -> exists=${snap.exists}`);
    if (snap.exists) {
      const data = snap.data() || {};
      const keys = Object.keys(data);
      console.log(`${label} -> keys:`, keys.slice(0, 30));
      // muestra algunos campos típicos si existen
      ["alertSent", "plate", "responsables", "eventCount", "events"].forEach(k => {
        if (k in data) console.log(`${label} -> ${k}:`, data[k]);
      });
    }
    return snap.exists;
  } catch (e) {
    console.log(`\n${label} -> ERROR:`, e.message);
    return false;
  }
}

async function main() {
  const app = admin.app();
  const projectId = app.options?.credential?.projectId || "(no detectable)";
  console.log("=====================================");
  console.log("DEBUG FIRESTORE RUTAS / PROYECTO");
  console.log("=====================================");
  console.log("projectId (credential):", projectId);
  console.log("FIRESTORE emulator:", process.env.FIRESTORE_EMULATOR_HOST || "(no)");

  console.log("Firestore project:", projectId);

  // Colección raíz "vehicles" (si no existe → no es la misma base)
  let vehiclesRootOk = false;
  try {
    const vehiclesRootSnap = await db.collection("vehicles").limit(1).get();
    vehiclesRootOk = !vehiclesRootSnap.empty;
    console.log("\nCOLLECTION vehicles (raíz) -> count (limit 1):", vehiclesRootSnap.size, vehiclesRootOk ? "(hay docs)" : "(vacía o no existe)");
    if (!vehiclesRootOk) {
      console.log("→ Si vehicles está vacía: definitivamente NO es la misma base.");
    }
  } catch (e) {
    console.log("\nCOLLECTION vehicles (raíz) -> ERROR:", e.message);
    console.log("→ Definitivamente NO es la misma base.");
  }

  // 1) colección apps
  await safeListDocs(db.collection("apps"), "COLLECTION apps");

  // 2) doc apps/emails
  await safeGetDoc(db.collection("apps").doc("emails"), "DOC apps/emails");

  // 3) colección apps/emails/dailyAlerts
  const dailyAlertsRef = db.collection("apps").doc("emails").collection("dailyAlerts");
  await safeListDocs(dailyAlertsRef, "COLLECTION apps/emails/dailyAlerts");

  // 4) comprobar doc de fecha
  const dateKey = "2026-03-02";
  await safeGetDoc(dailyAlertsRef.doc(dateKey), `DOC apps/emails/dailyAlerts/${dateKey}`);

  // 5) listar vehicles de ese día
  const vehiclesRef = dailyAlertsRef.doc(dateKey).collection("vehicles");
  await safeListDocs(vehiclesRef, `COLLECTION apps/emails/dailyAlerts/${dateKey}/vehicles`);

  // 6) comprobar vehículo puntual
  const plate = "AD374LK";
  await safeGetDoc(
    vehiclesRef.doc(plate),
    `DOC apps/emails/dailyAlerts/${dateKey}/vehicles/${plate}`
  );

  console.log("\n=====================================");
  console.log("FIN");
  console.log("=====================================");
  process.exit(0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});