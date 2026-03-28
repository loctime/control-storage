const admin = require("firebase-admin");
const path = require("path");

const SERVICE_ACCOUNT_PATH = path.join(
  process.cwd(),
  "serviceAccountKey-controlfile.json"
);

const COLLECTION_PATH = "apps/emails/vehicles";
const TEST_EMAIL = "hys@maximia.com.ar";

async function main() {
  const serviceAccount = require(SERVICE_ACCOUNT_PATH);

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }

  const db = admin.firestore();

  const snapshot = await db.collection(COLLECTION_PATH).get();

  console.log("Patentes encontradas:", snapshot.size);

  const batch = db.batch();

  snapshot.docs.forEach((doc) => {
    const ref = doc.ref;

    batch.set(
      ref,
      {
        responsables: [TEST_EMAIL],
      },
      { merge: true }
    );

    console.log("Asignado:", doc.id, "→", TEST_EMAIL);
  });

  await batch.commit();

  console.log("Todas las patentes actualizadas con email de prueba");
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});