/**
 * Recalcula summary.excesos en dailyAlerts/{date}/vehicles/{plate}
 * usando isSpeedExcessEvent (src/shared/eventClassification.js) y alinea
 * meta/meta totalExcesos del día con la suma de los deltas por vehículo.
 *
 * Uso:
 *   node scripts/fix-summary-excesos.js                    # dry-run (solo logs)
 *   node scripts/fix-summary-excesos.js --apply            # escribe en Firestore
 *   node scripts/fix-summary-excesos.js --apply --date=2026-03-27
 *
 * Credenciales (en este orden):
 * 1) Si existe serviceAccountKey-controlfile.json en la raíz del repo → se usa para inicializar Firebase.
 * 2) Si no, src/firebaseAdmin usa .env (GOOGLE_SERVICE_ACCOUNT_KEY, FB_ADMIN_APPDATA, etc.).
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
    /* Raíz sin JSON o archivo inválido: sigue firebaseAdmin.js */
  }
}

const admin = require("../src/firebaseAdmin");
const { isSpeedExcessEvent } = require("../src/shared/eventClassification");

const db = admin.firestore();
const DAILY_ALERTS = db.collection("apps").doc("emails").collection("dailyAlerts");
const BATCH_LIMIT = 400;

function parseArgs(argv) {
  const apply = argv.includes("--apply");
  let dateOnly = null;
  for (const a of argv) {
    if (a.startsWith("--date=")) {
      dateOnly = a.slice("--date=".length).trim();
      if (dateOnly && !/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
        console.error("Error: --date debe ser YYYY-MM-DD");
        process.exit(1);
      }
    }
  }
  return { apply, dryRun: !apply, dateOnly };
}

function countSpeedExcessInEvents(events) {
  if (!Array.isArray(events)) return 0;
  let n = 0;
  for (const e of events) {
    if (isSpeedExcessEvent(e)) n += 1;
  }
  return n;
}

function toIntExcesos(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function main() {
  const { dryRun, dateOnly } = parseArgs(process.argv.slice(2));

  console.log(
    dryRun
      ? "Modo: DRY-RUN (sin escrituras). Usa --apply para persistir.\n"
      : "Modo: APPLY (escritura en Firestore).\n"
  );

  let totalVehicles = 0;
  let totalDiffs = 0;
  let totalMetaDelta = 0;

  const dateRefsAll = await DAILY_ALERTS.listDocuments();
  const dateRefs = dateOnly
    ? dateRefsAll.filter((ref) => ref.id === dateOnly)
    : dateRefsAll.filter((ref) => /^\d{4}-\d{2}-\d{2}$/.test(ref.id));

  if (dateOnly && dateRefs.length === 0) {
    console.error(`No existe dailyAlerts doc para la fecha: ${dateOnly}`);
    process.exit(1);
  }

  for (const dateRef of dateRefs) {
    const dateKey = dateRef.id;
    const vehiclesSnap = await dateRef.collection("vehicles").get();

    /** Para --apply: cola de updates de vehículo */
    const vehicleUpdates = [];
    let dayMetaDelta = 0;

    for (const vehDoc of vehiclesSnap.docs) {
      totalVehicles += 1;
      const plate = vehDoc.id;
      const data = vehDoc.data() || {};
      const events = data.events;
      const oldExcesos = toIntExcesos(data.summary?.excesos);
      const newExcesos = countSpeedExcessInEvents(events);

      if (oldExcesos === newExcesos) continue;

      totalDiffs += 1;
      const delta = newExcesos - oldExcesos;
      dayMetaDelta += delta;
      totalMetaDelta += delta;

      const prefix = dryRun ? "[dry-run]" : "[apply]";
      console.log(
        `${prefix} ${dateKey} | patente=${plate} | summary.excesos ${oldExcesos} -> ${newExcesos} (delta ${delta >= 0 ? "+" : ""}${delta})`
      );

      if (!dryRun) {
        vehicleUpdates.push({ ref: vehDoc.ref, newExcesos });
      }
    }

    if (dayMetaDelta !== 0) {
      console.log(
        `  → Día ${dateKey}: delta acumulado en meta.totalExcesos: ${dayMetaDelta >= 0 ? "+" : ""}${dayMetaDelta}${dryRun ? " (no escrito)" : ""}`
      );
    }

    if (!dryRun && vehicleUpdates.length > 0) {
      let batch = db.batch();
      let ops = 0;

      for (const u of vehicleUpdates) {
        batch.update(u.ref, { "summary.excesos": u.newExcesos });
        ops += 1;
        if (ops >= BATCH_LIMIT) {
          await batch.commit();
          batch = db.batch();
          ops = 0;
        }
      }

      const metaRef = dateRef.collection("meta").doc("meta");
      batch.set(
        metaRef,
        { totalExcesos: admin.firestore.FieldValue.increment(dayMetaDelta) },
        { merge: true }
      );
      ops += 1;

      await batch.commit();
    }
  }

  console.log("\n--- Resumen ---");
  console.log(`Vehículos escaneados: ${totalVehicles}`);
  console.log(`Documentos con diferencia old/new: ${totalDiffs}`);
  console.log(`Suma global de deltas (meta totalExcesos): ${totalMetaDelta >= 0 ? "+" : ""}${totalMetaDelta}`);
  if (dryRun && totalDiffs > 0) {
    console.log("\nPara aplicar cambios: node scripts/fix-summary-excesos.js --apply");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
