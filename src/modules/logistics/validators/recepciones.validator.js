const { z } = require("zod");
const { ApiError } = require("../utils/apiError");

const itemSchema = z.object({
  productId: z.string().min(1),
  cantidadRecibidaOk: z.number().min(0),
  cantidadFaltante: z.number().min(0),
  cantidadDanada: z.number().min(0),
  cantidadPendiente: z.number().min(0),
  cantidadDevuelta: z.number().min(0),
  estadoRecepcion: z.enum(["ok", "faltante", "danado", "rechazado", "pendiente", "devuelto", "mixto"]),
  comentario: z.string().optional(),
  motivo: z.string().optional(),
  evidenciaFileIds: z.array(z.string()).optional(),
});

const schema = z.object({
  ownerId: z.string().min(1),
  branchId: z.string().min(1),
  remitoSalidaId: z.string().min(1),
  recepcionadoPor: z.string().min(1),
  resultadoGlobal: z.enum(["total_ok", "parcial", "rechazada", "con_observaciones"]),
  observacionesGenerales: z.string().optional(),
  items: z.array(itemSchema).min(1),
});

function validateRecepcionPayload(payload) {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "Payload invalido para recepcion", parsed.error.flatten());
  }
  return parsed.data;
}

function assertRecepcionItemBalance(item, expectedSent) {
  const sum =
    Number(item.cantidadRecibidaOk || 0) +
    Number(item.cantidadFaltante || 0) +
    Number(item.cantidadDanada || 0) +
    Number(item.cantidadPendiente || 0) +
    Number(item.cantidadDevuelta || 0);

  if (sum !== expectedSent) {
    throw new ApiError(400, "VALIDATION_ERROR", "Balance de recepcion invalido", {
      productId: item.productId,
      expected: expectedSent,
      got: sum,
    });
  }
}

module.exports = {
  validateRecepcionPayload,
  assertRecepcionItemBalance,
};
