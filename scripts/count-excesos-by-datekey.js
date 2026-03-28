/**
 * Cuenta documentos vehicleEvents con type === "exceso" agrupados por dateKey.
 *
 * Uso:
 *   node scripts/count-excesos-by-datekey.js
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

async function main() {
  const snap = await db
    .collection("apps")
    .doc("emails")
    .collection("vehicleEvents")
    .where("type", "==", "exceso")
    .get();

  const byDate = {};
  snap.docs.forEach((d) => {
    const data = d.data();
    const dateKey = data.dateKey || "UNKNOWN";
    byDate[dateKey] = (byDate[dateKey] || 0) + 1;
  });

  console.log(`Total docs type="exceso": ${snap.size}\n`);
  console.log("Excesos por dateKey:");
  Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([date, count]) => {
      console.log(`  ${date}: ${count}`);
    });

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
