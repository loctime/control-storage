# ControlFile – Files and Folders

---

## The Unified `files` Collection

ControlFile uses a **single Firestore collection** called `files` for both files and folders.

There is no separate `folders` collection. The distinction is made by the `type` field:

```
files/{documentId}
  type: "file"    → a stored file
  type: "folder"  → a folder (virtual container)
```

> **Legacy note:** An old `folders` Firestore collection exists in the security rules for backward compatibility but is **not actively used**. Never write to it. Never read from it. All folders are in `files`.

---

## File Document

A document with `type: "file"` represents a stored file.

### Required Fields

| Field | Type | Description |
|---|---|---|
| `id` | string | Firestore document ID |
| `userId` | string | Owner's Firebase UID |
| `name` | string | File name (e.g. `"report.pdf"`) |
| `size` | number | File size in bytes |
| `mime` | string | MIME type (e.g. `"application/pdf"`) |
| `bucketKey` | string | B2 storage path. Format: `users/{userId}/files/{timestamp}-{name}` |
| `parentId` | string\|null | Parent folder document ID. `null` = root level |
| `path` | string | Full human-readable path |
| `ancestors` | string[] | Ordered list of ancestor folder document IDs |
| `type` | `"file"` | Discriminator — must always be set |
| `createdAt` | Timestamp | Creation time |
| `updatedAt` | Timestamp | Last update time |
| `deletedAt` | Timestamp\|null | `null` = active. Non-null = soft-deleted (in trash) |

### Optional Fields

| Field | Type | Description |
|---|---|---|
| `etag` | string | B2 ETag for integrity validation |

---

## Folder Document

A document with `type: "folder"` represents a virtual folder container.

### Required Fields

| Field | Type | Description |
|---|---|---|
| `id` | string | Firestore document ID |
| `userId` | string | Owner's Firebase UID |
| `name` | string | Folder name (e.g. `"My Documents"`) |
| `slug` | string | URL-friendly name (e.g. `"my-documents"`) |
| `parentId` | string\|null | Parent folder document ID. `null` = root level |
| `path` | string | Full human-readable path |
| `ancestors` | string[] | Ordered list of ancestor folder document IDs |
| `type` | `"folder"` | Discriminator — must always be set |
| `createdAt` | Timestamp | Creation time |
| `modifiedAt` | Timestamp | Last update time (`updatedAt` also accepted by code) |
| `deletedAt` | Timestamp\|null | `null` = active. Non-null = soft-deleted |

---

## Hierarchy Model

Folders and files form a tree using `parentId` and `ancestors`.

```
files/rootFolderA          (type: "folder", parentId: null)
  files/subFolderB         (type: "folder", parentId: "rootFolderA")
    files/fileC            (type: "file",   parentId: "subFolderB")
    files/fileD            (type: "file",   parentId: "subFolderB")
  files/fileE              (type: "file",   parentId: "rootFolderA")
```

For `fileC`, the document looks like:
```json
{
  "type": "file",
  "parentId": "subFolderB",
  "ancestors": ["rootFolderA", "subFolderB"],
  "path": "/My Root/Sub Folder B/document.pdf"
}
```

**App integration note:** Apps request their assigned root folder via `GET /api/folders/root`. They can create subfolders within it. Apps cannot create root-level folders (`parentId: null`) — only ControlFile system creates those.

---

## Ownership

All file and folder operations validate ownership using:
- Firestore Rules: `userId == uid()` on create/update/delete
- Backend: explicit check `fileData.userId === req.uid` before any operation

The `userId` field (not `uid`) is the owner identifier within the `files` collection.

---

## Soft Delete (Trash)

Deletion in ControlFile is **soft by default**. Deleting a file sets `deletedAt` to the current timestamp.

| State | `deletedAt` value |
|---|---|
| Active | `null` |
| In trash (soft-deleted) | Timestamp |

**Quota behavior on soft delete:**
- When a file is soft-deleted: `usedBytes -= size`
- The file is still physically present in B2
- The file is still present in Firestore with `deletedAt != null`

**Listing:** All queries for active files must filter `deletedAt == null`. ControlFile does not automatically exclude soft-deleted files from Firestore — the backend enforces this in every listing/access operation.

---

## Permanent Delete

To physically remove a file from both Firestore and B2, use:

- **Single file:** `POST /api/files/permanent-delete` (must already be soft-deleted)
- **Batch (trash):** `POST /api/files/empty-trash` with `fileIds[]`

Permanent delete:
1. Deletes the B2 object using `bucketKey`
2. Deletes the Firestore document
3. For batch: adjusts `usedBytes` (quota decremented)

**Note:** `POST /api/files/permanent-delete` (single file) has no Next.js proxy route. Call the backend directly at `BACKEND_URL/v1/files/permanent-delete` or use the ControlFile SDK.

---

## File Restore

Restoring a file from trash requires:
1. File exists in Firestore with `deletedAt != null`
2. User has sufficient quota: `usedBytes + fileData.size <= planQuotaBytes`

On restore:
- Sets `deletedAt = null`
- Increments `usedBytes += size`

**Note:** `POST /api/files/restore` has no Next.js proxy route. Call the backend directly at `BACKEND_URL/v1/files/restore` or use the SDK.

---

## Storage Field: `bucketKey`

`bucketKey` is the canonical identifier of a file in Backblaze B2.

- Format: `users/{userId}/files/{timestamp}-{name}`
- Must be present on every `type: "file"` document
- Required before generating presigned URLs or creating share links
- Never use alternative field names (`b2Key`, `objectKey`, `key`)

---

## Quota System

Quota is tracked in the `users/{uid}` Firestore document.

| Field | Description |
|---|---|
| `planQuotaBytes` | Total quota allowed by the plan |
| `usedBytes` | Bytes used by active (non-trashed) files |
| `pendingBytes` | Bytes reserved for uploads in progress |

**Validation formula (checked before every upload):**
```
usedBytes + pendingBytes + newFileSize <= planQuotaBytes
```

Quota is validated **before** generating the presigned upload URL — not after the upload completes.

### Quota Lifecycle

| Event | `usedBytes` | `pendingBytes` |
|---|---|---|
| Start upload (presign) | unchanged | += size |
| Confirm upload | += size | -= size |
| Soft delete | -= size | unchanged |
| Restore | += size | unchanged |
| Permanent delete (single) | unchanged (already decremented) | unchanged |
| Batch empty trash | -= sum(sizes) | unchanged |

---

## Operations Summary

| Operation | Endpoint | Notes |
|---|---|---|
| List files/folders | _(via SDK or direct Firestore)_ | Filter `deletedAt == null` |
| Rename | `POST /api/files/rename` | Works for both files and folders |
| Soft delete | `POST /api/files/delete` | Moves to trash |
| Restore from trash | `POST /api/files/restore` | Backend-direct only |
| Permanent delete (single) | `POST /api/files/permanent-delete` | Backend-direct only |
| Permanent delete (batch) | `POST /api/files/empty-trash` | Includes quota adjustment |
| Create folder | `POST /api/folders/create` | Cannot create root folders |
| Get root folder | `GET /api/folders/root` | Idempotent |
| Set main folder | `POST /api/folders/set-main` | — |
| Delete folder permanently | `POST /api/folders/permanent-delete` | — |
| Browse by slug | `GET /api/folders/by-slug/{user}/{path}` | — |
| Generate download URL | `POST /api/files/presign-get` | 5 min TTL |
| Download via proxy | `POST /api/files/proxy-download` | Streams through backend |
| Zip download | `POST /api/files/zip` | Max 200 files |
