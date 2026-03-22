const admin = require("../../../firebaseAdmin");
const { ApiError } = require("../utils/apiError");
const { runFirestoreTransaction } = require("../utils/firestoreTx");
const { reserveRemitoNumber } = require("../utils/counters");
const { buildAuditLog } = require("../utils/audit");
const remitosRepo = require("../repositories/remitos.repository");
const pedidosRepo = require("../repositories/pedidosInternos.repository");
const catalogRepo = require("../repositories/logisticsCatalog.repository");

function toISOStringSafe(value) {
  if (!value) return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return value;
}

function serializeRemito(remito) {
  return {
    ...remito,
    emitidoAt: toISOStringSafe(remito.emitidoAt),
  };
}

async function emitirRemito({ payload, actor, correlationId }) {
  const productMap = await catalogRepo.getProductsByIds(
    payload.ownerId,
    payload.items.map((item) => item.productId)
  );

  const now = new Date();

  const result = await runFirestoreTransaction(async (tx) => {
    let pedidoInterno = null;
    let pedidoItemMap = new Map();

    if (payload.pedidoInternoId) {
      const pedidoRef = pedidosRepo.getByIdRef(payload.pedidoInternoId);
      const pedidoSnap = await tx.get(pedidoRef);
      if (!pedidoSnap.exists) {
        throw new ApiError(404, "DOCUMENT_NOT_FOUND", "Pedido interno no encontrado");
      }
      pedidoInterno = { id: pedidoSnap.id, ...pedidoSnap.data() };
      if (pedidoInterno.ownerId !== payload.ownerId || pedidoInterno.branchId !== payload.branchId) {
        throw new ApiError(403, "FORBIDDEN_OWNER_BRANCH", "El pedido no pertenece a owner/branch indicados");
      }
      if (!["borrador", "confirmado"].includes(pedidoInterno.estado)) {
        throw new ApiError(400, "INVALID_STATE_TRANSITION", "Estado de pedido interno no permite emitir remito");
      }
      pedidoItemMap = new Map((pedidoInterno.items || []).map((it) => [it.productId, it]));
    }

    const remitoRef = remitosRepo.getCollection().doc();
    const numeroRemito = await reserveRemitoNumber(tx, {
      ownerId: payload.ownerId,
      branchId: payload.branchId,
      date: now,
    });

    const itemsSnapshot = payload.items.map((item) => {
      const product = productMap.get(item.productId);
      if (!product) {
        throw new ApiError(404, "DOCUMENT_NOT_FOUND", `Producto no encontrado: ${item.productId}`);
      }

      if (!Number.isInteger(item.cantidadEnviadaUnidadesBase)) {
        throw new ApiError(422, "UNIT_PACK_MISMATCH", "cantidadEnviadaUnidadesBase debe ser entero en unidad base", {
          productId: item.productId,
        });
      }

      const original = pedidoItemMap.get(item.productId);
      return {
        id: admin.firestore().collection("_").doc().id,
        productId: item.productId,
        nombreSnapshot: product.nombre || product.name || item.productId,
        unidadBaseSnapshot: product.unidadBase || product.unidad || "unidad",
        packSizeSnapshot: product.packSize || null,
        cantidadPedidaOriginal: original ? original.cantidadFinalPedida : null,
        cantidadEnviada: item.cantidadEnviadaUnidadesBase,
        cantidadEnviadaUnidadesBase: item.cantidadEnviadaUnidadesBase,
        lote: item.lote || null,
        vencimiento: item.vencimiento || null,
        observacionesEnvio: item.observacionesEnvio || null,
      };
    });

    const remitoData = {
      id: remitoRef.id,
      ownerId: payload.ownerId,
      branchId: payload.branchId,
      numeroRemito,
      estado: "emitido",
      emitidoAt: now,
      emitidoPor: actor.uid,
      origen: payload.origen,
      destino: payload.destino,
      transportista: payload.transportista,
      vehiculo: payload.vehiculo || null,
      pedidoInternoId: payload.pedidoInternoId || null,
      pdfFileId: null,
      qrToken: null,
      firmaEmisorFileId: null,
      firmaTransportistaFileId: null,
      metadata: payload.metadata || {},
      itemsSnapshot,
    };

    tx.set(remitoRef, remitoData);

    if (pedidoInterno) {
      tx.update(pedidosRepo.getByIdRef(payload.pedidoInternoId), {
        estado: "usado_para_remito",
        remitoSalidaId: remitoRef.id,
        updatedAt: now,
      });
    }

    const audit = buildAuditLog({
      ownerId: payload.ownerId,
      branchId: payload.branchId,
      action: "remito_emitido",
      documentType: "remito_salida",
      documentId: remitoRef.id,
      actorId: actor.uid,
      actorEmail: actor.email,
      correlationId,
      metadata: {
        numeroRemito,
      },
    });
    tx.set(audit.ref, audit.data);

    return remitoData;
  }, { correlationId });

  return serializeRemito(result);
}

async function getRemitoById(id, ownerId, branchId) {
  const remito = await remitosRepo.getById(id);
  if (!remito) throw new ApiError(404, "DOCUMENT_NOT_FOUND", "Remito no encontrado");
  if (ownerId && remito.ownerId !== ownerId) throw new ApiError(403, "FORBIDDEN_OWNER_BRANCH", "Owner no autorizado");
  if (branchId && remito.branchId !== branchId) throw new ApiError(403, "FORBIDDEN_OWNER_BRANCH", "Branch no autorizado");
  return serializeRemito(remito);
}

module.exports = {
  emitirRemito,
  getRemitoById,
};
