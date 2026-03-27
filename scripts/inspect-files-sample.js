require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const admin = require("firebase-admin");

const sa = (() => {
  try {
    // eslint-disable-next-line import/no-unresolved
    return require("./serviceAccount.json");
  } catch (_) {
    // eslint-disable-next-line import/no-unresolved
    return require("../serviceAccountKey-controlfile.json");
  }
})();

admin.initializeApp({ credential: admin.credential.cert(sa) });

admin
  .firestore()
  .collection("files")
  .where("type", "==", "file")
  .limit(5)
  .get()
  .then(async (snap) => {
    console.log(`📊 Query type=="file" → docs: ${snap.size}`);
    snap.docs.forEach((d) => {
      const data = d.data();
      console.log(
        JSON.stringify(
          {
            id: d.id,
            type: data.type,
            userId: data.userId,
            bucketKey: data.bucketKey,
            name: data.name,
          },
          null,
          2
        )
      );
    });

    if (snap.size === 0) {
      const anySnap = await admin.firestore().collection("files").limit(5).get();
      console.log(`\n📊 Query sin filtro → docs: ${anySnap.size}`);
      anySnap.docs.forEach((d) => {
        const data = d.data() || {};
        console.log(
          JSON.stringify(
            {
              id: d.id,
              type: data.type,
              userId: data.userId,
              bucketKey: data.bucketKey,
              name: data.name,
              path: data.path,
            },
            null,
            2
          )
        );
      });
    }

    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Error:", err.message);
    process.exit(1);
  });

