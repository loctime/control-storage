const {
  detectEmailType,
  parseExcesos,
  parseNoIdentificados,
  parseContactoSinIdentificacion,
  parseVehicleEventsFromEmail,
  parseLine,
  EMAIL_TYPE_EXCESOS,
  EMAIL_TYPE_NO_IDENTIFICADOS,
  EMAIL_TYPE_CONTACTO,
} = require("../vehicleEventParser");

describe("vehicleEventParser - formatos reales", () => {
  afterEach(() => {
    delete process.env.RSV_V2_PARSER_ENABLED;
    delete process.env.RSV_V2_SPEED_EVENTS_ENABLED;
  });

  it("detecta tipo de email por subject", () => {
    expect(detectEmailType("Excesos del dia")).toBe(EMAIL_TYPE_EXCESOS);
    expect(detectEmailType("No identificados del dia")).toBe(EMAIL_TYPE_NO_IDENTIFICADOS);
    expect(detectEmailType("Contacto sin identificacion del dia.")).toBe(EMAIL_TYPE_CONTACTO);
  });

  it("parsea No identificados del dia y captura keyId cuando existe", () => {
    const body = `No identificados del dia
02/03/26 01:44:19 AG-628-GV - Ford Ranger (Llave sin cargar: 1F9C521)
02/03/26 07:27:42 AG-676-NJ - Ford Ranger (Llave sin cargar: 12EC248)
02/03/26 07:44:01 AF-999-DU - Renault Kangoo (No identificado)
02/03/26 18:08:24 AF-990-OE - Ford Ranger (No identificado)`;

    const events = parseNoIdentificados(body);
    expect(events).toHaveLength(4);
    expect(events[0].keyId).toBe("1F9C521");
    expect(events[1].keyId).toBe("12EC248");
    expect(events[2].type).toBe("no_identificado");
  });

  it("parsea Contacto sin identificacion del dia con columnas espaciadas", () => {
    const body = `Contacto sin identificacion del dia.
Marca    Modelo    Patente    Fecha
Toyota   Hilux     AG-572-HF   02-03-2026 09:02:01`;

    const events = parseContactoSinIdentificacion(body);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("contacto");
    expect(events[0].plateNormalized).toBe("AG572HF");
  });

  it("v2: parsea formato resumido sin timestamp usando fallback de ingesta", () => {
    process.env.RSV_V2_PARSER_ENABLED = "true";

    const subject = "No identificados del dia";
    const body = `AG-628-GV - Ford Ranger (Llave sin cargar: 12EC248)
AF-999-DS - Renault Kangoo (Conductor inactivo: BERRONDO, FRANCISCO)
AG-572-HF - Toyota Hilux (No identificado)`;

    const { events } = parseVehicleEventsFromEmail(subject, body, {
      parserV2Enabled: true,
      fallbackTimestamp: "2026-03-11T20:10:00-03:00",
    });

    expect(events).toHaveLength(3);
    expect(events[0].eventSubtype).toBe("UNKNOWN_KEY");
    expect(events[1].eventSubtype).toBe("INACTIVE_DRIVER");
    expect(events[1].driverName).toBe("BERRONDO, FRANCISCO");
    expect(events[2].eventSubtype).toBe("DRIVER_NOT_IDENTIFIED");
  });

  it("v2 speed: parsea lineas de excesos y extrae speed/driver/key/location", () => {
    process.env.RSV_V2_SPEED_EVENTS_ENABLED = "true";

    const body = `Excesos del dia
120 Km/h 12/03/26 05:19:33 AG-338-XC - Nissan Frontier RUIZ CESAR (12EBD08) RP51, RIO NEUQUEN`;
    const events = parseExcesos(body);

    expect(events).toHaveLength(1);
    expect(events[0].speed).toBe(120);
    expect(events[0].plateNormalized).toBe("AG338XC");
    expect(events[0].driverName).toBe("RUIZ CESAR");
    expect(events[0].keyId).toBe("12EBD08");
    expect(events[0].locationRaw).toContain("RP51");
  });

  it("v2 speed: SIN LLAVE marca subtipo sin llave detectada", () => {
    process.env.RSV_V2_SPEED_EVENTS_ENABLED = "true";

    const body = `Excesos del dia
119 Km/h 11/03/26 14:30:58 AG-338-XG - Nissan Frontier Desconocido (SIN LLAVE) RP7`;
    const { events } = parseVehicleEventsFromEmail("Excesos del dia", body);

    expect(events).toHaveLength(1);
    expect(events[0].eventCategory).toBe("SPEEDING");
    expect(events[0].eventSubtype).toBe("NO_KEY_DETECTED");
    expect(events[0].driverName).toBe(null);
    expect(events[0].keyId).toBe(null);
  });

  it("rechaza formatos de fecha y hora invalidos dentro del parser", () => {
    const badTime = parseLine("120 Km/h 12/03/26 5:19:33 AG-338-XC - Nissan Frontier RP51");
    const badDate = parseLine("120 Km/h 12-03-2026 05:19:33 AG-338-XC - Nissan Frontier RP51");

    expect(badTime).toBe(null);
    expect(badDate).toBe(null);
  });
});
