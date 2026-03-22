const admin = require("../../../firebaseAdmin");
const { ApiError } = require("../utils/apiError");
const { runFirestoreTransaction } = require("../utils/firestoreTx");
const { buildAuditLog } = require("../utils/audit");
const remitosRepo = require("../repositories/remitos.repository");
const recepcionesRepo = require("../repositories/recepciones.repository");
const devolucionesRepo = require("../repositories/devoluciones.repository");
const stockRepo = require("../repositories/stockMovements.repository");

function toISOStringSafe(value) {
  if (!value) return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return value;
}

function serializeDevolucion(doc) {
  return {
    ...doc,
    creadaAt: toISOStringSafe(doc.creadaAt),
  };
}

async function crearDevolucion({ payload, actor, correlationId }) {
  const now = new Date();

  const devolucion = await runFirestoreTransaction(async (tx) => {
    const remitoRef = remitosRepo.getByIdRef(payload.remitoSalidaId);
    const remitoSnap = await tx.get(remitoRef);
    if (!remitoSnap.exists) {
      throw new ApiError(404, "DOCUMENT_NOT_FOUND", "Remito no encontrado");
    }
    const remito = { id: remitoSnap.id, ...remitoSnap.data() };

    if (remito.ownerId !== payload.ownerId || remito.branchId !== payload.branchId) {
      throw new ApiError(403, "FORBIDDEN_OWNER_BRANCH", "El remito no pertenece a owner/branch indicados");
    }

    if (payload.recepcionRemitoId) {
      const recepcionRef = recepcionesRepo.getByIdRef(payload.recepcionRemitoId);
      const recepcionSnap = await tx.get(recepcionRef);
      if (!recepcionSnap.exists) {
        throw new ApiError(404, "DOCUMENT_NOT_FOUND", "Recepcion referenciada no encontrada");
      }
      const recepcion = { id: recepcionSnap.id, ...recepcionSnap.data() };
      if (recepcion.remitoSalidaId !== payload.remitoSalidaId) {
        throw new ApiError(400, "VALIDATION_ERROR", "La recepcion no corresponde al remito informado");
      }
    }

    const remitoItems = new Map((remito.itemsSnapshot || []).map((item) => [item.productId, item]));

    const devolucionRef = devolucionesRepo.getCollection().doc();
    const items = payload.items.map((item) => {
      const sent = remitoItems.get(item.productId);
      if (!sent) {
        throw new ApiError(400, "VALIDATION_ERROR", "Item de devolucion no corresponde a remito", {
          productId: item.productId,
        });
      }

      return {
        id: admin.firestore().collection("_").doc().id,
        productId: item.productId,
        nombreSnapshot: sent.nombreSnapshot,
        cantidad: item.cantidad,
        motivo: item.motivo,
        accionEsperada: item.accionEsperada,
      };
    });

    const devolucionData = {
      id: devolucionRef.id,
      ownerId: payload.ownerId,
      branchId: payload.branchId,
      remitoSalidaId: payload.remitoSalidaId,
      recepcionRemitoId: payload.recepcionRemitoId || null,
      estado: "abierta",
      tipoDevolucion: payload.tipoDevolucion,
      motivoGeneral: payload.motivoGeneral,
      creadaAt: now,
      creadaPor: payload.creadaPor,
      destinoDevolucion: payload.destinoDevolucion,
      items,
      pdfFileId: null,
      firmaEntregaFileId: null,
      firmaRecepcionProveedorFileId: null,
    };

    tx.set(devolucionRef, devolucionData);

    items.forEach((item) => {
      const movementRef = stockRepo.createMovementRef();
      const quantity = item.accionEsperada === "reingresar_stock" ? item.cantidad : -item.cantidad;
      tx.set(movementRef, {
        id: movementRef.id,
        ownerId: payload.ownerId,
        branchId: payload.branchId,
        productId: item.productId,
        movementType: "devolucion",
        quantity,
        sourceType: "devolucion_remito",
        sourceId: devolucionRef.id,
        remitoSalidaId: payload.remitoSalidaId,
        correlationId,
        createdAt: now,
        createdBy: actor.uid,
        metadata: {
          tipoDevolucion: payload.tipoDevolucion,
          accionEsperada: item.accionEsperada,
        },
      });
    });

    const audit = buildAuditLog({
      ownerId: payload.ownerId,
      branchId: payload.branchId,
      action: "devolucion_creada",
      documentType: "devolucion_remito",
      documentId: devolucionRef.id,
      actorId: actor.uid,
      actorEmail: actor.email,
      correlationId,
      metadata: {
        remitoSalidaId: payload.remitoSalidaId,
      },
    });
    tx.set(audit.ref, audit.data);

    return devolucionData;
  }, { correlationId });

  return serializeDevolucion(devolucion);
}

async function getDevolucionById(id, ownerId, branchId) {
  const devolucion = await devolucionesRepo.getById(id);
  if (!devolucion) throw new ApiError(404, "DOCUMENT_NOT_FOUND", "Devolucion no encontrada");
  if (ownerId && devolucion.ownerId !== ownerId) throw new ApiError(403, "FORBIDDEN_OWNER_BRANCH", "Owner no autorizado");
  if (branchId && devolucion.branchId !== branchId) throw new ApiError(403, "FORBIDDEN_OWNER_BRANCH", "Branch no autorizado");
  return serializeDevolucion(devolucion);
}

module.exports = {
  crearDevolucion,
  getDevolucionById,
};
