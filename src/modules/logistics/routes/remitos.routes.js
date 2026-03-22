const express = require("express");
const { validateRemitoPayload } = require("../validators/remitos.validator");
const { ApiError } = require("../utils/apiError");
const { beginIdempotentRequest, completeIdempotentRequest, failIdempotentRequest } = require("../utils/idempotency");
const { assertOwnerBranchAccess } = require("../utils/authz");
const remitosService = require("../services/remitos.service");

const router = express.Router();

router.post("/emitir", async (req, res, next) => {
  let started = null;
  try {
    const payload = validateRemitoPayload(req.body || {});
    const actor = await assertOwnerBranchAccess({
      uid: req.user.uid,
      ownerId: payload.ownerId,
      branchId: payload.branchId,
    });

    const key = req.headers["x-idempotency-key"];
    started = await beginIdempotentRequest({
      ownerId: payload.ownerId,
      branchId: payload.branchId,
      endpoint: "/api/logistics/v2/remitos-salida/emitir",
      idempotencyKey: key,
      payload,
      correlationId: res.locals.correlationId,
      actorId: req.user.uid,
    });

    if (started.mode === "replay") {
      return res.status(started.httpStatus || 201).json({
        remito: started.responseSnapshot,
        correlationId: res.locals.correlationId,
      });
    }

    const remito = await remitosService.emitirRemito({
      payload,
      actor: { uid: req.user.uid, email: req.user.email, role: actor.role },
      correlationId: res.locals.correlationId,
    });

    await completeIdempotentRequest({
      scopeHash: started.scopeHash,
      responseSnapshot: remito,
      httpStatus: 201,
      resourceId: remito.id,
    });

    return res.status(201).json({ remito, correlationId: res.locals.correlationId });
  } catch (err) {
    await failIdempotentRequest({ scopeHash: started && started.scopeHash, reason: err.message }).catch(() => {});
    return next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const remito = await remitosService.getRemitoById(req.params.id);
    await assertOwnerBranchAccess({
      uid: req.user.uid,
      ownerId: remito.ownerId,
      branchId: remito.branchId,
    });
    return res.json(remito);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
