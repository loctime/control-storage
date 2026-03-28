# Sistema de Emails / Alertas / RSV — Documentación Backend

> Generado el 2026-03-28. Basado en lectura directa del código fuente.

---

## 1. Mapa de Archivos

| Archivo | Propósito |
|---|---|
| `src/routes/email-receptor.js` | Endpoint `POST /api/email-local-ingest`: punto de entrada de emails desde PowerShell/Outlook |
| `src/routes/emailAlerts.js` | Endpoints de gestión de alertas diarias: pendientes, marcar enviadas, métricas, historial |
| `src/routes/adminOperations.js` | Endpoints CRUD de operaciones sobre `vehicles/{plate}` (agrupación por campo `operacion`) |
| `src/modules/emailAlerts/emailAlerts.routes.js` | Router: monta los 4 endpoints `my-alerts`, `my-alerts-vehicles`, `my-stats`, `my-risk` |
| `src/modules/emailAlerts/emailAlerts.controller.js` | Handlers para los 4 endpoints anteriores; valida acceso con `getMe()` antes de cada llamada |
| `src/modules/emailAlerts/emailAlerts.service.js` | Lógica de negocio: paginación de alertas, estadísticas, riesgo por vehículo |
| `src/modules/emailAlerts/vehicles.routes.js` | Endpoint `GET /api/vehicles/events`: consulta de eventos con filtros de fecha, patente y tipo |
| `src/modules/emailUsers/emailUsers.routes.js` | Router: monta `ensure-user`, `me`, `my-vehicles`, `vehicles/my-vehicles` |
| `src/modules/emailUsers/emailUsers.controller.js` | Handlers para gestión de usuarios del panel; separa autenticación local vs Firebase |
| `src/modules/emailUsers/emailUsers.service.js` | `ensureUser`, `getMe`, `getMyVehicles`, `syncAccessUsers`; fuente de verdad del acceso |
| `src/services/vehicleEventParser.js` | Parsers determinísticos para los 3 formatos de email: excesos, no identificados, contacto |
| `src/services/vehicleEventService.js` | Persistencia de eventos, vehículos, dailyAlerts, monthlyHistory, metaDeltas, risk scoring |
| `src/services/email/emailTemplateBuilder.js` | Construcción de HTML para emails de alerta diaria (sujeto, cuerpo, cards por vehículo) |
| `src/shared/eventClassification.js` | `isSpeedExcessEvent()` y `normalizeEventTypeForSummary()`: clasificación unificada de eventos |
| `src/shared/normalizeEmail.js` | `normalizeEmail()` y `normalizeEmailArray()`: trim + lowercase + deduplicación |

---

## 2. Flujo de Datos: Email → Evento → Dashboard

