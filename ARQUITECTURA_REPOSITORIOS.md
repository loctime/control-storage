# 🏗️ Arquitectura Backend - Repositorios e Indexación

## ✅ Arquitectura Final Confirmada

Backend ControlFile es la **ÚNICA fuente de verdad** sobre:
- Estado del repositorio
- Indexación
- Disponibilidad del chat

---

## 📁 Storage del Índice

### ✅ Decisión Final

**El índice completo vive ÚNICAMENTE en filesystem del backend (Render).**

```
backend/indexes/
└── github__owner__repo/          # Nombre normalizado (github:owner:repo → github__owner__repo)
    ├── index.json                 # Índice completo (files, tree, contenido)
    ├── embeddings.json            # Embeddings vectoriales (futuro, opcional)
    └── metadata.json              # Metadata liviana (estado, stats, timestamps)
```

**❌ NO se guarda:**
- `index_data` completo en Firestore
- `index_data` completo en PostgreSQL/SQLite
- Ninguna base de datos contiene el índice completo

**✅ La base de datos (si se usa) solo almacena:**
- Estado (`idle` | `indexing` | `ready` | `error`)
- Timestamps (`indexedAt`, `createdAt`, `updatedAt`)
- Stats livianas (`totalFiles`, `totalSize`, `languages`, `extensions`)
- `branchSha` (para comparar cambios)

---

## 🔄 Comportamiento de Indexación

### Reindexación Condicional

**Un repositorio en estado `ready` NO se reindexa automáticamente.**

La reindexación solo ocurre si:
1. **Cambia el SHA del repo** (detección automática)
2. **Se solicita explícitamente** (`force=true`)

### Flujo de Indexación

```
POST /repositories/index
  ↓
Verificar estado actual
  ↓
Si status === 'indexing' → Retornar estado actual (200)
  ↓
Si status === 'ready' && !force:
  - Obtener SHA actual de GitHub
  - Comparar con SHA indexado
  - Si SHA no cambió → Retornar estado 'ready' (200)
  - Si SHA cambió → Continuar indexación
  ↓
Si status === 'idle' || SHA cambió || force === true:
  - Adquirir lock
  - Actualizar estado a 'indexing'
  - Iniciar indexación asíncrona (no bloquea)
  - Retornar inmediatamente (200)
  ↓
Indexación en background:
  - Indexar repositorio
  - Guardar índice completo en filesystem
  - Guardar metadata liviana
  - Actualizar estado a 'ready' o 'error'
  - Liberar lock
```

---

## 🔑 Tokens de GitHub

### `accessToken` es OPCIONAL

- **Repos públicos** → Sin token (`accessToken: null`)
- **Repos privados** → Con token (`accessToken: "ghp_..."`)

El indexador detecta automáticamente si necesita token:
- Repos públicos: Request sin `Authorization` header
- Si GitHub responde **401/403**, reintenta automáticamente con `process.env.GITHUB_TOKEN`

---

## 📊 Política de Persistencia

- ✅ **Los índices NO se borran** al cerrar sesión
- ✅ **Los índices NO se borran** al navegar
- ✅ **NO hay limpieza automática** por ahora
- ✅ **Los índices se consideran cache persistente** del backend

---

## 🔌 Endpoints

### POST /repositories/index

Inicia indexación de un repositorio.

**Request:**
```json
{
  "repositoryId": "github:owner:repo",  // OPCIONAL: se genera desde owner+repo
  "owner": "owner",                     // REQUERIDO si no hay repositoryId
  "repo": "repo",                       // REQUERIDO si no hay repositoryId
  "accessToken": "ghp_..." | null,     // OPCIONAL: para repos privados
  "uid": "firebase-user-id",            // REQUERIDO
  "branch": "main" | null,              // OPCIONAL: default branch si no se proporciona
  "force": false                        // OPCIONAL: fuerza reindexación aunque esté listo
}
```

