# ControlFile – Truth Document (Single Source of Truth)

Este documento define las **verdades inmutables** del sistema ControlFile.

**ESTADO: CONGELADO**

Este documento está congelado y **NO se modifica** salvo:
1. Bug real detectado en código productivo
2. Contradicción con código productivo verificada
3. Decisión explícita del mantenedor

Si algo **no está definido aquí**, se considera:
- no soportado
- no implementado
- o explícitamente fuera de alcance

Este documento tiene prioridad sobre cualquier README, comentario o implementación parcial.

---

## 1. Propósito del sistema

ControlFile es la **infraestructura centralizada de gestión de archivos** para todo el ecosistema Control*.

Su función es:
- abstraer el storage real
- centralizar seguridad y permisos
- unificar flujos de subida, descarga y share
- eliminar lógica de archivos de las aplicaciones

Las apps **NO** gestionan:
- URLs presignadas
- CORS
- permisos públicos
- acceso directo al storage

---

## 2. Principio fundamental

> Un archivo no pertenece a una app.  
> Pertenece al sistema.

Las aplicaciones:
- crean referencias (`fileId`)
- solicitan accesos (`shareToken`)
- renderizan contenido

ControlFile:
- valida permisos
- decide cómo se accede
- protege el storage real
- expone archivos de forma segura

---

## 3. Componentes reales del sistema

### 3.1 Backend ControlFile
- Node.js + Express
- Autenticación: Firebase Admin SDK
- Base de datos: Firestore
- Storage: Backblaze B2 (S3-compatible)
- Deploy: Render

### 3.2 Frontend ControlFile
- Next.js 14
- Usado solo para UI administrativa
- No participa en flujos críticos de archivos

### 3.3 Storage
- Backblaze B2
- Ningún archivo es público directamente
- Acceso mediante:
  - URLs presignadas (temporales, expiran en 5min-1h)
  - Proxy backend (`GET /api/shares/{token}/image` para imágenes, stream directo desde B2)

### 3.4 Cloudflare Worker
- Opcional
- Solo puede actuar como proxy
- No define permisos
- No contiene lógica de seguridad
- La autoridad siempre es ControlFile backend

---

## 4. Modelo de datos definitivo (Firestore)

### 4.1 Colección `files`

Colección unificada para archivos y carpetas.  
Se diferencia por el campo `type`.

#### Archivo (`type: "file"`)

Campos obligatorios:
- `id`
- `userId`
- `name`
- `size`
- `mime`
- `bucketKey`
- `parentId`
- `path`
- `ancestors`
- `type = "file"`
- `createdAt`
- `updatedAt`
- `deletedAt`

Campos opcionales:
- `etag` (string, ETag de B2 para validación de integridad)

#### Carpeta (`type: "folder"`)

Campos obligatorios:
- `id`
- `userId`
- `name`
- `slug`
- `parentId`
- `path`
- `ancestors`
- `type = "folder"`
- `createdAt`
- `modifiedAt` (o `updatedAt`, ambos aceptados por el código)
- `deletedAt`

---

### 4.2 Colección `shares`

Documento indexado por `token`.

Campos obligatorios:
- `token`
- `fileId`
- `uid`
- `fileName`
- `fileSize`
- `mime`
- `isActive`
- `expiresAt` (nullable, si es null nunca expira)
- `createdAt`
- `downloadCount`

Campos opcionales:
- `virusScanned` (boolean, para escaneo de virus en shares)
- `revokedReason` (string, motivo de revocación)
- `revokedAt` (Timestamp, fecha de revocación)
- `lastDownloadAt` (Timestamp, última descarga)

Campos legacy (retrocompatibilidad):
- `isPublic` (boolean, legacy, retrocompatible con `isActive`)

---

### 4.3 Colección `users`

Campos obligatorios:
- `planQuotaBytes` (no `quotaBytes`, este es el campo real usado en código)
- `usedBytes`
- `pendingBytes` (bytes en uploads pendientes de confirmar)
- `planId`

