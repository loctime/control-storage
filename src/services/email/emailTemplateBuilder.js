/**
 * HTML templates for daily fleet alerts.
 */

const ICONS = {
  vehicle: "\uD83D\uDE97",
  alert: "\u26A0",
  metrics: "\uD83D\uDCCA",
  speed: "\uD83D\uDCA8",
};

function isRsvV2TemplateDetailsEnabled() {
  return process.env.RSV_V2_TEMPLATE_DETAILS_ENABLED === "true";
}

function escapeHtml(text) {
  if (!text || typeof text !== "string") return "";
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

function formatDateTimeArgentina(timestamp) {
  if (!timestamp) return "-";
  try {
    if (timestamp && typeof timestamp.toDate === "function") {
      const date = timestamp.toDate();
      if (isNaN(date.getTime())) return "-";
      return date
        .toLocaleString("es-AR", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZone: "America/Argentina/Buenos_Aires",
        })
        .replace(/,/g, "");
    }

    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return "-";
    return date
      .toLocaleString("es-AR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "America/Argentina/Buenos_Aires",
      })
      .replace(/,/g, "");
  } catch {
    return "-";
  }
}

function buildExplanationText(eventSubtype, rawReason) {
  const explanation = getHumanExplanation(eventSubtype);
  const detail = typeof rawReason === "string" ? rawReason.trim() : "";
  if (explanation && detail) {
    return `${explanation} Detalle RSV: ${detail}`;
  }
  return explanation || detail || "";
}

function getHumanExplanation(eventSubtype) {
  switch (eventSubtype) {
    case "UNKNOWN_KEY":
      return "La llave utilizada no está registrada en el sistema RSV.";
    case "DRIVER_NOT_IDENTIFIED":
      return "El conductor no se identificó utilizando su llave RSV.";
    case "CONTACT_NO_DRIVER":
      return "El sistema detectó contacto con el vehículo sin que se identificara una llave o conductor registrado.";
    case "INACTIVE_DRIVER":
      return "La llave utilizada pertenece a un conductor inactivo en el sistema RSV.";
    case "NO_KEY_DETECTED":
      return "El vehículo circuló sin una llave de identificación detectada por el sistema RSV.";
    default:
      return "";
  }
}

function getTypeLabel(e) {
  if (e.eventCategory === "SPEEDING" || e.eventSubtype === "SPEED_EXCESS") return "Exceso de velocidad";

  switch (e.eventSubtype) {
    case "CONTACT_NO_DRIVER":
      return "Contacto sin identificacion";
    case "DRIVER_NOT_IDENTIFIED":
      return "No identificado";
    case "UNKNOWN_KEY":
      return "Llave no registrada";
    case "INACTIVE_DRIVER":
      return "Conductor inactivo";
    default:
      break;
  }

  switch (e.type) {
    case "contacto":
      return "Contacto sin identificacion";
    case "no_identificado":
      return "No identificado";
    case "llave_no_registrada":
      return "Llave no registrada";
    case "conductor_inactivo":
      return "Conductor inactivo";
    default:
      return "Evento";
  }
}

function getMetricsByTypeFromMeta(meta) {
  if (!meta) {
    return {
      excesos: 0,
      no_identificados: 0,
      contactos: 0,
      llave_sin_cargar: 0,
      conductor_inactivo: 0,
      totalSpeedIncidents: 0,
      maxSpeedRecorded: 0,
      vehiclesWithSpeeding: 0,
      driversWithSpeeding: 0,
    };
  }
  return {
    excesos: meta.totalExcesos ?? 0,
    no_identificados: meta.totalNoIdentificados ?? 0,
    contactos: meta.totalContactos ?? 0,
    llave_sin_cargar: meta.totalLlaveSinCargar ?? 0,
    conductor_inactivo: meta.totalConductorInactivo ?? 0,
    totalSpeedIncidents: meta.totalSpeedIncidents ?? 0,
    maxSpeedRecorded: meta.maxSpeedRecorded ?? 0,
    vehiclesWithSpeeding: meta.vehiclesWithSpeeding ?? 0,
    driversWithSpeeding: meta.driversWithSpeeding ?? 0,
  };
}

