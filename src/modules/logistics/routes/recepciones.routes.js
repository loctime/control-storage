const express = require("express");
const { validateRecepcionPayload } = require("../validators/recepciones.validator");
const { beginIdempotentRequest, completeIdempotentRequest, failIdempotentRequest } = require("../utils/idempotency");
const { assertOwnerBranchAccess, assertActorMatch } = require("../utils/authz");
const recepcionesService = require("../services/recepciones.service");

const router = express.Router();

router.post("/confirmar", async (req, res, next) => {
  let started = null;
  try {
    const payload = validateRecepcionPayload(req.body || {});
    const actor = await assertOwnerBranchAccess({
      uid: req.user.uid,
      ownerId: payload.ownerId,
      branchId: payload.branchId,
    });
    assertActorMatch({ uid: req.user.uid, member: actor, actorId: payload.recepcionadoPor });

    started = await beginIdempotentRequest({
      ownerId: payload.ownerId,
      branchId: payload.branchId,
      endpoint: "/api/logistics/v2/recepciones/confirmar",
      idempotencyKey: req.headers["x-idempotency-key"],
      payload,
      correlationId: res.locals.correlationId,
      actorId: req.user.uid,
    });

    if (started.mode === "replay") {
      return res.status(started.httpStatus || 201).json({
        recepcion: started.responseSnapshot,
        correlationId: res.locals.correlationId,
      });
    }

    const recepcion = await recepcionesService.confirmarRecepcion({
      payload,
      actor: { uid: req.user.uid, email: req.user.email, role: actor.role },
      correlationId: res.locals.correlationId,
    });

    await completeIdempotentRequest({
      scopeHash: started.scopeHash,
      responseSnapshot: recepcion,
      httpStatus: 201,
      resourceId: recepcion.id,
    });

    return res.status(201).json({ recepcion, correlationId: res.locals.correlationId });
  } catch (err) {
    await failIdempotentRequest({ scopeHash: started && started.scopeHash, reason: err.message }).catch(() => {});
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const recepcion = await recepcionesService.getRecepcionById(req.params.id);
    await assertOwnerBranchAccess({
      uid: req.user.uid,
      ownerId: recepcion.ownerId,
      branchId: recepcion.branchId,
    });
    return res.json(recepcion);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