```
[Outlook/PowerShell]
    │
    │  POST /api/email-local-ingest
    │  Header: x-local-token
    │  Body: { source: "outlook-local", email: { message_id, from, subject, body_text, ... } }
    ▼
[email-receptor.js]
    │
    ├─ Guarda email crudo en:
    │    apps/emails/inbox/{message_id}
    │
    ├─ Si subject no clasifica:
    │    apps/emails/unclassifiedEmails/{message_id}
    │
    ├─ Llama: parseVehicleEventsFromEmail(subject, bodyText)
    │         └─ vehicleEventParser.js
    │              ├─ detectEmailType(subject)
    │              │    Patrones: "Excesos del día" | "No identificados del día" | "Contacto sin identificación del día"
    │              ├─ parseExcesos()       → regex: "120 Km/h DD/MM/YY HH:MM:SS PLACA - ubicación"
    │              ├─ parseNoIdentificados() → regex con "(razón)" al final
    │              ├─ parseContactoSinIdentificacion() → columnas separadas por 2+ espacios
    │              ├─ normalizarEvento()   → agrega eventCategory, eventSubtype, speedDelta, etc.
    │              └─ extractOperationFromBody() → busca "Operación: ..." en las primeras 15 líneas
    │
    ├─ Por cada evento: genera eventId determinístico
    │    SHA256(plate + "|" + eventTimestamp + "|" + rawLine).slice(0,32)
    │
    ├─ Si AUTO_CREATE_VEHICLES=true y dominio permitido:
    │    crea vehículo en apps/emails/vehicles/{plate}
    │
    ├─ saveVehicleEvents(events)
    │    apps/emails/vehicleEvents/{eventId}
    │    (skip si ya existe → deduplicación por eventId)
    │
    ├─ upsertVehicle(event)            [1 escritura por patente]
    │    apps/emails/vehicles/{plate}
    │    Actualiza: brand, model, lastLocation, lastSpeed, lastEventTimestamp,
    │               operacion, operationName, totalEvents, totalSpeedingEvents
    │
    ├─ upsertDailyAlertBatch(dateKey, plate, vehicle, eventSummaries)
    │    apps/emails/dailyAlerts/{YYYY-MM-DD}/vehicles/{plate}
    │    Agrupa eventos por incidentKey, calcula summary y riskScore
    │    Retorna: metaDeltas
    │
    ├─ upsertMonthlyHistoryBatch(dateKey, plate, vehicle, eventSummaries)
    │    apps/emails/monthlyHistory/{YYYY-MM}/vehicles/{plate}
    │
    └─ updateDailyMetaBatch(dateKey, deltas)
         apps/emails/dailyAlerts/{YYYY-MM-DD}/meta/meta
         Agrega: totalEvents, totalVehicles, totalExcesos, totalNoIdentificados,
                 totalContactos, totalCriticos, maxSpeedRecorded, etc.


[Script PowerShell — envío de alertas]
    │
    │  GET /api/email/get-pending-daily-alerts
    │  Header: x-local-token
    ▼
[emailAlerts.js]
    │
    ├─ getLastNDaysDateKeysArgentina(5) → últimos 5 días (hoy NO incluido)
    ├─ getPendingAlertsForDateKey(dateKey) → alertSent !== true
    ├─ Enriquece con responsables y operationName desde apps/emails/vehicles
    ├─ groupAlertsByResponsableSet() → agrupa por conjunto exacto de emails
    ├─ buildConsolidatedBody() / buildConsolidatedSubject()  ← emailTemplateBuilder.js
    └─ Respuesta: [{ responsableEmails, subject, body, alertIds }]
                  + general: { to, cc, reportRecipients, subject, body }

    │
    │  POST /api/email/mark-alert-sent
    │  Body: { alertIds: ["YYYY-MM-DD_PLATE", ...] }
    ▼
    ├─ batch.update: alertSent=true, sentAt en dailyAlerts/{dateKey}/vehicles/{plate}
    └─ batch.set: apps/emails/responsables/{encodeEmail}/alerts/{encodeAlertId}
                  { alertSent: true }


[Panel Web — usuario autenticado]
    │
    │  GET /api/email/my-alerts  (Firebase Auth)
    ▼
[emailAlerts.service.js]
    └─ Lee: apps/emails/responsables/{email}/alerts  (paginado, ordenado por createdAt desc)
```

---

## 3. Colecciones Firestore

### `apps/emails/inbox/{messageId}`
**Escrita por:** `email-receptor.js`
**Leída por:** nadie en el código (debug manual)
**Contiene:** email crudo completo + preview (200 chars) + `unparsedSummary` si hubo líneas no parseadas

### `apps/emails/unclassifiedEmails/{messageId}`
**Escrita por:** `email-receptor.js` cuando `detectEmailType(subject)` devuelve `null`
**Leída por:** nadie en el código
**Contiene:** `subject`, `from`, `preview` (500 chars), `receivedAt`, `messageId`

### `apps/emails/vehicleEvents/{eventId}`
**Escrita por:** `vehicleEventService.saveVehicleEvents()`
**Leída por:** nadie directamente en el código listado (⚠️ verificar si hay algún dashboard que la lee)
**Contiene:** evento individual con deduplicación por `eventId` (SHA256); campos: `plate`, `type`, `eventSubtype`, `eventCategory`, `eventTimestamp`, `dateKey`, `speed`, `incidentKey`, `driverName`, `keyId`, `severity`, `vehicleRegistered`, `messageId`, `source`

