// Función unificada para clasificar eventos de velocidad
// Reemplaza a: isSpeedingEvent (vehicleEventService.js) + isSpeedExcessEvent (dashboard.js)
function isSpeedExcessEvent(event) {
  if (!event || typeof event !== "object") return false;

  return (
    // Categorías V2 (actuales)
    event.eventCategory === "SPEEDING" ||
    event.eventSubtype === "SPEED_EXCESS" ||

    // Categoría legacy (emails antiguos)
    event.eventCategory === "exceso_velocidad" ||

    // Type directo (persistido en Firestore)
    event.type === "exceso" ||

    // Marcadores de agrupación
    Boolean(event.groupedSpeedIncidentKey) ||

    // Evento con velocidad medida (aunque no tenga categoría)
    event.hasSpeed === true ||
    (event.type === "exceso" && typeof event.speed === "number")
  );
}

// Mapeo para summary - AHORA usa isSpeedExcessEvent
function normalizeEventTypeForSummary(event) {
  // ⚠️ CAMBIO: ahora recibe el objeto evento completo, no solo el type

  if (isSpeedExcessEvent(event)) {
    return "excesos";
  }

  // Resto de categorías (sin cambios)
  const typeMap = {
    no_identificado: "no_identificados",
    contacto: "contactos",
    llave_no_registrada: "llave_sin_cargar",
    sin_llave: "llave_sin_cargar",
    conductor_inactivo: "conductor_inactivo",
    CONTACT_NO_DRIVER: "contactos",
    DRIVER_NOT_IDENTIFIED: "no_identificados",
    UNKNOWN_KEY: "llave_sin_cargar",
    INACTIVE_DRIVER: "conductor_inactivo",
  };

  const eventType = event.type || "no_identificado";
  return typeMap[eventType] || "no_identificados";
}

module.exports = {
  isSpeedExcessEvent,
  normalizeEventTypeForSummary,
};
