const { createHash } = require("crypto");

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

function computeRequestHash(payload) {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

function computeScopeHash({ ownerId, endpoint, idempotencyKey }) {
  return createHash("sha256").update(`${ownerId}|${endpoint}|${idempotencyKey}`).digest("hex");
}

module.exports = {
  stableStringify,
  computeRequestHash,
  computeScopeHash,
};
