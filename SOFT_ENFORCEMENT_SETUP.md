# Soft Enforcement - Instrumentación Implementada

## ✅ Estado: Implementado

La instrumentación de soft enforcement está completa para:
- ✅ POST `/api/folders/create`
- ✅ GET `/api/folders/root`
- ✅ `ensureRootFolder()` helper
- ✅ `ensureFolderBySlug()` helper

## 🔧 Configuración

### Feature Flags (Variables de Entorno)

Agregar al archivo `.env`:

```bash
# Soft enforcement: Instrumentación y logging (activar para recopilar métricas)
CONTRACT_SOFT_ENFORCEMENT_ENABLED=true

# Hard enforcement: Validaciones activas (TODAS apagadas por defecto)
CONTRACT_ENFORCEMENT_ENABLED=false
CONTRACT_VALIDATE_ROOT_FOLDERS=false
CONTRACT_VALIDATE_SUBFOLDERS=false
CONTRACT_VALIDATE_TASKBAR_PIN=false

# Whitelist de apps exentas (opcional, formato: app1,app2,app3)
CONTRACT_APP_WHITELIST=
```

### Activar Soft Enforcement

Para activar la instrumentación, establecer:
```bash
CONTRACT_SOFT_ENFORCEMENT_ENABLED=true
```

**Importante**: Con esta flag activada, el sistema:
- ✅ Registra todas las operaciones potencialmente violatorias
- ✅ Genera logs estructurados
- ✅ Recopila métricas en memoria
- ❌ NO bloquea ninguna operación
- ❌ NO devuelve errores 403
- ❌ NO cambia comportamiento existente

## 📊 Métricas Disponibles

Las métricas se recopilan en memoria y están disponibles mediante:

```javascript
const { getMetrics } = require('./services/contract-metrics');
const metrics = getMetrics();
```

### Estructura de Métricas

```javascript
{
  rootFolderCreations: {
    total: number,
    byCallerType: { CONTROLFILE_UI: number, APP: number, UNKNOWN: number },
    byAppId: { [appId]: number },
    byUserId: { [userId]: number },
    timestamps: Array<{ timestamp, callerType, appId, userId, folderId }>
  },
  subfolderCreations: {
    total: number,
    outsideAppRoot: number,
    byCallerType: { CONTROLFILE_UI: number, APP: number, UNKNOWN: number },
    byAppId: { [appId]: number },
    byUserId: { [userId]: number },
    timestamps: Array<{ timestamp, callerType, appId, userId, folderId, parentId, outsideAppRoot }>
  },
  taskbarPins: {
    total: number,
    byCallerType: { CONTROLFILE_UI: number, APP: number, UNKNOWN: number },
    byAppId: { [appId]: number },
    byUserId: { [userId]: number },
    timestamps: Array<{ timestamp, callerType, appId, userId, folderId }>
  },
  callerTypeDetections: {
    total: number,
    byMethod: { HEADER: number, CLAIMS: number, USER_AGENT: number, ORIGIN: number, FALLBACK: number },
    classifications: { CONTROLFILE_UI: number, APP: number, UNKNOWN: number }
  }
}
```

## 📝 Logs Estructurados

Los logs se generan con el siguiente formato:

### Violación Potencial: Creación de Carpeta Raíz
```json
{
  "event": "CONTRACT_VIOLATION_WARNING",
  "type": "ROOT_FOLDER_CREATION",
  "callerType": "APP" | "CONTROLFILE_UI" | "UNKNOWN",
  "appId": "string | null",
  "userId": "string",
  "endpoint": "POST /api/folders/create",
  "parentId": null,
  "folderName": "string",
  "detectionMethod": "HEADER" | "CLAIMS" | "USER_AGENT" | "ORIGIN" | "FALLBACK",
  "confidence": 0.0-1.0,
  "signals": ["HEADER_APP", "CLAIMS_APP_ID"],
  "timestamp": "ISO8601"
}
```

### Violación Potencial: Pin en Taskbar
```json
{
  "event": "CONTRACT_VIOLATION_WARNING",
  "type": "TASKBAR_PIN",
  "callerType": "APP" | "CONTROLFILE_UI" | "UNKNOWN",
  "appId": "string | null",
  "userId": "string",
  "endpoint": "GET /api/folders/root",
  "folderName": "string",
  "detectionMethod": "HEADER" | "CLAIMS" | "USER_AGENT" | "ORIGIN" | "FALLBACK",
  "confidence": 0.0-1.0,
  "signals": ["HEADER_APP"],
  "timestamp": "ISO8601"
}
```

## 🔍 Detección de Caller Type

El sistema usa estrategia multi-señal con prioridad:

1. **Header `X-ControlFile-Caller`** (más confiable, confidence: 0.95)
   - Valores: `ui`, `controlfile-ui`, `app`, `app:appId`
   
2. **Claims del token** (confidence: 0.85-0.90)
   - `req.claims.appId` o `req.claims.app_id`
   - `req.claims.controlfile_ui === true`
   
3. **User-Agent pattern matching** (confidence: 0.60)
   - Patrones: `controlfile`, `control-file`, `controldoc.*web`, `next.js`
   
4. **Origin domain matching** (confidence: 0.70)
   - Dominios: `controlfile.app`, `controlfile.com`, `controldoc.app`, `files.controldoc.app`, `localhost`
   
5. **Fallback** (confidence: 0.10)
   - Si no se detecta nada, marca como `UNKNOWN`

## 🎯 Próximos Pasos

1. **Activar soft enforcement** estableciendo `CONTRACT_SOFT_ENFORCEMENT_ENABLED=true`
2. **Recopilar métricas** durante 2-4 semanas
3. **Analizar logs** para identificar apps legacy
4. **Preparar dashboard** de métricas (opcional)
5. **Contactar desarrolladores** de apps legacy (opcional)
6. **Activar hard enforcement** cuando las métricas lo permitan

## 📚 Archivos Creados/Modificados

### Nuevos Archivos
- `backend/src/services/contract-feature-flags.js` - Sistema de feature flags
- `backend/src/services/contract-metrics.js` - Servicio de métricas
- `backend/SOFT_ENFORCEMENT_SETUP.md` - Esta documentación

### Archivos Modificados
- `backend/src/services/contract-validators.js` - `detectCallerType()` mejorado con multi-señal
- `backend/src/routes/folders.js` - Instrumentación agregada en endpoints y helpers

## ⚠️ Notas Importantes

- **No hay cambios de comportamiento**: El sistema funciona exactamente igual que antes
- **Solo instrumentación**: Se registran eventos pero no se bloquea nada
- **Métricas en memoria**: Para producción, considerar enviar a sistema externo (Prometheus, DataDog, etc.)
- **Logs estructurados**: Usan el logger existente, se pueden exportar a sistema de logs centralizado
