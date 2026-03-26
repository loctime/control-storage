# ControlFile – Platform Accounts & Billing

---

## Overview

ControlFile has a **platform layer** that tracks per-user accounts with plan limits. This is separate from the `users` Firestore collection. The platform layer is the authoritative source for quota enforcement at upload time.

---

## Dual Quota System

> **This is a known architectural inconsistency.** Two separate quota systems coexist and are not reconciled.

| System | Firestore path | Used by | What it checks |
|---|---|---|---|
| **Platform account guard** | `platform/accounts/accounts/{uid}` | `POST /uploads/presign` | `fileSize > limits.storageBytes` (hard cap) |
| **Users quota fields** | `users/{uid}` | `POST /files/restore`, `POST /user/plan` | `usedBytes + fileSize <= planQuotaBytes` |

### Platform Account Guard (presign)

```typescript
function requireStorage(account, requestedBytes) {
  if (requestedBytes > account.limits.storageBytes) {
    throw new QuotaExceededError(account, requestedBytes); // statusCode: 413
  }
}
```

- Compares **individual file size** against **total plan limit**
- Does **not** subtract previously used space
- Returns `413` on failure
- Account auto-created on first presign if document missing (defaults: `FREE_5GB`, 5GB)

### Users Collection (restore / plan change)

```typescript
// POST /files/restore
if (userData.usedBytes + fileData.size > userData.planQuotaBytes) {
  return res.status(413).json({ error: '...' });
}
```

- Uses cumulative `usedBytes` tracking
- Compares against `planQuotaBytes` from `users` doc

### External Upload (no quota check)

`POST /upload` and `POST /v1/external/upload` (ControlAudit flow) bypass both quota systems entirely. See [11_uploads_external.md](./11_uploads_external.md).

---

## Platform Account Document

**Collection:** `platform/accounts/accounts/{uid}` (subcollection under `platform/accounts`)

```typescript
interface PlatformAccountDocument {
  uid: string;                      // Firebase UID (also the document ID)
  email: string;                    // User email (denormalized)
  status: "active" | "suspended";  // Suspended = cannot upload
  planId: string;                   // e.g. "FREE_5GB", "PRO_50GB"
  limits: {
    storageBytes: number;           // Hard storage cap in bytes
  };
  enabledApps: Record<string, boolean>;  // App access flags
  paidUntil: Timestamp | null;      // Subscription expiry date
  trialEndsAt: Timestamp | null;    // Trial period end
  createdAt: Timestamp;
  updatedAt: Timestamp;
  metadata: {
    notes?: string;                 // Internal admin notes
    [key: string]: unknown;
  };
}
```

Default account (auto-created):
```json
{
  "status": "active",
  "planId": "FREE_5GB",
  "limits": { "storageBytes": 5368709120 },
  "enabledApps": {},
  "paidUntil": null,
  "trialEndsAt": null
}
```

---

## Platform Endpoints

### POST /api/platform/accounts/ensure

Ensure a platform account exists for the authenticated user. Idempotent — creates with FREE_5GB defaults if missing, returns existing if present.

**Auth:** Required (any authenticated user)
**Backend:** `POST /v1/platform/accounts/ensure`

**Response `200`:**
```json
{
  "uid": "firebase-uid",
  "status": "active",
  "planId": "FREE_5GB",
  "limits": { "storageBytes": 5368709120 },
  "enabledApps": {},
  "paidUntil": null,
  "trialEndsAt": null,
  "createdAt": "2026-03-20T10:00:00.000Z"
}
```

---

### GET /api/platform/accounts

List all platform accounts.

**Auth:** Required — `role: "platform_owner"` or `PLATFORM_OWNER_UID` env match
**Backend:** `GET /v1/platform/accounts`

**Query parameters:**

| Param | Description |
|---|---|
| `status` | Filter by `"active"` or `"suspended"` |
| `limit` | Max results (default `100`, max `500`) |

**Response `200`:**
```json
{ "accounts": [ { ... }, { ... } ] }
```

---

### GET /api/platform/accounts/:uid

Get a specific platform account by UID.

**Auth:** Required — `platform_owner`
**Backend:** `GET /v1/platform/accounts/:uid`

**Response `200`:** Platform account document

**Errors:** `404` not found

---

### PATCH /api/platform/accounts/:uid

Modify a platform account. Uses action-based dispatch.

**Auth:** Required — `platform_owner`
**Backend:** `PATCH /v1/platform/accounts/:uid`

