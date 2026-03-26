# Documentation Audit Report

**Date:** 2026-03-20
**Scope:** All documentation across `/docs`, `/docs/docs_v2`, `/docs_old`, root `API_REFERENCE.md`, `README.md`
**Outcome:** Generated clean v3 documentation in `/docs_v3`

---

## Files Audited

| Location | Files | Status |
|---|---|---|
| `/docs/docs_v2/TRUTH.md` | 1 | Authoritative – used as ground truth |
| `/docs/docs_v2/03_CONTRATOS_TECNICOS/` | 7 files | Mostly accurate, minor gaps |
| `/docs/docs_v2/04_FLUJOS_EJECUTABLES/` | 3 files | Accurate |
| `/docs/docs_v2/06_LEGACY_Y_EXCEPCIONES/` | 4 files | Accurate |
| `/docs/docs_v2/*.md` (misc) | 10+ files | Variable quality |
| `/docs/*.md` (legacy) | 12 files | Outdated, superseded |
| `/API_REFERENCE.md` (root) | 1 | Partially outdated |
| `/README.md` (root) | 1 | High-level only |

---

## Issues Found

### 1. DUPLICATE CONTENT (High Severity)

The same endpoint logic is described in at least 5 separate locations:
- `TRUTH.md §6–7`
- `03_CONTRATOS_TECNICOS/endpoints_files.md`
- `03_CONTRATOS_TECNICOS/endpoints_shares.md`
- `CONTROLFILESYSTEM.md`
- `docs/API_REFERENCE.md`
- root `API_REFERENCE.md`

**Fix:** Single authoritative endpoint reference in `docs_v3/07_endpoints_reference.md`.

---

### 2. LEGACY `folders` COLLECTION REFERENCES

Multiple documents mention a separate `folders` Firestore collection.
This collection exists in Firestore rules for backward compatibility but is **not used**.
All folders live in the unified `files` collection with `type: "folder"`.

**Affected files:**
- `docs/DATA_MODELS.md`
- `docs/API_REFERENCE.md`
- Several files in `docs_old/`

**Fix:** v3 docs never mention a `folders` collection as active. Only `files` exists.

---

### 3. INCONSISTENT FIELD NAMING

| Wrong name used | Correct name |
|---|---|
| `quotaBytes` | `planQuotaBytes` |
| `b2Key` | `bucketKey` |
| `objectKey` | `bucketKey` |
| `updatedAt` (folders) | `modifiedAt` (preferred; `updatedAt` also accepted) |

**Source:** `docs/DATA_MODELS.md`, several `docs_old/` files.

---

### 4. INCONSISTENT SHARE FIELD NAMING

Legacy docs describe `isPublic` as the primary field. Current code uses `isActive` as primary, with `isPublic` as a backward-compat read-only field.

**Rule:**
- **Read:** Accept both `isActive` and `isPublic`
- **Write:** Always write `isActive`. Never write `isPublic` in new code.

---

### 5. MISSING UPLOAD ENDPOINTS IN TRUTH.MD §6

`TRUTH.md §6` (endpoint list) does not include:
- `POST /api/uploads/presign`
- `POST /api/uploads/confirm`
- `POST /api/controlfile/upload`

These endpoints exist in code and in the executable flows section. The omission in §6 is an inconsistency in TRUTH.md itself.

**Fix:** v3 documents all three upload endpoints explicitly.

---

### 6. MISSING PROXY ROUTES IN NEXT.JS LAYER

Two backend endpoints have no corresponding Next.js proxy route:
- `POST /api/files/restore` — no proxy in `/app/api/files/restore/route.ts`
- `POST /api/files/permanent-delete` (files) — no proxy in `/app/api/files/permanent-delete/route.ts`
  (Note: `/app/api/folders/permanent-delete/route.ts` exists for folders)

**Fix:** Documented clearly in v3 as "backend-direct endpoints" (access via `BACKEND_URL/v1/...` or SDK).

---

### 7. ROUTE PREFIX INCONSISTENCY

Most endpoints proxy to `BACKEND_URL/v1/...`, but:
- `POST /api/users/initialize` → proxies to `BACKEND_URL/api/users/initialize` (no `/v1/`)
- `GET|PUT /api/users/profile` → proxies to `BACKEND_URL/api/users/profile` (no `/v1/`)

**Fix:** Documented in v3 with explicit backend target paths.

---

### 8. SUPERDEV ENDPOINTS ARE AUDITORIA-SPECIFIC

`/api/superdev/list-owners` and `/api/superdev/impersonate` query `apps/auditoria/owners` collection — making them ControlAudit-specific despite being in the shared backend. This is not documented anywhere as a limitation.

**Fix:** v3 marks these endpoints as "ControlAudit-scoped" and explains the constraint.

---

### 9. MISSING GET /api/shares/ PROXY ROUTE

