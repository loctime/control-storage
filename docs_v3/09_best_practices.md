# ControlFile – Best Practices

---

## Integration Principles

### 1. Apps Do Not Touch Storage

Apps never interact with Backblaze B2 directly. All storage operations go through ControlFile endpoints.

```
✅ CORRECT:
  App → POST /api/uploads/presign → ControlFile → B2 presigned URL → Client uploads

❌ WRONG:
  App generates B2 presigned URL directly and gives it to client
```

---

### 2. Never Persist Presigned URLs

Presigned URLs are ephemeral. Never store them in Firestore, databases, or return them as permanent references.

```
✅ CORRECT:
  Generate presigned URL on demand when user requests download.
  Return it to client. Let it expire.

❌ WRONG:
  Store presigned URL in files/{id}.downloadUrl
  Cache it in local state for long periods
```

Presigned URL TTLs:
- Downloads: **5 minutes**
- Uploads: **1 hour**

---

### 3. Always Use `bucketKey` — Never Alternatives

The canonical B2 object identifier is `bucketKey`. Never introduce or use alternative field names.

```
✅ CORRECT:  fileDoc.bucketKey
❌ WRONG:    fileDoc.b2Key, fileDoc.objectKey, fileDoc.key, fileDoc.storageKey
```

---

### 4. Validate `bucketKey` Before B2 Operations

Before generating a presigned URL or creating a share, verify `bucketKey` is present on the file document.

```typescript
if (!fileDoc.bucketKey) {
  throw new Error('File has no bucketKey — cannot generate access URL');
}
```

---

### 5. Always Filter `deletedAt == null` When Listing Files

The `files` collection includes soft-deleted documents. All queries must explicitly exclude them.

```typescript
// ✅ CORRECT
firestore.collection('files')
  .where('userId', '==', uid)
  .where('deletedAt', '==', null)

// ❌ WRONG
firestore.collection('files')
  .where('userId', '==', uid)  // includes trash items
```

---

### 6. Use `/api/shares/{token}/image` for `<img>` Tags

The `/download` endpoint returns a presigned B2 URL, which lacks CORS headers. Browsers block cross-origin image loads from B2 URLs.

```html
<!-- ✅ CORRECT: CORS-safe proxy -->
<img src="/api/shares/TOKEN/image" />

<!-- ❌ WRONG: B2 presigned URL has no CORS headers -->
<img src="https://b2.example.com/file/...?signature=..." />
```

---

### 7. Validate Quota Before Presigning — Not After

Quota validation happens in `POST /api/uploads/presign`. The formula uses `pendingBytes` to account for concurrent uploads.

```
usedBytes + pendingBytes + newFileSize <= planQuotaBytes
```

Do not implement this check in app code — let ControlFile handle it. The backend returns `402` if quota is exceeded.

---

### 8. Create User Identity via Backend, Not Frontend

`POST /api/admin/create-user` must only be called from app backends. Frontend clients must never call it directly.

```
✅ CORRECT:
  Frontend → App Backend → POST /api/admin/create-user (ControlFile)
                 ↓
           App Backend handles business logic

❌ WRONG:
  Frontend → POST /api/admin/create-user directly
```

---

### 9. Apps Write Their Own Firestore

ControlFile only creates the Firebase Auth identity. Apps are responsible for writing their own Firestore collections (e.g. `apps/auditoria/operarios`).

```typescript
// ControlFile creates identity:
const { uid } = await fetch('/api/admin/create-user', { body: {...} }).then(r => r.json());

// YOUR app backend writes business data:
await firestore.collection('apps/myapp/users').doc(uid).set({
  nombre: data.nombre,
  role: data.role,
  createdAt: FieldValue.serverTimestamp(),
});
```

---

### 10. Use `type: "file"` and `type: "folder"` — Never the Legacy `folders` Collection

