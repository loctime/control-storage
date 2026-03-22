/**
 * Normaliza app.id como slug (lowercase, a-z, 0-9, guiones)
 * Versión JavaScript para backend Node.js
 */
function normalizeAppId(appId) {
  if (!appId || typeof appId !== 'string') {
    throw new Error('app.id must be a non-empty string');
  }
  
  return appId
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

module.exports = {
  normalizeAppId,
};
