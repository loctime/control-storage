const express = require('express');

const router = express.Router();

/**
 * GET /api/github/status
 * 
 * STUB DEFENSIVO - GitHub OAuth fue eliminado
 * 
 * Este endpoint se mantiene por compatibilidad con frontends antiguos o caché,
 * pero ya no realiza ninguna operación relacionada con GitHub.
 * 
 * - NO hace llamadas a GitHub API
 * - NO consulta tokens en Firestore
 * - NO aplica rate limiting específico
 * - Siempre responde 200 con payload estático y seguro
 * 
 * Respuesta (200):
 * {
 *   ok: true,
 *   connected: false,
 *   mode: "url-only",
 *   message: "GitHub OAuth deshabilitado. Repositorios gestionados por URL."
 * }
 */
router.get('/status', (req, res) => {
  // Log mínimo (info, no warn/error)
  // No requiere userId ni autenticación para ser completamente inofensivo
  
  return res.status(200).json({
    ok: true,
    connected: false,
    mode: 'url-only',
    message: 'GitHub OAuth deshabilitado. Repositorios gestionados por URL.'
  });
});

module.exports = router;