**Response (200):**
```json
{
  "repositoryId": "github:owner:repo",
  "status": "indexing" | "ready",
  "message": "Indexación iniciada" | "Ya indexado y listo",
  "indexedAt": "2024-01-01T12:00:00Z" | null,
  "stats": { ... } | null
}
```

---

### GET /repositories/:repositoryId/status

Obtiene el estado actual del repositorio.

**IMPORTANTE: NUNCA devuelve 404**
- Si el repositorio no existe, retorna `status: "idle"`

**Response (200):**
```json
{
  "repositoryId": "github:owner:repo",
  "status": "idle" | "indexing" | "ready" | "error",
  "indexedAt": "2024-01-01T12:00:00Z" | null,
  "stats": {
    "totalFiles": 150,
    "totalSize": 1048576,
    "languages": { "TypeScript": 50, "JavaScript": 100 },
    "extensions": { ".ts": 50, ".js": 100 }
  } | null,
  "error": "Mensaje de error" | null  // Solo si status === 'error'
}
```

---

### POST /chat/query

Procesa una consulta sobre un repositorio indexado.

**Request:**
```json
{
  "repositoryId": "github:owner:repo",
  "question": "¿Cómo funciona la autenticación?",
  "conversationId": "conv-123"  // OPCIONAL: para contexto continuo
}
```

**Response exitosa (200):**
```json
{
  "response": "La autenticación funciona mediante...",
  "conversationId": "conv-123",
  "sources": [
    {
      "path": "src/auth.ts",
      "lines": [10, 25]
    }
  ]
}
```

**Response indexando (202):**
```json
{
  "status": "indexing",
  "message": "El repositorio aún se está indexando. Intenta de nuevo en unos momentos.",
  "estimatedTime": 30
}
```

**Response no listo (400):**
```json
{
  "status": "idle" | "error",
  "message": "El repositorio no ha sido indexado..."
}
```

---

## 🚫 Información que el Frontend NUNCA Recibe

El frontend **NUNCA** recibe:
- ❌ Tree completo del repositorio
- ❌ Contenido de archivos completos
- ❌ Rutas de filesystem del backend
- ❌ Estructura interna del índice
- ❌ Embeddings vectoriales
- ❌ Metadata pesada del índice

El frontend **SOLO** recibe:
- ✅ Estado del repositorio (`idle` | `indexing` | `ready` | `error`)
- ✅ Stats livianas (`totalFiles`, `totalSize`, `languages`)
- ✅ Respuestas del chat (texto + fuentes con paths y líneas)

---

## 📂 Estructura de Archivos

```
backend/src/
├── routes/
│   ├── repositories.js          # POST /repositories/index, GET /repositories/:id/status
│   └── chat.js                  # POST /chat/query
├── services/
│   ├── repository-store.js      # Almacenamiento en filesystem (abstracción)
│   ├── repository-indexer.js    # Lógica de indexación (GitHub API)
│   ├── repository-indexer-async.js  # Indexación asíncrona (orquestación)
│   └── chat-service.js          # Lógica del chat/query
├── utils/
│   └── repository-id.js         # Normalización y validación de IDs
└── index.js                     # Configuración de Express
```

---

## 🔍 Definición de Estados

```typescript
type RepositoryStatus = 'idle' | 'indexing' | 'ready' | 'error';
```

- **`idle`**: El repositorio no ha sido indexado (estado inicial)
- **`indexing`**: Indexación en progreso
- **`ready`**: Indexación completada, listo para chat
- **`error`**: Error durante la indexación

---

## ✅ Confirmación Final

- ✅ Índice completo SOLO en filesystem
- ✅ Metadata liviana separada del índice
- ✅ Frontend nunca recibe estructuras internas
- ✅ No hay compatibilidad con sistema anterior (rediseño limpio)
- ✅ Backend es la única fuente de verdad
- ✅ No hay fallback local ni lógica híbrida

---

**Última actualización:** 2024-01-XX  
**Versión:** 1.0.0  
**Estado:** ✅ Implementación Completa
