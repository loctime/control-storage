const admin = require("firebase-admin");
const path = require("path");

const SERVICE_ACCOUNT_PATH = path.join(process.cwd(), "serviceAccountKey-controlfile.json");

const DOC_PATH_PREFIX = "apps/emails/vehicles";
const RESPONSABLE_FIELD = "responsables";
const OPERACION_FIELD = "operacion";

const DEFAULT_EMAIL = "hys@maximia.com.ar";


// ==============================
// DEFINICIÓN DE GRUPOS
// ==============================

const GROUPS = {

  BAHIA_BLANCA: {
    operacion: "BAHIA_BLANCA",
    emails: [
      "ezequiel.hanna@maximia.com.ar",
      "analia.basilotto@maximia.com.ar",
    ],
    plates: [
      // AG572HC fue movida a COMIRSA
      "AF990QZ",
      "AF473JR",
      "AH170OY",
      "AH203DC",
    ],
  },

  AESA: {
    operacion: "AESA",
    emails: [
      "alberto.kruger@maximia.com.ar",
      "silvana.bilbao@maximia.com.ar",
      "claudio.visceglie@maximia.com.ar",
    ],
    plates: [
      "AG338YV",
      "AH107UY",
    ],
  },

  AESA_EXTRA: {
    operacion: "AESA",
    emails: [
      "alberto.kruger@maximia.com.ar",
      "silvana.bilbao@maximia.com.ar",
      "claudio.visceglie@maximia.com.ar",
    ],
    plates: [
      "AG338YX",
    ],
  },

  COMIRSA: {
    operacion: "COMIRSA",
    emails: [
      "rocio.ceballos@maximia.com.ar",
      "analia.basilotto@maximia.com.ar",
    ],
    plates: [
      "AG572HC", // movida desde BAHIA_BLANCA
      "AB456BA",
      "AF999DP",
      "AF405HE",
    ],
  },

  PK327: {
    operacion: "PK327",
    emails: [
      "rodrigo.gauna@maximia.com.ar",
      "patricio.lopez@maximia.com.ar",
      "analia.reyes@maximia.com.ar",
      "analia.basilotto@maximia.com.ar",
    ],
    plates: [
      "AG572HD",
      "AG989PP",
      "AH989PV", // corregido: era AG989PV
      "AD374LU",
      "AF990OE",
    ],
  },

  RINCON_DE_ARANDA: {
    operacion: "RINCON_DE_ARANDA",
    emails: [
      "daniel.moreno@maximia.com.ar",
      "hys.rda@maximia.com.ar",
      "alejandro.alcazar@maximia.com.ar",
      "claudio.visceglie@maximia.com.ar",
    ],
    plates: [
      "AG572HE",
      "AG338XC",
      "AG338XG",
      "AH346TQ",
      "OZU678",
    ],
  },

  RDLS: {
    operacion: "RDLS",
    emails: [
      "guillermo.ulrich@maximia.com.ar",
      "sebastian.ruiz@maximia.com.ar",
      "sebastian.soto@maximia.com.ar",
    ],
    plates: [
      "AD374LK",
      "AG572HF",
      "AG530IZ",
      "AH170PH",
      "AG676NJ",
      "AG628GV",
      "AG156YA",
    ],
  },

  LOS_TOLDOS: {
    operacion: "LOS_TOLDOS",
    emails: [
      "sebastian.soto@maximia.com.ar",
      "guillermo.ulrich@maximia.com.ar",
      "pablo.quinteros@maximia.com.ar",
    ],
    plates: [
      "AG448OQ",
      "AG338XF",
    ],
  },

  TRATAYEN: {
    operacion: "TRATAYEN",
    emails: [
      "juan.ceballos@maximia.com.ar",
      "claudio.visceglie@maximia.com.ar",
    ],
    plates: [
      "AG572HB",
      "AG338XD",
      "AG572HA",
    ],
  },

  UBA: {
    operacion: "UBA",
    emails: [
      "francisco.berrondo@maximia.com.ar",
    ],
    plates: [
      "AF999DS",
    ],
  },

  YPF_ANELO: {
    operacion: "YPF_ANELO",
    emails: [
      "mariano.metelsky@maximia.com.ar",
      "gonzalo.lorca@maximia.com.ar",
      "claudio.visceglie@maximia.com.ar",
    ],
    plates: [
      "AG743LO",
    ],
  },

  GUEMES: {
    operacion: "GUEMES",
    emails: [
      "sebastian.soto@maximia.com.ar",
      "carina.vega@maximia.com.ar",
    ],
    plates: [
      "AF999EF",
      "AF999DU",
    ],
  },

  MOV_QUINTEROS: {
    operacion: "MOV_QUINTEROS",
    emails: [
      "pablo.quinteros@maximia.com.ar",
    ],
    plates: [
      "AG989PM",
    ],
  },

};


// ==============================
// UTILIDADES
// ==============================

function normalizePlate(plate) {
  return String(plate || "").trim().toUpperCase();
}

function normalizeEmails(emails) {
  return Array.from(
    new Set(
      (emails || [])
        .map((e) => String(e || "").trim().toLowerCase())
        .filter(Boolean)
    )
  );
}


// ==============================
// CONSTRUIR MAPA DE PATENTES
// ==============================

function buildPlateConfig(groups) {
  const result = {};

  Object.values(groups).forEach((group) => {
    group.plates.forEach((plate) => {

      const p = normalizePlate(plate);

      result[p] = {
        operacion: group.operacion,
        emails: group.emails,
      };

    });
  });

  return result;
}

const plateConfig = buildPlateConfig(GROUPS);


// ==============================
// SCRIPT PRINCIPAL
// ==============================

async function main() {

  const serviceAccount = require(SERVICE_ACCOUNT_PATH);

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }

  const db = admin.firestore();

  const snapshot = await db.collection(DOC_PATH_PREFIX).get();

  const batch = db.batch();

  snapshot.docs.forEach((doc) => {

    const plate = normalizePlate(doc.id);

    const config = plateConfig[plate];

    let emails;
    let operacion;

    if (config) {
      emails = normalizeEmails(config.emails);
      operacion = config.operacion;
    } else {
      emails = normalizeEmails([DEFAULT_EMAIL]);
      operacion = "SIN_ASIGNAR";
      console.log("⚠ Patente sin configuración:", plate);
    }

    const ref = db.doc(`${DOC_PATH_PREFIX}/${plate}`);

    batch.set(
      ref,
      {
        responsables: emails,
        responsablesNormalized: emails,
        operacion: operacion,
      },
      { merge: true }
    );

  });

  await batch.commit();

  console.log("Script finalizado correctamente");

}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});