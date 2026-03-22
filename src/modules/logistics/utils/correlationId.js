const { randomUUID } = require("crypto");

function correlationIdMiddleware(req, res, next) {
  const incoming = req.headers["x-request-id"];
  const correlationId = typeof incoming === "string" && incoming.trim() ? incoming.trim() : randomUUID();
  res.locals.correlationId = correlationId;
  res.setHeader("x-correlation-id", correlationId);
  next();
}

module.exports = {
  correlationIdMiddleware,
};