function buildMetaFromVehicleDocs(vehicleDocs) {
  if (!Array.isArray(vehicleDocs) || vehicleDocs.length === 0) {
    return {
      totalVehicles: 0,
      totalEvents: 0,
      vehiclesWithCritical: 0,
      totalExcesos: 0,
      totalNoIdentificados: 0,
      totalContactos: 0,
      totalLlaveSinCargar: 0,
      totalConductorInactivo: 0,
      totalUniqueIncidents: 0,
      totalUniqueOperationalIncidents: 0,
      totalUniqueTechnicalIncidents: 0,
      totalSpeedIncidents: 0,
      maxSpeedRecorded: 0,
      vehiclesWithSpeeding: 0,
      driversWithSpeeding: 0,
    };
  }

  let totalEvents = 0;
  let vehiclesWithCritical = 0;
  let totalUniqueIncidents = 0;
  let totalUniqueOperationalIncidents = 0;
  let totalUniqueTechnicalIncidents = 0;
  let totalSpeedIncidents = 0;
  let maxSpeedRecorded = 0;
  let vehiclesWithSpeeding = 0;
  const speedingDrivers = new Set();

  const byType = { excesos: 0, no_identificados: 0, contactos: 0, llave_sin_cargar: 0, conductor_inactivo: 0 };

  for (const doc of vehicleDocs) {
    const events = Array.isArray(doc.events) ? doc.events : [];
    const n = Number.isFinite(doc?.totalEventsCount) ? Number(doc.totalEventsCount) : events.length;
    totalEvents += n;
    if (n > 0) vehiclesWithCritical += 1;

    const s = doc.summary || {};
    byType.excesos += s.excesos ?? 0;
    byType.no_identificados += s.no_identificados ?? 0;
    byType.contactos += s.contactos ?? 0;
    byType.llave_sin_cargar += s.llave_sin_cargar ?? 0;
    byType.conductor_inactivo += s.conductor_inactivo ?? 0;

    const incidentSummary = doc.incidentSummary || {};
    totalUniqueIncidents += incidentSummary.totalUniqueIncidents ?? 0;
    totalUniqueOperationalIncidents += incidentSummary.uniqueOperationalIncidents ?? 0;
    totalUniqueTechnicalIncidents += incidentSummary.uniqueTechnicalIncidents ?? 0;

    const speedIncidents = Array.isArray(doc.speedIncidents) ? doc.speedIncidents : [];
    if (speedIncidents.length > 0) vehiclesWithSpeeding += 1;
    totalSpeedIncidents += speedIncidents.length;
    for (const si of speedIncidents) {
      maxSpeedRecorded = Math.max(maxSpeedRecorded, Number(si?.maxSpeed || 0));
      if (si?.driverName) speedingDrivers.add(si.driverName);
    }
  }

  return {
    totalVehicles: vehicleDocs.length,
    totalEvents,
    vehiclesWithCritical,
    totalExcesos: byType.excesos,
    totalNoIdentificados: byType.no_identificados,
    totalContactos: byType.contactos,
    totalLlaveSinCargar: byType.llave_sin_cargar,
    totalConductorInactivo: byType.conductor_inactivo,
    totalUniqueIncidents,
    totalUniqueOperationalIncidents,
    totalUniqueTechnicalIncidents,
    totalSpeedIncidents,
    maxSpeedRecorded,
    vehiclesWithSpeeding,
    driversWithSpeeding: speedingDrivers.size,
  };
}

function sortVehiclesByCriticity(docs) {
  if (!Array.isArray(docs) || docs.length <= 1) return docs;
  return [...docs].sort((a, b) => {
    const scoreA = typeof a.riskScore === "number" ? a.riskScore : 0;
    const scoreB = typeof b.riskScore === "number" ? b.riskScore : 0;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return (a.plate || a.id || "").toString().localeCompare((b.plate || b.id || "").toString());
  });
}

function buildGlobalSummaryHeader(meta, dateKey) {
  const totalVehicles = meta ? meta.totalVehicles ?? 0 : 0;
  const totalEvents = meta ? meta.totalEvents ?? 0 : 0;
  const vehiclesWithCritical = meta ? meta.vehiclesWithCritical ?? 0 : 0;
  const byType = getMetricsByTypeFromMeta(meta);

  return `
  <div style="background:#1f2937;color:#fff;padding:20px;border-radius:6px 6px 0 0;">
    <div style="font-size:20px;font-weight:600;">${ICONS.vehicle} Alertas de flota</div>
    <div style="font-size:13px;opacity:0.9;margin-top:4px;">Resumen diario - ${escapeHtml(dateKey)}</div>
  </div>
  <div style="background:#eff6ff;padding:16px;border:1px solid #bfdbfe;border-top:none;">
    <div style="font-size:14px;line-height:1.6;">
      <strong>Vehiculos con alertas:</strong> ${totalVehicles} &nbsp;|&nbsp;
      <strong>Total eventos:</strong> ${totalEvents}
      ${vehiclesWithCritical > 0 ? ` &nbsp;|&nbsp; <span style="color:#b91c1c;font-weight:600;">${ICONS.alert} Vehiculos con eventos: ${vehiclesWithCritical}</span>` : ""}
    </div>
    <div style="font-size:13px;margin-top:8px;color:#1e40af;">
      ${ICONS.speed} Incidentes de velocidad: ${byType.totalSpeedIncidents} | Maxima: ${byType.maxSpeedRecorded || 0} km/h | Vehiculos con exceso: ${byType.vehiclesWithSpeeding} | Conductores: ${byType.driversWithSpeeding}
    </div>
  </div>`;
}

