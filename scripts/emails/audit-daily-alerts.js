const admin = require("firebase-admin");
const path = require("path");

const SERVICE_ACCOUNT_PATH = path.join(
  __dirname,
  "../serviceAccountKey-controlfile.json"
);

const serviceAccount = require(SERVICE_ACCOUNT_PATH);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

function normalizePlate(plate) {
  return plate.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().trim();
}

async function run() {
  console.log("=== AUDITORÍA DAILY ALERTS ===");

  const dailyRef = db
    .collection("apps")
    .doc("emails")
    .collection("dailyAlerts");

  const dates = await dailyRef.get();

  for (const dateDoc of dates.docs) {
    const dateKey = dateDoc.id;

    const vehiclesRef = dailyRef.doc(dateKey).collection("vehicles");
    const vehicles = await vehiclesRef.get();

    for (const v of vehicles.docs) {
      const id = v.id;
      const data = v.data();

      if (id !== normalizePlate(id)) {
        console.log("❌ ID no normalizado en daily:", dateKey, id);
      }

      const events = data.events || [];
      const uniqueIds = new Set(events.map(e => e.eventId));

      if (uniqueIds.size !== events.length) {
        console.log("⚠ Eventos duplicados:", dateKey, id);
      }

      const totalSummary =
        Object.values(data.summary || {}).reduce((a, b) => a + b, 0);

      if (totalSummary !== events.length) {
        console.log(
          "⚠ summary no coincide con events:",
          dateKey,
          id
        );
      }
    }
  }

  console.log("Fin auditoría daily alerts.");
}

run().catch(console.error);