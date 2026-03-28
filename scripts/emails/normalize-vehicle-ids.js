const admin = require("firebase-admin");
const path = require("path");

const SERVICE_ACCOUNT_PATH = path.join(
  __dirname,
  "../serviceAccountKey-controlfile.json"
);

const APPLY_CHANGES = true; // 🔒 cambiar a true cuando confirmes

const serviceAccount = require(SERVICE_ACCOUNT_PATH);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

function normalizePlate(plate) {
  if (!plate || typeof plate !== "string") return "";
  return plate.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().trim();
}

async function run() {
  console.log("======================================");
  console.log("NORMALIZACIÓN TOTAL DE VEHICLE IDS");
  console.log("Modo:", APPLY_CHANGES ? "WRITE" : "DRY RUN");
  console.log("======================================");

  const collectionRef = db
    .collection("apps")
    .doc("emails")
    .collection("vehicles");

  const snapshot = await collectionRef.get();

  console.log("Total documentos:", snapshot.size);

  let toFix = 0;

  for (const doc of snapshot.docs) {
    const originalId = doc.id;
    const normalizedId = normalizePlate(originalId);

    if (originalId === normalizedId) continue;

    toFix++;

    console.log("--------------------------------------");
    console.log("Original:", originalId);
    console.log("Normalizado:", normalizedId);

    const data = doc.data();

    if (APPLY_CHANGES) {
      const newRef = collectionRef.doc(normalizedId);

      // Si ya existe (caso extremo), mergeamos
      const existing = await newRef.get();

      if (existing.exists) {
        console.log("⚠ Ya existe. Mergeando datos.");

        const merged = {
          ...existing.data(),
          ...data,
          plate: normalizedId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        await newRef.set(merged, { merge: true });
      } else {
        await newRef.set({
          ...data,
          plate: normalizedId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      await doc.ref.delete();
      console.log("Eliminado:", originalId);
    }
  }

  console.log("--------------------------------------");
  console.log("Documentos a normalizar:", toFix);
  console.log("Finalizado.");
}

run().catch(console.error);