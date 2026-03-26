# ControlFile – Users Extended (user.js vs users.js)

---

## Overview

Two separate route files handle user-related endpoints, and they conflict on the `/v1/users` prefix.

| File | Mounted at | Handles |
|---|---|---|
| `routes/users.js` | `/api/users`, `/v1/users` | Profile, initialize |
| `routes/user.js` | `/api/user` **only** | Settings, taskbar, plan |

`users.js` takes precedence on `/v1/users`. The `user.js` routes at `/user/settings`, `/user/taskbar`, `/user/plan` are only accessible via `/api/user/...`.

---

## `users.js` — Profile & Initialize

These endpoints match the documented contract in [07_endpoints_reference.md](./07_endpoints_reference.md).

### POST /api/users/initialize

Initialize user document on first login. Called by the auth middleware automatically or explicitly by the app.

**Auth:** Required
**Backend path:** `POST /api/users/initialize` (also `/v1/users/initialize`)

**Request:**
```json
{ "displayName": "User Name" }
```

**Side effects:** Creates or updates `users/{uid}` document with default quota fields

---

### GET /api/users/profile

Get user profile and quota summary.

**Auth:** Required
**Backend path:** `GET /api/users/profile`

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

Update user display name.

**Auth:** Required
**Backend path:** `PUT /api/users/profile`

**Request:**
```json
{ "displayName": "New Name" }
```

---

## `user.js` — Settings, Taskbar, Plan

These endpoints are **only accessible at `/api/user/`**. The `/v1/user/` path does not work due to the collision described above.

### GET /api/user/settings

Get user billing interval setting.

**Auth:** Required
**Storage:** `userSettings/{uid}` (NOT `users/{uid}`)

**Response `200`:**
```json
{ "billingInterval": "monthly" }
```

Returns `null` for `billingInterval` if not set.

---

### POST /api/user/settings

Update user billing interval setting.

**Auth:** Required

**Request:**
```json
{ "billingInterval": "monthly" }
```

| Value | Description |
|---|---|
| `"monthly"` | Monthly billing |
| `"yearly"` | Annual billing |

**Side effects:** Writes `userSettings/{uid}.billingInterval`

---

### GET /api/user/taskbar

Get user taskbar items.

**Auth:** Required
**Storage:** `userSettings/{uid}.taskbarItems`

**Response `200`:**
```json
{
  "items": [
    {
      "id": "item-id",
      "name": "My Folder",
      "icon": "Folder",
      "color": "text-purple-600",
      "type": "folder",
      "isCustom": true,
      "folderId": "folderDocId"
    }
  ]
}
```

Returns empty array if not set.

---

### POST /api/user/taskbar

Save user taskbar items. Replaces existing list.

**Auth:** Required

**Request:**
```json
{
  "items": [
    {
      "id": "item-id",
      "name": "My Folder",
      "icon": "Folder",
      "color": "text-purple-600",
      "type": "folder",
      "isCustom": true,
      "folderId": "folderDocId"
    }
  ]
}
```

Taskbar item fields:

| Field | Type | Default | Description |
|---|---|---|---|
| `id` | string | — | Required. Item identifier |
| `name` | string | — | Required. Display name |
| `icon` | string | `"Folder"` | Icon name |
| `color` | string | `"text-purple-600"` | Tailwind color class |
| `type` | `"folder"` \| `"app"` | `"folder"` | Item type |
| `isCustom` | boolean | `true` | Whether user-customized |
| `folderId` | string | — | Optional. Firestore folder doc ID |

Items with missing `id` or `name` are silently filtered out.

**Side effects:** Writes `userSettings/{uid}.taskbarItems` (full replace)

---

### POST /api/user/plan

Apply a plan to the user. Validates that downgrade doesn't exceed current usage, then writes plan data to `users/{uid}`.

**Auth:** Required

**Request:**
```json
{
  "planId": "free",
  "interval": "monthly"
}
```

| Field | Required | Description |
|---|---|---|
| `planId` | Yes | Must exist in `config/plans.json` |
| `interval` | No | `"monthly"` \| `"yearly"` |

**Validations:**
- Plan must exist in `plans.json`
- If downgrading: `usedBytes <= plan.quotaBytes` (from `users/{uid}`) — returns `409` if user has more data than new plan allows

**Side effects:** Writes to `users/{uid}`:
```json
{
  "planQuotaBytes": 1073741824,
  "planId": "free",
  "billingInterval": "monthly",
  "updatedAt": "..."
}
```

**Naming discrepancy to note:**

| Source | Field name | Value |
|---|---|---|
| `plans.json` | `quotaBytes` | Plan quota in bytes |
| `users/{uid}` | `planQuotaBytes` | Same value, different field name |
| Validation check | `plan.quotaBytes` | Read from plans.json |
| Written to Firestore | `planQuotaBytes` | Written as `planQuotaBytes` |

This naming gap exists in the code. Do not normalize without updating both sides.

---

## `userSettings` Collection

Stores per-user UI preferences. Document ID = Firebase UID.

```typescript
interface UserSettingsDocument {
  billingInterval: "monthly" | "yearly" | null;
  taskbarItems: TaskbarItem[];
  updatedAt: Timestamp;
}
```

This collection is separate from `users/{uid}` and is NOT read by quota or auth code.

---

## Route Collision Summary

```
/v1/users/*  →  users.js handles (profile, initialize)
/api/users/* →  users.js handles (same)

/api/user/*  →  user.js handles (settings, taskbar, plan)
/v1/user/*   →  ❌ does NOT work (not mounted on /v1/)
```

If you receive a 404 on `/v1/user/settings`, you must use `/api/user/settings` instead.
