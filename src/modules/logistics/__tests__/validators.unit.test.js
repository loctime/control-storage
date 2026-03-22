const { describe, it, expect } = require("vitest");
const { validateRemitoPayload } = require("../validators/remitos.validator");
const { validateRecepcionPayload, assertRecepcionItemBalance } = require("../validators/recepciones.validator");
const { validateDevolucionPayload } = require("../validators/devoluciones.validator");
const { validatePedidoInternoPayload } = require("../validators/pedidosInternos.validator");

describe("logistics validators", () => {
  it("valida remito payload correcto", () => {
    const payload = validateRemitoPayload({
      ownerId: "o1",
      branchId: "b1",
      origen: "Depo",
      destino: "Sucursal",
      transportista: "Juan",
      items: [{ productId: "p1", cantidadEnviadaUnidadesBase: 3 }],
    });
    expect(payload.items).toHaveLength(1);
  });

  it("balance de recepcion falla cuando no coincide", () => {
    expect(() =>
      assertRecepcionItemBalance(
        {
          productId: "p1",
          cantidadRecibidaOk: 1,
          cantidadFaltante: 0,
          cantidadDanada: 0,
          cantidadPendiente: 0,
          cantidadDevuelta: 0,
        },
        2
      )
    ).toThrow();
  });

  it("valida recepcion payload correcto", () => {
    const payload = validateRecepcionPayload({
      ownerId: "o1",
      branchId: "b1",
      remitoSalidaId: "r1",
      recepcionadoPor: "u1",
      resultadoGlobal: "total_ok",
      items: [
        {
          productId: "p1",
          cantidadRecibidaOk: 2,
          cantidadFaltante: 0,
          cantidadDanada: 0,
          cantidadPendiente: 0,
          cantidadDevuelta: 0,
          estadoRecepcion: "ok",
        },
      ],
    });
    expect(payload.items[0].productId).toBe("p1");
  });

  it("valida devolucion payload correcto", () => {
    const payload = validateDevolucionPayload({
      ownerId: "o1",
      branchId: "b1",
      remitoSalidaId: "r1",
      tipoDevolucion: "a_proveedor",
      motivoGeneral: "danado",
      creadaPor: "u1",
      destinoDevolucion: "Proveedor X",
      items: [{ productId: "p1", cantidad: 1, motivo: "rotura", accionEsperada: "cambiar" }],
    });
    expect(payload.tipoDevolucion).toBe("a_proveedor");
  });

  it("valida pedido interno payload correcto", () => {
    const payload = validatePedidoInternoPayload({
      ownerId: "o1",
      branchId: "b1",
      creadoPor: "u1",
      origen: "depo",
      items: [
        {
          id: "i1",
          productId: "p1",
          nombreSnapshot: "Prod",
          unidadBaseSnapshot: "u",
          stockMinimoSnapshot: 1,
          stockActualSnapshot: 2,
          cantidadSugerida: 3,
          cantidadFinalPedida: 3,
        },
      ],
    });
    expect(payload.items[0].cantidadFinalPedida).toBe(3);
  });
});