**Actions:**

| `action` | Additional fields | Effect |
|---|---|---|
| `"suspend"` | — | Sets `status = "suspended"` |
| `"activate"` | — | Sets `status = "active"` |
| `"change_plan"` | `planId` (string) | Updates plan; `planId` must exist in `platform/plans` |
| `"update_apps"` | `enabledApps` (object) | Replaces `enabledApps` map |
| `"extend_paidUntil"` | `paidUntil` (ISO date string) | Updates subscription expiry |
| `"update_limits"` | `limits` (object, e.g. `{ storageBytes: N }`) | Replaces limits |
| `"update_notes"` | `note` (string) | Writes to `metadata.notes` |

**Request example:**
```json
{ "action": "change_plan", "planId": "PRO_50GB" }
```

**Response `200`:**
```json
{ "success": true, "account": { ... } }
```

---

### GET /api/platform/plans

List all platform plans.

**Auth:** Required — `platform_owner`
**Backend:** `GET /v1/platform/plans`

**Response `200`:**
```json
{
  "plans": [
    {
      "planId": "FREE_5GB",
      "name": "Free",
      "limits": { "storageBytes": 5368709120 },
      "apps": { "controlfile": true },
      "pricing": { "monthly": 0, "yearly": 0 },
      "isActive": true
    }
  ]
}
```

---

### POST /api/platform/plans

Create a new platform plan.

**Auth:** Required — `platform_owner`
**Backend:** `POST /v1/platform/plans`

**Request:**
```json
{
  "planId": "PRO_50GB",
  "name": "Pro",
  "limits": { "storageBytes": 53687091200 },
  "apps": { "controlfile": true, "controlaudit": true },
  "pricing": { "monthly": 9.99, "yearly": 99 },
  "description": "Pro plan with 50GB storage",
  "features": ["feature_a", "feature_b"]
}
```

**Errors:** `409` plan already exists

---

### GET /api/platform/plans/:planId

Get a specific plan by ID.

**Auth:** Required — `platform_owner`
**Backend:** `GET /v1/platform/plans/:planId`

---

### PATCH /api/platform/plans/:planId

Update an existing platform plan.

**Auth:** Required — `platform_owner`
**Backend:** `PATCH /v1/platform/plans/:planId`

---

## Billing Endpoint

### POST /api/billing/checkout

Create a Stripe Checkout session for plan subscription.

**Auth:** Required (any authenticated user)
**Backend:** `POST /v1/billing/checkout`

**Request:**
```json
{
  "planId": "PRO_50GB",
  "interval": "monthly"
}
```

| Field | Required | Values | Default |
|---|---|---|---|
| `planId` | Yes | Must exist in `plans.json` | — |
| `interval` | No | `"monthly"` \| `"yearly"` | `"monthly"` |

**Response `200`:**
```json
{ "url": "https://checkout.stripe.com/pay/..." }
```

Client redirects user to `url`. On success, Stripe redirects to `{BASE_URL}/settings?checkout=success`.

**Errors:** `400` invalid plan/interval · `500` Stripe not configured

**Note:** Checkout session metadata includes `userId`, `planId`, and `interval`. Post-checkout plan activation requires a Stripe webhook handler (not documented in current backend).

---

## Plan Source: `plans.json`

The billing checkout endpoint reads plan pricing from `config/plans.json` (not Firestore). This is a separate config file from `platform/plans` collection.

```json
{
  "plans": [
    {
      "planId": "free",
      "name": "Free",
      "quotaBytes": 5368709120,
      "pricing": { "monthly": 0, "yearly": 0 }
    }
  ]
}
```

> **Naming discrepancy:** `plans.json` uses `quotaBytes`. Firestore `users` collection uses `planQuotaBytes`. These are bridged in `POST /api/user/plan`. Do not confuse them.

---

## Auth: `platform_owner` Role

Platform management endpoints require `role: "platform_owner"` in Firebase custom claims, OR the caller's UID must match `PLATFORM_OWNER_UID` environment variable.

This role is separate from `admin` and `superdev`. It grants access to platform management (plans, accounts, billing) but not app-level admin functions.

---

## Relationship to `users` Collection

The platform account (`platform/accounts/accounts/{uid}`) and the user document (`users/{uid}`) are independent. They exist in parallel:

- Platform account: created by `POST /platform/accounts/ensure` or auto-created during presign
- User document: created by `POST /users/initialize` (Firebase auth middleware on first login)

Neither document creation triggers the other.
