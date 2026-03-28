const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey-controlfile.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function compressInbox(days = 7, dryRun = false) {

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

compressInbox(7, false);