const admin = require("firebase-admin");
const path = require("path");

const SERVICE_ACCOUNT_PATH = path.join(
  process.cwd(),
  "serviceAccountKey-controlfile.json"
);

// Inicializar Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(require(SERVICE_ACCOUNT_PATH)),
});

const db = admin.firestore();

// ─── CONFIGURACIÓN ───────────────────────────────────────────
const DRY_RUN = true         // false para ejecutar cambios reales
const TARGET_DATE = "2026-03-13"
// ─────────────────────────────────────────────────────────────

/**
 * Borra documentos de apps/emails/inbox para el día dado
 * usando el campo ingested_at (string ISO).
 */
async function deleteInboxByDate(dateKey) {
  const start = `${dateKey}T00:00:00.000Z`;
  const end = `${dateKey}T23:59:59.999Z`;

  const inboxRef = db
    .collection("apps")
    .doc("emails")
    .collection("inbox");

  const snapshot = await inboxRef
    .where("ingested_at", ">=", start)
    .where("ingested_at", "<=", end)
    .get();

  console.log(`📨 inbox: encontrados ${snapshot.size} docs para ${dateKey}`);

  if (snapshot.empty) return;

  if (DRY_RUN) {
    console.log("📨 inbox: DRY RUN, no se borran documentos");
    return;
  }

  const batch = db.batch();
  snapshot.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();

  console.log("📨 inbox: borrados");
}

/**
 * Borra documentos de apps/emails/vehicleEvents para el día dado
 * usando el campo dateKey (YYYY-MM-DD).
 */
async function deleteVehicleEventsByDate(dateKey) {
  const eventsRef = db
    .collection("apps")
    .doc("emails")
    .collection("vehicleEvents");

  let totalDeleted = 0;

  while (true) {
    const snapshot = await eventsRef
      .where("dateKey", "==", dateKey)
      .limit(500) // límite de batch de Firestore
      .get();

    if (snapshot.empty) break;

    console.log(
      `🚗 vehicleEvents: ${DRY_RUN ? "encontrado" : "borrando"} batch de ${snapshot.size} docs para ${dateKey}`
    );

    if (!DRY_RUN) {
      const batch = db.batch();
      snapshot.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    }

    totalDeleted += snapshot.size;
    if (snapshot.size < 500) break; // ya no quedan más para ese día
  }

  console.log(
    `🚗 vehicleEvents: ${DRY_RUN ? "se borrarían" : "borrados"} ${totalDeleted} docs para ${dateKey}`
  );
}

/**
 * Borra el día completo de apps/emails/dailyAlerts/{dateKey}
 * incluyendo subcolecciones vehicles y meta.
 */
async function deleteDailyAlertsDay(dateKey) {
  const dayRef = db
    .collection("apps")
    .doc("emails")
    .collection("dailyAlerts")
    .doc(dateKey);

  const daySnap = await dayRef.get();
  if (!daySnap.exists) {
    console.log(`📊 dailyAlerts: no existe doc para ${dateKey}, nada que borrar`);
    return;
  }

  // 1) Borrar vehicles
  const vehiclesSnap = await dayRef.collection("vehicles").get();
  console.log(
    `📊 dailyAlerts/vehicles: encontrados ${vehiclesSnap.size} docs para ${dateKey}`
  );
  if (!vehiclesSnap.empty) {
    if (DRY_RUN) {
      console.log("📊 dailyAlerts/vehicles: DRY RUN, no se borran documentos");
    } else {
      const batch = db.batch();
      vehiclesSnap.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      console.log("📊 dailyAlerts/vehicles: borrados");
    }
  }

  // 2) Borrar meta (suele ser solo el doc "meta")
  const metaSnap = await dayRef.collection("meta").get();
  console.log(
    `📊 dailyAlerts/meta: encontrados ${metaSnap.size} docs para ${dateKey}`
  );
  if (!metaSnap.empty) {
    if (DRY_RUN) {
      console.log("📊 dailyAlerts/meta: DRY RUN, no se borran documentos");
    } else {
      const batch = db.batch();
      metaSnap.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      console.log("📊 dailyAlerts/meta: borrados");
    }
  }

  // 3) Borrar el doc del día
  if (DRY_RUN) {
    console.log(`📊 dailyAlerts: DRY RUN, no se borra doc ${dateKey}`);
  } else {
    await dayRef.delete();
    console.log(`📊 dailyAlerts: doc ${dateKey} borrado`);
  }
}

async function run() {
  console.log("===========================================")
  console.log("Script: resetRsvDay.js")
  console.log("Descripción: Elimina inbox, vehicleEvents y dailyAlerts completo para un día específico")
  console.log("Modo: " + (DRY_RUN ? "DRY-RUN (solo lectura)" : "⚠️  ESCRITURA REAL"))
  console.log("Variables: TARGET_DATE=" + TARGET_DATE)
  console.log("===========================================")
  await new Promise(r => setTimeout(r, 3000))

  try {
    await deleteInboxByDate(TARGET_DATE);
    await deleteVehicleEventsByDate(TARGET_DATE);
    await deleteDailyAlertsDay(TARGET_DATE);

    console.log("✅ RESET COMPLETADO para", TARGET_DATE);
  } catch (err) {
    console.error("❌ Error en reset:", err);
  } finally {
    process.exit();
  }
}

run();
