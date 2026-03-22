const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/auth");

const {
  myAlertsHandler,
  myVehiclesHandler,
  myStatsHandler,
  myRiskHandler,
} = require("./emailAlerts.controller");

// Todas las rutas bajo /api/email/*

router.get("/email/my-alerts", authMiddleware, myAlertsHandler);
// Evita colisión con /api/email/my-vehicles de emailUsers.routes.
router.get("/email/my-alerts-vehicles", authMiddleware, myVehiclesHandler);
router.get("/email/my-stats", authMiddleware, myStatsHandler);
router.get("/email/my-risk", authMiddleware, myRiskHandler);

module.exports = router;

