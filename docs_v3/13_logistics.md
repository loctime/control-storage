# ControlFile – Logistics (v2)

---

## Overview

The logistics domain manages supply chain documents for ControlAudit: remitos (delivery notes), recepciones (receptions), devoluciones (returns), and pedidos internos (internal orders).

**Prefix:** `/api/logistics/v2` ONLY — no `/v1/` path, versioned internally.

The domain uses a full module architecture (`controller/service/repository`) with `ownerId`/`branchId` access control.

---

## Authorization

All logistics endpoints require:
1. Firebase ID Token (`Authorization: Bearer ...`)
2. `ownerId` that matches the caller's access rights (checked via `assertOwnerBranchAccess`)
3. Optional `branchId` to scope to a specific branch

---

## Document Types

| Type | Spanish | Endpoint base | Firestore collection |
|---|---|---|---|
| Remito | Delivery note | `/api/logistics/v2/remitos-salida` | `apps/auditoria/owners/{ownerId}/logistics/remitos` |
| Recepcion | Reception | `/api/logistics/v2/recepciones` | `apps/auditoria/owners/{ownerId}/logistics/recepciones` |
| Devolucion | Return | `/api/logistics/v2/devoluciones` | `apps/auditoria/owners/{ownerId}/logistics/devoluciones` |
| Pedido Interno | Internal order | `/api/logistics/v2/pedidos-internos` | `apps/auditoria/owners/{ownerId}/logistics/pedidosInternos` |

---

## Unified Document List

### GET /api/logistics/v2/documentos

List all logistics documents across all types (remitos, recepciones, devoluciones) in a single paginated response.

**Auth:** Required
**Query parameters:**

| Param | Required | Description |
|---|---|---|
| `ownerId` | Yes | Owner identifier |
| `branchId` | No | Filter by branch |
| `tipo` | No | `"remito"` \| `"recepcion"` \| `"devolucion"` (all if omitted) |
| `estado` | No | Filter by document status |
| `from` | No | Start date filter (ISO date string) |
| `to` | No | End date filter (ISO date string) |
| `page` | No | Page number (default `1`) |
| `pageSize` | No | Items per page (default `50`, max `200`) |

**Response `200`:**
```json
{
  "items": [
    {
      "id": "docId",
      "tipo": "remito",
      "estado": "pendiente",
      "emitidoAt": "2026-03-20T10:00:00.000Z",
      ...
    }
  ],
  "total": 142
}
```

Items are sorted by date descending (uses `emitidoAt`, `recepcionAt`, `creadaAt`, or `createdAt` depending on type).

**Errors:** Uses `ApiError` format with `correlationId`:
```json
{
  "error": "VALIDATION_ERROR",
  "message": "ownerId es requerido",
  "correlationId": "req-abc123"
}
```

---

## Sub-Domain Routes

Each document type has its own set of CRUD endpoints under its prefix:

### Remitos Salida — `/api/logistics/v2/remitos-salida`

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | List remitos |
| `POST` | `/` | Create remito |
| `GET` | `/:id` | Get remito by ID |
| `PATCH` | `/:id` | Update remito |
| `DELETE` | `/:id` | Delete remito |

### Recepciones — `/api/logistics/v2/recepciones`

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | List recepciones |
| `POST` | `/` | Create recepcion |
| `GET` | `/:id` | Get recepcion by ID |
| `PATCH` | `/:id` | Update recepcion |
| `DELETE` | `/:id` | Delete recepcion |

### Devoluciones — `/api/logistics/v2/devoluciones`

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | List devoluciones |
| `POST` | `/` | Create devolucion |
| `GET` | `/:id` | Get devolucion by ID |
| `PATCH` | `/:id` | Update devolucion |
| `DELETE` | `/:id` | Delete devolucion |

### Pedidos Internos — `/api/logistics/v2/pedidos-internos`

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | List pedidos internos |
| `POST` | `/` | Create pedido interno |
| `GET` | `/:id` | Get pedido interno by ID |
| `PATCH` | `/:id` | Update pedido interno |
| `DELETE` | `/:id` | Delete pedido interno |

---

## Error Format

All logistics errors include a `correlationId` for distributed tracing:

```json
{
  "error": "NOT_FOUND",
  "message": "Remito no encontrado",
  "correlationId": "req-abc123"
}
```

Common error codes: `VALIDATION_ERROR`, `NOT_FOUND`, `FORBIDDEN`, `CONFLICT`, `INTERNAL_ERROR`

---

## Notes

- The `/api/logistics/v2` prefix is the only active version (v1 does not exist)
- All document operations are scoped to `ownerId` — cross-owner access is forbidden
- `branchId` is optional; omitting it may return all branches within the owner scope
