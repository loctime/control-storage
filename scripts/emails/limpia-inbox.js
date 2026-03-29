const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey-controlfile.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// ─── CONFIGURACIÓN ───────────────────────────────────────────
const DRY_RUN = true         // false para ejecutar cambios reales
// ─────────────────────────────────────────────────────────────

async function compressInbox(days = 7, dryRun = false) {
  console.log("===========================================")
  console.log("Script: limpia-inbox.js")
  console.log("Descripción: Elimina campos body_html/text/preview/attachments de docs de inbox con más de N días")
  console.log("Modo: " + (dryRun ? "DRY-RUN (solo lectura)" : "⚠️  ESCRITURA REAL"))
  console.log("===========================================")
  await new Promise(r => setTimeout(r, 3000))

  const base = db.collection("apps").doc("emails").collection("inbox");
  const snap = await base.get();

  const now = Date.now();

  let processed = 0;
  let updated = 0;

  for (const doc of snap.docs) {

    const data = doc.data();

    if (!data.received_at) continue;

    const received = new Date(data.received_at);
    const diffDays = (now - received.getTime()) / (1000 * 60 * 60 * 24);

    if (diffDays < days) continue;

    processed++;

    const update = {
      body_html: admin.firestore.FieldValue.delete(),
      body_text: admin.firestore.FieldValue.delete(),
      preview: admin.firestore.FieldValue.delete(),
      attachments: admin.firestore.FieldValue.delete(),
      compressed: true,
      compressedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (dryRun) {
      console.log("[dry-run] compress", doc.id);
      continue;
    }

    await doc.ref.update(update);
    updated++;
  }

  console.log({
    processed,
    updated
  });
}

compressInbox(7, DRY_RUN);