function buildSpeedIncidentCards(doc) {
  const events = Array.isArray(doc.events) ? doc.events : [];
  const eventsById = new Map(
    events
      .filter((e) => e && e.eventId)
      .map((e) => [e.eventId, e]),
  );

  const speedIncidents = Array.isArray(doc.speedIncidents)
    ? [...doc.speedIncidents].sort((a, b) => new Date(b?.lastEventAt || 0) - new Date(a?.lastEventAt || 0))
    : [];
  if (speedIncidents.length === 0) return "";

  const cards = speedIncidents
    .map((incident) => {
      const causeSubtype = incident.causeSubtype || (incident.driverName ? null : "NO_KEY_DETECTED");
      const causeText = causeSubtype ? getHumanExplanation(causeSubtype) : "";
      const durationSeconds = incident.durationSeconds || 0;
      const durationMinutes = Math.round(durationSeconds / 60);
      const durationLabel =
        durationMinutes > 0
          ? `${durationMinutes} minutos`
          : `${durationSeconds} segundos`;
      const incidentEvents = Array.isArray(incident.eventIds)
        ? incident.eventIds
            .map((id) => eventsById.get(id))
            .filter((e) => e && e.eventTimestamp != null)
            .sort((a, b) => new Date(a.eventTimestamp) - new Date(b.eventTimestamp))
        : [];
      const incidentEventsHtml = incidentEvents.length
        ? `<div style="font-size:12px;margin-top:8px;"><strong>Eventos que componen el incidente:</strong>
        <ul style="margin:4px 0 0 18px;padding:0;">
          ${incidentEvents
            .map(
              (e) =>
                `<li style="margin:2px 0;">${escapeHtml(
                  e.speed != null ? `${e.speed} km/h` : "- km/h",
                )} – ${escapeHtml(formatDateTimeArgentina(e.eventTimestamp))}</li>`,
            )
            .join("")}
        </ul>
        </div>`
        : "";

      return `
      <div style="margin-top:10px;padding:10px;border:1px solid #fca5a5;border-radius:6px;background:#fff7ed;">
        <div style="font-size:13px;font-weight:700;color:#9a3412;">Exceso de velocidad constante detectado</div>
        <div style="font-size:12px;margin-top:6px;">Velocidad maxima: <strong>${incident.maxSpeed ?? "-"} km/h</strong></div>
        <div style="font-size:12px;">Cantidad de eventos: <strong>${incident.groupedEventsCount ?? 0}</strong></div>
        <div style="font-size:12px;">Duracion estimada: <strong>${durationLabel}</strong></div>
        ${incidentEventsHtml}
        <div style="font-size:12px;">Ubicacion: <strong>${escapeHtml(incident.location || "Sin ubicacion")}</strong></div>
        <div style="font-size:12px;">Conductor: <strong>${escapeHtml(incident.driverName || "No identificado")}</strong></div>
        ${causeText ? `<div style="font-size:12px;margin-top:6px;"><strong>Causa probable:</strong> ${escapeHtml(causeText)}</div>` : ""}
      </div>`;
    })
    .join("");

  return `<div style="margin-top:10px;">${cards}</div>`;
}

