# ControlFile – Endpoint Reference

> All endpoints listed here exist in the running backend. Endpoints are NOT invented.
> Source verified from: route files in `/app/api/**`, TRUTH.md, and endpoint contracts.

---

## Base URLs

- **Frontend proxy:** `https://your-domain.com/api/...`
- **Backend direct:** `BACKEND_URL/v1/...` (most endpoints)
- **Backend legacy path:** `BACKEND_URL/api/...` (users endpoints only)

---

## Authentication

- Protected endpoints require: `Authorization: Bearer <firebase-id-token>`
- Public endpoints require no authorization

---

## Quick Reference

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/health` | None | Health check |
| `POST` | `/api/uploads/presign` | Required | Create upload session |
| `POST` | `/api/uploads/confirm` | Required | Confirm completed upload |
| `POST` | `/api/controlfile/upload` | Required | Single-step upload (body passthrough) |
| `GET` | `/api/files/list` | Required | List files and folders (paginated, with cache) |
| `POST` | `/api/files/replace` | Required | Replace file contents (same ID, multipart) |
| `POST` | `/api/files/delete` | Required | Soft-delete a file |
| `POST` | `/api/files/restore` | Required | Restore file from trash *(backend-direct)* |
| `POST` | `/api/files/permanent-delete` | Required | Permanently delete one file *(backend-direct)* |
| `POST` | `/api/files/empty-trash` | Required | Permanently delete multiple files |
| `POST` | `/api/files/rename` | Required | Rename a file or folder |
| `POST` | `/api/files/presign-get` | Required | Get presigned download URL |
| `POST` | `/api/files/proxy-download` | Required | Stream file through proxy |
| `POST` | `/api/files/zip` | Required | Download multiple files as ZIP |
| `POST` | `/api/folders/create` | Required | Create a folder |
| `GET` | `/api/folders/root` | Required | Get/create user's root folder |
| `POST` | `/api/folders/set-main` | Required | Set folder as main |
| `POST` | `/api/folders/permanent-delete` | Required | Permanently delete a folder |
| `GET` | `/api/folders/by-slug/{u}/{path}` | Required | Browse folder by slug path |
| `POST` | `/api/shares/create` | Required | Create a share link |
| `POST` | `/api/shares/revoke` | Required | Revoke a share link |
| `GET` | `/api/shares/` | Required | List user's active shares *(backend-direct)* |
| `GET` | `/api/shares/{token}` | None | Get share metadata |
| `POST` | `/api/shares/{token}/download` | None | Get presigned download URL for share |
| `GET` | `/api/shares/{token}/image` | None | CORS-safe image proxy |
| `POST` | `/api/shares/{token}/increment-counter` | None | Increment download counter (internal) |
| `POST` | `/api/users/initialize` | Required | Initialize user on first login |
| `GET` | `/api/users/profile` | Required | Get user profile |
| `PUT` | `/api/users/profile` | Required | Update user profile |
| `POST` | `/api/admin/create-user` | Required (admin) | Create Firebase Auth user (backend-to-backend) |
| `PATCH` | `/api/admin/vehicle-alerts` | Required (admin) | Update vehicle alert responsables |
| `GET` | `/api/admin/email-config` | Required (admin) | Get email alert recipient config |
| `PATCH` | `/api/admin/email-config` | Required (admin) | Update email alert recipient config |
| `POST` | `/api/admin/sync-access-users` | Required (admin) | Sync email access user list |
| `POST` | `/api/feedback` | Required | Create feedback with screenshot |
| `GET` | `/api/feedback` | Required | List feedback with filters |
| `PATCH` | `/api/feedback/:id` | Required | Update feedback status/assignment |
| `POST` | `/upload` | Required | External file upload (ControlAudit, no quota check) |
| `POST` | `/v1/external/upload` | Required | Same as above (versioned path) |
| `GET` | `/api/superdev/list-owners` | Superdev | List all owners (ControlAudit-scoped) |
| `POST` | `/api/superdev/impersonate` | Superdev | Generate impersonation token (ControlAudit-scoped) |

---

## System

---

### GET /api/health

Server health check.

**Auth:** None

**Response `200`:**
```json
{
  "status": "ok",
  "timestamp": "2026-03-20T10:00:00.000Z",
  "uptime": 3600.5
}
```

**HEAD /api/health** returns `200` with empty body. Used for load balancer pings.

---

## Uploads

---

### POST /api/uploads/presign

Create upload session. Validate quota. Get B2 presigned URL.

**Auth:** Required
**Backend:** `POST /v1/uploads/presign`

**Request:**
```json
{
  "name": "file.pdf",
  "size": 2048576,
  "mime": "application/pdf",
  "parentId": "folderId"
}
```

**Response `200`:**
```json
{
  "uploadSessionId": "sessionId",
  "url": "https://b2.example.com/upload/..."
}
```

For multipart (≥128MB):
```json
{
  "uploadSessionId": "sessionId",
  "multipart": {
    "uploadId": "b2UploadId",
    "parts": [
      { "partNumber": 1, "url": "https://..." },
      { "partNumber": 2, "url": "https://..." }
    ]
  }
}
```

**Errors:** `401` invalid token · `413` quota exceeded (`size > limits.storageBytes`) · `500` server error

**Side effects:** Creates `uploadSessions/{id}` (platform account guard checked — no `pendingBytes` update)

---

### POST /api/uploads/confirm

Confirm upload. Create file record. Adjust quota.

**Auth:** Required
**Backend:** `POST /v1/uploads/confirm`

**Request (simple):**
```json
{
  "uploadSessionId": "sessionId",
  "etag": "\"abc123\""
}
```

**Request (multipart):**
```json
{
  "uploadSessionId": "sessionId",
  "parts": [
    { "PartNumber": 1, "ETag": "\"etag1\"" },
    { "PartNumber": 2, "ETag": "\"etag2\"" }
  ]
}
```

**Response `200`:**
```json
{
  "success": true,
  "fileId": "firestoreDocId",
  "message": "Upload confirmed"
}
```

**Errors:** `401` · `404` session not found · `409` already completed · `500`

**Side effects:** Creates `files/{fileId}` · Sets session `status = "completed"` (no quota field updates)

---

### POST /api/controlfile/upload

Single-step upload. File body passes through backend to B2.

**Auth:** Required
**Backend:** `POST /v1/controlfile/upload`
**Content-Type:** `multipart/form-data` or `application/octet-stream`

**Response `200`:**
```json
{ "fileId": "firestoreDocId" }
```

---

## Files

---

### POST /api/files/delete

Soft-delete a file (move to trash).

**Auth:** Required
**Backend:** `POST /v1/files/delete`

**Request:**
```json
{ "fileId": "firestoreDocId" }
```

**Response `200`:**
```json
{ "success": true, "message": "..." }
```

**Validations:** Ownership · `deletedAt == null`

**Side effects:** `files/{id}.deletedAt = now` · `usedBytes -= size`

---

### POST /api/files/restore

Restore file from trash.

**Auth:** Required
**Backend:** `POST /v1/files/restore` *(no Next.js proxy — access backend directly)*

**Request:**
```json
{ "fileId": "firestoreDocId" }
```

**Response `200`:**
```json
{ "success": true, "message": "..." }
```

**Validations:** Ownership · `deletedAt != null` · Quota: `usedBytes + size <= planQuotaBytes`

**Side effects:** `files/{id}.deletedAt = null` · `files/{id}.updatedAt = now` · `usedBytes += size`

---

### POST /api/files/permanent-delete

Permanently delete a single file that is already in trash.

**Auth:** Required
**Backend:** `POST /v1/files/permanent-delete` *(no Next.js proxy — access backend directly)*

**Request:**
```json
{ "fileId": "firestoreDocId" }
```

**Response `200`:**
```json
{ "success": true, "message": "..." }
```

**Validations:** Ownership · `deletedAt != null` (must already be in trash)

**Side effects:** Deletes B2 object · Deletes `files/{id}` document · No quota change (already decremented on soft-delete)

---

### POST /api/files/empty-trash

Permanently delete multiple files from trash in batch.

**Auth:** Required
**Backend:** `POST /v1/files/empty-trash`

**Request:**
```json
{ "fileIds": ["id1", "id2", "id3"] }
```

**Response `200`:**
```json
{
  "success": true,
  "deletedIds": ["id1", "id2"],
  "notFound": ["id3"],
  "unauthorized": []
}
```

**Side effects:** Deletes B2 objects (tolerant — continues on B2 errors) · Batch-deletes Firestore docs · `usedBytes -= sum(sizes)`

---

### POST /api/files/rename

Rename a file or folder.

**Auth:** Required
**Backend:** `POST /v1/files/rename`

**Request:**
```json
{
  "fileId": "firestoreDocId",
  "newName": "new-name.pdf"
}
```

**Response `200`:**
```json
{ "success": true }
```

---

### GET /api/files/list

List files and folders in a directory with cursor pagination.

**Auth:** Required
**Backend:** `GET /v1/files/list`

**Query parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `parentId` | string\|`"null"` | (all) | Parent folder ID. Pass `"null"` string for root items |
| `pageSize` | number | `100` | Items per page (max `200`) |
| `cursor` | string | — | Last item ID from previous page |

**Response `200`:**
```json
{
  "items": [
    { "id": "docId", "type": "file", "name": "report.pdf", "size": 1024, ... },
    { "id": "foldId", "type": "folder", "name": "My Docs", ... }
  ],
  "nextPage": "lastItemId"
}
```

`nextPage` is `null` when no more items. Items are sorted by `updatedAt` descending.

**Notes:**
- Excludes soft-deleted items (`deletedAt != null`)
- Responses may be served from TanStack cache layer

---

### POST /api/files/replace

Replace the contents of an existing file without changing its ID or metadata structure. File is uploaded as multipart/form-data.

**Auth:** Required
**Backend:** `POST /v1/files/replace`
**Content-Type:** `multipart/form-data`

**Form fields:**

| Field | Required | Description |
|---|---|---|
| `fileId` | Yes | Firestore doc ID of the file to replace |
| `file` | Yes | New file content (the replacement binary) |

**Response `200`:**
```json
{
  "success": true,
  "message": "Archivo reemplazado",
  "size": 2048576,
  "mime": "image/png"
}
```

**Validations:** Ownership · `deletedAt == null`

**Side effects:** Uploads to **same `bucketKey`** (overwrites B2 object) · Updates `files/{id}.size`, `.mime`, `.etag`, `.updatedAt` · Adjusts `users/{uid}.usedBytes` by size delta

---

### POST /api/files/presign-get

Generate a presigned download URL for an owned file.

**Auth:** Required
**Backend:** `POST /v1/files/presign-get`

**Request:**
```json
{ "fileId": "firestoreDocId" }
```

**Response `200`:**
```json
{
  "downloadUrl": "https://b2.example.com/...?signature=...",
  "fileName": "file.pdf"
}
```

URL expires in **5 minutes**. Validations: ownership · `deletedAt == null` · `bucketKey` exists

---

### POST /api/files/proxy-download

Stream an owned file through the frontend proxy (wraps presign-get + fetch).

**Auth:** Required
**Backend:** Calls `POST /v1/files/presign-get` internally, then streams from B2

**Request:**
```json
{ "fileId": "firestoreDocId" }
```

**Response `200`:** File byte stream
```http
Content-Type: application/pdf
Cache-Control: private, max-age=60
```

Use when the client cannot handle B2 redirects directly.

---

### POST /api/files/zip

Download multiple files as a single ZIP archive (streamed).

**Auth:** Required
**Backend:** `POST /v1/files/zip`

**Request:**
```json
{
  "fileIds": ["id1", "id2"],
  "zipName": "my-archive"
}
```

| Field | Required | Default |
|---|---|---|
| `fileIds` | Yes | — |
| `zipName` | No | `"seleccion"` |

**Response `200`:** ZIP byte stream
```http
Content-Type: application/zip
Content-Disposition: attachment; filename="my-archive-1700000000.zip"
```

**Constraints:**
- Maximum 200 files
- Only `type: "file"` items (folders excluded)
- All files must belong to caller
- All files must not be deleted (`deletedAt == null`)

Duplicate filenames are auto-renamed in the archive.

---

## Folders

---

### POST /api/folders/create

Create a new folder.

**Auth:** Required
**Backend:** `POST /v1/folders/create`

**Request:**
```json
{
  "name": "My Documents",
  "parentId": "parentFolderDocId"
}
```

**Response `200`:**
```json
{
  "id": "newFolderDocId",
  "name": "My Documents",
  "slug": "my-documents",
  "parentId": "parentFolderDocId",
  "type": "folder"
}
```

**Notes:**
- Apps cannot create root-level folders (`parentId: null`)
- Root folders are created by the ControlFile system only

---

### GET /api/folders/root

Get or create the user's root folder. Idempotent.

**Auth:** Required
**Backend:** `GET /v1/folders/root`

**Query parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `appId` | string | No | Application identifier for multi-app root |

**Response `200`:**
```json
{
  "id": "rootFolderDocId",
  "name": "Root",
  "parentId": null,
  "type": "folder"
}
```

---

### POST /api/folders/set-main

Set a folder as the user's main (pinned) folder.

**Auth:** Required
**Backend:** `POST /v1/folders/set-main`

**Request:**
```json
{ "folderId": "folderDocId" }
```

**Response `200`:**
```json
{ "success": true }
```

---

### POST /api/folders/permanent-delete

Permanently delete a folder and its contents.

**Auth:** Required
**Backend:** `POST /v1/folders/permanent-delete`

**Request:**
```json
{ "folderId": "folderDocId" }
```

**Response `200`:**
```json
{ "success": true, "message": "..." }
```

---

### GET /api/folders/by-slug/{username}/{...path}

Browse folder contents by URL-friendly slug path.

**Auth:** Required
**Backend:** `GET /v1/folders/by-slug/{username}/{path}`

**Path parameters:**

| Param | Description |
|---|---|
| `username` | User's slug/username |
| `...path` | Slash-separated folder path (catch-all) |

**Response `200`:**
```json
{
  "folder": { "id": "...", "name": "...", "type": "folder" },
  "children": [
    { "id": "...", "name": "...", "type": "file" },
    { "id": "...", "name": "...", "type": "folder" }
  ]
}
```

---

## Shares – Authenticated

---

### POST /api/shares/create

Create a public share link for a file.

**Auth:** Required
**Backend:** `POST /v1/shares/create`

**Request:**
```json
{
  "fileId": "firestoreDocId",
  "expiresIn": 24
}
```

| Field | Required | Default | Description |
|---|---|---|---|
| `fileId` | Yes | — | File to share |
| `expiresIn` | No | `24` | Hours until expiry. `null` = never |

**Response `200`:**
```json
{
  "shareToken": "randomToken",
  "shareUrl": "https://example.com/share/randomToken",
  "expiresAt": "2026-03-21T10:00:00Z",
  "fileName": "file.pdf"
}
```

**Validations:** File exists · Ownership · `deletedAt == null`

---

### POST /api/shares/revoke

Revoke a share. Sets `isActive = false`.

**Auth:** Required
**Backend:** `POST /v1/shares/revoke`

**Request:**
```json
{ "shareToken": "randomToken" }
```

**Response `200`:**
```json
{ "success": true }
```

---

### GET /api/shares/

List user's active shares.

**Auth:** Required
**Backend:** `GET /v1/shares/`

> **Note:** No Next.js proxy route confirmed. Access backend directly.

**Response `200`:**
```json
{
  "shares": [
    {
      "token": "randomToken",
      "fileName": "file.pdf",
      "fileSize": 2048576,
      "expiresAt": "2026-03-21T10:00:00Z",
      "createdAt": "2026-03-20T10:00:00Z",
      "downloadCount": 5,
      "shareUrl": "https://example.com/share/randomToken"
    }
  ]
}
```

Only returns `isActive === true` shares.

---

## Shares – Public

---

### GET /api/shares/{token}

Get file metadata for a share. No auth required.

**Auth:** None
**Backend:** `GET /v1/shares/{token}`

**Response `200`:**
```json
{
  "fileName": "file.pdf",
  "fileSize": 2048576,
  "mime": "application/pdf",
  "expiresAt": "2026-03-21T10:00:00Z",
  "downloadCount": 5
}
```

**Errors:** `404` not found · `410` expired or revoked

---

### POST /api/shares/{token}/download

Get a presigned B2 download URL. No auth required.

**Auth:** None
**Backend:** `POST /v1/shares/{token}/download`

**Response `200`:**
```json
{
  "downloadUrl": "https://b2.example.com/...?signature=...",
  "fileName": "file.pdf",
  "fileSize": 2048576
}
```

URL expires in **5 minutes**. Increments `downloadCount`.

**Errors:** `404` · `410` · `451` virus blocked · `500`

---

### GET /api/shares/{token}/image

Stream image via CORS-safe proxy. Use for `<img src="...">`. No auth required.

**Auth:** None
**Backend:** `GET /v1/shares/{token}/image`
**Supports:** `GET` and `HEAD`

**Response `200`:** File byte stream
```http
Content-Type: image/jpeg
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, HEAD, OPTIONS
Cache-Control: public, max-age=3600
```

Increments `downloadCount` asynchronously.

**Errors:** `404` · `410` · `500`

---

### POST /api/shares/{token}/increment-counter

Increment download counter. Used by Cloudflare Worker.

**Auth:** None
**Backend:** `POST /v1/shares/{token}/increment-counter`

**Response `200`:**
```json
{ "success": true }
```

**Side effects:** `downloadCount += 1` · `lastDownloadAt = now`

---

## Users

---

### POST /api/users/initialize

Initialize user document on first login.

**Auth:** Required
**Backend:** `POST /api/users/initialize` *(legacy path — not `/v1/`)*

**Request:**
```json
{ "displayName": "User Name" }
```

**Response `200`:**
```json
{ "success": true }
```

---

### GET /api/users/profile

Get authenticated user's profile and quota.

**Auth:** Required
**Backend:** `GET /api/users/profile` *(legacy path — not `/v1/`)*

**Response `200`:**
```json
{
  "uid": "firebase-uid",
  "email": "user@example.com",
  "displayName": "User Name",
  "planId": "free",
  "planQuotaBytes": 1073741824,
  "usedBytes": 52428800,
  "pendingBytes": 0
}
```

---

### PUT /api/users/profile

Update authenticated user's profile.

**Auth:** Required
**Backend:** `PUT /api/users/profile` *(legacy path — not `/v1/`)*

**Request:**
```json
{ "displayName": "New Name" }
```

**Response `200`:**
```json
{ "success": true }
```

---

## Admin

---

### POST /api/admin/create-user

Create a Firebase Auth user and set custom claims. **Backend-to-backend only — never call from frontend.**

**Auth:** Required — Firebase ID Token with `role: "admin"` or `"supermax"` and matching `appId`

**Request:**
```json
{
  "email": "user@example.com",
  "password": "TemporaryPass123!",
  "nombre": "User Name",
  "appId": "auditoria",
  "role": "admin"
}
```

**Response `200`:**
```json
{
  "uid": "firebase-auth-uid",
  "status": "created",
  "source": "controlfile"
}
```

**What it does:** Creates Firebase Auth user · Sets custom claims `{ appId, role, ownerId }`

**What it does NOT do:** Write app Firestore · Apply business logic · Create user documents

> **Response status:** `201` when user was created, `200` when email already existed and UID was reused.

---

### PATCH /api/admin/vehicle-alerts

Update vehicle alert responsables (email recipients) and sync access list.

**Auth:** Required — `role: "admin"` or `"supermax"`

**Request (single vehicle):**
```json
{
  "plate": "ABC123",
  "responsables": ["user@example.com", "other@example.com"]
}
```

**Request (multiple vehicles):**
```json
{
  "vehicles": [
    { "plate": "ABC123", "responsables": ["user@example.com"] },
    { "plate": "XYZ789", "responsables": ["other@example.com"] }
  ]
}
```

**Response `200`:**
```json
{
  "ok": true,
  "vehiclesUpdated": 2,
  "sync": { ... }
}
```

**Side effects:** Writes `apps/emails/vehicles/{plate}` · Triggers `syncAccessUsers()` to rebuild `apps/emails/access`

---

### GET /api/admin/email-config

Get global email alert recipient configuration.

**Auth:** Required — `role: "admin"` or `"supermax"`

**Response `200`:**
```json
{
  "ok": true,
  "config": {
    "generalRecipients": ["alerts@example.com"],
    "ccRecipients": ["mgmt@example.com"],
    "reportRecipients": ["reports@example.com"]
  }
}
```

Reads from `apps/emails/config/config`. Returns empty arrays if document does not exist.

---

### PATCH /api/admin/email-config

Update global email alert recipient lists.

**Auth:** Required — `role: "admin"` or `"supermax"`

**Request:**
```json
{
  "generalRecipients": ["alerts@example.com"],
  "ccRecipients": [],
  "reportRecipients": ["reports@example.com"]
}
```

At least one array field required. All provided arrays replace existing values.

**Response `200`:**
```json
{ "ok": true, "sync": { ... } }
```

**Side effects:** Writes `apps/emails/config/config` · Triggers `syncAccessUsers()`

---

### POST /api/admin/sync-access-users

Manually trigger sync of email access users. Updates `apps/emails/access` from vehicle responsables and config recipients.

**Auth:** Required — `role: "admin"` or `"supermax"`

**Response `200`:**
```json
{ "ok": true, ... }
```

---

## Feedback

---

### POST /api/feedback

Create a feedback item with screenshot attachment.

**Auth:** Required
**Backend:** `POST /v1/feedback` (or `/api/feedback`)
**Content-Type:** `multipart/form-data`

**Form fields:**

| Field | Required | Description |
|---|---|---|
| `payload` | Yes | JSON string: `{ appId, tenantId?, userRole?, comment, context, clientRequestId?, source? }` |
| `screenshot` | Yes | PNG/JPEG image (max 10MB) |

**Response `201`** (new) or **`200`** (idempotent — same `clientRequestId`):
```json
{
  "success": true,
  "feedbackId": "firestoreDocId",
  "screenshotFileId": "firestoreFileId",
  "status": "open",
  "createdAt": "2026-03-20T10:00:00.000Z"
}
```

**Errors:** `400` validation error · `401` no auth · `403` permission denied · `500`

---

### GET /api/feedback

List feedback items with filters and pagination.

**Auth:** Required
**Backend:** `GET /v1/feedback`

**Query parameters:**

| Param | Required | Description |
|---|---|---|
| `appId` | Yes | Filter by app |
| `tenantId` | No | Filter by tenant |
| `status` | No | `open` \| `in_progress` \| `resolved` \| `archived` |
| `createdBy` | No | UID of creator |
| `assignedTo` | No | UID of assignee |
| `fromDate` | No | Start timestamp (ms) |
| `toDate` | No | End timestamp (ms) |
| `cursor` | No | Last document ID for pagination |
| `pageSize` | No | Default `20`, max `100` |

**Response `200`:**
```json
{
  "items": [
    { "id": "...", "appId": "...", "status": "open", "comment": "...", "createdAt": "...", ... }
  ],
  "pagination": { "cursor": "lastId", "hasMore": true }
}
```

---

### PATCH /api/feedback/:feedbackId

Update feedback status, assignment, or internal notes.

**Auth:** Required — must be creator or assignee of the feedback item

**Request:**
```json
{
  "status": "in_progress",
  "assignedTo": "uid",
  "internalNotes": "Investigated — reproduced in staging"
}
```

All fields optional. At least one required.

**Response `200`:**
```json
{
  "success": true,
  "feedback": { ... }
}
```

**Errors:** `400` no fields or invalid · `401` · `403` not creator/assignee · `404` not found · `500`

---

## Superdev

> These endpoints are scoped to **ControlAudit** (`apps/auditoria/owners` collection).

---

### GET /api/superdev/list-owners

List all valid owners available for impersonation.

**Auth:** Required — `role: "superdev"`

**Response `200`:**
```json
{
  "owners": [
    { "uid": "uid1", "email": "owner@example.com", "nombre": "Owner Name" }
  ]
}
```

**Errors:** `401` UNAUTHORIZED/TOKEN_EXPIRED/TOKEN_REVOKED · `403` FORBIDDEN

---

### POST /api/superdev/impersonate

Generate a Firebase Custom Token to sign in as a specific owner.

**Auth:** Required — `role: "superdev"`

**Request:**
```json
{ "ownerId": "targetOwnerUid" }
```

**Response `200`:**
```json
{ "customToken": "firebase-custom-token" }
```

Use `signInWithCustomToken(auth, customToken)` on the client to sign in as the owner.

**Constraints:** Does not modify Firestore · Token is temporary · Full audit log written

**Errors:**

| Status | Code | Description |
|---|---|---|
| `400` | `INVALID_OWNER_ID` | Missing or invalid ownerId |
| `401` | `UNAUTHORIZED` | Missing/invalid token |
| `401` | `TOKEN_EXPIRED` | Token expired |
| `401` | `TOKEN_REVOKED` | Token revoked |
| `403` | `FORBIDDEN` | Not superdev |
| `403` | `INVALID_OWNER` | Not a valid owner |
| `404` | `OWNER_NOT_FOUND` | Owner not in Firestore |
| `404` | `OWNER_AUTH_NOT_FOUND` | Owner has no Auth account |
