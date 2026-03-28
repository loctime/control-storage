/**
 * Bootstrap de prueba:
 * 1) Crea/asegura usuarios en /apps/emails/users/{email} (con role y active)
 * 2) Completa responsables faltantes en /apps/emails/vehicles/{plate}
 * 3) (Opcional) Asigna responsables específicos por patente (tu mapa plateToEmails)
 *
 * Requisitos:
 * - npm i firebase-admin
 * - serviceAccountKey-controlfile.json en la raíz del proyecto
 *
 * Ejecutar:
 * node scripts/bootstrap-test-users-and-responsables.js
 */

const admin = require("firebase-admin");
const path = require("path");

const SERVICE_ACCOUNT_PATH = path.join(process.cwd(), "serviceAccountKey-controlfile.json");

const USERS_COLLECTION = "apps/emails/users";
const VEHICLES_COLLECTION = "apps/emails/vehicles";
const RESPONSABLE_FIELD = "responsables";

const TEST_EMAILS = {
  E1: "basebalbuss@gmail.com",
  E2: "controldoc@controldoc.app",
  E3: "controldocumentarioapp@gmail.com",
  E4: "negservises@gmail.com",
  E5: "ceboide.loc@gmail.com",
};

// 1) Usuarios de prueba (Firestore). OJO: esto NO crea usuarios en Firebase Auth.
// Solo crea los docs de autorización/rol en Firestore.
const TEST_USERS = [
  { email: TEST_EMAILS.E1, role: "responsable", active: true },
  { email: TEST_EMAILS.E2, role: "responsable", active: true },
  { email: TEST_EMAILS.E3, role: "responsable", active: true },
  { email: TEST_EMAILS.E4, role: "responsable", active: true },
  { email: TEST_EMAILS.E5, role: "responsable", active: true },

  // Si querés un admin “por Firestore” para endpoints tipo ensureUser/me:
  // { email: "admin@test.com", role: "admin", active: true },
];

