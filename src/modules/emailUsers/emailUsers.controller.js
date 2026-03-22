/**
 * emailUsers.controller.js
 * Controladores para usuarios autorizados del panel de alertas.
 */

const { ensureUser, getMe, getMyVehicles, normalizeEmail } = require("./emailUsers.service");

/**
 * Valida x-local-token. Retorna true si válido.
 */
function validateLocalToken(req) {
  const token = process.env.LOCAL_EMAIL_TOKEN;
  if (!token) return false;
  return req.headers["x-local-token"] === token;
}

/**
 * POST /api/email/ensure-user
 * Crea o actualiza usuario autorizado (solo con token local).
 */
async function ensureUserHandler(req, res) {
  try {
    if (!validateLocalToken(req)) {
      return res.status(401).json({ error: "no autorizado" });
    }

    const { email, role } = req.body || {};
    if (!email || typeof email !== "string") {
      return res.status(400).json({ error: "email requerido" });
    }

    const normalized = normalizeEmail(email);
    if (!normalized) {
      return res.status(400).json({ error: "email inválido" });
    }

    const allowedRoles = ["admin", "general", "report", "responsable"];
    if (!role || !allowedRoles.includes(role)) {
      return res
        .status(400)
        .json({ error: "role debe ser 'admin', 'general', 'report' o 'responsable'" });
    }

    await ensureUser(normalized, role);
    return res.json({ ok: true });
  } catch (err) {
    console.error("[emailUsers] ensure-user error:", err);
    return res.status(500).json({ ok: false, error: err.message || "Error interno" });
  }
}

/**
 * GET /api/email/me
 * Devuelve el usuario autorizado actual (req.user viene del auth middleware).
 * Verifica apps/emails/access/{email}.active/enabled === true.
 */
async function meHandler(req, res) {
  try {
    const email = req.user?.email;
    if (!email) {
      return res.status(401).json({ ok: false, error: "Token inválido o sin email" });
    }

    const user = await getMe(email);
    if (!user) {
      return res.status(403).json({ ok: false, error: "USER_NOT_AUTHORIZED" });
    }

    return res.json({
      ok: true,
      email: user.email,
      role: user.role,
    });
  } catch (err) {
    console.error("[emailUsers] me error:", err);
    return res.status(500).json({ ok: false, error: err.message || "Error interno" });
  }
}

/**
 * GET /api/email/my-vehicles
 * Devuelve vehículos visibles según role.
 * - admin/general/report: todos los vehículos
 * - responsable: solo vehículos donde responsablesNormalized contiene su email
 */
async function myVehiclesHandler(req, res) {
  try {
    const email = req.user?.email;
    if (!email) {
      return res.status(401).json({ ok: false, error: "Token inválido o sin email" });
    }

    const user = await getMe(email);
    if (!user) {
      return res.status(403).json({ ok: false, error: "USER_NOT_AUTHORIZED" });
    }

    const vehicles = await getMyVehicles(user.email, user.role);
    return res.json({ ok: true, vehicles });
  } catch (err) {
    console.error("[emailUsers] my-vehicles error:", err);
    return res.status(500).json({ ok: false, error: err.message || "Error interno" });
  }
}

/**
 * GET /api/vehicles/my-vehicles
 * Alias explícito para el panel de vehículos, mismo comportamiento que /api/email/my-vehicles.
 */
async function myVehiclesAliasHandler(req, res) {
  return myVehiclesHandler(req, res);
}

module.exports = {
  ensureUserHandler,
  meHandler,
  myVehiclesHandler,
  myVehiclesAliasHandler,
};
