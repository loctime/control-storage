const DEFAULT_MIGRATION_DOC = 'https://github.com/loctime/controlfile/blob/main/docs/AUDITORIA_BACKEND_COMPLETA.md';
const DEFAULT_SUNSET_DATE = 'Tue, 30 Jun 2026 00:00:00 GMT';

/**
 * Adds RFC-style deprecation headers for legacy /api routes.
 * This keeps backward compatibility while making migration visible to clients.
 */
function legacyDeprecation(req, res, next) {
  if (!req.path.startsWith('/api/')) {
    return next();
  }

  // Keep health endpoint noise-free for uptime checkers.
  if (req.path === '/api/health' || req.path === '/api/health/') {
    return next();
  }

  const sunset = process.env.LEGACY_API_SUNSET_DATE || DEFAULT_SUNSET_DATE;
  const migrationDoc = process.env.LEGACY_API_MIGRATION_DOC || DEFAULT_MIGRATION_DOC;

  res.setHeader('Deprecation', 'true');
  res.setHeader('Sunset', sunset);
  res.setHeader('Link', `<${migrationDoc}>; rel="deprecation"; type="text/markdown"`);
  res.setHeader('X-Legacy-Route', 'true');

  // Minimal telemetry for sunset readiness.
  const actor = req.user?.uid || req.uid || 'anonymous';
  console.log('[legacy-api-usage]', JSON.stringify({
    method: req.method,
    path: req.path,
    actor,
    source: req.headers.origin || req.headers.referer || 'unknown',
    userAgent: req.headers['user-agent'] || '',
    requestId: req.headers['x-request-id'] || null,
    at: new Date().toISOString(),
  }));

  return next();
}

module.exports = legacyDeprecation;
