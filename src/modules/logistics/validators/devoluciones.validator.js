const { z } = require("zod");
const { ApiError } = require("../utils/apiError");

const itemSchema = z.object({
  productId: z.string().min(1),
  cantidad: z.number().positive(),
  motivo: z.string().min(1),
  accionEsperada: z.enum(["reponer", "cambiar", "aceptar_nota_credito", "descartar", "reingresar_stock"]),
});

const schema = z.object({
  ownerId: z.string().min(1),
  branchId: z.string().min(1),
  remitoSalidaId: z.string().min(1),
  recepcionRemitoId: z.string().min(1).optional(),
  tipoDevolucion: z.enum(["a_proveedor", "interna", "ajuste_stock", "reposicion_pendiente"]),
  motivoGeneral: z.string().min(1),
  creadaPor: z.string().min(1),
  destinoDevolucion: z.string().min(1),
  items: z.array(itemSchema).min(1),
});

function validateDevolucionPayload(payload) {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "Payload invalido para devolucion", parsed.error.flatten());
  }
  return parsed.data;
}

module.exports = {
  validateDevolucionPayload,
};
