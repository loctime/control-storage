/**
 * Inbox apps/emails/inbox: qué correos RSV encajan por fecha (día y día anterior en received).
 *
 * Uso:
 *   node scripts/check-inbox-27-03.js
 *   node scripts/check-inbox-27-03.js --date=2026-03-27
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

function previousDateKey(dateKey) {
  const d = new Date(`${dateKey}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function check() {
  const { dateKey } = parseArgs(process.argv.slice(2));
  const prevKey = previousDateKey(dateKey);

  console.log(`\n========== INBOX - QUÉ LLEGÓ (${prevKey} / ${dateKey}) ==========\n`);

  const inboxSnap = await db.collection("apps").doc("emails").collection("inbox").get();

  console.log(`Total emails en inbox: ${inboxSnap.size}\n`);

  const emailsFiltered = inboxSnap.docs.filter((d) => {
    const data = d.data();
    const received = String(data.received_at || data.receivedAt || "");
    return received.includes(dateKey) || received.includes(prevKey);
  });

  console.log(`Emails con fecha ${prevKey} o ${dateKey} en received: ${emailsFiltered.length}\n`);

  emailsFiltered.forEach((docSnap, i) => {
    const data = docSnap.data();
    const subject = data.subject || data.email?.subject || "SIN SUBJECT";
    const received = data.received_at || data.receivedAt || "";
    const from = data.from || data.email?.from || "UNKNOWN";
    const parsed = data.parsed || data.parsedEvents || null;
    const eventCount = parsed?.events?.length || 0;

    console.log(`[${i + 1}] ${received}`);
    console.log(`    From: ${from}`);
    console.log(`    Subject: ${subject}`);
    console.log(`    Parsed events: ${eventCount}`);

    if (parsed?.events && parsed.events.length > 0) {
      const excesos = parsed.events.filter(
        (e) => e.type === "exceso" || e.sourceEmailType === "excesos_del_dia"
      ).length;
      const noIds = parsed.events.filter(
        (e) => e.type === "no_identificado" || e.sourceEmailType === "no_identificados_del_dia"
      ).length;
      const contactos = parsed.events.filter(
        (e) => e.type === "contacto" || e.sourceEmailType === "contacto_sin_identificacion"
      ).length;

      console.log(`      → excesos: ${excesos}, no_identificados: ${noIds}, contactos: ${contactos}`);

      if (excesos > 0) {
        console.log(`      Sample excesos:`);
        parsed.events
          .filter((e) => e.type === "exceso")
          .slice(0, 3)
          .forEach((e, j) => {
            console.log(`        [${j + 1}] ${e.plate} | ${e.speed} km/h | ${e.eventTimestamp}`);
          });
      }
    }

    console.log();
  });

  process.exit(0);
}

check().catch((err) => {
  console.error(err);
  process.exit(1);
});
