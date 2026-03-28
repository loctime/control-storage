/**
 * Muestra la forma de un documento de inbox: campos top-level y subcolecciones (muestra 1 doc).
 * Query de muestra: subject >= "Excesos" (primer resultado).
 *
 * Uso:
 *   node scripts/check-email-structure.js
 *   node scripts/check-email-structure.js --subject-prefix=Excesos
 *
 * Credenciales: igual que fix-summary-excesos.js (serviceAccountKey en raíz o .env).
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const path = require("path");
const firebaseAdmin = require("firebase-admin");

if (!firebaseAdmin.apps.length) {
  try {
    const serviceAccount = require(path.resolve(__dirname, "../serviceAccountKey-controlfile.json"));
    const sa = { ...serviceAccount };
    if (sa.private_key && typeof sa.private_key === "string") {
      sa.private_key = sa.private_key.replace(/\\n/g, "\n");
    }
    firebaseAdmin.initializeApp({
      credential: firebaseAdmin.credential.cert(sa),
      projectId:
        process.env.FIREBASE_PROJECT_ID ||
        process.env.FB_DATA_PROJECT_ID ||
        sa.project_id ||
        sa.projectId,
    });
  } catch (_) {
    /* sigue firebaseAdmin.js */
  }
}

const admin = require("../src/firebaseAdmin");
const db = admin.firestore();

function parseArgs(argv) {
  let subjectPrefix = "Excesos";
  for (const a of argv) {
    if (a.startsWith("--subject-prefix=")) {
      subjectPrefix = a.slice("--subject-prefix=".length).trim() || "Excesos";
    }
  }
  return { subjectPrefix };
}

async function check() {
  const { subjectPrefix } = parseArgs(process.argv.slice(2));

  const snap = await db
    .collection("apps")
    .doc("emails")
    .collection("inbox")
    .where("subject", ">=", subjectPrefix)
    .limit(1)
    .get();

  if (snap.empty) {
    console.log("No email encontrado");
    process.exit(0);
  }

  const email = snap.docs[0].data();
  const docRef = snap.docs[0].ref;

  console.log("\n=== TODOS LOS CAMPOS DEL EMAIL ===\n");
  Object.keys(email).forEach((key) => {
    const val = email[key];
    const type = typeof val;
    const isLarge = type === "string" && val.length > 1000;
    const preview = isLarge ? `${val.slice(0, 100)}...` : val;
    console.log(`${key}: ${type} ${isLarge ? "(LARGE)" : ""}`);
    if (type === "string" && val.length < 200) {
      console.log(`  → ${preview}`);
    }
  });

  console.log("\n=== SUB-COLECCIONES ===\n");
  const subCollections = await docRef.listCollections();
  console.log(`Total sub-colecciones: ${subCollections.length}`);

  for (const col of subCollections) {
    const docs = await col.limit(1).get();
    console.log(`\n${col.id}: ${docs.size} docs (muestra hasta 1)`);
    if (!docs.empty) {
      const data = docs.docs[0].data();
      console.log("  Fields:", Object.keys(data).slice(0, 10));
      console.log("  Sample:", JSON.stringify(data).slice(0, 300));
    }
  }

  process.exit(0);
}

check().catch((err) => {
  console.error(err);
  process.exit(1);
});
