const firebaseAdminPath = require.resolve("../../firebaseAdmin");

require.cache[firebaseAdminPath] = {
  id: firebaseAdminPath,
  filename: firebaseAdminPath,
  loaded: true,
  exports: {
    firestore: Object.assign(
      () => null,
      {
        FieldValue: {
          serverTimestamp: () => "SERVER_TIMESTAMP",
          increment: (value) => ({ __increment: value }),
        },
      },
    ),
  },
};

const { simulateAlertFromEmail } = require("../alertSimulationService");

describe("alertSimulationService", () => {
  afterEach(() => {
    delete process.env.RSV_V2_RISK_MODEL_ENABLED;
    delete process.env.RSV_V2_SPEED_GROUPING_ENABLED;
    delete process.env.RSV_V2_PARSER_ENABLED;
    delete process.env.RSV_V2_SPEED_EVENTS_ENABLED;
  });

  it("simula el pipeline en memoria y devuelve html reutilizando el template productivo", () => {
    process.env.RSV_V2_PARSER_ENABLED = "true";
    process.env.RSV_V2_SPEED_EVENTS_ENABLED = "true";
    process.env.RSV_V2_SPEED_GROUPING_ENABLED = "true";
    process.env.RSV_V2_RISK_MODEL_ENABLED = "true";

    const result = simulateAlertFromEmail({
      subject: "Excesos del dia",
      body: [
        "Operacion: Demo",
        "145 Km/h 12/03/26 08:10:00 AF123BC - SCANIA R450 JUAN PEREZ (ABC123) RN 9 KM 123",
        "148 Km/h 12/03/26 08:12:10 AF123BC - SCANIA R450 JUAN PEREZ (ABC123) RN 9 KM 123",
      ].join("\n"),
      receivedAt: "2026-03-13T09:00:00-03:00",
    });

    expect(result.detectedEmailType).toBe("excesos");
    expect(result.events).toHaveLength(2);
    expect(result.eventSummaries).toHaveLength(2);
    expect(result.speedIncidents).toHaveLength(1);
    expect(result.incidentSummary.totalSpeedIncidents).toBe(1);
    expect(result.riskScore).toBeGreaterThan(0);
    expect(result.emailHtml).toContain("AF123BC");
    expect(result.emailHtml).toContain("Exceso de velocidad detectado");
    expect(result.plateGrouping).toHaveLength(1);
  });
});
