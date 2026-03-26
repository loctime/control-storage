# ControlFile – Architecture

---

## System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT (App or Browser)                   │
└────────────┬────────────────────────────────────────────────────┘
             │ 1. API calls with Authorization: Bearer <idToken>
             ▼
┌─────────────────────────────────────────────────────────────────┐
│              Next.js Proxy Layer  (/app/api/**)                  │
│                                                                  │
│  Thin HTTP proxy. Forwards requests to Express backend.          │
│  Passes Authorization header unchanged.                          │
│  Default: http://localhost:3001                                   │
│  Env: NEXT_PUBLIC_BACKEND_URL or BACKEND_URL                     │
└────────────────────────────────┬────────────────────────────────┘
                                 │ 2. Forwards to /v1/** (or /api/**)
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│              ControlFile Backend  (Node.js + Express)            │
│                      Deploy: Render                              │
│                                                                  │
│  - Verifies Firebase ID tokens (Firebase Admin SDK)              │
│  - Enforces ownership and access rules                           │
│  - Generates presigned URLs for B2                               │
│  - Writes/reads Firestore metadata                               │
│  - Orchestrates upload sessions                                  │
└──────────┬────────────────────────────┬────────────────────────┘
           │ 3a. Reads/writes metadata   │ 3b. Generates presigned URLs
           ▼                             ▼                         │
┌──────────────────┐          ┌───────────────────┐               │
│    Firestore     │          │   Backblaze B2    │               │
│  (Metadata only) │          │  (File storage)   │               │
└──────────────────┘          └────────────┬──────┘               │
                                           │                       │
                              4. Client uploads/downloads directly │
                              ◄────────────┘                       │
                                                                   │
                         (Or: backend streams for image proxy) ◄───┘
```

---

## Proxy Layer (Next.js)

The Next.js frontend includes a thin API proxy at `/app/api/**`. Each route:

1. Reads the `Authorization` header from the incoming request
2. Forwards the request body unchanged to the backend
3. Returns the backend response to the client

This allows the frontend and backend to be deployed independently while sharing the same domain for API calls.

**Backend target:** `${BACKEND_URL}/v1/${path}`

**Exception:** `users/initialize` and `users/profile` route to `${BACKEND_URL}/api/...` (legacy path, not `/v1/`).

### Proxy Route Map

| Frontend Route | Backend Target |
|---|---|
| `POST /api/uploads/presign` | `POST {BACKEND_URL}/v1/uploads/presign` |
| `POST /api/uploads/confirm` | `POST {BACKEND_URL}/v1/uploads/confirm` |
| `POST /api/files/delete` | `POST {BACKEND_URL}/v1/files/delete` |
| `POST /api/files/rename` | `POST {BACKEND_URL}/v1/files/rename` |
| `POST /api/files/presign-get` | `POST {BACKEND_URL}/v1/files/presign-get` |
| `POST /api/files/zip` | `POST {BACKEND_URL}/v1/files/zip` |
| `POST /api/files/empty-trash` | `POST {BACKEND_URL}/v1/files/empty-trash` |
| `POST /api/folders/create` | `POST {BACKEND_URL}/v1/folders/create` |
| `GET /api/folders/root` | `GET {BACKEND_URL}/v1/folders/root` |
| `POST /api/folders/set-main` | `POST {BACKEND_URL}/v1/folders/set-main` |
| `POST /api/folders/permanent-delete` | `POST {BACKEND_URL}/v1/folders/permanent-delete` |
| `GET /api/folders/by-slug/{u}/{path}` | `GET {BACKEND_URL}/v1/folders/by-slug/{u}/{path}` |
| `POST /api/shares/create` | `POST {BACKEND_URL}/v1/shares/create` |
| `POST /api/shares/revoke` | `POST {BACKEND_URL}/v1/shares/revoke` |
| `GET /api/shares/{token}` | `GET {BACKEND_URL}/v1/shares/{token}` |
| `POST /api/shares/{token}/download` | `POST {BACKEND_URL}/v1/shares/{token}/download` |
| `GET /api/shares/{token}/image` | `GET {BACKEND_URL}/v1/shares/{token}/image` |
| `POST /api/controlfile/upload` | `POST {BACKEND_URL}/v1/controlfile/upload` |
| `POST /api/users/initialize` | `POST {BACKEND_URL}/api/users/initialize` |
| `GET|PUT /api/users/profile` | `GET|PUT {BACKEND_URL}/api/users/profile` |

**Backend-direct only** (no Next.js proxy route):
- `POST /v1/files/restore`
- `POST /v1/files/permanent-delete` (single file)

---

## Backend (Express)

The actual ControlFile backend is a Node.js + Express server. It:

- Verifies Firebase ID tokens on protected routes
- Manages upload sessions via Firestore
- Generates presigned URLs via the AWS S3 SDK (B2 is S3-compatible)
- Streams files from B2 for the image proxy endpoint
- Enforces quota via platform account guard (`platform/accounts/accounts/{uid}`)

### Route Prefix Rules

Most domains are mounted on **both** `/api/` and `/v1/`. Several domains break this rule:

| Domain | Prefix(es) | Note |
|---|---|---|
| files | `/api/files`, `/v1/files` | Standard dual prefix |
| folders | `/api/folders`, `/v1/folders` | Standard dual prefix |
| uploads | `/api/uploads`, `/v1/uploads` | Standard dual prefix |
| shares | `/api/shares`, `/v1/shares` | Standard dual prefix |
| users (profile) | `/api/users`, `/v1/users` | Standard dual prefix |
| user (settings) | `/api/user` only | **No `/v1/`** — collision with users.js |
| platform | `/api/platform`, `/v1/platform` | Standard dual prefix |
| billing | `/api/billing`, `/v1/billing` | Standard dual prefix |
| admin | `/api/admin`, `/v1/admin` | Standard dual prefix |
| training | `/api/training`, `/v1/training` | Standard dual prefix |
| chat | `/api/chat`, `/v1/chat` | Standard dual prefix |
| audio | `/api/audio`, `/v1/audio` | Standard dual prefix |
| superdev | `/api/superdev`, `/v1/superdev` | Standard dual prefix |
| **email** | `/api/email/` **only** | No `/v1/` prefix |
| **dashboard** | `/api/dashboard/` **only** | No `/v1/` prefix |
| **logistics** | `/api/logistics/v2` **only** | No `/v1/` prefix; versioned internally |
| **horarios** | `/api/horarios/` **only** | No `/v1/` prefix |
| **repositories** | `/repositories/`, `/v1/repositories/` | **No `/api/`** prefix |
| **external upload** | `POST /upload`, `/v1/external/upload` | Bare path + `/v1/external/` |
| health | `/health`, `/api/health`, `/v1/health` | Triple mount |

---

## Storage (Backblaze B2)

B2 is accessed via the AWS S3-compatible API using `@aws-sdk/client-s3`.

**Key behaviors:**
- No files are publicly accessible directly in B2
- All access is via:
  - **Presigned URLs** (time-limited, expire in 5 min for downloads, 1h for uploads)
  - **Backend proxy stream** (for the `/api/shares/{token}/image` endpoint only)
- `bucketKey` is the canonical B2 object path for presign uploads: `{uid}/{parentPath}/{timestamp}_{randomId}_{sanitizedFileName}`. External uploads use `audits/{companyId}/{auditId}/{uuid}{ext}`.

---

## Firestore

Firestore stores all metadata. It does not store file content.

**Collections:**

| Collection | Purpose |
|---|---|
| `files` | All files and folders (unified, differentiated by `type`) |
| `shares` | Public share links, indexed by token |
| `uploadSessions` | Temporary upload session state |
| `users` | User plan data (`planQuotaBytes`, `usedBytes`, `pendingBytes`) |
| `userSettings` | Per-user settings: billing interval, taskbar items |
| `platform/accounts/accounts/{uid}` | Platform account: active plan, `limits.storageBytes` (used by quota guard) |

**Security model:** `files` allows public read (needed for Cloudflare Worker share access). Real security is enforced by the backend, not Firestore rules alone. See [Data Models](./08_data_models.md) for full rules.

---

## Cloudflare Worker (Optional)

An optional Cloudflare Worker can sit in front of public share endpoints. It acts as a CDN/proxy layer and calls `POST /api/shares/{token}/increment-counter` to update download counters. The Worker has no security authority — all validation happens in the ControlFile backend.

---

## Request Lifecycle (Typical Upload)

```
1. App calls POST /api/uploads/presign (with Firebase ID Token)
2. Backend validates token → gets uid
3. Backend loads platform account (platform/accounts/accounts/{uid})
4. Backend checks quota: requireStorage(account, size) — size > limits.storageBytes → 413
5. Backend creates uploadSessions/{sessionId} with status "pending"
6. Backend generates B2 presigned PUT URL (1h TTL)
7. Backend returns { uploadSessionId, url }

8. Client PUTs file directly to B2 presigned URL
   (Backend is not in this path)

9. App calls POST /api/uploads/confirm (with sessionId)
10. Backend verifies file exists in B2
11. Backend creates files/{fileId} document
12. Backend sets session status = "completed"
13. Backend returns { fileId }
```

---

## Request Lifecycle (Public Share Download)

```
1. Anyone calls GET /api/shares/{token}
2. Backend validates: share exists, not expired, isActive
3. Backend returns file metadata (name, size, mime)

4. Anyone calls POST /api/shares/{token}/download
5. Backend validates share again
6. Backend generates B2 presigned GET URL (5 min TTL)
7. Backend increments downloadCount
8. Backend returns { downloadUrl, fileName, fileSize }

9. Client fetches downloadUrl directly from B2
```

---

## Environment Variables

| Variable | Used By | Purpose |
|---|---|---|
| `NEXT_PUBLIC_BACKEND_URL` | Next.js proxy | Backend URL |
| `BACKEND_URL` | Next.js proxy (fallback) | Backend URL |
| `PORT` | Express backend | Listen port (default: 3001) |
| Firebase Admin credentials | Backend | Token verification |
| B2 credentials | Backend | S3-compatible storage access |
