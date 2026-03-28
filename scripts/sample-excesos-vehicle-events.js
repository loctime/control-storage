/**
 * Muestra una muestra de vehicleEvents (excesos) de un dateKey con createdAt.
 *
 * Uso:
 *   node scripts/sample-excesos-vehicle-events.js
 *   node scripts/sample-excesos-vehicle-events.js --date=2026-03-27 --limit=10
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
  let dateKey = "2026-03-27";
  let limit = 10;
  for (const a of argv) {
    if (a.startsWith("--date=")) {
      dateKey = a.slice("--date=".length).trim();
      if (dateKey && !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
        console.error("Error: --date debe ser YYYY-MM-DD");
        process.exit(1);
      }
    }
    if (a.startsWith("--limit=")) {
      const n = Number(a.slice("--limit=".length).trim(), 10);
      if (!Number.isFinite(n) || n < 1 || n > 500) {
        console.error("Error: --limit debe ser un entero entre 1 y 500");
        process.exit(1);
      }
      limit = Math.floor(n);
    }
  }
  return { dateKey, limit };
}

function fmtCreatedAt(v) {
  if (v == null) return String(v);
  if (typeof v.toDate === "function") return v.toDate().toISOString();
  return String(v);
}

async function main() {
  const { dateKey, limit } = parseArgs(process.argv.slice(2));

  const snap = await db
    .collection("apps")
    .doc("emails")
    .collection("vehicleEvents")
    .where("dateKey", "==", dateKey)
    .where("type", "==", "exceso")
    .limit(limit)
    .get();

  console.log(`Primeros ${snap.size} excesos de ${dateKey} en vehicleEvents:`);
  snap.docs.forEach((d, i) => {
    const data = d.data();
    const created = data.createdAt;
    console.log(`[${i + 1}] id=${d.id} createdAt: ${fmtCreatedAt(created)}`);
  });

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