// 2) Tu mapa patente -> responsables (si querés mantenerlo)
const plateToEmails = {
  AG572HC: [TEST_EMAILS.E1, TEST_EMAILS.E2],
  AF990QZ: [TEST_EMAILS.E1, TEST_EMAILS.E2],
  AF473JR: [TEST_EMAILS.E1, TEST_EMAILS.E2],
  AH170OY: [TEST_EMAILS.E1, TEST_EMAILS.E2],
  AH203DC: [TEST_EMAILS.E1, TEST_EMAILS.E2],

  AG338YV: [TEST_EMAILS.E3, TEST_EMAILS.E4],
  AH107UY: [TEST_EMAILS.E3, TEST_EMAILS.E4],

  AB456BA: [TEST_EMAILS.E5, TEST_EMAILS.E2],
  AF999DP: [TEST_EMAILS.E5, TEST_EMAILS.E2],
  AF405HE: [TEST_EMAILS.E5, TEST_EMAILS.E2],

  AG572HD: [TEST_EMAILS.E1, TEST_EMAILS.E3, TEST_EMAILS.E2],
  AG989PP: [TEST_EMAILS.E1, TEST_EMAILS.E3, TEST_EMAILS.E2],
  AG989PV: [TEST_EMAILS.E1, TEST_EMAILS.E3, TEST_EMAILS.E2],
  AD374LU: [TEST_EMAILS.E1, TEST_EMAILS.E3, TEST_EMAILS.E2],
  AF990OE: [TEST_EMAILS.E1, TEST_EMAILS.E3, TEST_EMAILS.E2],

  AG572HE: [TEST_EMAILS.E4, TEST_EMAILS.E2],

  AD374LK: [TEST_EMAILS.E1, TEST_EMAILS.E5, TEST_EMAILS.E2],
  AG338XF: [TEST_EMAILS.E1, TEST_EMAILS.E5, TEST_EMAILS.E2],
  AG572HF: [TEST_EMAILS.E1, TEST_EMAILS.E5, TEST_EMAILS.E2],
  AG530IZ: [TEST_EMAILS.E1, TEST_EMAILS.E5, TEST_EMAILS.E2],
  AH170PH: [TEST_EMAILS.E1, TEST_EMAILS.E5, TEST_EMAILS.E2],
  AG676NJ: [TEST_EMAILS.E1, TEST_EMAILS.E5, TEST_EMAILS.E2],
  AG628GV: [TEST_EMAILS.E1, TEST_EMAILS.E5, TEST_EMAILS.E2],
  AG448OQ: [TEST_EMAILS.E1, TEST_EMAILS.E5, TEST_EMAILS.E2],
  AG156YA: [TEST_EMAILS.E1, TEST_EMAILS.E5, TEST_EMAILS.E2],

  AG572HB: [TEST_EMAILS.E3, TEST_EMAILS.E2],

  AF999DS: [TEST_EMAILS.E5, TEST_EMAILS.E2],

  AG743LO: [TEST_EMAILS.E4, TEST_EMAILS.E3, TEST_EMAILS.E2],
};

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizePlate(plate) {
  return String(plate || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase().trim();
}

function normalizeEmails(emails) {
  return Array.from(
    new Set(
      (emails || [])
        .map((e) => normalizeEmail(e))
        .filter(Boolean)
    )
  );
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function ensureTestUsers(db) {
  const now = admin.firestore.FieldValue.serverTimestamp();
  const entries = TEST_USERS.map((u) => ({
    email: normalizeEmail(u.email),
    role: u.role,
    active: u.active !== false,
  })).filter((u) => u.email);

  // Firestore batch: 500 ops máx
  const chunks = chunkArray(entries, 450);

  let written = 0;
  for (const group of chunks) {
    const batch = db.batch();
    for (const u of group) {
      const ref = db.doc(`${USERS_COLLECTION}/${u.email}`);
      batch.set(
        ref,
        {
          email: u.email,
          role: u.role,
          active: u.active,
          createdAt: now,
          updatedAt: now,
        },
        { merge: true }
      );
      written++;
    }
    await batch.commit();
  }
  return written;
}

async function assignSpecificResponsables(db) {
  const entries = Object.entries(plateToEmails).map(([plate, emails]) => ({
    plate: normalizePlate(plate),
    emails: normalizeEmails(emails),
  })).filter((e) => e.plate && e.emails.length > 0);

  const chunks = chunkArray(entries, 450);

  let written = 0;
  for (const group of chunks) {
    const batch = db.batch();
    for (const e of group) {
      const ref = db.doc(`${VEHICLES_COLLECTION}/${e.plate}`);
      batch.set(ref, { [RESPONSABLE_FIELD]: e.emails }, { merge: true });
      written++;
    }
    await batch.commit();
  }

  return written;
}

async function fillMissingResponsables(db, defaultEmail) {
  const def = normalizeEmail(defaultEmail);
  if (!def) throw new Error("defaultEmail inválido");

  const snap = await db.collection(VEHICLES_COLLECTION).get();

  const toFix = [];
  snap.forEach((doc) => {
    const data = doc.data() || {};
    const current = Array.isArray(data[RESPONSABLE_FIELD]) ? data[RESPONSABLE_FIELD] : [];
    const normalizedCurrent = normalizeEmails(current);

    if (normalizedCurrent.length === 0) {
      toFix.push(doc.id);
    }
  });

  const chunks = chunkArray(toFix, 450);
  let fixed = 0;

  for (const group of chunks) {
    const batch = db.batch();
    for (const plateId of group) {
      const plate = normalizePlate(plateId);
      const ref = db.doc(`${VEHICLES_COLLECTION}/${plate}`);
      batch.set(ref, { [RESPONSABLE_FIELD]: [def] }, { merge: true });
      fixed++;
    }
    await batch.commit();
  }

  return { totalVehicles: snap.size, fixed };
}

async function main() {
  const serviceAccount = require(SERVICE_ACCOUNT_PATH);

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }

  const db = admin.firestore();

  // 1) Crea usuarios Firestore
  const usersWritten = await ensureTestUsers(db);

  // 2) Aplica tu mapa de responsables (si querés)
  const specificWritten = await assignSpecificResponsables(db);

  // 3) Completa faltantes: cualquier patente sin responsables => default
  const defaultEmail = TEST_EMAILS.E2; // elegí el default que quieras
  const fillResult = await fillMissingResponsables(db, defaultEmail);

  console.log("OK");
  console.log("Users upserted:", usersWritten);
  console.log("Specific responsables applied:", specificWritten);
  console.log("Vehicles total:", fillResult.totalVehicles);
  console.log("Vehicles fixed (added default responsable):", fillResult.fixed);
  console.log("Default responsable used:", defaultEmail);
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});