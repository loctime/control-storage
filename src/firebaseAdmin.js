/**
 * Centralized Firebase Admin SDK initialization.
 * Must be required before any Firestore or Auth usage.
 * Initializes exactly once from GOOGLE_SERVICE_ACCOUNT_KEY or FB_ADMIN_APPDATA (or FIREBASE_* split vars).
 */
const admin = require("firebase-admin");

function tryParseServiceAccountJson(raw) {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const data = JSON.parse(trimmed);
    if (data && (data.project_id || data.projectId) && (data.client_email || data.private_key))
      return data;
    return null;
  } catch (_) {}
  try {
    const data = JSON.parse(trimmed.replace(/\\n/g, "\n"));
    if (data && (data.project_id || data.projectId) && (data.client_email || data.private_key))
      return data;
    return null;
  } catch (_) {}
  return null;
}

if (!admin.apps.length) {
  const raw =
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY ||
    process.env.FB_ADMIN_APPDATA;

  let serviceAccount = null;
  if (raw) {
    serviceAccount = tryParseServiceAccountJson(raw);
  }

  if (serviceAccount) {
    if (serviceAccount.private_key && typeof serviceAccount.private_key === "string") {
      serviceAccount = { ...serviceAccount };
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
    }
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId:
        process.env.FIREBASE_PROJECT_ID ||
        process.env.FB_DATA_PROJECT_ID ||
        serviceAccount.project_id ||
        serviceAccount.projectId,
    });
  } else {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const privateKeyRaw =
      process.env.FIREBASE_PRIVATE_KEY || process.env.FIREBASE_ADMIN_PRIVATE_KEY || "";
    let clientEmail =
      process.env.FIREBASE_CLIENT_EMAIL || process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (!clientEmail && process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      const fromGoogle = tryParseServiceAccountJson(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
      if (fromGoogle) clientEmail = fromGoogle.client_email;
    }
    if (projectId && privateKeyRaw && clientEmail) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey: privateKeyRaw.replace(/\\n/g, "\n"),
        }),
        projectId,
      });
    } else if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || process.env.FB_ADMIN_APPDATA) {
      throw new Error(
        "Firebase: GOOGLE_SERVICE_ACCOUNT_KEY or FB_ADMIN_APPDATA must be valid JSON (service account with project_id, client_email, private_key)."
      );
    } else {
      throw new Error(
        "Firebase service account env missing. Set GOOGLE_SERVICE_ACCOUNT_KEY or FB_ADMIN_APPDATA (JSON), or FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY"
      );
    }
  }
}

module.exports = admin;
