const {
  getMyAlertsPage,
  getMyStats,
  getMyRiskByVehicle,
  getMyVehiclesWithRisk,
} = require("./emailAlerts.service");
const { getMe } = require("../emailUsers/emailUsers.service");

async function requireAccessUser(req, res) {
  const email = req.user?.email;
  if (!email) {
    res.status(401).json({ ok: false, error: "Token inválido o sin email" });
    return null;
  }

  const accessUser = await getMe(email);
  if (!accessUser) {
    res.status(403).json({ ok: false, error: "USER_NOT_AUTHORIZED" });
    return null;
  }

  return accessUser;
}

/**
 * GET /api/email/my-alerts
 * Devuelve alertas del índice apps/emails/responsables/{email}/alerts.
 */
async function myAlertsHandler(req, res) {
  try {
    const accessUser = await requireAccessUser(req, res);
    if (!accessUser) return;

    const limitParam = req.query.limit;
    const startAfter = typeof req.query.startAfter === "string" ? req.query.startAfter : undefined;

    const limit =
      typeof limitParam === "string" && !Number.isNaN(parseInt(limitParam, 10))
        ? parseInt(limitParam, 10)
        : 50;

    const alerts = await getMyAlertsPage(accessUser.email, { limit, startAfter });
    return res.json({ ok: true, alerts });
  } catch (err) {
    console.error("[emailAlerts] my-alerts error:", err);
    return res
      .status(500)
      .json({ ok: false, error: err && err.message ? err.message : "Error interno" });
  }
}

/**
 * GET /api/email/my-alerts-vehicles
 * Devuelve vehículos donde el usuario es responsable, usando índice de alertas para riesgo.
 */
async function myVehiclesHandler(req, res) {
  try {
    const accessUser = await requireAccessUser(req, res);
    if (!accessUser) return;

    const vehicles = await getMyVehiclesWithRisk(accessUser.email);
    return res.json({ ok: true, vehicles });
  } catch (err) {
    console.error("[emailAlerts] my-vehicles error:", err);
    return res
      .status(500)
      .json({ ok: false, error: err && err.message ? err.message : "Error interno" });
  }
}

/**
 * GET /api/email/my-stats
 * Estadísticas agregadas de alertas para el responsable actual.
 */
async function myStatsHandler(req, res) {
  try {
    const accessUser = await requireAccessUser(req, res);
    if (!accessUser) return;

    const stats = await getMyStats(accessUser.email);
    return res.json({ ok: true, stats });
  } catch (err) {
    console.error("[emailAlerts] my-stats error:", err);
    return res
      .status(500)
      .json({ ok: false, error: err && err.message ? err.message : "Error interno" });
  }
}

/**
 * GET /api/email/my-risk
 * Riesgo por vehículo (agrupado por plate) para el responsable actual.
 */
async function myRiskHandler(req, res) {
  try {
    const accessUser = await requireAccessUser(req, res);
    if (!accessUser) return;

    const vehicles = await getMyRiskByVehicle(accessUser.email);
    return res.json({ ok: true, vehicles });
  } catch (err) {
    console.error("[emailAlerts] my-risk error:", err);
    return res
      .status(500)
      .json({ ok: false, error: err && err.message ? err.message : "Error interno" });
  }
}

module.exports = {
  myAlertsHandler,
  myVehiclesHandler,
  myStatsHandler,
  myRiskHandler,
};

