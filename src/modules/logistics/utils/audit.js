const admin = require("../../../firebaseAdmin");

function getAuditCollection() {
  return admin.firestore().collection("apps").doc("horarios").collection("audit_logs");
}

function buildAuditLog({ ownerId, branchId, action, documentType, documentId, actorId, actorEmail, correlationId, metadata }) {
  const ref = getAuditCollection().doc();
  return {
    ref,
    data: {
      id: ref.id,
      ownerId,
      branchId,
      action,
      documentType: documentType || null,
      documentId: documentId || null,
      actorId,
      actorEmail: actorEmail || null,
      correlationId,
      metadata: metadata || {},
      createdAt: new Date(),
    },
  };
}

async function writeAuditLogDirect(payload) {
  const { ref, data } = buildAuditLog(payload);
  await ref.set(data);
}

module.exports = {
  buildAuditLog,
  writeAuditLogDirect,
};
