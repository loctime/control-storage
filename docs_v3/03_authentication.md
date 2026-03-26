# ControlFile – Authentication

---

## Overview

ControlFile uses **Firebase Authentication** as its identity layer. All protected endpoints require a valid Firebase ID Token passed as a Bearer token in the `Authorization` header.

There is no session, cookie, or API key system. Every request is stateless and self-authenticating via the ID token.

---

## Firebase ID Token

### What it is

A short-lived JWT issued by Firebase Auth after a user signs in. It contains the user's `uid`, email, and any custom claims set by the backend.

### How to send it

```http
Authorization: Bearer <firebase-id-token>
```

The token is passed as-is through the Next.js proxy layer to the backend. The backend verifies it using Firebase Admin SDK.

### Token lifetime

Firebase ID tokens expire after **1 hour**. Clients must refresh them using the Firebase SDK before making requests with an expired token.

---

## Custom Claims

ControlFile sets custom claims on Firebase Auth tokens for users managed by the system. These claims are readable in the token payload after the next token refresh.

| Claim | Type | Description |
|---|---|---|
| `appId` | string | The app this user belongs to (e.g. `"auditoria"`) |
| `role` | string | Role within that app (`"admin"`, `"supermax"`, `"superdev"`) |
| `ownerId` | string | UID of the owner (usually same as `uid`) |

Claims are set by `POST /api/admin/create-user`. Apps read them from the token to enforce their own access rules.

---

## Endpoint Auth Requirements

### Public (no auth)

These endpoints require no `Authorization` header:

| Endpoint | Notes |
|---|---|
| `GET /api/shares/{token}` | Token is the auth mechanism |
| `POST /api/shares/{token}/download` | Token is the auth mechanism |
| `GET /api/shares/{token}/image` | Token is the auth mechanism |
| `POST /api/shares/{token}/increment-counter` | Internal use by Cloudflare Worker |
| `GET /api/health` | Health check |

### Protected (Firebase ID Token required)

All upload, file, folder, share-create/revoke, and user endpoints require a valid Firebase ID Token:

| Endpoint Group | Auth |
|---|---|
| `POST /api/uploads/presign` | Firebase ID Token |
| `POST /api/uploads/confirm` | Firebase ID Token |
| `POST /api/files/*` | Firebase ID Token |
| `GET|POST /api/folders/*` | Firebase ID Token |
| `POST /api/shares/create` | Firebase ID Token |
| `POST /api/shares/revoke` | Firebase ID Token |
| `GET /api/shares/` | Firebase ID Token |
| `POST|GET|PUT /api/users/*` | Firebase ID Token |

### Admin (Backend-to-backend only)

| Endpoint | Auth |
|---|---|
| `POST /api/admin/create-user` | Firebase ID Token with `role: admin` or `supermax` |

This endpoint must only be called from an app backend. Frontend clients must never call it directly.

### Superdev (role: superdev)

| Endpoint | Auth |
|---|---|
| `GET /api/superdev/list-owners` | Firebase ID Token with `role: superdev` |
| `POST /api/superdev/impersonate` | Firebase ID Token with `role: superdev` |

---

## Ownership Enforcement

Beyond token validation, the backend enforces **ownership** for every file operation:

| Collection | Ownership field | Enforced by |
|---|---|---|
| `files` | `userId == uid` | Backend + Firestore Rules |
| `shares` | `uid == uid` | Backend |
| `uploadSessions` | `uid == uid` | Backend + Firestore Rules |
| `users` | document ID == `uid` | Firestore Rules |

A valid token is not enough — the token's `uid` must match the resource owner.

---

## IAM / Identity Management

ControlFile also acts as a centralized identity layer (IAM) for the Control\* ecosystem.

### Creating Users

App backends call `POST /api/admin/create-user` to create a user in Firebase Auth and set custom claims. ControlFile handles **Auth only** — it does not write to the app's Firestore or apply business logic.

```
App Backend → POST /api/admin/create-user → Firebase Auth + Claims
    ↓
App Backend writes own Firestore
App Backend applies business validation
```

### Input
```json
{
  "email": "user@example.com",
  "password": "TemporaryPass123!",
  "nombre": "User Name",
  "appId": "auditoria",
  "role": "admin"
}
```

**Note:** `nombre` maps internally to Firebase Auth `displayName`.

### Output
```json
{
  "uid": "firebase-auth-uid",
  "status": "created",
  "source": "controlfile"
}
```

---

## Auth Error Responses

When authentication fails, the backend returns:

| Status | Meaning |
|---|---|
| `401` | Missing token, invalid token, expired token, revoked token |
| `403` | Valid token but insufficient role/permissions |

Error response format:
```json
{
  "error": "Human-readable message",
  "code": "MACHINE_READABLE_CODE"
}
```

Common error codes (superdev endpoints):

| Code | Meaning |
|---|---|
| `UNAUTHORIZED` | Missing or invalid token |
| `TOKEN_EXPIRED` | Token is expired |
| `TOKEN_REVOKED` | Token has been revoked |
| `FORBIDDEN` | Token valid but role insufficient |

---

## Firestore Rules and Auth

Firestore security rules provide a baseline enforcement layer. The backend adds a second layer of ownership validation for all write operations.

**Important:** The `files` collection has `allow read: if true`. This is intentional — it allows Cloudflare Workers to read share-related file metadata without a token. The actual file content (in B2) is protected by presigned URLs. No sensitive data should be stored in the `files` Firestore collection.

See [Data Models → Firestore Rules](./08_data_models.md#firestore-rules) for the full rules.