---

### 4.4 Colección `uploadSessions`

Campos obligatorios:
- `uid`
- `bucketKey`
- `size`
- `name`
- `mime`
- `status` (valores: `'pending'`, `'uploaded'`, `'completed'`)
- `expiresAt`
- `createdAt`

Campos opcionales:
- `parentId` (nullable, carpeta padre donde se subirá el archivo)
- `uploadId` (string, para multipart uploads)
- `ancestors` (array de IDs de carpetas ancestras)
- `completedAt` (Timestamp, cuando `status = 'completed'`)

---

## 5. Reglas de acceso (verdad oficial)

### 5.1 Firestore Rules

```js
// Archivos y carpetas (colección unificada)
match /files/{fileId} {
  // READ público necesario para shares públicos vía Cloudflare Worker
  // El control de acceso real está en shares/{token} que valida expiración y estado
  // Los datos sensibles están en B2, no en Firestore
  allow read: if true;
  allow create: if isAuth() && request.resource.data.userId == uid();
  allow update, delete: if isAuth() && resource.data.userId == uid();
}

// LEGACY: Esta regla existe en firestore-rules/controlFile.rules pero NO se usa
// Las carpetas están en la colección 'files' con type="folder"
match /folders/{folderId} {
  allow create: if isAuth() && request.resource.data.userId == uid();
  allow read, update, delete: if isAuth() && resource.data.userId == uid();
}

// Sesiones de upload
match /uploadSessions/{sessionId} {
  allow create: if isAuth() && request.resource.data.uid == uid();
  allow read, update, delete: if isAuth() && resource.data.uid == uid();
}

// Shares (público para lectura, write para backend)
match /shares/{shareId} {
  allow read, write: if true;
}

// Usuarios
match /users/{userId} {
  allow create: if isAuth() && userId == uid();
  allow read, update, delete: if isAuth() && userId == uid();
}
```

---

## 6. Endpoints de Files

Todos los endpoints de files están en `/api/files`.  
Estos endpoints son core de ControlFile y no están pensados para uso directo por apps externas.

### 6.1 Endpoints protegidos (requieren autenticación)

- `POST /api/files/restore` - Restaurar archivo desde papelera
  - Body: `{ fileId }`
  - Valida: ownership (`userId == uid`), archivo existe, `deletedAt !== null`
  - Valida cuota: `usedBytes + fileData.size <= planQuotaBytes`
  - Actualiza: `files/{fileId}.deletedAt = null`, `files/{fileId}.updatedAt = now`
  - Actualiza cuota: `users/{uid}.usedBytes += fileData.size`
  - Retorna: `{ success: true, message }`

- `POST /api/files/permanent-delete` - Eliminar permanentemente archivo de papelera
  - Body: `{ fileId }`
  - Valida: ownership (`userId == uid`), archivo existe, `deletedAt !== null`
  - Elimina: objeto en B2 (`bucketKey`), documento en `files/{fileId}`
  - No actualiza cuota (archivo ya estaba en papelera, cuota ya fue decrementada)
  - Retorna: `{ success: true, message }`

- `POST /api/files/zip` - Descargar múltiples archivos como ZIP
  - Body: `{ fileIds: string[], zipName?: string }`
  - Valida: ownership (`userId == uid`), archivos existen, `deletedAt === null`, `type === "file"` (no carpetas)
  - Límite: máximo 200 archivos
  - Genera: ZIP stream desde B2 usando presigned URLs (expiración: 5 minutos)
  - Retorna: `application/zip` (stream directo)
  - Headers: `Content-Type: application/zip`, `Content-Disposition: attachment`

