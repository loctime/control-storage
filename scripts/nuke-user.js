require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const admin = require("firebase-admin");
const { S3Client, DeleteObjectsCommand, ListObjectsV2Command } = require("@aws-sdk/client-s3");
const readline = require("readline");

// Firebase init
let serviceAccount;
try {
  // eslint-disable-next-line import/no-unresolved
  serviceAccount = require("./serviceAccount.json");
} catch (_) {
  // eslint-disable-next-line import/no-unresolved
  serviceAccount = require("../serviceAccountKey-controlfile.json");
}
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// B2 via S3-compatible SDK
const s3 = new S3Client({
  endpoint: process.env.B2_ENDPOINT || "https://s3.us-west-004.backblazeb2.com",
  region: process.env.B2_REGION || "us-west-004",
  credentials: {
    accessKeyId: process.env.B2_APPLICATION_KEY_ID,
    secretAccessKey: process.env.B2_APPLICATION_KEY,
  },
});
const BUCKET = process.env.B2_BUCKET_NAME;

function formatTs(ts) {
  if (!ts) return "desconocido";
  if (typeof ts.toDate === "function") return ts.toDate().toISOString();
  if (typeof ts === "string") return ts;
  return "desconocido";
}

function askConfirmation(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function getAllUserDocs(userId) {
  const snapshot = await db.collection("files").where("userId", "==", userId).get();

  return snapshot.docs.map((doc) => {
    const data = doc.data() || {};
    return {
      id: doc.id,
      type: data.type || "unknown",
      name: data.name || "(sin nombre)",
      path: data.path || "(sin path)",
      bucketKey: data.bucketKey || null, // solo archivos tienen esto
      createdAt: formatTs(data.createdAt),
    };
  });
}

async function deleteFromB2(bucketKeys) {
  if (!BUCKET) {
    console.warn("⚠️  B2_BUCKET_NAME no configurado. Saltando borrado de B2.");
    return { deleted: 0, errors: 0 };
  }

  let deleted = 0;
  let errors = 0;
  const CHUNK = 1000; // S3 DeleteObjects máximo

  for (let i = 0; i < bucketKeys.length; i += CHUNK) {
    const chunk = bucketKeys.slice(i, i + CHUNK);
    const objects = chunk.map((k) => ({ Key: k }));

    try {
      const result = await s3.send(
        new DeleteObjectsCommand({
          Bucket: BUCKET,
          Delete: { Objects: objects, Quiet: false },
        })
      );
      deleted += (result.Deleted || []).length;
      errors += (result.Errors || []).length;
      if (result.Errors?.length) {
        result.Errors.forEach((e) => console.error(`  ❌ B2 error: ${e.Key} — ${e.Message}`));
      }
    } catch (err) {
      console.error(`  ❌ B2 batch error: ${err.message}`);
      errors += chunk.length;
    }

    console.log(
      `  ☁️  B2: ${Math.min(i + CHUNK, bucketKeys.length)}/${bucketKeys.length} objetos procesados`
    );
  }

  return { deleted, errors };
}

async function deleteFromFirestore(docIds) {
  const BATCH_SIZE = 400;
  let deleted = 0;

  for (let i = 0; i < docIds.length; i += BATCH_SIZE) {
    const batch = db.batch();
    docIds.slice(i, i + BATCH_SIZE).forEach((id) => {
      batch.delete(db.collection("files").doc(id));
    });
    await batch.commit();
    deleted += Math.min(BATCH_SIZE, docIds.length - i);
    console.log(`  🔥 Firestore: ${deleted}/${docIds.length} documentos borrados`);
  }
}

async function main() {
  const email = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");

  if (!email) {
    console.error("❌ Uso: node nuke-user.js email@ejemplo.com [--dry-run]");
    process.exit(1);
  }

  if (dryRun) console.log("\n🔍 MODO DRY-RUN — no se borrará nada\n");

  // 1. Buscar usuario
  console.log(`🔍 Buscando usuario: ${email}`);
  const user = await admin.auth().getUserByEmail(email);
  const userId = user.uid;
  console.log(`✅ userId: ${userId}`);

  // 2. Cargar todos los docs
  console.log("\n📂 Cargando colección files...");
  const docs = await getAllUserDocs(userId);
  console.log(`📊 Total documentos encontrados: ${docs.length}`);

  // Nota: en algunos entornos legacy el campo `type` puede no existir.
  // - Igual borramos TODO por userId.
  // - Para B2, borramos todo objeto referenciado por cualquier doc con `bucketKey`.
  const folders = docs.filter((d) => d.type === "folder");
  const typedFiles = docs.filter((d) => d.type === "file");
  const docsWithBucketKey = docs.filter((d) => Boolean(d.bucketKey));
  const bucketKeys = docsWithBucketKey.map((d) => d.bucketKey).filter(Boolean);

  // 3. Preview
  console.log("\n══════════════════════════════════════════════");
  console.log("📋 RESUMEN DE LO QUE SE VA A BORRAR:");
  console.log("══════════════════════════════════════════════");
  console.log(`  📁 Carpetas en Firestore:  ${folders.length}`);
  console.log(`  📄 Archivos en Firestore (type=="file"):  ${typedFiles.length}`);
  console.log(`  🔑 Docs con bucketKey:     ${docsWithBucketKey.length}`);
  console.log(`  ☁️  Objetos en B2:          ${bucketKeys.length}`);
  console.log(`  📊 TOTAL documentos:       ${docs.length}`);
  console.log("══════════════════════════════════════════════\n");

  // Mostrar archivos con bucketKey
  if (docsWithBucketKey.length > 0) {
    console.log("📄 Objetos físicos referenciados (docs con bucketKey):");
    docsWithBucketKey.forEach((d) => {
      console.log(`  [${d.id}] ${d.name} → ${d.bucketKey}`);
    });
    console.log("");
  }

  if (docs.length === 0) {
    console.log("✅ No hay nada que borrar. Saliendo.");
    process.exit(0);
  }

  if (dryRun) {
    console.log("🔍 DRY-RUN completo. No se borró nada.");
    process.exit(0);
  }

  // 4. Confirmación
  const answer = await askConfirmation(
    `⚠️  ¿Confirmas borrar ${docs.length} documentos de Firestore y ${bucketKeys.length} objetos de B2?\nEscribe "BORRAR" para continuar: `
  );

  if (answer !== "borrar") {
    console.log("❌ Cancelado. No se borró nada.");
    process.exit(0);
  }

  // 5. Borrar de B2 primero
  if (bucketKeys.length > 0) {
    console.log("\n☁️  Borrando objetos de B2...");
    const b2Result = await deleteFromB2(bucketKeys);
    console.log(`  ✅ B2: ${b2Result.deleted} borrados, ${b2Result.errors} errores`);
  } else {
    console.log("\n☁️  Sin objetos en B2 para borrar.");
  }

  // 6. Borrar de Firestore
  console.log("\n🔥 Borrando de Firestore...");
  await deleteFromFirestore(docs.map((d) => d.id));

  console.log("\n🎉 Limpieza completa.");
  console.log(`   Firestore: ${docs.length} documentos borrados`);
  console.log(`   B2: ${bucketKeys.length} objetos borrados`);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});