### `apps/emails/vehicles/{plate}`
**Escrita por:** `email-receptor.js` → `vehicleEventService.upsertVehicle()` / `createVehicleFromEvent()`; `adminOperations.js` (PUT/DELETE operaciones y patentes); scripts `scripts/emails/`
**Leída por:** `emailAlerts.js`, `emailUsers.service.js`, `emailAlerts.service.js`, `adminOperations.js`
**Schema:**
```
plate:                  string   (normalizado: sin espacios/guiones, MAYÚSCULAS)
brand:                  string
model:                  string
lastLocation:           string
lastSpeed:              number | null
lastEventTimestamp:     string (ISO)
totalEvents:            number
totalSpeedingEvents:    number
operacion:              string   (= operationName; redundante por compatibilidad)
operationName:          string   (mismo valor que operacion)
responsables:           string[] (emails en formato original, pueden tener mayúsculas)
responsablesNormalized: string[] (trim + lowercase + deduplicado)
createdAt:              Timestamp
updatedAt:              Timestamp
```

### `apps/emails/dailyAlerts/{YYYY-MM-DD}/vehicles/{plate}`
**Escrita por:** `vehicleEventService.upsertDailyAlertBatch()`; `emailAlerts.markAlertsAsSentBatch()`
**Leída por:** `emailAlerts.js` (pendientes, métricas, consistency); `vehicles.routes.js`
**Schema:**
```
plate:                  string
dateKey:                string (YYYY-MM-DD)
operacion:              string
operationName:          string
responsables:           string[]
responsablesNormalized: string[]
events:                 EventSummary[]  (max RSV_V2_MAX_DAILY_EVENTS_STORED, default 250)
summary:                { excesos, no_identificados, contactos, llave_sin_cargar, conductor_inactivo }
incidentSummary:        object
riskScore:              number
alertSent:              boolean
sentAt:                 Timestamp | null
eventCount:             number
storedEventsCount:      number
eventsTruncated:        boolean
```

### `apps/emails/dailyAlerts/{YYYY-MM-DD}/meta/meta`
**Escrita por:** `vehicleEventService.updateDailyMetaBatch()`
**Leída por:** `emailAlerts.js` (daily-metrics, daily-consistency)
**Schema:**
```
totalEvents:                     number
totalVehicles:                   number
totalExcesos:                    number
totalNoIdentificados:            number
totalContactos:                  number
totalLlaveSinCargar:             number
totalConductorInactivo:          number
totalCriticos:                   number
totalAdvertencias:               number
totalAdministrativos:            number
vehiclesWithCritical:            number
totalUniqueIncidents:            number
totalUniqueOperationalIncidents: number
totalUniqueTechnicalIncidents:   number
totalSpeedIncidents:             number
vehiclesWithSpeeding:            number
driversWithSpeeding:             number
maxSpeedRecorded:                number
```

### `apps/emails/monthlyHistory/{YYYY-MM}/vehicles/{plate}`
**Escrita por:** `vehicleEventService.upsertMonthlyHistoryBatch()`
**Leída por:** `emailAlerts.js` (endpoint `events-history`)
**Schema:** similar a `dailyAlerts/vehicles/{plate}` pero con `monthKey` en lugar de `dateKey`; `events` acumula con `arrayUnion`

### `apps/emails/responsables/{encodeURIComponent(email)}/alerts/{encodeURIComponent(dateKey_plate)}`
**Escrita por:** `emailAlerts.markAlertsAsSentBatch()`
**Leída por:** `emailAlerts.service.getMyAlertsPage()`, `getAllAlertsForStats()`, `getMyVehiclesWithRisk()`
**Contiene:** `alertSent: true` (índice invertido para búsquedas por responsable)
**Nota:** Las claves están codificadas con `encodeURIComponent` para ser IDs de documento válidos en Firestore

### `apps/emails/access/{normalizedEmail}`
**Escrita por:** `emailUsers.service.ensureUser()`, `syncAccessUsers()`; `adminOperations.isEmailAdmin()` solo lee
**Leída por:** `emailUsers.service.getMe()`, `adminOperations.isEmailAdmin()`
**Schema:**
```
email:    string (normalizado)
role:     "admin" | "general" | "report" | "responsable"
active:   boolean
enabled:  boolean
createdAt: Timestamp
updatedAt: Timestamp
```
**Nota:** `active` y `enabled` se mantienen alineados. `getMe()` acepta si `active === true || enabled === true`.

