/**
 * Obtiene un access token OAuth2 desde el JSON de la service account.
 * Uso: node get-token.js <ruta-al-json>
 * Salida: el access_token en stdout (solo el token, una línea).
 * Requiere ejecutarse desde la raíz del proyecto (pnpm install / node_modules con firebase-admin).
 */

// ─── CONFIGURACIÓN ───────────────────────────────────────────
// Script de solo lectura — sin parámetros configurables
// ─────────────────────────────────────────────────────────────

const path = require("path");
const keyPath = process.argv[2];
if (!keyPath) {
  process.stderr.write("Uso: node get-token.js <ruta-service-account.json>\n");
  process.exit(1);
}
const absPath = path.isAbsolute(keyPath) ? keyPath : path.resolve(process.cwd(), keyPath);
let key;
try {
  key = require(absPath);
} catch (e) {
  process.stderr.write("Error leyendo JSON: " + e.message + "\n");
  process.exit(1);
}
const admin = require("firebase-admin");
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(key) });
}
const cred = admin.credential.cert(key);

process.stderr.write("===========================================\n");
process.stderr.write("Script: get-service-access-token.js\n");
process.stderr.write("Descripción: Genera y printea un access token OAuth2 de la service account\n");
process.stderr.write("Modo: SOLO LECTURA\n");
process.stderr.write("===========================================\n");

setTimeout(() => {
  cred.getAccessToken().then((t) => {
    if (t && t.access_token) {
      process.stdout.write(t.access_token);
    } else {
      process.stderr.write("No se obtuvo access_token\n");
      process.exit(1);
    }
  }).catch((e) => {
    process.stderr.write("Error obteniendo token: " + e.message + "\n");
    process.exit(1);
  });
}, 3000);
