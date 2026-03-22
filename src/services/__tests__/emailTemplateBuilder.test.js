const {
  buildVehicleSection,
  getHumanExplanation,
} = require("../email/emailTemplateBuilder");

describe("emailTemplateBuilder", () => {
  it("mantiene visible un exceso aislado cuando no hay incidente agrupado", () => {
    const html = buildVehicleSection({
      plate: "AG338XC",
      brand: "Nissan",
      model: "Frontier",
      events: [
        {
          eventId: "evt-1",
          type: "exceso",
          eventCategory: "SPEEDING",
          eventSubtype: "SPEED_EXCESS",
          speed: 145,
          eventTimestamp: "2026-03-12T05:19:33-03:00",
          locationRaw: "RP51",
          driverName: "RUIZ CESAR",
        },
      ],
      speedIncidents: [],
      summary: { excesos: 1 },
    });

    expect(html).toContain("Exceso de velocidad");
    expect(html).toContain("145 km/h");
  });

  it("usa totalEventsCount y aclara truncamiento en el encabezado", () => {
    const html = buildVehicleSection({
      plate: "AG338XC",
      brand: "Nissan",
      model: "Frontier",
      events: [
        {
          eventId: "evt-2",
          type: "no_identificado",
          eventSubtype: "DRIVER_NOT_IDENTIFIED",
          eventTimestamp: "2026-03-12T06:00:00-03:00",
          locationRaw: "Base",
        },
      ],
      speedIncidents: [],
      totalEventsCount: 240,
      storedEventsCount: 1,
      eventsTruncated: true,
      summary: { no_identificados: 240 },
    });

    expect(html).toContain("240 eventos (mostrando 1 recientes)");
  });

  it("usa una explicacion conservadora para contacto sin identificacion", () => {
    expect(getHumanExplanation("CONTACT_NO_DRIVER")).toBe(
      "El sistema detectó contacto con el vehículo sin que se identificara una llave o conductor registrado.",
    );
  });
});
