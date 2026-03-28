/**
 * migrateMonthlyHistory.js
 * Script de uso único: migra documentos de dailyAlerts → monthlyHistory.
 *
 * Lee: apps/emails/dailyAlerts/{dateKey}/vehicles/{plate}
 * Escribe: apps/emails/monthlyHistory/{YYYY-MM}/vehicles/{plate}
 *
 * Credenciales: usa backend/serviceAccountKey-controlfile.json si existe;
 * si no, las mismas variables que el resto del backend (GOOGLE_SERVICE_ACCOUNT_KEY, etc.).
 *
 * Ejecutar con:
 *   node backend/src/scripts/migrateMonthlyHistory.js
 */

const path = require("path");
const fs = require("fs");

require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const SERVICE_ACCOUNT_PATH = path.resolve(__dirname, "../../serviceAccountKey-controlfile.json");
if (fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  process.env.GOOGLE_SERVICE_ACCOUNT_KEY = fs.readFileSync(SERVICE_ACCOUNT_PATH, "utf8");
} else if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY && !process.env.FB_ADMIN_APPDATA) {
  console.error(
    "❌ [MIGRATE] No hay credenciales: coloca serviceAccountKey-controlfile.json en backend/ o define GOOGLE_SERVICE_ACCOUNT_KEY / FB_ADMIN_APPDATA."
  );
  process.exit(1);
}

const admin = require("../firebaseAdmin");
const db = admin.firestore();

const DAILY_ALERTS_REF = db.collection("apps").doc("emails").collection("dailyAlerts");
const MONTHLY_HISTORY_REF = db.collection("apps").doc("emails").collection("monthlyHistory");

/**
 * Normaliza y deduplica un arreglo de correos (mismo criterio que vehicleEventService).
 */
function normalizeEmailArray(values) {
  if (!Array.isArray(values)) return [];
  const set = new Set();
  for (const raw of values) {
    if (raw && typeof raw === "string") {
      const n = raw.trim().toLowerCase();
      if (n) set.add(n);
    }
  }
  return Array.from(set);
}

async function migrate() {
  console.log("🚀 [MIGRATE] Iniciando migración dailyAlerts → monthlyHistory");

  // 1. Listar todos los dateKeys
  const dateKeysSnap = await DAILY_ALERTS_REF.get();
  const dateKeyDocs = dateKeysSnap.docs;
  console.log(`📅 [MIGRATE] dateKeys encontrados: ${dateKeyDocs.length}`);

  let totalDateKeys = 0;
  let totalVehicles = 0;
  let totalEventsMigrated = 0;
  let totalVehiclesSkipped = 0;

  for (const dateKeyDoc of dateKeyDocs) {
    const dateKey = dateKeyDoc.id;

    // Validar formato YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      console.warn(`⚠️ [MIGRATE] dateKey inválido, saltando: "${dateKey}"`);
      continue;
    }

    const monthKey = dateKey.slice(0, 7);

    // 2. Leer todos los vehicles de este dateKey
    const vehiclesSnap = await DAILY_ALERTS_REF.doc(dateKey).collection("vehicles").get();
    console.log(`\n📂 [MIGRATE] ${dateKey} → ${monthKey} | vehículos: ${vehiclesSnap.docs.length}`);

    let dateKeyMigrated = 0;

    for (const vehicleDoc of vehiclesSnap.docs) {
      const plate = vehicleDoc.id;
      const src = vehicleDoc.data();

      const srcEvents = Array.isArray(src.events) ? src.events : [];
      if (srcEvents.length === 0) {
        totalVehiclesSkipped++;
        continue;
      }

      // 3b. Leer documento destino
      const destRef = MONTHLY_HISTORY_REF.doc(monthKey).collection("vehicles").doc(plate);
      const destSnap = await destRef.get();
      const destData = destSnap.exists ? destSnap.data() : null;

      // 3c. Filtrar eventos no existentes en destino (dedup por eventId)
      const existingEventIds = new Set(
        Array.isArray(destData?.eventIdsSeen) ? destData.eventIdsSeen.filter(Boolean) : []
      );

      const newEvents = srcEvents.filter(
        (e) => e.eventId && !existingEventIds.has(e.eventId)
      );

      if (newEvents.length === 0) {
        totalVehiclesSkipped++;
        continue;
      }

      const newEventIds = newEvents.map((e) => e.eventId).filter(Boolean);
      const FieldValue = admin.firestore.FieldValue;

      const responsables = Array.isArray(src.responsables) ? src.responsables : [];
      const responsablesNormalized =
        Array.isArray(src.responsablesNormalized) && src.responsablesNormalized.length > 0
          ? src.responsablesNormalized
          : normalizeEmailArray(responsables);

      // 3d. Escribir en destino con merge
      const payload = {
        plate,
        monthKey,
        brand: src.brand || destData?.brand || "",
        model: src.model || destData?.model || "",
        operationName: src.operationName || src.operacion || destData?.operationName || destData?.operacion || null,
        responsables: responsables.length > 0 ? responsables : (destData?.responsables ?? []),
        responsablesNormalized:
          responsablesNormalized.length > 0 ? responsablesNormalized : (destData?.responsablesNormalized ?? []),
        events: FieldValue.arrayUnion(...newEvents),
        eventIdsSeen: FieldValue.arrayUnion(...newEventIds),
        totalEventsCount: (destData?.totalEventsCount ?? 0) + newEvents.length,
        lastEventAt: src.lastEventAt || null,
      };

      if (!destData) {
        payload.createdAt = src.createdAt || FieldValue.serverTimestamp();
      }

      await destRef.set(payload, { merge: true });

      dateKeyMigrated += newEvents.length;
      totalVehicles++;
      totalEventsMigrated += newEvents.length;

      console.log(`  ✅ [MIGRATE] ${plate}: ${newEvents.length} evento(s) migrado(s) → ${monthKey}`);
    }

    if (dateKeyMigrated > 0) {
      console.log(`  📊 [MIGRATE] ${dateKey}: ${dateKeyMigrated} evento(s) total migrados`);
    }

    totalDateKeys++;
  }

  // 5. Resumen final
  console.log("\n══════════════════════════════════════");
  console.log("✅ [MIGRATE] Migración completada");
  console.log(`   dateKeys procesados : ${totalDateKeys}`);
  console.log(`   vehículos migrados  : ${totalVehicles}`);
  console.log(`   vehículos saltados  : ${totalVehiclesSkipped} (sin eventos nuevos)`);
  console.log(`   eventos migrados    : ${totalEventsMigrated}`);
  console.log("══════════════════════════════════════");

  process.exit(0);
}

migrate().catch((err) => {
  console.error("❌ [MIGRATE] Error fatal:", err.message);
  console.error(err.stack);
  process.exit(1);
});