### `apps/emails/config/config`
**Escrita por:** manualmente / scripts
**Leída por:** `emailAlerts.getEmailConfig()`, `emailUsers.service.syncAccessUsers()`
**Contiene:** `generalRecipients: string[]`, `ccRecipients: string[]`, `reportRecipients: string[]`

---

## 4. Todos los Endpoints

### Autenticación por `x-local-token` (header `x-local-token: $LOCAL_EMAIL_TOKEN`)

| Método | Path | Descripción |
|---|---|---|
| `POST` | `/api/email-local-ingest` | Ingest de email desde PowerShell. Body: `{ source, email: { message_id, from, subject, body_text, ... } }` |
| `GET` | `/api/email/get-pending-daily-alerts` | Alertas pendientes de los últimos 5 días, agrupadas por conjunto de responsables. Incluye HTML listo para enviar |
| `POST` | `/api/email/mark-alert-sent` | Marca alertas como enviadas. Body: `{ alertIds: ["YYYY-MM-DD_PLATE"] }` o `{ alertId: string }` |
| `POST` | `/api/email/sync-access-users` | Sincroniza `apps/emails/access` desde vehicles + config. Crea, actualiza y deshabilita usuarios |
| `GET` | `/api/email/daily-metrics?date=YYYY-MM-DD` | Totales por tipo y severidad del día desde `meta/meta` |
| `GET` | `/api/email/daily-consistency?date=YYYY-MM-DD` | Sanity check: compara `meta.totalEvents` vs suma de `events.length` en vehicles |
| `GET` | `/api/email/debug-pending-alerts` | Debug: lista todos los dateKeys y estado de cada vehicle (alertSent) |
| `GET` | `/api/email/vehicles/events-history?months=6&plate=opt` | Historial de eventos desde `monthlyHistory`. `months` max 12 |
| `POST` | `/api/email/ensure-user` | Crea/actualiza usuario en `access/{email}`. Body: `{ email, role }` |

### Autenticación Firebase Auth (header `Authorization: Bearer <Firebase ID Token>`)

**Panel del responsable:**

| Método | Path | Descripción |
|---|---|---|
| `GET` | `/api/email/me` | Devuelve `{ email, role }` del usuario si está habilitado en `access` |
| `GET` | `/api/email/my-vehicles` | Vehículos visibles según role. Admin/general/report: todos. Responsable: filtrado por `responsablesNormalized` |
| `GET` | `/api/vehicles/my-vehicles` | Alias de `/api/email/my-vehicles` |
| `GET` | `/api/email/my-alerts?limit=50&startAfter=cursor` | Paginación de alertas desde el índice `responsables/{email}/alerts`. Orden: `createdAt` desc |
| `GET` | `/api/email/my-alerts-vehicles` | Vehículos del responsable enriquecidos con riskScore y lastEvent desde el índice de alertas |
| `GET` | `/api/email/my-stats` | Totales: `totalAlerts`, `alertsToday`, `alertsPending`, `alertsSent`, `maxRisk`, `avgRisk` |
| `GET` | `/api/email/my-risk` | Riesgo agrupado por patente: `[{ plate, alerts, maxRisk }]` ordenado por riesgo desc |
| `GET` | `/api/vehicles/events?dateFrom=&dateTo=&plate=&eventType=&limit=100&page=1` | Eventos desde `dailyAlerts/{dateKey}/vehicles`. Rango máx 31 días. `eventType` separado por comas |

**Panel de administración de operaciones (requiere `role === "admin"` en `apps/emails/access`):**

