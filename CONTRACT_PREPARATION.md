# Preparación Backend para Contrato App ↔ ControlFile v1

## 📋 Resumen

Este documento describe los cambios preparatorios realizados en el backend para alinear el código con el **Contrato App ↔ ControlFile v1** sin cambiar el comportamiento actual.

**Estado**: ✅ Preparado (sin validaciones activas)  
**Compatibilidad**: ✅ Mantiene comportamiento legacy permisivo  
**Referencia**: `docs/docs_v2/03_CONTRATOS_TECNICOS/CONTRACT.md`

---

## 🎯 Objetivo

Preparar el backend para el contrato v1 **sin romper compatibilidad** con apps existentes. Solo se agregaron:

- ✅ Marcadores explícitos de código legacy
- ✅ Comentarios preparatorios en puntos de validación futuros
- ✅ Helpers preparatorios (stubs) para validaciones
- ✅ Identificación de campos legacy

---

## 📁 Archivos Modificados

### 1. `backend/src/routes/folders.js`

**Cambios realizados:**

- ✅ Header comentario indicando estado LEGACY PERMISIVO
- ✅ Marcadores `⚠️ PUNTO DE VALIDACIÓN FUTURA` en lugares críticos
- ✅ Comentarios `TODO` con instrucciones específicas
- ✅ Identificación de campo legacy `metadata.source`
- ✅ Documentación de endpoints con estado futuro

**Puntos de validación futuros identificados:**

1. **POST `/api/folders/create`** (línea ~49)
   - Validar que apps NO creen carpetas raíz (`parentId=null`)
   - Validar que apps solo creen subcarpetas dentro de su app root

2. **GET `/api/folders/root`** (línea ~551)
   - Validar que solo ControlFile UI pueda hacer pin en taskbar
   - Validar que solo ControlFile UI pueda crear carpetas raíz

3. **GET/POST `/api/folders`** (SDK compatibility)
   - Refactorizar para usar `ensureAppRootFolder()` cuando se implemente
   - Agregar detección de caller type

4. **`ensureRootFolder()` helper**
   - Agregar validación de caller type
   - No establecer `metadata.source` (campo legacy)

5. **`ensureFolderBySlug()` helper**
   - Validar que el parent pertenece a la app del caller
   - Eliminar hardcodeo de `source: 'navbar'`

---

### 2. `backend/src/services/contract-validators.js` (NUEVO)

**Helpers preparatorios creados:**

1. **`detectCallerType(req)`**
   - Determina si el caller es ControlFile UI o app externa
   - **Estado**: Stub (siempre retorna permisivo)

2. **`validateRootFolderCreation(req, parentId)`**
   - Valida si una app puede crear carpetas raíz
   - **Estado**: Stub (siempre permite)

3. **`validateSubfolderCreation(req, parentId)`**
   - Valida si una app puede crear subcarpetas dentro de un parent
   - **Estado**: Stub (siempre permite)

4. **`validateTaskbarPin(req)`**
   - Valida si una app puede auto-pinnear carpetas
   - **Estado**: Stub (siempre permite)

5. **`ensureAppRootFolder(uid, appId)`** (futuro)
   - Obtiene o crea el app root folder para una aplicación
   - **Estado**: No implementado (throw error)

6. **`folderBelongsToApp(folderId, appId)`**
   - Verifica si una carpeta pertenece a una app específica
   - **Estado**: Stub (siempre retorna false)

---

### 3. `backend/src/index.js`

**Cambios realizados:**

- ✅ Header comentario indicando estado LEGACY PERMISIVO

---

## ⚠️ Campos Legacy Identificados

### `metadata.source`

**Estado**: ⚠️ LEGACY - No tiene valor contractual

**Problemas:**
- No define UX (navbar vs taskbar)
- No define jerarquía
- No debe ser usado por apps según CONTRACT.md v1
- Se mantiene por compatibilidad pero será eliminado/redefinido en v2

