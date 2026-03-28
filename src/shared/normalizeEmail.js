/**
 * Normaliza un email: trim + toLowerCase.
 * @param {string} email
 * @returns {string}
 */
function normalizeEmail(email) {
  if (email == null || typeof email !== "string") return "";
  return email.trim().toLowerCase();
}

/**
 * Normaliza y deduplica un arreglo de correos.
 * @param {Array<string>} values
 * @returns {string[]}
 */
function normalizeEmailArray(values) {
  if (!Array.isArray(values)) return [];
  const set = new Set();
  for (const value of values) {
    const normalized = normalizeEmail(value);
    if (normalized) set.add(normalized);
  }
  return Array.from(set);
}

module.exports = { normalizeEmail, normalizeEmailArray };
