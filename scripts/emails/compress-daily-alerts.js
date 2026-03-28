const admin = require("firebase-admin");

const serviceAccount = require("./serviceAccountKey-controlfile.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

function parseArgs(argv) {
  const out = { daysToKeepFull: 7, dryRun: false, limitDays: null, debug: false };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];

    if (a === "--debug") {
      out.debug = true;
      continue;
    }

    if (a === "--dry-run") {
      out.dryRun = true;
      continue;
    }

    if (a === "--days") {
      const v = Number(argv[i + 1]);
      if (!Number.isFinite(v) || v < 0) throw new Error("Uso: --days <numero>=0");
      out.daysToKeepFull = v;
      i++;
      continue;
    }

    if (a === "--limit-days") {
      const v = Number(argv[i + 1]);
      if (!Number.isFinite(v) || v < 1) throw new Error("Uso: --limit-days <numero>=1");
      out.limitDays = v;
      i++;
      continue;
    }

    throw new Error(`Argumento desconocido: ${a}`);
  }

  return out;
}

function parseDateKey(dateKey) {
  // Esperado: "YYYY-MM-DD" (lo más común en IDs de día).
  // Usamos UTC para evitar desfases por timezone.
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return new Date(`${dateKey}T00:00:00.000Z`);
  const d = new Date(dateKey);
  if (Number.isNaN(d.getTime())) throw new Error(`No pude parsear dateKey: ${dateKey}`);
  return d;
}

async function flushBatch(batch, pending) {
  if (pending.count === 0) return;
  await batch.commit();
  pending.count = 0;
}

async function debug() {
  const snapRoot = await db.collection("dailyAlerts").get();
  const snapNested = await db.collection("apps").doc("emails").collection("dailyAlerts").get();
  console.log("dailyAlerts (raíz /dailyAlerts):", snapRoot.size);
  console.log("apps/emails/dailyAlerts (/apps/emails/dailyAlerts):", snapNested.size);
}

async function compressDailyAlerts({ daysToKeepFull, dryRun, limitDays }) {
  // Ruta real: collection apps → doc emails → subcollection dailyAlerts
  const base = db.collection("apps").doc("emails").collection("dailyAlerts");

  const daysSnap = await base.get();
  const now = Date.now();

  let daysProcessed = 0;
  let vehiclesUpdated = 0;
  let vehiclesSkipped = 0;

  console.log("Path:", base.path);
  daysSnap.docs.forEach((d) => console.log("day:", d.id));

  console.log(
    JSON.stringify(
      {
        action: "compressDailyAlerts",
        daysToKeepFull,
        dryRun,
        daysFound: daysSnap.size,
      },
      null,
      2
    )
  );

  // Procesamos primero los más antiguos.
  const dayDocs = [...daysSnap.docs].sort((a, b) => (a.id < b.id ? -1 : 1));

  for (const dayDoc of dayDocs) {
    const dateKey = dayDoc.id;
    const date = parseDateKey(dateKey);
    const diffDays = (now - date.getTime()) / (1000 * 60 * 60 * 24);

    if (diffDays < daysToKeepFull) continue;

    daysProcessed++;
    if (limitDays && daysProcessed > limitDays) break;

    const vehiclesSnap = await dayDoc.ref.collection("vehicles").get();
    console.log(`Día ${dateKey}: vehicles=${vehiclesSnap.size}`);

    let batch = db.batch();
    const pending = { count: 0 };

    for (const vehicleDoc of vehiclesSnap.docs) {
      const data = vehicleDoc.data();

      if (!data || !Object.prototype.hasOwnProperty.call(data, "events")) {
        vehiclesSkipped++;
        continue;
      }

      const updates = {
        events: admin.firestore.FieldValue.delete(),
        archived: true,
        archivedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      vehiclesUpdated++;

      if (dryRun) {
        console.log("[dry-run] Compressed:", dateKey, vehicleDoc.id);
        continue;
      }

      batch.update(vehicleDoc.ref, updates);
      pending.count++;

      // Firestore batch: máximo 500 ops
      if (pending.count >= 450) {
        await flushBatch(batch, pending);
        batch = db.batch();
      }
    }

    if (!dryRun) await flushBatch(batch, pending);
  }

  console.log(
    JSON.stringify(
      {
        done: true,
        daysProcessed,
        vehiclesUpdated,
        vehiclesSkipped,
      },
      null,
      2
    )
  );
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.debug) {
    await debug();
    return;
  }
  await compressDailyAlerts(args);
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exitCode = 1;
});