| Método | Path | Descripción |
|---|---|---|
| `GET` | `/api/admin/operations` | Lista operaciones agrupadas. Cada una incluye: `nombre`, `plates[]` (con `totalEvents`, `lastEventTimestamp`), `responsables[]` (union de `responsablesNormalized` de todos los vehicles del grupo) |
| `POST` | `/api/admin/operations` | Valida que el nombre no exista y no sea `SIN_ASIGNAR`. No escribe en Firestore. Body: `{ nombre, responsables? }` |
| `PUT` | `/api/admin/operations/:nombre` | Actualiza `responsables` y `responsablesNormalized` en todos los vehicles con ese `operacion`. Body: `{ responsables: [emails] }` |
| `DELETE` | `/api/admin/operations/:nombre` | Pasa todos los vehicles con ese `operacion` a `operacion: "SIN_ASIGNAR"` |
| `POST` | `/api/admin/operations/:nombre/plates` | Asigna un vehicle existente a una operación. Body: `{ plate }`. Falla con 404 si el vehicle no existe |
| `DELETE` | `/api/admin/operations/:nombre/plates/:plate` | Quita un vehicle de su operación → `SIN_ASIGNAR`. Falla con 400 si el vehicle pertenece a otra operación |

---

## 5. Mapa de Dependencias

```
email-receptor.js
    ├── ../services/vehicleEventParser        (parseVehicleEventsFromEmail, detectEmailType)
    └── ../services/vehicleEventService       (saveVehicleEvents, upsertVehicle, getVehicle,
                                               createVehicleFromEvent, upsertDailyAlertBatch,
                                               upsertMonthlyHistoryBatch, updateDailyMetaBatch,
                                               buildEventSummary, formatDateKey,
                                               generateDeterministicEventId, isFromAllowedDomain,
                                               normalizePlate)

emailAlerts.js
    ├── ../services/vehicleEventService       (formatDateKey, getVehicle, normalizePlate)
    ├── ../shared/normalizeEmail              (normalizeEmail, normalizeEmailArray)
    ├── ../services/dailyMetricsService       (getDailyTotalsByType)   ← ⚠️ no listado en la auditoría
    ├── ../modules/emailUsers/emailUsers.service  (syncAccessUsers)
    ├── ../utils/logger                       (logger)
    └── ../services/email/emailTemplateBuilder    (buildConsolidatedBody, buildConsolidatedSubject,
                                                   buildGeneralGroupsBody, buildGeneralSubjectLastDays,
                                                   buildGeneralSubjectSingleDate, buildMetaFromVehicleDocs,
                                                   sortVehiclesByCriticity)

adminOperations.js
    ├── ../firebaseAdmin
    └── ../shared/normalizeEmail              (normalizeEmailArray)

emailAlerts.controller.js
    ├── ./emailAlerts.service                 (getMyAlertsPage, getMyStats, getMyRiskByVehicle, getMyVehiclesWithRisk)
    └── ../emailUsers/emailUsers.service      (getMe)

emailAlerts.routes.js
    ├── ../../middleware/auth                 (authMiddleware)
    └── ./emailAlerts.controller

emailAlerts.service.js
    ├── ../../firebaseAdmin
    └── ../emailUsers/emailUsers.service      (normalizeEmail)

vehicles.routes.js
    ├── ../../middleware/auth                 (authMiddleware)
    └── ../../firebaseAdmin

emailUsers.controller.js
    └── ./emailUsers.service                 (ensureUser, getMe, getMyVehicles, normalizeEmail)

emailUsers.routes.js
    ├── ../../middleware/auth                 (authMiddleware)
    └── ./emailUsers.controller

emailUsers.service.js
    ├── ../../firebaseAdmin
    └── ../../shared/normalizeEmail           (normalizeEmail, normalizeEmailArray)

vehicleEventParser.js
    └── (sin dependencias externas del proyecto)

vehicleEventService.js
    ├── ../firebaseAdmin
    ├── ../shared/eventClassification         (isSpeedExcessEvent, normalizeEventTypeForSummary)
    └── ../shared/normalizeEmail              (normalizeEmail, normalizeEmailArray)

emailTemplateBuilder.js
    └── (sin dependencias externas del proyecto)

eventClassification.js
    └── (sin dependencias externas)

normalizeEmail.js
    └── (sin dependencias externas)
```

---

## 6. adminOperations.js — Integración con el resto del sistema

### Qué hace y qué no hace

