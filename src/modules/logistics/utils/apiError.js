class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = "ApiError";
    this.status = status || 500;
    this.code = code || "INTERNAL_ERROR";
    this.details = details;
  }
}

function createErrorResponse(err, correlationId) {
  const status = err instanceof ApiError ? err.status : 500;
  const code = err instanceof ApiError ? err.code : "INTERNAL_ERROR";
  const message = err instanceof ApiError ? err.message : "Error interno del servidor";
  const details = err instanceof ApiError ? err.details : undefined;

  const payload = { code, message, correlationId };
  if (details !== undefined) payload.details = details;

  return { status, payload };
}

module.exports = {
  ApiError,
  createErrorResponse,
};