```typescript
// ✅ CORRECT: query unified files collection
firestore.collection('files').where('type', '==', 'folder').where('userId', '==', uid)

// ❌ WRONG: legacy collection — do not use
firestore.collection('folders').where('userId', '==', uid)
```

---

### 11. Read `isPublic` for Backwards Compatibility, Never Write It

When checking if a share is active, account for the legacy `isPublic` field. But never set it in new code.

```typescript
// ✅ CORRECT validation:
const isValid =
  share.isActive !== false &&
  (share.isPublic === undefined || share.isPublic !== false) &&
  (share.expiresAt === null || share.expiresAt.toDate() > new Date());

// ✅ CORRECT write:
await firestore.collection('shares').doc(token).update({ isActive: false });

// ❌ WRONG write:
await firestore.collection('shares').doc(token).update({ isPublic: false }); // never
```

---

### 12. Apps Request Their Root Folder, Not Create It

Apps should not create root-level folders (`parentId: null`). Use `GET /api/folders/root` which is idempotent:

```typescript
// ✅ CORRECT: get or create root folder (idempotent)
const { id: rootFolderId } = await fetch('/api/folders/root?appId=myapp', {
  headers: { Authorization: `Bearer ${token}` }
}).then(r => r.json());

// ❌ WRONG: creating root folder directly
await fetch('/api/folders/create', {
  method: 'POST',
  body: JSON.stringify({ name: 'My App', parentId: null }) // not allowed for apps
});
```

---

## Common Anti-Patterns

| Anti-Pattern | Why It's Wrong | Correct Approach |
|---|---|---|
| Store presigned URL in Firestore | URL expires in 5 min, becomes stale | Generate on demand via `presign-get` |
| Use `b2Key` field name | Not the canonical name | Always use `bucketKey` |
| Read from `folders` collection | Legacy, not used | Read from `files` where `type == "folder"` |
| Use `isPublic` to check/set shares | Legacy field | Use `isActive` |
| Query `files` without `deletedAt == null` | Returns trash items | Always filter on `deletedAt` |
| Call `admin/create-user` from frontend | Security risk | Only from app backend |
| Use `quotaBytes` field | Wrong field name | Use `planQuotaBytes` |
| Validate quota after upload | Too late — user wasted bandwidth | Validate at presign time |
| Use `<img src={presignedUrl}>` | No CORS headers from B2 | Use `/api/shares/{token}/image` |
| Direct B2 presigned URLs from apps | Bypasses ControlFile security | Always go through ControlFile endpoints |

---

## Error Handling

Always check HTTP status codes before using response data:

```typescript
const response = await fetch('/api/uploads/presign', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ name, size, mime }),
});

if (response.status === 402) {
  // Quota exceeded — show user-friendly message
  throw new Error('Storage quota exceeded');
}

if (!response.ok) {
  const { error } = await response.json();
  throw new Error(error || 'Unknown error');
}

const { uploadSessionId, url } = await response.json();
```

---

## Upload Flow Checklist

When implementing the upload flow:

- [ ] Send `Authorization: Bearer <token>` header on `presign` and `confirm`
- [ ] Include `size` in bytes (exact file size, not approximate)
- [ ] Include correct `mime` type
- [ ] Handle `402` response (quota exceeded) with user message
- [ ] Upload to B2 using the exact `url` returned (do not modify it)
- [ ] For multipart: collect `ETag` from each part response header
- [ ] Call `confirm` with `uploadSessionId` + ETags
- [ ] Use returned `fileId` as the permanent reference to the file

---

## Share Flow Checklist

When implementing share access:

- [ ] `GET /api/shares/{token}` to show preview page (metadata only)
- [ ] `POST /api/shares/{token}/download` to get download URL (5 min TTL)
- [ ] `GET /api/shares/{token}/image` for `<img>` tags (not presigned URL)
- [ ] Handle `410` response (expired/revoked) gracefully
- [ ] Handle `404` response (not found) gracefully
- [ ] Do not cache presigned URLs from `/download` — they expire in 5 minutes
