// backend/src/routes/publicHorarios.routes.js
// Endpoint público: GET /api/horarios/publicos-completos?companySlug=...
// Sin authMiddleware.
const express = require('express');
const router = express.Router();
const { getPublicHorariosCompletos } = require('../handlers/publicHorarios.handler');

router.get('/api/horarios/publicos-completos', getPublicHorariosCompletos);

module.exports = router;
