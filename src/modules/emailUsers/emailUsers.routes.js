/**
 * emailUsers.routes.js
 * Rutas para usuarios autorizados del panel de alertas de vehículos.
 *
 * POST /api/email/ensure-user        → x-local-token (crear/actualizar usuario autorizado)
 * GET  /api/email/me                 → Firebase Auth (datos del usuario autorizado)
 * GET  /api/email/my-vehicles        → Firebase Auth (vehículos visibles según role)
 * GET  /api/vehicles/my-vehicles     → Firebase Auth (alias explícito para vehículos)
 */

const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/auth");
const {
  ensureUserHandler,
  meHandler,
  myVehiclesHandler,
  myVehiclesAliasHandler,
} = require("./emailUsers.controller");

router.post("/email/ensure-user", ensureUserHandler);
router.get("/email/me", authMiddleware, meHandler);
router.get("/email/my-vehicles", authMiddleware, myVehiclesHandler);
router.get("/vehicles/my-vehicles", authMiddleware, myVehiclesAliasHandler);

module.exports = router;
