const { z } = require("zod");
const { ApiError } = require("../utils/apiError");

const itemSchema = z.object({
  productId: z.string().min(1),
  cantidadEnviadaUnidadesBase: z.number().positive(),
  observacionesEnvio: z.string().optional(),
});

const schema = z.object({
  ownerId: z.string().min(1),
  branchId: z.string().min(1),
  pedidoInternoId: z.string().min(1).optional(),
  origen: z.string().min(1),
  destino: z.string().min(1),
  transportista: z.string().min(1),
  vehiculo: z.string().optional(),
  items: z.array(itemSchema).min(1),
  metadata: z.record(z.string(), z.string()).optional(),
});

function validateRemitoPayload(payload) {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "Payload invalido para emision de remito", parsed.error.flatten());
  }
  return parsed.data;
}

module.exports = {
  validateRemitoPayload,
};
