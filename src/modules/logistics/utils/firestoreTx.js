const admin = require("../../../firebaseAdmin");
const { logger } = require("../../../utils/logger");
const { ApiError } = require("./apiError");

async function runFirestoreTransaction(work, options = {}) {
  const retries = Number.isInteger(options.retries) ? options.retries : 3;
  const correlationId = options.correlationId;

  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await admin.firestore().runTransaction(async (tx) => work(tx));
    } catch (err) {
      lastError = err;
      const retryable = err && (err.code === 10 || err.code === "aborted");
      if (!retryable || attempt >= retries) break;
      logger.warn("logistics.tx_retry", {
        attempt,
        retries,
        correlationId,
        message: err.message,
      });
      await new Promise((resolve) => setTimeout(resolve, attempt * 50));
    }
  }

  if (lastError instanceof ApiError) throw lastError;
  throw new ApiError(500, "INTERNAL_ERROR", "Error ejecutando transaccion", {
    reason: lastError ? lastError.message : "unknown",
  });
}

module.exports = {
  runFirestoreTransaction,
};
