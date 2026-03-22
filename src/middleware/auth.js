const admin = require('../firebaseAdmin');
const { logger } = require('../utils/logger');

// Intenta parsear credenciales de forma robusta (solo para FB_ADMIN_IDENTITY)
function parseServiceAccount(envVarName) {
  let raw = process.env[envVarName];
  if (!raw || typeof raw !== 'string') {
    throw new Error(`${envVarName} no está configurada`);
  }
  raw = raw.trim();
  if ((raw.startsWith('\'') && raw.endsWith('\'')) || (raw.startsWith('"') && raw.endsWith('"'))) {
    raw = raw.slice(1, -1);
  }
  try {
    return JSON.parse(raw);
  } catch (_) {}
  try {
    return JSON.parse(raw.replace(/\\n/g, '\n'));
  } catch (_) {}
  try {
    return JSON.parse(raw.replace(/'/g, '"'));
  } catch (e) {
    console.error(`No se pudo parsear ${envVarName}. Valor inicia con:`, raw.slice(0, 60));
    throw e;
  }
}

let centralAuth;

// App de Auth central (opcional): si FB_ADMIN_IDENTITY está definido, usa una app nombrada 'authApp'
try {
  if (process.env.FB_ADMIN_IDENTITY) {
    const appIdentityCred = parseServiceAccount('FB_ADMIN_IDENTITY');
    const authApp = admin.initializeApp({
      credential: admin.credential.cert(appIdentityCred),
    }, 'authApp');
    centralAuth = authApp.auth();
  } else {
    centralAuth = admin.auth();
  }
} catch (e) {
  console.error('Error inicializando App de identidad:', e);
  throw e;
}

// APP_CODE eliminado - ya no es necesario

// Auto-inicializar usuario en Firestore si no existe
async function ensureUserExists(uid, email) {
  try {
    const db = admin.firestore();
    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      console.log('🔧 Auto-inicializando usuario en Firestore:', uid);
      
      const defaultQuotaGB = parseInt(process.env.DEFAULT_USER_QUOTA_GB) || 5;
      const quotaBytes = defaultQuotaGB * 1024 * 1024 * 1024;
      
      await userRef.set({
        planQuotaBytes: quotaBytes,
        usedBytes: 0,
        pendingBytes: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        email: email || ''
      });
      
      console.log(`✅ Usuario auto-inicializado con ${defaultQuotaGB}GB de cuota`);
    }
  } catch (error) {
    // No bloqueamos la request si falla, solo loggeamos
    console.error('⚠️  Error auto-inicializando usuario (no crítico):', error.message);
  }
}

module.exports = async (req, res, next) => {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) {
      return res.status(401).json({
        error: 'Token de autorización requerido',
        code: 'AUTH_TOKEN_MISSING',
      });
    }

    const decoded = await centralAuth.verifyIdToken(token);

    if (!decoded || !decoded.uid) {
      return res.status(401).json({ error: 'Token de usuario inválido', code: 'AUTH_UID_MISSING' });
    }

    // Verificar que el usuario tenga acceso (claims ya validados por Firebase)
    // No necesitamos filtrar por APP_CODE, la seguridad viene de los claims

    // Compat: mantener req.user y también exponer req.uid/claims
    req.uid = decoded.uid;
    req.claims = decoded;
    req.user = {
      uid: decoded.uid,
      email: decoded.email,
      emailVerified: decoded.email_verified,
      name: decoded.name,
      picture: decoded.picture,
    };

    // Auto-inicializar usuario en Firestore si no existe (async, no blocking)
    ensureUserExists(decoded.uid, decoded.email).catch(err => {
      console.error('Error en ensureUserExists:', err);
    });

    return next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({ error: 'Token expirado', code: 'AUTH_TOKEN_EXPIRED' });
    }
    if (error.code === 'auth/id-token-revoked') {
      return res.status(401).json({ error: 'Token revocado', code: 'AUTH_TOKEN_REVOKED' });
    }
    return res.status(401).json({ error: 'No autorizado', code: 'AUTH_FAILED' });
  }
};
