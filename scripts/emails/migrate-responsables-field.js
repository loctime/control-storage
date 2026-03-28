const admin = require("firebase-admin");
const path = require("path");

const SERVICE_ACCOUNT_PATH = path.join(
  __dirname,
  "../serviceAccountKey-controlfile.json"
);

const APPLY_CHANGES = false; // cambiar a true cuando confirmes

const serviceAccount = require(SERVICE_ACCOUNT_PATH);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function run() {
  console.log("======================================");
  console.log("MIGRACIÓN responsibleEmails → responsables");
  console.log("Modo:", APPLY_CHANGES ? "WRITE" : "DRY RUN");
  console.log("======================================");

  const ref = db
    .collection("apps")
    .doc("emails")
    .collection("vehicles");

  const snapshot = await ref.get();

  let affected = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();

    const oldField = Array.isArray(data.responsibleEmails)
      ? data.responsibleEmails
      : [];

    if (oldField.length === 0) continue;

    const currentResponsables = Array.isArray(data.responsables)
      ? data.responsables
      : [];

    const merged = Array.from(
      new Set([...currentResponsables, ...oldField])
    );

    affected++;

    console.log("--------------------------------------");
    console.log("Doc:", doc.id);
    console.log("Antes responsables:", currentResponsables);
    console.log("responsibleEmails:", oldField);
    console.log("Después:", merged);

    if (APPLY_CHANGES) {
      await doc.ref.update({
        responsables: merged,
        responsibleEmails: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }

  console.log("--------------------------------------");
  console.log("Documentos afectados:", affected);
  console.log("Finalizado.");
}

run().catch(console.error);