# ControlFile – Uploads

---

## Overview

ControlFile uses a **3-step upload flow**. Files are uploaded **directly from the client to Backblaze B2** — they never stream through the ControlFile backend (except via the alternate `controlfile/upload` path).

```
Step 1  →  POST /api/uploads/presign   →  Create session, validate quota, get presigned URL
Step 2  →  Client PUT → B2 directly    →  Upload file content (backend not involved)
Step 3  →  POST /api/uploads/confirm   →  Verify B2, create file record, update quota
```

---

## Step 1: Create Upload Session

### `POST /api/uploads/presign`

Creates an `uploadSessions` document, validates quota, and returns a presigned B2 URL.

**Auth:** Required (Firebase ID Token)
**Backend route:** `POST /v1/uploads/presign`

**Request body:**
```json
{
  "name": "document.pdf",
  "size": 2048576,
  "mime": "application/pdf",
  "parentId": "folderDocumentId"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | File name |
| `size` | number | Yes | File size in bytes |
| `mime` | string | Yes | MIME type |
| `parentId` | string\|null | No | Target folder ID. `null` = root |

**Quota validation (performed here, before any upload):**

Quota is checked via `requireStorage(account, size)` using the **platform account** (`platform/accounts/accounts/{uid}`):

```
size > account.limits.storageBytes  →  413 QuotaExceeded
```

This is a **hard cap check** against the total plan limit (`limits.storageBytes`), not against remaining space. It does **not** subtract already-used bytes. See [10_platform_and_billing.md](./10_platform_and_billing.md) for the full dual quota system explanation.

If quota is exceeded, the request fails with `413` — no session is created.

**Side effects:**
- Creates `uploadSessions/{sessionId}` with `status: "pending"`
- Does **not** update `users/{uid}.pendingBytes` (pendingBytes is a legacy field not updated by current code)

**Response `200`:**
```json
{
  "uploadSessionId": "abc123",
  "url": "https://b2.example.com/upload/...?signature=..."
}
```

For simple uploads (< 128 MB):
```json
{
  "uploadSessionId": "abc123",
  "url": "https://b2.example.com/..."
}
```

For multipart uploads (≥ 128 MB):
```json
{
  "uploadSessionId": "abc123",
  "multipart": {
    "uploadId": "b2-multipart-id",
    "parts": [
      { "partNumber": 1, "url": "https://b2.example.com/part/1?..." },
      { "partNumber": 2, "url": "https://b2.example.com/part/2?..." }
    ]
  }
}
```

**Errors:**

| Status | Description |
|---|---|
| `401` | Invalid or missing Firebase token |
| `413` | Quota exceeded (`size > limits.storageBytes`) |
| `500` | Internal error |

---

## Step 2: Upload to B2

The client uploads directly to B2 using the presigned URL. **The ControlFile backend is not involved in this step.**

### Simple Upload

```http
PUT {url}
Content-Type: application/pdf
[file bytes]
```

Presigned URL expires in **1 hour**.

### Multipart Upload

Upload each part to its respective `url`:
```http
PUT {parts[0].url}
[part 1 bytes]

PUT {parts[1].url}
[part 2 bytes]
```

Collect the `ETag` response header from each part for the confirm step.

---

## Step 3: Confirm Upload

### `POST /api/uploads/confirm`

Verifies the file exists in B2, creates the permanent `files/{fileId}` document, and updates quota.

**Auth:** Required (Firebase ID Token)
**Backend route:** `POST /v1/uploads/confirm`

**Request body (simple upload):**
```json
{
  "uploadSessionId": "abc123",
  "etag": "\"abc123etag\""
}
```

**Request body (multipart upload):**
```json
{
  "uploadSessionId": "abc123",
  "parts": [
    { "PartNumber": 1, "ETag": "\"etag1\"" },
    { "PartNumber": 2, "ETag": "\"etag2\"" }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `uploadSessionId` | string | Yes | Session ID from presign step |
| `etag` | string | No | ETag from simple upload response |
| `parts` | array | No | Parts for multipart upload |

**Validations:**
- Session exists in `uploadSessions` and belongs to user
- Session `status` is `"pending"` or `"uploaded"`
- File exists in B2 (verified via metadata call)

**Side effects:**
- Completes B2 multipart upload (if applicable)
- Creates `files/{fileId}` document with `type: "file"`, all metadata
- Sets session `status = "completed"`
- Does **not** update `users/{uid}.usedBytes` or `pendingBytes` (quota accounting is handled by the platform account system, not the users collection)

**Response `200`:**
```json
{
  "success": true,
  "fileId": "generatedFirestoreDocId",
  "message": "Upload confirmed"
}
```

**Errors:**

| Status | Description |
|---|---|
| `401` | Invalid or missing token |
| `404` | Session not found |
| `409` | Session already completed |
| `500` | Internal error |

---

## Alternate Upload Path

### `POST /api/controlfile/upload`

A single-step upload where the file body is sent directly to the ControlFile backend, which then handles storage in B2. Unlike the presign flow, the file passes through the backend.

**Auth:** Required (Firebase ID Token)
**Backend route:** `POST /v1/controlfile/upload`
**Content-Type:** `multipart/form-data` or `application/octet-stream`

**Response `200`:**
```json
{
  "fileId": "generatedFirestoreDocId"
}
```

**When to use:** For server-side or programmatic uploads where the presign flow is impractical. The standard presign flow is preferred for client-side uploads.

---

## Upload Session Document

The `uploadSessions/{sessionId}` document tracks upload state:

```json
{
  "uid": "firebase-uid",
  "bucketKey": "users/uid/files/1700000000-document.pdf",
  "size": 2048576,
  "name": "document.pdf",
  "mime": "application/pdf",
  "status": "pending",
  "expiresAt": "Timestamp (24 hours from creation)",
  "createdAt": "Timestamp",
  "parentId": "folderDocumentId",
  "uploadId": "b2-multipart-id (multipart only)",
  "ancestors": ["ancestorId1", "ancestorId2"]
}
```

Status values:
| Status | Meaning |
|---|---|
| `"pending"` | Session created, upload not yet confirmed |
| `"uploaded"` | File uploaded to B2 but not yet confirmed |
| `"completed"` | Upload confirmed, `files` document created |

Sessions expire after **24 hours**. Expired sessions with `pendingBytes` still reserved should be cleaned up by a scheduled job.

---

## Quota During Upload

Quota is enforced by the **platform account guard** at presign time:

```
requireStorage(account, requestedFileSize)
  → if requestedFileSize > account.limits.storageBytes: throw QuotaExceededError (413)
```

The check compares the **individual file size** against the **total plan limit** (`limits.storageBytes`). It does not track cumulative used space — that is a known limitation of the current implementation. See [10_platform_and_billing.md](./10_platform_and_billing.md) for the dual quota system and its implications.

> **Note:** The `users/{uid}` collection has `usedBytes` and `pendingBytes` fields that are referenced in older documentation. These fields exist in Firestore but are not updated by the current upload code paths. They may be populated by the `POST /user/plan` flow and legacy code.
