const express = require("express");
const { validateDevolucionPayload } = require("../validators/devoluciones.validator");
const { beginIdempotentRequest, completeIdempotentRequest, failIdempotentRequest } = require("../utils/idempotency");
const { assertOwnerBranchAccess, assertActorMatch } = require("../utils/authz");
const devolucionesService = require("../services/devoluciones.service");

const router = express.Router();

router.post("/crear", async (req, res, next) => {
  let started = null;
  try {
    const payload = validateDevolucionPayload(req.body || {});
    const actor = await assertOwnerBranchAccess({
      uid: req.user.uid,
      ownerId: payload.ownerId,
      branchId: payload.branchId,
    });
    assertActorMatch({ uid: req.user.uid, member: actor, actorId: payload.creadaPor });

    started = await beginIdempotentRequest({
      ownerId: payload.ownerId,
      branchId: payload.branchId,
      endpoint: "/api/logistics/v2/devoluciones/crear",
      idempotencyKey: req.headers["x-idempotency-key"],
      payload,
      correlationId: res.locals.correlationId,
      actorId: req.user.uid,
    });

    if (started.mode === "replay") {
      return res.status(started.httpStatus || 201).json({
        devolucion: started.responseSnapshot,
        correlationId: res.locals.correlationId,
      });
    }

    const devolucion = await devolucionesService.crearDevolucion({
      payload,
      actor: { uid: req.user.uid, email: req.user.email, role: actor.role },
      correlationId: res.locals.correlationId,
    });

    await completeIdempotentRequest({
      scopeHash: started.scopeHash,
      responseSnapshot: devolucion,
      httpStatus: 201,
      resourceId: devolucion.id,
    });

    return res.status(201).json({ devolucion, correlationId: res.locals.correlationId });
  } catch (err) {
    await failIdempotentRequest({ scopeHash: started && started.scopeHash, reason: err.message }).catch(() => {});
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const ownerId = req.query.ownerId;
    const branchId = req.query.branchId;
    const devolucion = await devolucionesService.getDevolucionById(req.params.id, ownerId, branchId);
    await assertOwnerBranchAccess({
      uid: req.user.uid,
      ownerId: devolucion.ownerId,
      branchId: devolucion.branchId,
    });
    return res.json(devolucion);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