`GET /api/shares/` (list user's shares) is documented in TRUTH.md and endpoint contracts, but no corresponding Next.js proxy route file was found (`/app/api/shares/route.ts` does not exist). The endpoint exists on the backend at `/v1/shares/`.

**Fix:** Documented in v3 with a note that the proxy route may be missing.

---

### 10. APP-SPECIFIC FRAMING IN SOME DOCS

Several documents in `docs_old/` and some in `docs/` describe ControlFile from the perspective of a single app (ControlAudit). This contradicts the multi-tenant, shared-backend nature of the system.

**Fix:** v3 documentation is written entirely from the perspective of ControlFile as a shared platform.

---

### 11. FRONTEND LEAKAGE

Multiple existing docs include React hooks, Next.js component examples, and frontend state management explanations. These are out of scope for backend documentation.

**Fix:** v3 contains zero frontend-specific content.

---

## Summary Table

| Issue | Severity | Status in v3 |
|---|---|---|
| Duplicate content | High | Eliminated |
| Legacy `folders` collection | High | Removed |
| Inconsistent field names | High | Standardized |
| `isPublic` vs `isActive` | Medium | Clarified |
| Missing upload endpoints in TRUTH | Medium | Added |
| Missing proxy routes | Medium | Documented |
| Route prefix inconsistency | Medium | Documented |
| Superdev auditoria-specific | Low | Noted |
| Missing shares/ list proxy | Low | Noted |
| App-specific framing | High | Eliminated |
| Frontend leakage | High | Eliminated |

---

## Phase 2 Audit – Full Backend Domain Coverage

**Date:** 2026-03-20
**Scope:** All backend route files and module directories verified against running code

### Additional Bugs Fixed in Phase 2

| ID | File | Bug | Fix |
|---|---|---|---|
| B1 | `05_uploads.md` | Quota formula stated as `usedBytes + pendingBytes + size <= planQuotaBytes`. Actual code: `size > account.limits.storageBytes` (hard cap, no remaining space calculation) | Corrected formula; added platform account guard explanation |
| B2 | `05_uploads.md`, `07_endpoints_reference.md` | Quota exceeded error code stated as `402`. Actual: `413` (`QuotaExceededError.statusCode = 413`) | Fixed to `413` |
| B3 | `02_architecture.md` | Route prefix stated as universal dual `/api/` + `/v1/`. Reality: email, dashboard, logistics, horarios are `/api/` only; repositories has no `/api/`; external upload has no standard prefix | Added route prefix exceptions table |
| B4 | `07_endpoints_reference.md` | Missing ~15 endpoints | Added: `GET /files/list`, `POST /files/replace`, admin email-config endpoints, feedback CRUD, external upload paths |
| B5 | `08_data_models.md` | Missing `platform/accounts/accounts/{uid}` collection | Added with full schema and quota guard logic |
| B6 | `05_uploads.md`, `07_endpoints_reference.md`, `08_data_models.md` | Confirm endpoint stated to update `usedBytes` and `pendingBytes`. Actual code: creates `files` doc only, no quota field updates | Corrected side effects in all three files |
| B7 | `07_endpoints_reference.md` | Rename endpoint body uses `name`. Actual code: `newName` | Fixed field name |
| B8 | `02_architecture.md` | `bucketKey` format stated as `users/{userId}/files/{timestamp}-{name}`. Actual: `{uid}/{parentPath}/{timestamp}_{randomId}_{sanitizedFileName}` | Corrected format |

### New Domains Documented (Phase 2)

| File | Domain |
|---|---|
| `10_platform_and_billing.md` | Platform accounts, Stripe billing, dual quota system |
| `11_uploads_external.md` | External upload (ControlAudit), quota bypass, 7-day TTL |
| `12_email_domain.md` | Email alerts, x-local-token auth, Resend inbound webhook |
| `13_logistics.md` | Logistics v2: remitos, recepciones, devoluciones, pedidos internos |
| `14_training.md` | Training: catalog, plans, sessions, attendance, dashboard |
| `15_chat_and_repositories.md` | Repository indexing (GitHub), chat queries |
| `16_audio.md` | Audio mastering (FFmpeg processing) |
| `17_dashboard_and_horarios.md` | Fleet monitoring dashboard, weekly schedule image upload |
| `18_users_extended.md` | user.js vs users.js collision, settings, taskbar, plan endpoint |
| `19_internal_and_debug.md` | Debug endpoints, cache middleware, create-user disambiguation |

### Critical Findings (Phase 2)

**Dual quota systems (data integrity risk):**
- Upload presign uses `platform/accounts/accounts/{uid}.limits.storageBytes` (hard cap, individual file size check only)
- Restore/plan endpoints use `users/{uid}.usedBytes` + `planQuotaBytes` (cumulative tracking)
- External upload bypasses both systems entirely
- These three paths are not reconciled — total storage usage in `users.usedBytes` may not reflect actual B2 usage

**External upload quota bypass:**
- `POST /upload` / `POST /v1/external/upload` performs no quota check
- `users/{uid}.usedBytes` is never updated by external uploads
- B2 usage from `audits/...` bucket path is invisible to all quota systems

**Route collision (user.js vs users.js):**
- Both mount handlers for `/users/...` paths
- `users.js` takes precedence on `/v1/users`
- `user.js` settings/taskbar/plan routes only accessible via `/api/user/`
- `/v1/user/settings` returns 404

**Naming discrepancy (plans.json vs Firestore):**
- `plans.json`: `plan.quotaBytes`
- `users/{uid}`: `planQuotaBytes`
- Bridged in `POST /api/user/plan` but creates ongoing maintenance risk
