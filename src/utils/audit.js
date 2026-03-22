const admin = require('../firebaseAdmin');

/**
 * Generar ID único para auditoría
 */
function generateAuditId() {
  return `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Crea un log de auditoría
 * Versión JavaScript para backend Node.js
 */
async function createAuditLog(action, performedBy, changes, options = {}) {
  const db = admin.firestore();
  const auditId = generateAuditId();
  const now = admin.firestore.Timestamp.now();

  const auditLog = {
    auditId,
    action,
    performedBy,
    changes,
    createdAt: now,
    ...options,
  };

  await db.collection('platform').doc('audit').collection('audit').doc(auditId).set(auditLog);
}

module.exports = {
  createAuditLog,
};
