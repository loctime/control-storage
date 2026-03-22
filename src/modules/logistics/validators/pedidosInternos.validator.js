const { z } = require("zod");
const { ApiError } = require("../utils/apiError");

const itemSchema = z.object({
  id: z.string().min(1),
  productId: z.string().min(1),
  nombreSnapshot: z.string().min(1),
  unidadBaseSnapshot: z.string().min(1),
  packSizeSnapshot: z.number().positive().optional(),
  stockMinimoSnapshot: z.number(),
  stockActualSnapshot: z.number(),
  cantidadSugerida: z.number(),
  cantidadAjustada: z.number().optional(),
  cantidadFinalPedida: z.number().positive(),
  observaciones: z.string().optional(),
});

const schema = z.object({
  ownerId: z.string().min(1),
  branchId: z.string().min(1),
  creadoPor: z.string().min(1),
  origen: z.string().min(1),
  destinoSugerido: z.string().optional(),
  observaciones: z.string().optional(),
  items: z.array(itemSchema).min(1),
});

function validatePedidoInternoPayload(payload) {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "Payload invalido para pedido interno", parsed.error.flatten());
  }
  return parsed.data;
}

module.exports = {
  validatePedidoInternoPayload,
};
