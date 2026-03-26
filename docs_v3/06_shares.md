# ControlFile – Share Links

---

## Overview

Shares are public, token-based links that provide time-limited access to a specific file. No authentication is required to access a share — the token itself is the credential.

```
Owner creates share → gets shareToken
Anyone with shareToken → can view metadata, download, or display the file
```

---

## Share Document

Shares live in the `shares` Firestore collection. The document ID is the share token itself.

```json
{
  "token": "a7f3k2...random...",
  "fileId": "firestoredocid",
  "uid": "owner-firebase-uid",
  "fileName": "quarterly-report.pdf",
  "fileSize": 2048576,
  "mime": "application/pdf",
  "isActive": true,
  "expiresAt": null,
  "createdAt": "Timestamp",
  "downloadCount": 47,
  "lastDownloadAt": "Timestamp"
}
```

### Share Validity

A share is considered valid if **all three** conditions are met:
1. The document exists in Firestore
2. `isActive !== false`
3. `expiresAt === null` OR `expiresAt > now`

**Legacy compatibility:** If `isPublic` field is present and is `false`, the share is also considered invalid. If `isPublic` is `undefined` or `true`, it is ignored (only `isActive` matters). **Never write `isPublic` in new code.**

---

## Creating a Share

### `POST /api/shares/create`

**Auth:** Required (Firebase ID Token)
**Backend route:** `POST /v1/shares/create`

**Request body:**
```json
{
  "fileId": "firestoreDocumentId",
  "expiresIn": 48
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `fileId` | string | Yes | The file to share (must belong to caller) |
| `expiresIn` | number | No | Hours until expiration. Default: `24`. `null` = never expires |

**Validations:**
- File exists in `files` collection
- File belongs to authenticated user (`userId == uid`)
- File is not soft-deleted (`deletedAt == null`)

**Response `200`:**
```json
{
  "shareToken": "a7f3k2...random...",
  "shareUrl": "https://controlfile.example.com/share/a7f3k2",
  "expiresAt": "2026-03-22T10:00:00Z",
  "fileName": "quarterly-report.pdf"
}
```

**Side effects:**
- Creates `shares/{token}` document with `isActive: true`
- Token is randomly generated and non-predictable

---

## Revoking a Share

### `POST /api/shares/revoke`

**Auth:** Required (Firebase ID Token)
**Backend route:** `POST /v1/shares/revoke`

**Request body:**
```json
{
  "shareToken": "a7f3k2..."
}
```

**Validations:**
- Share belongs to authenticated user (`uid == req.uid`)

**Response `200`:**
```json
{ "success": true }
```

**Side effects:**
- Sets `shares/{token}.isActive = false`
- Sets `shares/{token}.revokedAt = now`
- The share document is NOT deleted (preserved for audit)

---

## Listing User's Shares

### `GET /api/shares/`

**Auth:** Required (Firebase ID Token)
**Backend route:** `GET /v1/shares/`

> **Note:** No Next.js proxy route was found for this endpoint. Access at `BACKEND_URL/v1/shares/` directly or via SDK.

**Response `200`:**
```json
{
  "shares": [
    {
      "token": "a7f3k2...",
      "fileName": "quarterly-report.pdf",
      "fileSize": 2048576,
      "expiresAt": "2026-03-22T10:00:00Z",
      "createdAt": "2026-03-20T10:00:00Z",
      "downloadCount": 47,
      "shareUrl": "https://controlfile.example.com/share/a7f3k2"
    }
  ]
}
```

Only active shares (`isActive === true`) are returned.

---

## Public Endpoints (No Auth Required)

The following endpoints are publicly accessible. The share token is the only credential.

---

### `GET /api/shares/{token}`

Get metadata about a shared file. Use this to show a "download page" before the actual download.

**Auth:** None
**Backend route:** `GET /v1/shares/{token}`

**Response `200`:**
```json
{
  "fileName": "quarterly-report.pdf",
  "fileSize": 2048576,
  "mime": "application/pdf",
  "expiresAt": "2026-03-22T10:00:00Z",
  "downloadCount": 47
}
```

**Errors:**

| Status | Description |
|---|---|
| `404` | Share not found |
| `410` | Share is expired or revoked |

---

### `POST /api/shares/{token}/download`

Get a presigned download URL. The client then fetches the file directly from B2.

**Auth:** None
**Backend route:** `POST /v1/shares/{token}/download`

**Response `200`:**
```json
{
  "downloadUrl": "https://b2.example.com/file/...?signature=...",
  "fileName": "quarterly-report.pdf",
  "fileSize": 2048576
}
```

**Behavior:**
- Backend validates share (exists, active, not expired)
- Backend verifies file exists in `files` collection and has `bucketKey`
- Backend generates a B2 presigned GET URL (**expires in 5 minutes**)
- Backend increments `downloadCount`
- Client must immediately redirect to or fetch `downloadUrl`

**Errors:**

| Status | Description |
|---|---|
| `404` | Share not found |
| `410` | Share expired or revoked |
| `451` | File blocked by virus scan |
| `500` | Internal error |

**Usage pattern:**
```javascript
// 1. Get presigned URL
const { downloadUrl, fileName } = await fetch(`/api/shares/${token}/download`, {
  method: 'POST'
}).then(r => r.json());

