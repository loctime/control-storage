const admin = require("../../../firebaseAdmin");
const { ApiError } = require("./apiError");
const { computeRequestHash, computeScopeHash } = require("./idempotencyHash");

const DEFAULT_TTL_HOURS = 24;

function getCollection() {
  return admin.firestore().collection("apps").doc("horarios").collection("idempotency_keys");
}

async function beginIdempotentRequest({ ownerId, branchId, endpoint, idempotencyKey, payload, correlationId, actorId }) {
  if (!idempotencyKey || typeof idempotencyKey !== "string") {
    throw new ApiError(400, "VALIDATION_ERROR", "x-idempotency-key es obligatorio");
  }

  const requestHash = computeRequestHash(payload);
  const scopeHash = computeScopeHash({ ownerId, endpoint, idempotencyKey });
  const docRef = getCollection().doc(scopeHash);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + DEFAULT_TTL_HOURS * 60 * 60 * 1000);

  const result = await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists) {
      tx.set(docRef, {
        ownerId,
        branchId,
        endpoint,
        idempotencyKey,
        requestHash,
        status: "in_progress",
        responseSnapshot: null,
        resourceId: null,
        httpStatus: null,
        createdAt: now,
        updatedAt: now,
        expiresAt,
        correlationId,
        actorId: actorId || null,
      });
      return { mode: "proceed", scopeHash, requestHash };
    }

    const data = snap.data();
    if (data.requestHash !== requestHash) {
      throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD", "La idempotency key ya fue usada con otro payload");
    }

    if (data.status === "completed") {
      return {
        mode: "replay",
        scopeHash,
        requestHash,
        responseSnapshot: data.responseSnapshot,
        httpStatus: data.httpStatus || 200,
      };
    }

    if (data.status === "in_progress") {
      throw new ApiError(409, "IDEMPOTENCY_IN_PROGRESS", "La solicitud con esta idempotency key esta en curso");
    }

    tx.update(docRef, {
      status: "in_progress",
      updatedAt: now,
      correlationId,
    });
    return { mode: "proceed", scopeHash, requestHash };
  });

  return result;
}

async function completeIdempotentRequest({ scopeHash, responseSnapshot, httpStatus, resourceId }) {
  const docRef = getCollection().doc(scopeHash);
  await docRef.set(
    {
      status: "completed",
      responseSnapshot,
      httpStatus,
      resourceId: resourceId || null,
      updatedAt: new Date(),
    },
    { merge: true }
  );
}

async function failIdempotentRequest({ scopeHash, reason }) {
  if (!scopeHash) return;
  const docRef = getCollection().doc(scopeHash);
  await docRef.set(
    {
      status: "failed",
      failureReason: reason || "unknown",
      updatedAt: new Date(),
    },
    { merge: true }
  );
}

module.exports = {
  beginIdempotentRequest,
  completeIdempotentRequest,
  failIdempotentRequest,
};
