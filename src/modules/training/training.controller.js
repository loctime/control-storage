const trainingService = require("./training.service");

function getRequestedOwnerId(req) {
  return req.query?.ownerId || req.body?.ownerId || null;
}

function resolveOwnerId(req) {
  const claimOwnerId = req.claims?.ownerId || null;
  const uid = req.user?.uid || req.uid || null;
  const requestedOwnerId = getRequestedOwnerId(req);
  const role = req.claims?.role || null;

  if (requestedOwnerId) {
    if (role === "superdev" || uid === requestedOwnerId || claimOwnerId === requestedOwnerId) {
      return requestedOwnerId;
    }
    throw trainingService.httpError(403, "FORBIDDEN_OWNER", "No autorizado para ownerId solicitado");
  }

  if (claimOwnerId) return claimOwnerId;
  if (uid) return uid;
  throw trainingService.httpError(400, "VALIDATION_ERROR", "No se pudo resolver ownerId");
}

function ok(res, data, status = 200) {
  return res.status(status).json({ ok: true, data });
}

function fail(res, error) {
  const status = Number(error.status || 500);
  return res.status(status).json({
    ok: false,
    error: error.message || "Error interno del servidor",
    code: error.code || "INTERNAL_ERROR",
    details: error.details || undefined,
  });
}

async function listCatalog(req, res) {
  try {
    const ownerId = resolveOwnerId(req);
    const data = await trainingService.listCatalog(ownerId, req.query || {});
    return ok(res, data);
  } catch (error) {
    return fail(res, error);
  }
}

async function createCatalog(req, res) {
  try {
    const ownerId = resolveOwnerId(req);
    const data = await trainingService.createCatalog(ownerId, req.body || {});
    return ok(res, data, 201);
  } catch (error) {
    return fail(res, error);
  }
}

async function patchCatalog(req, res) {
  try {
    const ownerId = resolveOwnerId(req);
    const data = await trainingService.patchCatalog(ownerId, req.params.id, req.body || {});
    return ok(res, data);
  } catch (error) {
    return fail(res, error);
  }
}

async function deleteCatalog(req, res) {
  try {
    const ownerId = resolveOwnerId(req);
    const data = await trainingService.deleteCatalog(ownerId, req.params.id);
    return ok(res, data);
  } catch (error) {
    return fail(res, error);
  }
}

async function listPlans(req, res) {
  try {
    const ownerId = resolveOwnerId(req);
    const data = await trainingService.listPlans(ownerId, req.query || {});
    return ok(res, data);
  } catch (error) {
    return fail(res, error);
  }
}

async function createPlan(req, res) {
  try {
    const ownerId = resolveOwnerId(req);
    const data = await trainingService.createPlan(ownerId, req.body || {});
    return ok(res, data, 201);
  } catch (error) {
    return fail(res, error);
  }
}

async function patchPlan(req, res) {
  try {
    const ownerId = resolveOwnerId(req);
    const data = await trainingService.patchPlan(ownerId, req.params.id, req.body || {});
    return ok(res, data);
  } catch (error) {
    return fail(res, error);
  }
}

async function listPlanItems(req, res) {
  try {
    const ownerId = resolveOwnerId(req);
    const data = await trainingService.listPlanItems(ownerId, req.params.id, req.query || {});
    return ok(res, data);
  } catch (error) {
    return fail(res, error);
  }
}

async function createPlanItem(req, res) {
  try {
    const ownerId = resolveOwnerId(req);
    const data = await trainingService.createPlanItem(ownerId, req.body || {});
    return ok(res, data, 201);
  } catch (error) {
    return fail(res, error);
  }
}

async function patchPlanItem(req, res) {
  try {
    const ownerId = resolveOwnerId(req);
    const data = await trainingService.patchPlanItem(ownerId, req.params.id, req.body || {});
    return ok(res, data);
  } catch (error) {
    return fail(res, error);
  }
}

async function deletePlanItem(req, res) {
  try {
    const ownerId = resolveOwnerId(req);
    const data = await trainingService.deletePlanItem(ownerId, req.params.id);
    return ok(res, data);
  } catch (error) {
    return fail(res, error);
  }
}

async function listSessions(req, res) {
  try {
    const ownerId = resolveOwnerId(req);
    const data = await trainingService.listSessions(ownerId, req.query || {});
    return ok(res, data);
  } catch (error) {
    return fail(res, error);
  }
}

async function createSession(req, res) {
  try {
    const ownerId = resolveOwnerId(req);
    const data = await trainingService.createSession(ownerId, req.body || {});
    return ok(res, data, 201);
  } catch (error) {
    return fail(res, error);
  }
}

async function patchSession(req, res) {
  try {
    const ownerId = resolveOwnerId(req);
    const data = await trainingService.patchSession(ownerId, req.params.id, req.body || {});
    return ok(res, data);
  } catch (error) {
    return fail(res, error);
  }
}

async function registerAttendance(req, res) {
  try {
    const ownerId = resolveOwnerId(req);
    const data = await trainingService.registerAttendance(ownerId, req.params.id, req.body || {});
    return ok(res, data, 201);
  } catch (error) {
    return fail(res, error);
  }
}

async function getDashboard(req, res) {
  try {
    const ownerId = resolveOwnerId(req);
    const data = await trainingService.getDashboard(ownerId);
    return ok(res, data);
  } catch (error) {
    return fail(res, error);
  }
}

async function getEmployeeTrainingStatus(req, res) {
  try {
    const ownerId = resolveOwnerId(req);
    const employeeId = req.params.employeeId;
    const data = await trainingService.getEmployeeTrainingStatus(ownerId, employeeId);
    return ok(res, data);
  } catch (error) {
    return fail(res, error);
  }
}

module.exports = {
  listCatalog,
  createCatalog,
  patchCatalog,
  deleteCatalog,
  listPlans,
  createPlan,
  patchPlan,
  listPlanItems,
  createPlanItem,
  patchPlanItem,
  deletePlanItem,
  listSessions,
  createSession,
  patchSession,
  registerAttendance,
  getDashboard,
  getEmployeeTrainingStatus,
};
