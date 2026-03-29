const admin = require("firebase-admin");
const path = require("path");

const SERVICE_ACCOUNT_PATH = path.join(
  __dirname,
  "../serviceAccountKey-controlfile.json"
);

// ─── CONFIGURACIÓN ───────────────────────────────────────────
const DRY_RUN = true         // false para ejecutar cambios reales
// ─────────────────────────────────────────────────────────────

const serviceAccount = require(SERVICE_ACCOUNT_PATH);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

function normalizePlate(plate) {
  if (!plate || typeof plate !== "string") return "";
  return plate.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().trim();
}

function mergeVehicleData(docs) {
  const merged = {
    plate: "",
    brand: "",
    model: "",
    responsables: [],
    totalEvents: 0,
    totalSpeedingEvents: 0,
  };

  for (const d of docs) {
    const data = d.data();

    merged.plate = normalizePlate(d.id);

    if (!merged.brand && data.brand) {
      merged.brand = data.brand;
    }

    if (!merged.model && data.model) {
      merged.model = data.model;
    }

    // Merge responsables (único campo válido)
    const actuales = merged.responsables || [];
    const nuevos = Array.isArray(data.responsables)
      ? data.responsables
      : [];

    merged.responsables = Array.from(new Set([...actuales, ...nuevos]));

    // Sumar contadores
    merged.totalEvents += data.totalEvents || 0;
    merged.totalSpeedingEvents += data.totalSpeedingEvents || 0;
  }

  merged.updatedAt = admin.firestore.FieldValue.serverTimestamp();

  return merged;
}

async function run() {
  console.log("===========================================")
  console.log("Script: consolidate-vehicles.js")
  console.log("Descripción: Fusiona docs de vehículos con IDs duplicados y elimina los duplicados")
  console.log("Modo: " + (DRY_RUN ? "DRY-RUN (solo lectura)" : "⚠️  ESCRITURA REAL"))
  console.log("===========================================")
  await new Promise(r => setTimeout(r, 3000))

  const collectionRef = db
    .collection("apps")
    .doc("emails")
    .collection("vehicles");

  const snapshot = await collectionRef.get();

  console.log("Total documentos:", snapshot.size);

  const groups = {};

  for (const doc of snapshot.docs) {
    const normalized = normalizePlate(doc.id);
    if (!groups[normalized]) groups[normalized] = [];
    groups[normalized].push(doc);
  }

  let duplicatesFound = 0;

  for (const plate in groups) {
    const docs = groups[plate];

    if (docs.length <= 1) continue;

    duplicatesFound++;

    console.log("--------------------------------------");
    console.log("Duplicado detectado:", plate);
    console.log("Docs originales:", docs.map(d => d.id));

    const mergedData = mergeVehicleData(docs);

    console.log("Resultado merge:", mergedData);

    if (!DRY_RUN) {
      const mainRef = collectionRef.doc(plate);
      await mainRef.set(mergedData, { merge: false });

      for (const d of docs) {
        if (d.id !== plate) {
          console.log("Eliminando:", d.id);
          await collectionRef.doc(d.id).delete();
        }
      }
    }
  }

  console.log("--------------------------------------");
  console.log("Duplicados encontrados:", duplicatesFound);
  console.log("Finalizado.");
}

run().catch(console.error);
