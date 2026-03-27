const admin = require("firebase-admin");
const readline = require("readline");

// Requiere credenciales para Firebase Admin.
// Preferimos `scripts/serviceAccount.json`; si no existe, usamos el archivo existente en la raíz.
let serviceAccount = null;
try {
  // eslint-disable-next-line import/no-unresolved
  serviceAccount = require("./serviceAccount.json");
} catch (_) {
  // eslint-disable-next-line import/no-unresolved
  serviceAccount = require("../serviceAccountKey-controlfile.json");
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function getUserIdByEmail(email) {
  const user = await admin.auth().getUserByEmail(email);
  return user.uid;
}

function formatTimestampMaybe(ts) {
  // En Firestore Admin SDK normalmente es un Timestamp con .toDate()
  if (!ts) return "desconocido";
  if (typeof ts.toDate === "function") return ts.toDate().toISOString();
  // Por si viene ya serializado como string/ISO
  if (typeof ts === "string") return ts;
  return "desconocido";
}

async function listAllFolders(userId) {
  const snapshot = await db
    .collection("files")
    .where("userId", "==", userId)
    .where("type", "==", "folder")
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data() || {};
    return {
      id: doc.id,
      name: data.name || "(sin nombre)",
      path: data.path || "(sin path)",
      parentId: data.parentId || null,
      isAppRoot: data.metadata?.isAppRoot === true,
      createdAt: formatTimestampMaybe(data.createdAt),
      deletedAt: data.deletedAt || null,
    };
  });
}

function askConfirmation(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function main() {
  const email = process.argv[2];

  if (!email) {
    console.error('❌ Uso: node cleanup-folders.js usuario@email.com');
    process.exit(1);
  }

  console.log(`\n🔍 Buscando usuario: ${email}`);
  const userId = await getUserIdByEmail(email);
  console.log(`✅ userId: ${userId}`);

  console.log("\n📂 Cargando carpetas...");
  const folders = await listAllFolders(userId);
  console.log(`📊 Total de carpetas encontradas: ${folders.length}`);

  // Separar qué se borra y qué se preserva
  const toDelete = folders.filter((f) => !f.isAppRoot);
  const toKeep = folders.filter((f) => f.isAppRoot);

  console.log("\n══════════════════════════════════════════════");
  console.log("📋 PREVIEW — lo que se va a BORRAR:");
  console.log("══════════════════════════════════════════════");
  if (toDelete.length === 0) {
    console.log("  (ninguna carpeta para borrar)");
  } else {
    toDelete.forEach((f) => {
      console.log(`  🗑  [${f.id}] ${f.path} (creada: ${f.createdAt})`);
    });
  }

  console.log("\n══════════════════════════════════════════════");
  console.log("✅ PREVIEW — lo que se va a PRESERVAR:");
  console.log("══════════════════════════════════════════════");
  if (toKeep.length === 0) {
    console.log("  (ninguna carpeta protegida encontrada)");
  } else {
    toKeep.forEach((f) => {
      console.log(`  🔒 [${f.id}] ${f.path}`);
    });
  }

  console.log("\n══════════════════════════════════════════════");
  console.log(`🗑  Para borrar: ${toDelete.length} carpetas`);
  console.log(`🔒 Para preservar: ${toKeep.length} carpetas`);
  console.log("══════════════════════════════════════════════\n");

  if (toDelete.length === 0) {
    console.log("✅ No hay nada que limpiar. Saliendo.");
    process.exit(0);
  }

  const answer = await askConfirmation(
    `⚠️  ¿Confirmas borrar ${toDelete.length} carpetas? Escribe "si" para continuar: `
  );

  if (answer !== "si") {
    console.log("❌ Cancelado. No se borró nada.");
    process.exit(0);
  }

  console.log("\n🚀 Borrando...");

  // Borrar en batches de 400 (límite de Firestore es 500)
  const BATCH_SIZE = 400;
  let deleted = 0;

  for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = toDelete.slice(i, i + BATCH_SIZE);
    chunk.forEach((f) => {
      const ref = db.collection("files").doc(f.id);
      batch.delete(ref);
    });
    await batch.commit();
    deleted += chunk.length;
    console.log(`  ✅ Borradas ${deleted}/${toDelete.length}`);
  }

  console.log("\n🎉 Limpieza completa.");
  console.log(`   Borradas: ${deleted}`);
  console.log(`   Preservadas: ${toKeep.length}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});