`adminOperations.js` opera **exclusivamente** sobre `apps/emails/vehicles/{plate}`. No toca ninguna otra colección, no invoca ningún servicio del sistema de ingest ni de alertas.

### Autenticación propia

A diferencia de `emailAlerts.js` y `email-receptor.js` (que usan `x-local-token`), y de los módulos de usuario (que usan Firebase Auth con validación básica), `adminOperations.js` usa **Firebase Auth + chequeo de rol en Firestore**:

```
authMiddleware (en index.js) → verifica token Firebase → setea req.user.email
isEmailAdmin(req.user.email) → lee apps/emails/access/{email}
                             → verifica role === "admin" && enabled !== false && active !== false
```

El rol `"admin"` en `apps/emails/access` es el mismo que gestiona `emailUsers.service.js`. Para crear un admin, se usa `POST /api/email/ensure-user` con `role: "admin"` (requiere `x-local-token`).

### Invariantes que mantiene

| Campo actualizado | Siempre en conjunto con |
|---|---|
| `operacion` | `operationName` (mismo valor) |
| `responsables` | `responsablesNormalized` (`normalizeEmailArray(responsables)`) |

Esto es consistente con lo que hace `vehicleEventService.upsertVehicle()`.

### Lo que adminOperations.js no actualiza

- `dailyAlerts/{dateKey}/vehicles/{plate}` — los documentos de alerta **no** se actualizan cuando se cambia la operación o los responsables de un vehicle. El próximo ingest de email sobreescribirá esos campos en el daily alert con los valores actuales del vehicle.
- `responsables/{email}/alerts/` — el índice de alertas por responsable **no** se recalcula al cambiar responsables. Solo se actualiza cuando se llama a `mark-alert-sent`.
- `monthlyHistory` — ídem.

### Operación `POST /api/admin/operations` — sin persistencia

Esta operación solo valida que el nombre no exista y devuelve 201. No crea ningún documento en Firestore porque las operaciones no tienen existencia propia: existen en tanto algún vehicle tenga ese valor en el campo `operacion`. Para que la operación "exista", se debe asignar al menos una patente con `POST /api/admin/operations/:nombre/plates`.

### Valor reservado `SIN_ASIGNAR`

Es el valor por defecto cuando un vehicle no tiene operación asignada o cuando se quita de una. No puede usarse como nombre al crear una operación (`POST` devuelve 400). Vehicles que en Firestore tienen `operacion: null` o `operacion: ""` aparecen en el `GET` agrupados bajo `SIN_ASIGNAR`.

---

## Variables de Entorno Relevantes

| Variable | Descripción | Valor esperado |
|---|---|---|
| `LOCAL_EMAIL_TOKEN` | Token para endpoints con `x-local-token` | string secreto |
| `AUTO_CREATE_VEHICLES` | Permite crear vehicles automáticamente al ingestar | `"true"` / `"false"` |
| `AUTO_CREATE_ALLOWED_DOMAINS` | Dominios autorizados para auto-creación | CSV de dominios |
| `AUTO_CREATE_MAX_PER_EMAIL` | Máximo de vehicles a crear por email | número (default `50`) |
| `RSV_V2_PARSER_ENABLED` | Habilita parser V2 (allowSummaryFormat en no_identificados) | `"true"` |
| `RSV_V2_SPEED_EVENTS_ENABLED` | Habilita subtype `SPEED_EXCESS` en lugar de legacy | `"true"` |
| `RSV_V2_SPEED_GROUPING_ENABLED` | Agrupa eventos de velocidad en ventana de 180s | `"true"` |
| `RSV_V2_EVENT_MODEL_DUAL_WRITE` | Dual-write al modelo V2 en vehicleEvents | `"true"` |
| `RSV_V2_RISK_MODEL_ENABLED` | Habilita cálculo de riskScore | `"true"` |
| `RSV_V2_MAX_DAILY_EVENTS_STORED` | Máximo de eventos a guardar por vehicle/día | número (default `250`) |
| `RSV_V2_TEMPLATE_DETAILS_ENABLED` | Habilita detalles extra en el template HTML de alertas | `"true"` |