**Ubicaciones marcadas:**
- `backend/src/routes/folders.js` línea ~11 (ALLOWED_SOURCES)
- `backend/src/routes/folders.js` línea ~17 (validateAndNormalizeSource)
- `backend/src/routes/folders.js` línea ~120 (uso en POST /create)
- `backend/src/routes/folders.js` línea ~342 (hardcodeo en ensureFolderBySlug)

---

## 🔍 Puntos de Validación Futuros

### Endpoints que necesitarán validaciones:

| Endpoint | Validación Futura | Estado Actual |
|----------|-------------------|--------------|
| `POST /api/folders/create` | ❌ Apps NO pueden crear `parentId=null` | ✅ Permisivo |
| `GET /api/folders/root` | ❌ Apps NO pueden crear raíz ni pin | ✅ Permisivo |
| `GET /api/folders` (SDK) | 🔄 Usar `ensureAppRootFolder()` | ✅ Permisivo |
| `POST /api/folders` (SDK) | 🔄 Usar `ensureAppRootFolder()` | ✅ Permisivo |

### Helpers que necesitarán cambios:

| Helper | Cambio Futuro | Estado Actual |
|--------|---------------|---------------|
| `ensureRootFolder()` | Validar caller type | ✅ Permisivo |
| `ensureFolderBySlug()` | Validar parent pertenece a app | ✅ Permisivo |

---

## 📝 Próximos Pasos (NO implementados todavía)

### Fase 1: Detección de Caller Type
- [ ] Implementar `detectCallerType()` basado en claims del token
- [ ] Agregar headers específicos para identificar ControlFile UI
- [ ] Documentar cómo las apps deben identificarse

### Fase 2: Validaciones de Contrato
- [ ] Activar `validateRootFolderCreation()` en POST `/create`
- [ ] Activar `validateSubfolderCreation()` en POST `/create`
- [ ] Activar `validateTaskbarPin()` en GET `/root`
- [ ] Implementar `ensureAppRootFolder()` para apps

### Fase 3: Nuevas APIs Contractuales
- [ ] Crear `POST /api/apps/:appId/root` (obligatorio para apps)
- [ ] Crear `GET /api/taskbar` (lectura de taskbar)
- [ ] Crear `POST /api/taskbar/pin` (pin explícito)
- [ ] Crear `POST /api/taskbar/unpin` (unpin explícito)

### Fase 4: Refactorización SDK
- [ ] Refactorizar `GET /api/folders` para usar `ensureAppRootFolder()`
- [ ] Refactorizar `POST /api/folders` para usar `ensureAppRootFolder()`
- [ ] Actualizar documentación SDK

### Fase 5: Eliminación de Legacy
- [ ] Eliminar o redefinir `metadata.source` en v2
- [ ] Deprecar endpoints legacy si es necesario
- [ ] Actualizar documentación de migración

---

## ✅ Compatibilidad Garantizada

**El comportamiento actual NO cambia:**

- ✅ Cualquier caller autenticado puede crear carpetas raíz
- ✅ Cualquier caller puede crear subcarpetas
- ✅ Cualquier caller puede hacer pin en taskbar
- ✅ Los helpers mantienen su funcionalidad actual
- ✅ Los endpoints responden igual que antes

**Los cambios son solo preparatorios:**

- ✅ Comentarios y marcadores NO afectan ejecución
- ✅ Helpers stubs siempre retornan permisivo
- ✅ TODOs son solo documentación para el futuro

---

## 📚 Referencias

- **Contrato v1**: `docs/docs_v2/03_CONTRATOS_TECNICOS/CONTRACT.md`
- **Helpers preparatorios**: `backend/src/services/contract-validators.js`
- **Endpoints modificados**: `backend/src/routes/folders.js`

---

## 🎯 Resultado

El backend está **preparado y alineado** con el contrato v1, pero mantiene el comportamiento legacy permisivo para no romper compatibilidad. Cuando se decida activar las validaciones, solo será necesario:

1. Implementar las funciones stub en `contract-validators.js`
2. Descomentar los bloques de validación marcados con `TODO`
3. Refactorizar los endpoints SDK para usar `ensureAppRootFolder()`

**Sin cambios funcionales hasta entonces.**