function buildVehicleSection(doc) {
  const { plate, brand, model, events, summary } = doc;
  const detailsEnabled = isRsvV2TemplateDetailsEnabled();

  if (!Array.isArray(events) || events.length === 0) {
    return `<div style="margin-top:16px;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
      <div style="background:#f9fafb;padding:10px 12px;font-weight:600;font-size:14px;">${ICONS.vehicle} ${escapeHtml(plate)}</div>
      <div style="padding:12px;font-size:13px;color:#6b7280;">Sin eventos.</div>
    </div>`;
  }

  const sortedEvents = events
    .filter((e) => e && e.eventTimestamp)
    .sort((a, b) => new Date(b.eventTimestamp) - new Date(a.eventTimestamp));

  const speedIncidents = Array.isArray(doc.speedIncidents) ? doc.speedIncidents : [];
  const incidentEventIds = new Set(
    speedIncidents.flatMap((incident) => (Array.isArray(incident?.eventIds) ? incident.eventIds : [])),
  );
  const tableEvents = sortedEvents;
  const displayedEventsCount = tableEvents.length + speedIncidents.length;
  const totalEventsCount = Number.isFinite(doc?.totalEventsCount) ? Number(doc.totalEventsCount) : displayedEventsCount;
  const storedEventsCount = Number.isFinite(doc?.storedEventsCount) ? Number(doc.storedEventsCount) : events.length;
  const headerCountLabel = doc?.eventsTruncated
    ? `${totalEventsCount} ${totalEventsCount === 1 ? "evento" : "eventos"} (mostrando ${storedEventsCount} recientes)`
    : `${totalEventsCount} ${totalEventsCount === 1 ? "evento" : "eventos"}`;

  const rowsHtml = tableEvents
    .map((e) => {
      const isInIncident = e && e.eventId && incidentEventIds.has(e.eventId);
      const typeLabel = `${getTypeLabel(e)}${isInIncident ? " ⚠" : ""}`;
      const explanationText = buildExplanationText(e.eventSubtype, e.reasonRaw || e.reason || null);
      return `
      <tr>
        <td style="padding:6px 8px;font-weight:600;font-size:12px;color:#b91c1c;">${escapeHtml(typeLabel)}</td>
        <td style="padding:6px 8px;font-size:12px;">${escapeHtml(e.driverName || "-")}</td>
        ${detailsEnabled ? `<td style="padding:6px 8px;font-size:12px;">${escapeHtml(e.keyId || "-")}</td>` : ""}
        <td style="padding:6px 8px;font-size:12px;">${e.speed != null ? `${e.speed} km/h` : "-"}</td>
        <td style="padding:6px 8px;font-size:12px;">${formatDateTimeArgentina(e.eventTimestamp)}</td>
        <td style="padding:6px 8px;font-size:12px;">${escapeHtml(e.locationRaw || e.location || "Sin ubicacion")}</td>
      </tr>
      ${explanationText ? `<tr><td colspan="${detailsEnabled ? 6 : 5}" style="padding:4px 8px 8px 8px;font-size:11px;color:#374151;">${escapeHtml(explanationText)}</td></tr>` : ""}`;
    })
    .join("");

  const summaryByType = summary || {};
  const typeSummaryParts = [];
  if (summaryByType.excesos > 0) typeSummaryParts.push(`Excesos: ${summaryByType.excesos}`);
  if (summaryByType.no_identificados > 0) typeSummaryParts.push(`No identificados: ${summaryByType.no_identificados}`);
  if (summaryByType.contactos > 0) typeSummaryParts.push(`Contactos: ${summaryByType.contactos}`);
  if (summaryByType.llave_sin_cargar > 0) typeSummaryParts.push(`Llave sin cargar: ${summaryByType.llave_sin_cargar}`);
  if (summaryByType.conductor_inactivo > 0) typeSummaryParts.push(`Conductor inactivo: ${summaryByType.conductor_inactivo}`);

  const speedCards = buildSpeedIncidentCards(doc);
  const tableHtml = tableEvents.length > 0
    ? `<table style="width:100%;border-collapse:collapse;font-size:12px;" cellpadding="0" cellspacing="0">
      <thead>
        <tr style="background:#f3f4f6;">
          <th style="padding:6px 8px;text-align:left;border-bottom:1px solid #e5e7eb;">Tipo</th>
          <th style="padding:6px 8px;text-align:left;border-bottom:1px solid #e5e7eb;">Conductor</th>
          ${detailsEnabled ? '<th style="padding:6px 8px;text-align:left;border-bottom:1px solid #e5e7eb;">Llave</th>' : ""}
          <th style="padding:6px 8px;text-align:left;border-bottom:1px solid #e5e7eb;">Velocidad</th>
          <th style="padding:6px 8px;text-align:left;border-bottom:1px solid #e5e7eb;">Fecha/Hora</th>
          <th style="padding:6px 8px;text-align:left;border-bottom:1px solid #e5e7eb;">Ubicacion</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>`
    : "";
  const vehicleName = [brand, model].filter(Boolean).join(" ");

  return `
  <div style="margin-top:20px;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
      <div style="background:#fafafa;padding:10px 12px;font-weight:600;font-size:14px;border-bottom:1px solid #e5e7eb;">
      ${ICONS.vehicle} ${escapeHtml(plate)}${vehicleName ? ` - ${escapeHtml(vehicleName)}` : ""}
      <span style="color:#b91c1c;margin-left:8px;font-size:13px;">${ICONS.alert} ${headerCountLabel}</span>
    </div>
    ${typeSummaryParts.length > 0 ? `<div style="font-size:11px;margin:8px;color:#4b5563;">${typeSummaryParts.join(" | ")}</div>` : ""}
    ${speedCards}
    ${tableHtml}
  </div>`;
}

