/**
 * Limpieza destructiva: vehicleEvents (dateKey), dailyAlerts/{date} (vehicles + meta),
 * monthlyHistory/{YYYY-MM}/vehicles, e inbox filtrado por received 26–27 (relativo a --date).
 *
 * Sin --apply solo imprime conteos (dry-run). Con --apply borra en Firestore.
 *
 * Uso:
 *   node scripts/cleanup-27-03.js
 *   node scripts/cleanup-27-03.js --date=2026-03-27
 *   node scripts/cleanup-27-03.js --apply --date=2026-03-27
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

const BATCH_LIMIT = 400;

function parseArgs(argv) {
  let dateKey = "2026-03-27";
  let apply = false;
  for (const a of argv) {
    if (a === "--apply") apply = true;
    if (a.startsWith("--date=")) {
      dateKey = a.slice("--date=".length).trim();
      if (dateKey && !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
        console.error("Error: --date debe ser YYYY-MM-DD");
        process.exit(1);
      }
    }
  }
  return { dateKey, dryRun: !apply };
}

function previousDateKey(dateKey) {
  const d = new Date(`${dateKey}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function monthKeyFromDateKey(dateKey) {
  return dateKey.slice(0, 7);
}

async function commitDeletesInBatches(refs) {
  for (let i = 0; i < refs.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    for (const ref of refs.slice(i, i + BATCH_LIMIT)) {
      batch.delete(ref);
    }
    await batch.commit();
  }
}

async function cleanup() {
  const { dateKey, dryRun } = parseArgs(process.argv.slice(2));
  const prevKey = previousDateKey(dateKey);
  const monthKey = monthKeyFromDateKey(dateKey);

  console.log(`\n========== LIMPIEZA ${dateKey} (mes ${monthKey}) ==========`);
  console.log(dryRun ? "Modo: DRY-RUN (sin --apply no se borra nada)\n" : "Modo: APPLY (borrando)\n");

  console.log("1️⃣ vehicleEvents (dateKey)...");
  const eventsSnap = await db
    .collection("apps")
    .doc("emails")
    .collection("vehicleEvents")
    .where("dateKey", "==", dateKey)
    .get();
  console.log(`   Documentos: ${eventsSnap.size}`);
  if (!dryRun && eventsSnap.size > 0) {
    await commitDeletesInBatches(eventsSnap.docs.map((d) => d.ref));
  }
  console.log(`   ${dryRun ? "⏭️  Omitido (dry-run)" : "✅ Eliminados"}\n`);

  console.log("2️⃣ dailyAlerts/{date} → vehicles + meta...");
  const dailyRef = db.collection("apps").doc("emails").collection("dailyAlerts").doc(dateKey);

  const vehiclesSnap = await dailyRef.collection("vehicles").get();
  console.log(`   vehicles: ${vehiclesSnap.size}`);
  if (!dryRun && vehiclesSnap.size > 0) {
    await commitDeletesInBatches(vehiclesSnap.docs.map((d) => d.ref));
  }

  const metaSnap = await dailyRef.collection("meta").get();
  console.log(`   meta: ${metaSnap.size}`);
  if (!dryRun && metaSnap.size > 0) {
    await commitDeletesInBatches(metaSnap.docs.map((d) => d.ref));
  }
  console.log(`   ${dryRun ? "⏭️  Omitido (dry-run)" : "✅ Eliminados"}\n`);

  console.log(`3️⃣ monthlyHistory/${monthKey} → vehicles...`);
  const monthlyRef = db.collection("apps").doc("emails").collection("monthlyHistory").doc(monthKey);
  const monthVehiclesSnap = await monthlyRef.collection("vehicles").get();
  console.log(`   vehicles: ${monthVehiclesSnap.size}`);
  if (!dryRun && monthVehiclesSnap.size > 0) {
    await commitDeletesInBatches(monthVehiclesSnap.docs.map((d) => d.ref));
  }
  console.log(`   ${dryRun ? "⏭️  Omitido (dry-run)" : "✅ Eliminados"}\n`);

  console.log(`4️⃣ inbox (received contiene ${prevKey} o ${dateKey})...`);
  const inboxSnap = await db.collection("apps").doc("emails").collection("inbox").get();
  const emailsInRange = inboxSnap.docs.filter((d) => {
    const received = String(d.data().received_at || d.data().receivedAt || "");
    return received.includes(prevKey) || received.includes(dateKey);
  });
  console.log(`   Documentos a borrar: ${emailsInRange.length}`);
  if (!dryRun && emailsInRange.length > 0) {
    await commitDeletesInBatches(emailsInRange.map((d) => d.ref));
  }
  console.log(`   ${dryRun ? "⏭️  Omitido (dry-run)" : "✅ Eliminados"}\n`);

  console.log("========== FIN ==========");
  if (dryRun) {
    console.log("\nPara ejecutar borrados: añade --apply\n");
  } else {
    console.log("\n✅ Limpieza aplicada. Re-ingesta emails si corresponde.\n");
  }

  process.exit(0);
}

cleanup().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