// 2. Trigger download
window.location.href = downloadUrl;
// or: create an <a download> link
```

---

### `GET /api/shares/{token}/image`

CORS-safe image proxy. Streams file content directly from B2 through the backend. Use this for `<img>` tags and anywhere CORS headers are needed.

**Auth:** None
**Backend route:** `GET /v1/shares/{token}/image`
**Supports:** `GET` and `HEAD` methods

**Response `200`:**
- Direct file stream (not a redirect to B2)
- Response headers:
  ```http
  Content-Type: image/jpeg
  Access-Control-Allow-Origin: *
  Access-Control-Allow-Methods: GET, HEAD, OPTIONS
  Cache-Control: public, max-age=3600
  ```

**Behavior:**
- Backend validates share (exists, active, not expired)
- Backend fetches file stream from B2 using `bucketKey`
- Backend pipes stream to client with CORS headers
- `downloadCount` is incremented **asynchronously** (does not block response)

**Errors:**

| Status | Description |
|---|---|
| `404` | Share not found |
| `410` | Share expired or revoked |
| `500` | Internal error or B2 error |

**Usage:**
```html
<img src="/api/shares/a7f3k2.../image" alt="Shared file" />
```

**Why not use `/download` for images?**

The `/download` endpoint returns a presigned B2 URL. B2 URLs do not include CORS headers, causing browsers to block cross-origin image loads. The `/image` endpoint proxies the stream through the backend, which adds the required CORS headers.

```
/download → returns presigned URL → client fetches from B2 → NO CORS headers → ❌ blocked in <img>
/image    → streams from B2 → adds CORS headers → ✓ works in <img>
```

---

### `POST /api/shares/{token}/increment-counter`

Increments the download counter. Used internally by Cloudflare Workers. Not intended for direct use.

**Auth:** None
**Backend route:** `POST /v1/shares/{token}/increment-counter`

**Response `200`:**
```json
{ "success": true }
```

**Side effects:**
- `shares/{token}.downloadCount += 1`
- `shares/{token}.lastDownloadAt = now`

This endpoint does not re-validate the share — it assumes the Cloudflare Worker has already done so.

---

## Share Token Properties

- **Format:** Random alphanumeric string
- **Non-predictable:** Cannot be guessed or enumerated
- **Doubles as Firestore document ID** in the `shares` collection
- **Immutable:** Once created, the token never changes

---

## Share Expiration

| `expiresIn` value | Effect |
|---|---|
| Not provided (default) | Expires in 24 hours |
| `48` | Expires in 48 hours |
| `null` | Never expires |

The `expiresAt` field in the `shares` document stores the absolute timestamp. All public endpoints check this on every request.

---

## Image Endpoint vs Download Endpoint

| | `/api/shares/{token}/image` | `/api/shares/{token}/download` |
|---|---|---|
| Auth | None | None |
| Response | File stream | JSON with presigned URL |
| CORS headers | Yes (`*`) | No (from B2) |
| Caching | Yes (1h) | No (must re-request) |
| Use for `<img>` | ✅ Yes | ❌ No |
| Use for file download | ❌ No | ✅ Yes |
| Downloads counted | Yes (async) | Yes (sync) |
| Presigned URL TTL | N/A (stream) | 5 minutes |

---

## Cloudflare Worker Integration

An optional Cloudflare Worker can sit in front of the public share endpoints as a caching/CDN layer. The Worker:
1. Receives the public request
2. Validates the share (calls backend to check)
3. Serves the cached response or proxies to B2
4. Calls `POST /api/shares/{token}/increment-counter` to count the download

The Worker has **no security authority**. All validation is performed by the ControlFile backend.
