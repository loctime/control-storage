/**
 * Lista excesos en vehicleEvents (type=exceso) por fecha: por fuente, por placa, velocidad > 0.
 *
 * Uso:
 *   node scripts/check-real-rsv-excesos.js
 *   node scripts/check-real-rsv-excesos.js --date=2026-03-27
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
  for (const a of argv) {
    if (a.startsWith("--date=")) {
      dateKey = a.slice("--date=".length).trim();
      if (dateKey && !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
        console.error("Error: --date debe ser YYYY-MM-DD");
        process.exit(1);
      }
    }
  }
  return { dateKey };
}

async function check() {
  const { dateKey } = parseArgs(process.argv.slice(2));

  console.log(`\n========== EXCESOS REALES DE RSV - ${dateKey} ==========\n`);

  const eventsSnap = await db
    .collection("apps")
    .doc("emails")
    .collection("vehicleEvents")
    .where("dateKey", "==", dateKey)
    .where("type", "==", "exceso")
    .get();

  console.log(`Total documentos con type="exceso": ${eventsSnap.size}\n`);

  const byPlate = {};
  const bySource = {};

  eventsSnap.docs.forEach((d) => {
    const event = d.data();
    const plate = event.plate || "UNKNOWN";
    const source = event.sourceEmailType || event.source || "unknown";
    const speed = event.speed;
    const eventSubtype = event.eventSubtype;

    if (!byPlate[plate]) {
      byPlate[plate] = [];
    }
    byPlate[plate].push({
      eventId: event.eventId,
      speed,
      eventSubtype,
      source,
      timestamp: event.eventTimestamp,
      reasonRaw: event.reasonRaw,
      driverName: event.driverName,
    });

    bySource[source] = (bySource[source] || 0) + 1;
  });

  console.log(`Por fuente de email:`);
  Object.entries(bySource).forEach(([source, count]) => {
    console.log(`  ${source}: ${count}`);
  });

  console.log(`\nPor placa:`);
  Object.entries(byPlate).forEach(([plate, events]) => {
    console.log(`\n  ${plate}: ${events.length} eventos`);
    events.slice(0, 5).forEach((e, i) => {
      console.log(
        `    [${i + 1}] ${e.timestamp} | ${e.speed} km/h | subtype=${e.eventSubtype} | driver=${e.driverName || "n/a"}`
      );
    });
    if (events.length > 5) {
      console.log(`    ... y ${events.length - 5} más`);
    }
  });

  console.log(`\n========== ANÁLISIS ==========\n`);

  const realSpeedEvents = eventsSnap.docs.filter((d) => {
    const event = d.data();
    return typeof event.speed === "number" && event.speed > 0;
  });

  console.log(`Eventos con velocidad > 0: ${realSpeedEvents.length}`);
  console.log(`Eventos sin velocidad (speed null/0): ${eventsSnap.size - realSpeedEvents.length}`);

  if (realSpeedEvents.length > 0) {
    console.log(`\nPrimeros 10 eventos con velocidad REAL:`);
    realSpeedEvents.slice(0, 10).forEach((d, i) => {
      const e = d.data();
      console.log(`  [${i + 1}] ${e.plate} | ${e.speed} km/h | ${e.eventTimestamp}`);
    });
  }

  console.log(`\n¿Cuándo fue el email que generó estos excesos?`);
  const timestamps = realSpeedEvents.map((d) => d.data().eventTimestamp).filter(Boolean);
  if (timestamps.length > 0) {
    const sorted = [...timestamps].sort();
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    console.log(`  Primer exceso: ${min}`);
    console.log(`  Último exceso: ${max}`);
  }

  process.exit(0);
}

check().catch((err) => {
  console.error(err);
  process.exit(1);
});
