# ControlFile – External Upload (ControlAudit)

---

## Overview

The external upload flow is a **separate, independent upload path** used by ControlAudit. It is fundamentally different from the standard 3-step presign flow:

| | Standard presign flow | External upload |
|---|---|---|
| Endpoint | `POST /api/uploads/presign` + confirm | `POST /upload` |
| Content-Type | JSON → separate B2 PUT | `multipart/form-data` |
| Quota check | Yes (platform account guard) | **No** |
| `usedBytes` update | No (known gap) | **No** |
| B2 bucket path | `{uid}/{parentPath}/...` | `audits/{companyId}/{auditId}/...` |
| Response | `{ uploadSessionId, url }` | `{ fileId, fileURL }` |
| Presigned URL TTL | 1 hour (upload) | 7 days (download) |
| Firestore fields | Standard `files` doc | Extended with `companyId`, `auditId`, etc. |

---

## Endpoints

### POST /upload

Upload a file for ControlAudit. The backend receives the file and streams it directly to B2.

**Auth:** Required (Firebase ID Token)
**Content-Type:** `multipart/form-data`
**Max file size:** 5 GB

**Alternative path:** `POST /v1/external/upload` (same handler)

**Form fields:**

| Field | Required | Type | Description |
|---|---|---|---|
| `file` | Yes | binary | The file to upload |
| `auditId` | Yes | string | Audit identifier |
| `companyId` | Yes | string | Company identifier |
| `sourceApp` | No | string | App that triggered the upload (e.g. `"controlaudit"`) |
| `metadata` | No | JSON string | Arbitrary JSON metadata stored with the file |

**Response `200`:**
```json
{
  "fileId": "firestoreDocumentId",
  "fileURL": "https://b2.example.com/file/audits/...?signature=..."
}
```

`fileURL` is a presigned GET URL with **7-day TTL**. It expires — do not store as a permanent reference.

**Errors:** `400` missing required fields · `401` invalid token · `500` internal error

---

## B2 Storage Path

External uploads use a different bucket path format than standard uploads:

```
Standard:  {uid}/{parentPath}/{timestamp}_{randomId}_{sanitizedFileName}
External:  audits/{companyId}/{auditId}/{uuid}{fileExtension}
```

Example:
```
audits/company-abc/audit-xyz/550e8400-e29b-41d4-a716-446655440000.pdf
```

---

## Firestore Document

The handler creates a document in the `files` collection. The document includes **extra fields** not present in standard uploads:

```typescript
interface ExternalUploadFileDocument {
  // Standard fields
  userId: string;                  // Firebase UID of uploader
  type: "file";
  name: string;                    // Original filename
  size: number;                    // File size in bytes
  mime: string;                    // MIME type

  // Non-standard B2 path fields
  bucketPath: string;              // Same as bucketKey value (ControlAudit naming)
  bucketKey: string;               // Canonical field — same as bucketPath

  // External upload specific fields
  fileId: string;                  // Firestore document ID (denormalized)
  companyId: string;               // Company identifier
  auditId: string;                 // Audit identifier
  fileName: string;                // Original filename (denormalized)
  fileURL: string;                 // Presigned URL (7-day TTL, expires — do not store permanently)
  uploadedBy: string;              // Firebase UID (same as userId)
  sourceApp: string | null;        // Source app identifier (e.g. "controlaudit")
  metadata: object | null;         // Parsed JSON metadata from upload

  createdAt: Timestamp;
}
```

> **Critical:** `fileURL` in the Firestore document is a 7-day presigned URL. It expires. If you need a download URL after expiry, call `POST /api/files/presign-get` with the `fileId`.

---

## Quota Behavior

**This flow bypasses quota entirely.** No platform account guard check is performed. No `users/{uid}.usedBytes` update occurs. Files uploaded via external upload are invisible to the quota system.

This means:
1. A user could exceed their plan limit via external uploads
2. `usedBytes` in `users/{uid}` does not account for these files
3. The presign quota check (`requireStorage`) would not reflect actual usage

This is a known gap documented for awareness. Do not assume quota tracking is complete.

---

## When to Use

External upload is used by **ControlAudit** for attaching files to audits. It is not intended for general use.

```
✅ ControlAudit backend → POST /upload → attaches PDF to audit record
❌ ControlDoc, ControlGastos, etc. → should use standard presign flow
```

For standard file management features (list, share, delete, restore, quota), use the standard upload flow and standard `files` collection semantics.

---

## Presigned URL Behavior

The `fileURL` in the response is a B2 presigned GET URL valid for **7 days**. After expiry:

```javascript
// ✅ CORRECT: re-generate on demand
const { downloadUrl } = await fetch('/api/files/presign-get', {
  method: 'POST',
  body: JSON.stringify({ fileId }),
  headers: { Authorization: `Bearer ${token}` }
}).then(r => r.json());

// ❌ WRONG: store and reuse fileURL from upload response
await db.collection('audits').doc(auditId).update({ pdfUrl: fileURL }); // expires in 7 days
```
