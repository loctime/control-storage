const express = require("express");
const { validatePedidoInternoPayload } = require("../validators/pedidosInternos.validator");
const { beginIdempotentRequest, completeIdempotentRequest, failIdempotentRequest } = require("../utils/idempotency");
const { assertOwnerBranchAccess, assertActorMatch } = require("../utils/authz");
const pedidosService = require("../services/pedidosInternos.service");

const router = express.Router();

router.post("/", async (req, res, next) => {
  let started = null;
  try {
    const payload = validatePedidoInternoPayload(req.body || {});
    const actor = await assertOwnerBranchAccess({
      uid: req.user.uid,
      ownerId: payload.ownerId,
      branchId: payload.branchId,
    });
    assertActorMatch({ uid: req.user.uid, member: actor, actorId: payload.creadoPor });

    started = await beginIdempotentRequest({
      ownerId: payload.ownerId,
      branchId: payload.branchId,
      endpoint: "/api/logistics/v2/pedidos-internos",
      idempotencyKey: req.headers["x-idempotency-key"],
      payload,
      correlationId: res.locals.correlationId,
      actorId: req.user.uid,
    });

    if (started.mode === "replay") {
      return res.status(started.httpStatus || 201).json({
        pedidoInterno: started.responseSnapshot,
        correlationId: res.locals.correlationId,
      });
    }

    const pedidoInterno = await pedidosService.crearPedidoInterno({
      payload,
      actor: { uid: req.user.uid, email: req.user.email, role: actor.role },
      correlationId: res.locals.correlationId,
    });

    await completeIdempotentRequest({
      scopeHash: started.scopeHash,
      responseSnapshot: pedidoInterno,
      httpStatus: 201,
      resourceId: pedidoInterno.id,
    });

    return res.status(201).json({ pedidoInterno, correlationId: res.locals.correlationId });
  } catch (err) {
    await failIdempotentRequest({ scopeHash: started && started.scopeHash, reason: err.message }).catch(() => {});
    next(err);
  }
});

module.exports = router;
