const admin = require("firebase-admin");

const serviceAccount = require("./serviceAccountKey-controlfile.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

function parseArgs(argv) {
  const out = { dryRun: false, limit: null };

  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--dry-run") {
      out.dryRun = true;
      continue;
    }

    if (argv[i] === "--limit") {
      const v = Number(argv[i + 1]);
      if (!Number.isFinite(v) || v < 1) throw new Error("Uso: --limit <numero>=1");
      out.limit = v;
      i++;
      continue;
    }

    throw new Error(`Argumento desconocido: ${argv[i]}`);
  }

  return out;
}

async function createMissingDayDocs({ dryRun, limit }) {
  const base = db.collection("apps").doc("emails").collection("dailyAlerts");

  const vehiclesGroup = db.collectionGroup("vehicles");

  const snap = await vehiclesGroup.get();

  const dateKeys = new Set();
  let skippedOtherPaths = 0;

  snap.docs.forEach((doc) => {
    const path = doc.ref.path;
    const parts = path.split("/");

    // Solo nos interesan vehículos bajo:
    // apps/emails/dailyAlerts/{dateKey}/vehicles/{plate}
    // parts: [apps, emails, dailyAlerts, {dateKey}, vehicles, {plate}]
    if (parts.length < 6) {
      skippedOtherPaths++;
      return;
    }
    if (parts[0] !== "apps" || parts[1] !== "emails" || parts[2] !== "dailyAlerts" || parts[4] !== "vehicles") {
      skippedOtherPaths++;
      return;
    }

    const dateKey = parts[3];

    dateKeys.add(dateKey);
  });

  const sortedDateKeys = [...dateKeys].sort();

  console.log(
    JSON.stringify(
      {
        action: "createMissingDayDocs",
        dryRun,
        vehiclesDocsScanned: snap.size,
        skippedOtherPaths,
        dateKeysDetected: sortedDateKeys.length,
        limit,
      },
      null,
      2
    )
  );

  let created = 0;
  let exists = 0;
  let pending = 0;
  let batch = db.batch();

  for (const dateKey of sortedDateKeys) {
    if (limit && created >= limit) break;

    const ref = base.doc(dateKey);

    const doc = await ref.get();

    if (doc.exists) {
      exists++;
      continue;
    }

    const data = {
      dateKey,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (dryRun) {
      console.log("[dry-run] Crearía documento:", dateKey);
      created++;
      continue;
    }

    batch.set(ref, data, { merge: true });
    pending++;
    created++;

    if (pending >= 450) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }

  if (!dryRun && pending > 0) {
    await batch.commit();
  }

  console.log({
    done: true,
    created,
    exists,
  });
}

async function main() {
  const args = parseArgs(process.argv);

  await createMissingDayDocs(args);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});