function buildConsolidatedBody(meta, vehicleDocs, dateKey) {
  const sections = vehicleDocs.map((doc) => buildVehicleSection(doc)).join("");
  const today = new Date().toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Resumen diario de flota - ${escapeHtml(dateKey)}</title>
</head>
<body style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;padding:16px;background:#fff;color:#111;">
  ${buildGlobalSummaryHeader(meta, dateKey)}
  ${sections}
  <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;text-align:center;">
    <div style="font-size:13px;color:#374151;font-weight:600;">Sistema ControlDoc</div>
    <div style="font-size:12px;color:#6b7280;margin-top:4px;">Reporte automatico de eventos de flota</div>
    <div style="font-size:11px;color:#9ca3af;margin-top:6px;">Generado el ${today}</div>
  </div>
</body>
</html>`.trim();
}

function buildGeneralGroupsBody(groups, dateKey) {
  if (!Array.isArray(groups) || groups.length === 0) {
    return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>Resumen general - ${escapeHtml(dateKey)}</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;padding:20px;">
  <div style="text-align:center;padding:24px;"><h2 style="font-size:18px;color:#374151;">No hay alertas pendientes.</h2></div>
</body>
</html>`.trim();
  }

  const today = new Date().toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const sections = groups
    .map((group) => {
      const sortedDocs = sortVehiclesByCriticity(group.docs);
      const meta = buildMetaFromVehicleDocs(sortedDocs);
      const operationName = (sortedDocs[0]?.operationName || sortedDocs[0]?.operacion || "Operacion no asignada").toUpperCase();
      const responsablesText = (group.responsableEmails || []).join(", ");
      return `
      <div style="margin-top:24px;border-top:2px solid #1f2937;padding-top:12px;">
        <h2 style="margin:0;font-size:16px;color:#111;font-weight:600;">${ICONS.metrics} Operacion ${escapeHtml(operationName)}</h2>
        <div style="font-size:12px;color:#4b5563;margin:6px 0 12px 0;">
          Responsables: ${escapeHtml(responsablesText)}<br>
          Vehiculos con eventos: ${meta.totalVehicles} | Total eventos: ${meta.totalEvents}
        </div>
      </div>
      ${sortedDocs.map((doc) => buildVehicleSection(doc)).join("")}`.trim();
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Resumen general de operaciones - ${escapeHtml(dateKey)}</title>
</head>
<body style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;padding:20px;background:#fff;color:#111;">
  <div style="background:#1f2937;color:#fff;padding:20px;border-radius:6px 6px 0 0;">
    <div style="font-size:20px;font-weight:600;">${ICONS.metrics} Resumen general de operaciones</div>
    <div style="font-size:13px;opacity:0.9;margin-top:4px;">${escapeHtml(dateKey)}</div>
  </div>
  ${sections}
  <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;text-align:center;">
    <div style="font-size:13px;color:#374151;font-weight:600;">Sistema ControlDoc</div>
    <div style="font-size:12px;color:#6b7280;margin-top:4px;">Reporte automatico de eventos de flota</div>
    <div style="font-size:11px;color:#9ca3af;margin-top:6px;">Generado el ${today}</div>
  </div>
</body>
</html>`.trim();
}

function buildConsolidatedSubject(dateKey) {
  return `${ICONS.vehicle} Resumen diario de flota - ${dateKey}`;
}

function buildGeneralSubjectLastDays(days) {
  return `${ICONS.metrics} Resumen general de operaciones (ultimos ${days} dias)`;
}

function buildGeneralSubjectSingleDate(dateKey) {
  return `${ICONS.metrics} Resumen general de operaciones - ${dateKey}`;
}

module.exports = {
  buildConsolidatedBody,
  buildVehicleSection,
  buildGlobalSummaryHeader,
  buildGeneralGroupsBody,
  buildConsolidatedSubject,
  buildGeneralSubjectLastDays,
  buildGeneralSubjectSingleDate,
  buildMetaFromVehicleDocs,
  sortVehiclesByCriticity,
  getHumanExplanation,
};
