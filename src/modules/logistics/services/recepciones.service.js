const admin = require("../../../firebaseAdmin");
const { ApiError } = require("../utils/apiError");
const { runFirestoreTransaction } = require("../utils/firestoreTx");
const { buildAuditLog } = require("../utils/audit");
const remitosRepo = require("../repositories/remitos.repository");
const recepcionesRepo = require("../repositories/recepciones.repository");
const stockRepo = require("../repositories/stockMovements.repository");
const { assertRecepcionItemBalance } = require("../validators/recepciones.validator");

function toISOStringSafe(value) {
  if (!value) return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return value;
}

function serializeRecepcion(doc) {
  return {
    ...doc,
    recepcionAt: toISOStringSafe(doc.recepcionAt),
  };
}

function hasIncident(item) {
  return (item.cantidadFaltante || 0) > 0 || (item.cantidadDanada || 0) > 0 || (item.cantidadPendiente || 0) > 0 || (item.cantidadDevuelta || 0) > 0;
}

async function confirmarRecepcion({ payload, actor, correlationId }) {
  const now = new Date();

  const recepcion = await runFirestoreTransaction(async (tx) => {
    const remitoRef = remitosRepo.getByIdRef(payload.remitoSalidaId);
    const remitoSnap = await tx.get(remitoRef);
    if (!remitoSnap.exists) {
      throw new ApiError(404, "DOCUMENT_NOT_FOUND", "Remito de salida no encontrado");
    }

    const remito = { id: remitoSnap.id, ...remitoSnap.data() };
    if (remito.ownerId !== payload.ownerId || remito.branchId !== payload.branchId) {
      throw new ApiError(403, "FORBIDDEN_OWNER_BRANCH", "El remito no pertenece a owner/branch indicados");
    }

    if (remito.estado === "anulado") {
      throw new ApiError(400, "INVALID_STATE_TRANSITION", "No se puede recepcionar un remito anulado");
    }

    const existingQuery = recepcionesRepo
      .getCollection()
      .where("ownerId", "==", payload.ownerId)
      .where("branchId", "==", payload.branchId)
      .where("remitoSalidaId", "==", payload.remitoSalidaId)
      .limit(1);

    const existingSnap = await tx.get(existingQuery);
    if (!existingSnap.empty) {
      throw new ApiError(409, "DOCUMENT_ALREADY_CONFIRMED", "La recepcion para este remito ya fue confirmada");
    }

    const sentByProduct = new Map((remito.itemsSnapshot || []).map((item) => [item.productId, item]));

    const items = payload.items.map((item) => {
      const sent = sentByProduct.get(item.productId);
      if (!sent) {
        throw new ApiError(400, "VALIDATION_ERROR", "Item de recepcion no corresponde a item enviado", {
          productId: item.productId,
        });
      }
      assertRecepcionItemBalance(item, Number(sent.cantidadEnviadaUnidadesBase || sent.cantidadEnviada || 0));
      return {
        id: admin.firestore().collection("_").doc().id,
        productId: item.productId,
        nombreSnapshot: sent.nombreSnapshot,
        cantidadEnviada: Number(sent.cantidadEnviadaUnidadesBase || sent.cantidadEnviada || 0),
        cantidadRecibidaOk: item.cantidadRecibidaOk,
        cantidadFaltante: item.cantidadFaltante,
        cantidadDanada: item.cantidadDanada,
        cantidadPendiente: item.cantidadPendiente,
        cantidadDevuelta: item.cantidadDevuelta,
        estadoRecepcion: item.estadoRecepcion,
        motivo: item.motivo || null,
        comentario: item.comentario || null,
        evidenciaFileIds: item.evidenciaFileIds || [],
      };
    });

    if (payload.resultadoGlobal === "total_ok" && items.some(hasIncident)) {
      throw new ApiError(400, "VALIDATION_ERROR", "resultadoGlobal total_ok no admite faltantes/danados/pendientes/devueltos");
    }

    const recepcionRef = recepcionesRepo.getCollection().doc();
    const recepcionData = {
      id: recepcionRef.id,
      ownerId: payload.ownerId,
      branchId: payload.branchId,
      remitoSalidaId: payload.remitoSalidaId,
      numeroRemitoSnapshot: remito.numeroRemito,
      estado: "confirmada",
      recepcionAt: now,
      recepcionadoPor: payload.recepcionadoPor,
      firmaReceptorFileId: null,
      evidenciasFileIds: [],
      resultadoGlobal: payload.resultadoGlobal,
      observacionesGenerales: payload.observacionesGenerales || null,
      items,
    };

    tx.set(recepcionRef, recepcionData);

    items.forEach((item) => {
      if (item.cantidadRecibidaOk > 0) {
        const moveRef = stockRepo.createMovementRef();
        tx.set(moveRef, {
          id: moveRef.id,
          ownerId: payload.ownerId,
          branchId: payload.branchId,
          productId: item.productId,
          movementType: "entrada_recepcion",
          quantity: item.cantidadRecibidaOk,
          sourceType: "recepcion_remito",
          sourceId: recepcionRef.id,
          remitoSalidaId: payload.remitoSalidaId,
          correlationId,
          createdAt: now,
          createdBy: actor.uid,
        });
      }

      if (item.cantidadDanada > 0 || item.cantidadDevuelta > 0) {
        const qty = Number(item.cantidadDanada || 0) + Number(item.cantidadDevuelta || 0);
        const moveRef = stockRepo.createMovementRef();
        tx.set(moveRef, {
          id: moveRef.id,
          ownerId: payload.ownerId,
          branchId: payload.branchId,
          productId: item.productId,
          movementType: "salida_incidente_recepcion",
          quantity: -qty,
          sourceType: "recepcion_remito",
          sourceId: recepcionRef.id,
          remitoSalidaId: payload.remitoSalidaId,
          correlationId,
          createdAt: now,
          createdBy: actor.uid,
        });
      }
    });

    tx.update(remitoRef, {
      estado: payload.resultadoGlobal === "total_ok" ? "cerrado" : "entregado",
      recepcionRemitoId: recepcionRef.id,
      updatedAt: now,
    });

    const audit = buildAuditLog({
      ownerId: payload.ownerId,
      branchId: payload.branchId,
      action: "recepcion_confirmada",
      documentType: "recepcion_remito",
      documentId: recepcionRef.id,
      actorId: actor.uid,
      actorEmail: actor.email,
      correlationId,
      metadata: {
        remitoSalidaId: payload.remitoSalidaId,
      },
    });
    tx.set(audit.ref, audit.data);

    return recepcionData;
  }, { correlationId });

  return serializeRecepcion(recepcion);
}

async function getRecepcionById(id, ownerId, branchId) {
  const recepcion = await recepcionesRepo.getById(id);
  if (!recepcion) throw new ApiError(404, "DOCUMENT_NOT_FOUND", "Recepcion no encontrada");
  if (ownerId && recepcion.ownerId !== ownerId) throw new ApiError(403, "FORBIDDEN_OWNER_BRANCH", "Owner no autorizado");
  if (branchId && recepcion.branchId !== branchId) throw new ApiError(403, "FORBIDDEN_OWNER_BRANCH", "Branch no autorizado");
  return serializeRecepcion(recepcion);
}

module.exports = {
  confirmarRecepcion,
  getRecepcionById,
};
