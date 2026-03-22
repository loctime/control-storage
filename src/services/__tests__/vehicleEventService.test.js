let dbMock;
const firebaseAdminPath = require.resolve("../../firebaseAdmin");

require.cache[firebaseAdminPath] = {
  id: firebaseAdminPath,
  filename: firebaseAdminPath,
  loaded: true,
  exports: {
    firestore: Object.assign(
      () => dbMock,
      {
        FieldValue: {
          serverTimestamp: () => "SERVER_TIMESTAMP",
          increment: (value) => ({ __increment: value }),
        },
      },
    ),
  },
};

const {
  generateDeterministicEventId,
  normalizePlate,
  isFromAllowedDomain,
  computeRiskScore,
  buildEventSummary,
  groupSpeedingIncidents,
  getSpeedSeverity,
  upsertDailyAlertBatch,
} = require("../vehicleEventService");

function createRef(path = []) {
  return {
    path,
    collection(name) {
      return createRef([...path, name]);
    },
    doc(name) {
      return createRef([...path, name]);
    },
  };
}

describe("vehicleEventService", () => {
  afterEach(() => {
    delete process.env.RSV_V2_RISK_MODEL_ENABLED;
    delete process.env.RSV_V2_SPEED_GROUPING_ENABLED;
    dbMock = null;
  });

  describe("generateDeterministicEventId", () => {
    it("genera id deterministico para mismos inputs", () => {
      const id1 = generateDeterministicEventId("AF999EF", "2026-02-04T19:27:54-03:00", "raw line");
      const id2 = generateDeterministicEventId("AF999EF", "2026-02-04T19:27:54-03:00", "raw line");
      expect(id1).toBe(id2);
      expect(id1).toMatch(/^[a-f0-9]{32}$/);
    });
  });

  describe("normalizePlate", () => {
    it("normaliza patente", () => {
      expect(normalizePlate("af 999 ef")).toBe("AF999EF");
      expect(normalizePlate("AB-123-CD")).toBe("AB123CD");
    });
  });

  describe("isFromAllowedDomain", () => {
    it("valida dominio permitido", () => {
      expect(isFromAllowedDomain("alerta@pluspetrol.com", "pluspetrol.com")).toBe(true);
      expect(isFromAllowedDomain("otro@gmail.com", "pluspetrol.com")).toBe(false);
    });
  });

  describe("getSpeedSeverity", () => {
    it("clasifica severidad por velocidad", () => {
      expect(getSpeedSeverity(100)).toBe("low");
      expect(getSpeedSeverity(120)).toBe("medium");
      expect(getSpeedSeverity(145)).toBe("high");
      expect(getSpeedSeverity(151)).toBe("critical");
    });
  });

  describe("groupSpeedingIncidents", () => {
    it("no crea incidente para un solo evento de velocidad", () => {
      process.env.RSV_V2_SPEED_GROUPING_ENABLED = "true";
      const events = [
        buildEventSummary({ plate: "AG338XC", eventCategory: "SPEEDING", eventSubtype: "SPEED_EXCESS", speed: 145, locationRaw: "RP51", eventTimestamp: "2026-03-12T05:19:33-03:00", rawLine: "a" }),
      ];

      const groups = groupSpeedingIncidents(events);
      expect(groups).toHaveLength(0);
    });

    it("agrupa eventos consecutivos dentro de 3 minutos", () => {
      process.env.RSV_V2_SPEED_GROUPING_ENABLED = "true";
      const events = [
        buildEventSummary({ plate: "AG338XC", eventCategory: "SPEEDING", eventSubtype: "SPEED_EXCESS", speed: 145, locationRaw: "RP51", eventTimestamp: "2026-03-12T05:19:33-03:00", rawLine: "a" }),
        buildEventSummary({ plate: "AG338XC", eventCategory: "SPEEDING", eventSubtype: "SPEED_EXCESS", speed: 144, locationRaw: "RP51", eventTimestamp: "2026-03-12T05:20:20-03:00", rawLine: "b" }),
        buildEventSummary({ plate: "AG338XC", eventCategory: "SPEEDING", eventSubtype: "SPEED_EXCESS", speed: 143, locationRaw: "RP51", eventTimestamp: "2026-03-12T05:21:50-03:00", rawLine: "c" }),
      ];

      const groups = groupSpeedingIncidents(events);
      expect(groups).toHaveLength(1);
      expect(groups[0].groupedEventsCount).toBe(3);
      expect(groups[0].maxSpeed).toBe(145);
      expect(groups[0].severity).toBe("high");
    });

    it("no crea incidentes separados cuando solo hay eventos aislados", () => {
      process.env.RSV_V2_SPEED_GROUPING_ENABLED = "true";
      const events = [
        buildEventSummary({ plate: "AG338XC", eventCategory: "SPEEDING", eventSubtype: "SPEED_EXCESS", speed: 130, locationRaw: "RP51", eventTimestamp: "2026-03-12T05:19:33-03:00", rawLine: "a" }),
        buildEventSummary({ plate: "AG338XC", eventCategory: "SPEEDING", eventSubtype: "SPEED_EXCESS", speed: 129, locationRaw: "RP51", eventTimestamp: "2026-03-12T05:25:40-03:00", rawLine: "b" }),
      ];

      const groups = groupSpeedingIncidents(events);
      expect(groups).toHaveLength(0);
    });

    it("prioriza causa NO_KEY_DETECTED en incidentes agrupados", () => {
      process.env.RSV_V2_SPEED_GROUPING_ENABLED = "true";
      const events = [
        buildEventSummary({ plate: "AG338XG", eventCategory: "SPEEDING", eventSubtype: "NO_KEY_DETECTED", speed: 119, locationRaw: "RP7", eventTimestamp: "2026-03-11T14:30:58-03:00", rawLine: "a" }),
        buildEventSummary({ plate: "AG338XG", eventCategory: "SPEEDING", eventSubtype: "SPEED_EXCESS", speed: 118, locationRaw: "RP7", eventTimestamp: "2026-03-11T14:31:40-03:00", rawLine: "b" }),
      ];

      const groups = groupSpeedingIncidents(events);
      expect(groups).toHaveLength(1);
      expect(groups[0].causeSubtype).toBe("NO_KEY_DETECTED");
    });
  });

  describe("computeRiskScore", () => {
    it("legacy: score por cantidad de eventos", () => {
      expect(computeRiskScore(null, [{}, {}])).toBe(2);
    });

    it("v2: prioriza velocidad por sobre eventos tecnicos", () => {
      process.env.RSV_V2_RISK_MODEL_ENABLED = "true";
      process.env.RSV_V2_SPEED_GROUPING_ENABLED = "true";

      const events = [
        buildEventSummary({ plate: "AG338XC", eventCategory: "SPEEDING", eventSubtype: "SPEED_EXCESS", speed: 151, locationRaw: "RP51", eventTimestamp: "2026-03-12T05:19:33-03:00", rawLine: "a" }),
        buildEventSummary({ plate: "AG338XC", eventCategory: "SPEEDING", eventSubtype: "SPEED_EXCESS", speed: 149, locationRaw: "RP51", eventTimestamp: "2026-03-12T05:20:00-03:00", rawLine: "b" }),
        buildEventSummary({ plate: "AG338XC", eventCategory: "DRIVER_IDENTIFICATION", eventSubtype: "CONTACT_NO_DRIVER", eventTimestamp: "2026-03-12T06:00:00-03:00", rawLine: "c" }),
      ];

      const score = computeRiskScore(null, events);
      expect(score).toBeGreaterThanOrEqual(10);
    });
  });

  describe("upsertDailyAlertBatch", () => {
    it("deduplica contra eventIdsSeen aunque el evento ya no este en events por truncamiento", async () => {
      const tx = {
        get: vi.fn(async () => ({
          exists: true,
          data: () => ({
            events: [],
            eventIdsSeen: ["evt-1"],
            summary: {
              excesos: 0,
              no_identificados: 0,
              contactos: 0,
              llave_sin_cargar: 0,
              conductor_inactivo: 0,
            },
            riskScore: 4,
            alertSent: false,
          }),
        })),
        set: vi.fn(),
      };

      dbMock = {
        collection: vi.fn(() => createRef(["apps"])),
        runTransaction: vi.fn(async (callback) => callback(tx)),
      };

      const result = await upsertDailyAlertBatch(
        "2026-03-12",
        "AG338XC",
        { brand: "Nissan", model: "Frontier", responsables: [] },
        [{
          eventId: "evt-1",
          plate: "AG338XC",
          type: "exceso",
          eventCategory: "SPEEDING",
          eventSubtype: "SPEED_EXCESS",
          speed: 145,
          eventTimestamp: "2026-03-12T05:19:33-03:00",
          locationRaw: "RP51",
        }],
      );

      expect(result.metaDeltas).toBe(null);
      expect(tx.set).toHaveBeenCalledTimes(1);
    });
  });
});
