const { ApiError } = require("../utils/apiError");
const { runFirestoreTransaction } = require("../utils/firestoreTx");
const { buildAuditLog } = require("../utils/audit");
const pedidosRepo = require("../repositories/pedidosInternos.repository");

function toISOStringSafe(value) {
  if (!value) return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return value;
}

function serializePedido(doc) {
  return {
    ...doc,
    createdAt: toISOStringSafe(doc.createdAt),
    confirmadoAt: toISOStringSafe(doc.confirmadoAt),
  };
}

async function crearPedidoInterno({ payload, actor, correlationId }) {
  const now = new Date();

  const pedido = await runFirestoreTransaction(async (tx) => {
    const pedidoRef = pedidosRepo.getCollection().doc();

    const pedidoData = {
      id: pedidoRef.id,
      ownerId: payload.ownerId,
      branchId: payload.branchId,
      estado: "borrador",
      createdAt: now,
      confirmadoAt: null,
      creadoPor: payload.creadoPor,
      origen: payload.origen,
      destinoSugerido: payload.destinoSugerido || null,
      observaciones: payload.observaciones || null,
      items: payload.items,
    };

    tx.set(pedidoRef, pedidoData);

    const audit = buildAuditLog({
      ownerId: payload.ownerId,
      branchId: payload.branchId,
      action: "pedido_interno_creado",
      documentType: "pedido_interno",
      documentId: pedidoRef.id,
      actorId: actor.uid,
      actorEmail: actor.email,
      correlationId,
    });
    tx.set(audit.ref, audit.data);

    return pedidoData;
  }, { correlationId });

  return serializePedido(pedido);
}

async function getPedidoInternoById(id, ownerId, branchId) {
  const pedido = await pedidosRepo.getById(id);
  if (!pedido) throw new ApiError(404, "DOCUMENT_NOT_FOUND", "Pedido interno no encontrado");
  if (ownerId && pedido.ownerId !== ownerId) throw new ApiError(403, "FORBIDDEN_OWNER_BRANCH", "Owner no autorizado");
  if (branchId && pedido.branchId !== branchId) throw new ApiError(403, "FORBIDDEN_OWNER_BRANCH", "Branch no autorizado");
  return serializePedido(pedido);
}

module.exports = {
  crearPedidoInterno,
  getPedidoInternoById,
};
