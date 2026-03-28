/**
 * Auditoría previa a corrección: meta vs summary.excesos vs isSpeedExcessEvent vs vehicleEvents.
 *
 * Uso:
 *   node scripts/audit-state-before-fix.js
 *   node scripts/audit-state-before-fix.js --date=2026-03-27
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
const { isSpeedExcessEvent } = require("../src/shared/eventClassification");

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

async function audit() {
  const { dateKey } = parseArgs(process.argv.slice(2));

  console.log(`\n========== ESTADO ACTUAL ${dateKey} ==========\n`);

  const metaSnap = await db
    .collection("apps")
    .doc("emails")
    .collection("dailyAlerts")
    .doc(dateKey)
    .collection("meta")
    .doc("meta")
    .get();
  const meta = metaSnap.data() || {};
  console.log("📊 META:");
  console.log(`  totalExcesos (en meta): ${meta.totalExcesos ?? 0}`);
  console.log(`  totalEvents: ${meta.totalEvents ?? 0}`);

  const vehiclesSnap = await db
    .collection("apps")
    .doc("emails")
    .collection("dailyAlerts")
    .doc(dateKey)
    .collection("vehicles")
    .get();

  console.log(`\n🚗 VEHICULOS (${vehiclesSnap.size} total):`);

  let totalExcesosAcumulado = 0;
  let totalExcesosRealesEnEventos = 0;
  const problematicVehicles = [];

  for (const vDoc of vehiclesSnap.docs) {
    const plate = vDoc.id;
    const vData = vDoc.data() || {};
    const summaryExcesos = vData.summary?.excesos ?? 0;
    const eventCount = (vData.events || []).length;

    const realExcesos = (vData.events || []).filter((e) => isSpeedExcessEvent(e)).length;

    totalExcesosAcumulado += summaryExcesos;
    totalExcesosRealesEnEventos += realExcesos;

    if (summaryExcesos > 0 || realExcesos > 0) {
      console.log(`\n  ${plate}:`);
      console.log(`    summary.excesos: ${summaryExcesos}`);
      console.log(`    events.length: ${eventCount}`);
      console.log(`    isSpeedExcessEvent() count: ${realExcesos}`);

      if (summaryExcesos !== realExcesos) {
        problematicVehicles.push({
          plate,
          summary: summaryExcesos,
          real: realExcesos,
          delta: summaryExcesos - realExcesos,
        });
        console.log(`    ⚠️  MISMATCH: summary=${summaryExcesos} vs real=${realExcesos}`);
      }
    }
  }

  const allEventsSnap = await db
    .collection("apps")
    .doc("emails")
    .collection("vehicleEvents")
    .where("dateKey", "==", dateKey)
    .get();

  const speedExcessCount = allEventsSnap.docs.filter((d) => d.data().type === "exceso").length;

  console.log(`\n📋 VEHICLEEVENTS GLOBALES ${dateKey}:`);
  console.log(`  Total docs: ${allEventsSnap.size}`);
  console.log(`  type === "exceso": ${speedExcessCount}`);

  console.log(`\n========== RESUMEN ==========`);
  console.log(`META.totalExcesos:              ${meta.totalExcesos ?? 0}`);
  console.log(`Sum de summary.excesos (vehículos): ${totalExcesosAcumulado}`);
  console.log(`Count real isSpeedExcessEvent():    ${totalExcesosRealesEnEventos}`);
  console.log(`VehicleEvents type===exceso:       ${speedExcessCount}`);

  if (problematicVehicles.length > 0) {
    console.log(`\n⚠️  VEHÍCULOS CON MISMATCHES:`);
    problematicVehicles.forEach((v) => {
      console.log(`  ${v.plate}: summary=${v.summary} vs real=${v.real} (Δ=${v.delta})`);
    });
  }

  console.log(`\n🔍 CONCLUSIONES:`);
  if (meta.totalExcesos === speedExcessCount) {
    console.log(`  ✓ META coincide con vehicleEvents globales`);
    console.log(`  ✗ Pero NO coincide con los excesos reales de los vehículos`);
  }
  if (totalExcesosAcumulado === 0 && meta.totalExcesos > 0) {
    console.log(`  🚨 META tiene ${meta.totalExcesos} pero sum(summary.excesos) = 0`);
    console.log(`  → El meta está corrupto y necesita reset`);
  }

  process.exit(0);
}

audit().catch((err) => {
  console.error(err);
  process.exit(1);
});
