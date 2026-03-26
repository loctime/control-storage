# ControlFile – Internal & Debug Endpoints

---

## Overview

This document covers internal, administrative, and debug endpoints that are not part of the primary user-facing API.

---

## Upload Debug Endpoints

These endpoints exist in `routes/upload.js` and are intended for testing the upload pipeline.

### POST /api/uploads/test

Debug echo endpoint. Returns request metadata without performing any operation.

**Auth:** Required

**Response `200`:**
```json
{
  "message": "Test endpoint OK",
  "user": { "uid": "...", "email": "..." },
  "body": { ... },
  "headers": { ... }
}
```

---

### POST /api/uploads/test-no-auth

Debug echo endpoint. No authentication required. Returns request metadata.

**Auth:** None

**Response `200`:**
```json
{
  "message": "Test no-auth endpoint OK",
  "body": { ... },
  "headers": { ... }
}
```

> **Security note:** This endpoint is unauthenticated and returns request data. Do not deploy in production without gating behind environment flags.

---

## Proxy Upload

### POST /api/uploads/proxy-upload

Direct multipart upload where the file passes through the backend to B2. Alternative to the standard presign flow.

**Auth:** Required
**Content-Type:** `multipart/form-data`

**Form fields:**

| Field | Required | Description |
|---|---|---|
| `file` | Yes | File to upload |
| `parentId` | No | Target folder in `files` collection |

**Optional virus scanning:** If `CLOUDMERSIVE_API_KEY` env var is set, files are scanned before upload.

**Response `200`:**
```json
{ "fileId": "firestoreDocId" }
```

**Errors:** `400` no file · `401` · `413` virus detected · `500`

---

## Create-User Endpoint Disambiguation

There are three separate `create-user` implementations that produce the same effect but are different code paths:

| Path | Where | Notes |
|---|---|---|
| `POST /api/admin/create-user` | Express backend | Only accepts `appId: "auditoria"`. Returns `201` created or `200` reused. |
| `POST /api/admin/create-user` | Next.js API route | Thin proxy to Express backend |
| `POST /api/create-user` | Next.js API route | Separate route; accepts `role: "admin"` or `"maxdev"` |

All three create Firebase Auth users and set custom claims. None write Firestore.

---

## Health Endpoints

### GET /api/health (also /health and /v1/health)

Server health check. Triple-mounted.

**Auth:** None

**Response `200`:**
```json
{
  "status": "ok",
  "timestamp": "2026-03-20T10:00:00.000Z",
  "uptime": 3600.5
}
```

**HEAD /api/health** returns `200` with empty body. Used by load balancers.

---

## Superdev Endpoints

Documented in [07_endpoints_reference.md](./07_endpoints_reference.md) under "Superdev". Scoped to ControlAudit.

- `GET /api/superdev/list-owners` — list impersonatable owners
- `POST /api/superdev/impersonate` — generate custom token to sign in as owner

---

## Feedback System

Documented in [07_endpoints_reference.md](./07_endpoints_reference.md) under "Feedback".

- `POST /api/feedback` — submit feedback with screenshot
- `GET /api/feedback` — list feedback items
- `PATCH /api/feedback/:feedbackId` — update feedback status

Feedback is stored in the `feedback` Firestore collection.

---

## Cache Middleware

The `GET /api/files/list` endpoint uses a TanStack-compatible cache layer (`middleware/cache`). Cache is invalidated on:
- `POST /files/delete` → invalidates affected parent
- `POST /files/rename` → invalidates update
- `POST /files/empty-trash` → invalidates delete
- `POST /files/replace` → invalidates update
- File creation (`POST /uploads/confirm`, proxy-upload)

Cache is per-user and per-`parentId`. It is transparent to API consumers — the response format is identical.

---

## `.v2.ts` Files

Several route files have corresponding `.v2.ts` counterparts in the Next.js proxy layer. These are **empty re-exports** of the v1 routes with no actual v2 behavior:

```typescript
// Example: upload.v2.ts
export { POST, GET } from './upload'; // identical to v1
```

Do not expect different behavior from v2 paths — they are aliases.

---

## Environment-Gated Features

| Feature | Env variable | Effect if missing |
|---|---|---|
| Stripe billing | `STRIPE_SECRET_KEY` | `POST /billing/checkout` returns `500` |
| Virus scanning | `CLOUDMERSIVE_API_KEY` | Proxy upload skips scan, proceeds normally |
| Email token auth | `LOCAL_EMAIL_TOKEN` | All `/api/email/` endpoints return `500` |
| Platform owner access | `PLATFORM_OWNER_UID` | Only claim-based owner access works |
| External upload | Standard Firebase auth | No extra env needed |
