const express = require("express");
const remitosRoutes = require("./routes/remitos.routes");
const recepcionesRoutes = require("./routes/recepciones.routes");
const devolucionesRoutes = require("./routes/devoluciones.routes");
const pedidosInternosRoutes = require("./routes/pedidosInternos.routes");
const remitosRepo = require("./repositories/remitos.repository");
const recepcionesRepo = require("./repositories/recepciones.repository");
const devolucionesRepo = require("./repositories/devoluciones.repository");
const { correlationIdMiddleware } = require("./utils/correlationId");
const { assertOwnerBranchAccess } = require("./utils/authz");
const { ApiError, createErrorResponse } = require("./utils/apiError");
const { logger } = require("../../utils/logger");

const router = express.Router();

function sortableDate(doc) {
  const keys = ["emitidoAt", "recepcionAt", "creadaAt", "createdAt"];
  for (const key of keys) {
    const value = doc[key];
    if (!value) continue;
    if (typeof value.toDate === "function") return value.toDate().getTime();
    const parsed = new Date(value).getTime();
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

function normalizeDoc(doc) {
  const out = { ...doc };
  Object.keys(out).forEach((k) => {
    const v = out[k];
    if (v && typeof v.toDate === "function") {
      out[k] = v.toDate().toISOString();
    }
  });
  return out;
}

router.use(correlationIdMiddleware);
router.use("/remitos-salida", remitosRoutes);
router.use("/recepciones", recepcionesRoutes);
router.use("/devoluciones", devolucionesRoutes);
router.use("/pedidos-internos", pedidosInternosRoutes);

router.get("/documentos", async (req, res, next) => {
  try {
    const ownerId = req.query.ownerId;
    const branchId = req.query.branchId;
    if (!ownerId || typeof ownerId !== "string") {
      throw new ApiError(400, "VALIDATION_ERROR", "ownerId es requerido");
    }

    await assertOwnerBranchAccess({ uid: req.user.uid, ownerId, branchId });

    const tipo = req.query.tipo;
    const estado = req.query.estado;
    const from = req.query.from;
    const to = req.query.to;
    const page = Math.max(Number(req.query.page || 1), 1);
    const pageSize = Math.min(Math.max(Number(req.query.pageSize || 50), 1), 200);

    const query = { ownerId, branchId, estado, from, to, limit: 500 };
    let docs = [];

    if (!tipo || tipo === "remito") {
      const remitos = await remitosRepo.findByFilters(query);
      docs = docs.concat(remitos.map((d) => ({ ...normalizeDoc(d), __tipo: "remito" })));
    }

    if (!tipo || tipo === "recepcion") {
      const recepciones = await recepcionesRepo.findByFilters(query);
      docs = docs.concat(recepciones.map((d) => ({ ...normalizeDoc(d), __tipo: "recepcion" })));
    }

    if (!tipo || tipo === "devolucion") {
      const devoluciones = await devolucionesRepo.findByFilters(query);
      docs = docs.concat(devoluciones.map((d) => ({ ...normalizeDoc(d), __tipo: "devolucion" })));
    }

    docs.sort((a, b) => sortableDate(b) - sortableDate(a));
    const total = docs.length;
    const start = (page - 1) * pageSize;
    const items = docs.slice(start, start + pageSize).map(({ __tipo, ...rest }) => rest);

    return res.json({ items, total });
  } catch (err) {
    next(err);
  }
});

router.use((err, req, res, next) => {
  const correlationId = res.locals.correlationId;
  const { status, payload } = createErrorResponse(err, correlationId);

  logger.error("logistics.error", {
    status,
    code: payload.code,
    message: payload.message,
    correlationId,
    path: req.path,
  });

  res.setHeader("x-correlation-id", correlationId || "");
  res.status(status).json(payload);
});

module.exports = router;