- `POST /api/files/empty-trash` - Eliminar permanentemente múltiples archivos de papelera
  - Body: `{ fileIds: string[] }`
  - Valida: ownership (`userId == uid`) para cada archivo
  - Elimina: objetos en B2 (`bucketKey`), documentos en `files/{fileId}` (batch)
  - Actualiza cuota: `users/{uid}.usedBytes -= sum(fileData.size)` (decrementa total)
  - Retorna: `{ success: true, deletedIds: string[], notFound: string[], unauthorized: string[] }`

---

## 7. Endpoints de Shares

Todos los endpoints de shares están en `/api/shares`.

### 7.1 Endpoints protegidos (requieren autenticación)

- `POST /api/shares/create` - Crear share
  - Body: `{ fileId, expiresIn? }` (expiresIn en horas, default: 24)
  - Retorna: `{ shareToken, shareUrl, expiresAt, fileName }`

- `POST /api/shares/revoke` - Revocar share
  - Body: `{ shareToken }`
  - Actualiza: `isActive = false`, `revokedAt = now`

- `GET /api/shares/` - Listar shares del usuario autenticado
  - Retorna: `{ shares: Array<{ token, fileName, fileSize, expiresAt, createdAt, downloadCount, shareUrl }> }`
  - Filtra: solo shares activos (`isActive = true`)

### 7.2 Endpoints públicos (sin autenticación)

- `GET /api/shares/{token}` - Obtener información de share
  - Retorna: `{ fileName, fileSize, mime, expiresAt, downloadCount }`
  - Valida: expiración, estado activo

- `POST /api/shares/{token}/download` - Descargar archivo compartido
  - Retorna: `{ downloadUrl, fileName, fileSize }`
  - Genera: presigned URL de B2 (expira en 5 minutos)
  - Valida: expiración, estado activo, bucketKey existe
  - Escanea virus: si está habilitado y es archivo sospechoso

- `GET /api/shares/{token}/image` - Proxy de imagen CORS-safe
  - **Proxy stream directo desde B2** (no presigned URL)
  - Headers CORS: `Access-Control-Allow-Origin: *`
  - Cache: `Cache-Control: public, max-age=3600`
  - Soporta: GET y HEAD requests
  - Valida: expiración, estado activo, bucketKey existe
  - Actualiza: `downloadCount` automáticamente
  - Uso: para `<img>` tags sin problemas de CORS

- `POST /api/shares/{token}/increment-counter` - Incrementar contador
  - Público, usado por Cloudflare Worker
  - Actualiza: `downloadCount`, `lastDownloadAt`
  - No valida share (Worker ya lo hizo)

---

## 8. Flujos críticos

### 8.1 Creación de share

```
Usuario autenticado → POST /api/shares/create
  ↓
Backend valida ownership del archivo
Backend genera token aleatorio (no predecible)
Backend crea documento en shares/{token}
Backend retorna shareToken y shareUrl
```

### 8.2 Acceso a share público

```
Público → GET /api/shares/{token}
  ↓
Backend valida:
  - Share existe
  - No expirado (expiresAt > now o null)
  - Activo (isActive !== false)
  ↓
Backend retorna metadatos del archivo
```

### 8.3 Descarga de archivo compartido

```
Público → POST /api/shares/{token}/download
  ↓
Backend valida share (expiración, estado)
Backend obtiene archivo desde files/{fileId}
Backend valida bucketKey existe
Backend escanea virus (si habilitado y sospechoso)
Backend genera presigned URL de B2 (5min)
Backend incrementa downloadCount
  ↓
Cliente → GET directo a B2 (presigned URL)
```

### 8.4 Proxy de imagen (CORS-safe)

```
Público → GET /api/shares/{token}/image
  ↓
Backend valida share (expiración, estado)
Backend obtiene archivo desde files/{fileId}
Backend valida bucketKey existe
Backend obtiene stream desde B2
Backend establece headers CORS
Backend incrementa downloadCount (async, no bloquea)
Backend stream archivo directamente al cliente
```

**Diferencia clave:** Este endpoint hace **stream directo desde B2**, no genera presigned URL. Esto permite headers CORS y evita problemas de CORS en `<img>` tags.
