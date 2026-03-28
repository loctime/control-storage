/**
 * Auditoría: compara meta.totalExcesos vs eventos reales en dailyAlerts y vehicleEvents.
 * Basado en scripts/fallo.js (notas de auditoría 312 vs 3 excesos).
 *
 * Uso:
 *   node scripts/audit-312-excesos.js
 *   node scripts/audit-312-excesos.js --date=2026-03-27 --plate=AG572HF
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
  let plate = "AG572HF";
  for (const a of argv) {
    if (a.startsWith("--date=")) {
      dateKey = a.slice("--date=".length).trim();
      if (dateKey && !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
        console.error("Error: --date debe ser YYYY-MM-DD");
        process.exit(1);
      }
    }
    if (a.startsWith("--plate=")) {
      plate = a.slice("--plate=".length).trim().replace(/-/g, "").toUpperCase();
    }
  }
  return { dateKey, plate };
}

async function audit() {
  const { dateKey, plate } = parseArgs(process.argv.slice(2));

  const metaSnap = await db
    .collection("apps")
    .doc("emails")
    .collection("dailyAlerts")
    .doc(dateKey)
    .collection("meta")
    .doc("meta")
    .get();
  console.log("\n=== META ===");
  console.log("totalExcesos:", metaSnap.data()?.totalExcesos);

  const vehicleSnap = await db
    .collection("apps")
    .doc("emails")
    .collection("dailyAlerts")
    .doc(dateKey)
    .collection("vehicles")
    .doc(plate)
    .get();
  const vData = vehicleSnap.data();
  console.log("\n=== DAILYALERTS/VEHICLE ===");
  console.log("events.length:", vData?.events?.length);
  console.log("speedIncidents.length:", vData?.speedIncidents?.length);
  console.log("summary.excesos:", vData?.summary?.excesos);
  console.log("\nFirst 3 events:");
  (vData?.events || []).slice(0, 3).forEach((e, i) => {
    console.log(
      `  [${i}] eventId=${e.eventId}, speed=${e.speed}, grouped=${e.groupedSpeedIncidentKey || "none"}, groupedEventsCount=${e.groupedEventsCount ?? "n/a"}`
    );
  });

  const eventsByPlateSnap = await db
    .collection("apps")
    .doc("emails")
    .collection("vehicleEvents")
    .where("dateKey", "==", dateKey)
    .where("plate", "==", plate)
    .get();
  console.log("\n=== VEHICLEEVENTS (por placa + fecha) ===");
  console.log("total docs:", eventsByPlateSnap.size);
  const speedCountPlate = eventsByPlateSnap.docs.filter((d) => d.data().type === "exceso").length;
  console.log("speed excess count (type===exceso):", speedCountPlate);

  const eventsDaySnap = await db
    .collection("apps")
    .doc("emails")
    .collection("vehicleEvents")
    .where("dateKey", "==", dateKey)
    .where("type", "==", "exceso")
    .get();
  console.log("\n=== VEHICLEEVENTS (todo el día, type===exceso) ===");
  console.log("Real events count:", eventsDaySnap.size);

  process.exit(0);
}

audit().catch((err) => {
  console.error(err);
  process.exit(1);
});
