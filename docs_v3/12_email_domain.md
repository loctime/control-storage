# ControlFile – Email Domain

---

## Overview

The email domain manages vehicle event alerts for ControlAudit. It is a **read/write backend** for alert state — it does not send emails itself. A separate email sender (cron job or external service) polls for pending alerts, sends them, then marks them as sent.

**Prefix:** `/api/email/` ONLY — no `/v1/` path. Not proxied through Next.js.

---

## Authentication Model

> **This domain uses two different auth models depending on the endpoint group.**

### Group A — System / cron endpoints (x-local-token)

Used by internal cron jobs and local ingestion scripts.

| Header | Value | Required |
|---|---|---|
| `x-local-token` | Value of `LOCAL_EMAIL_TOKEN` env var | Yes |

If `LOCAL_EMAIL_TOKEN` is not set in the environment, all requests are rejected with `500`.

Do NOT send `Authorization: Bearer ...` — it is not used here.

### Group B — User-facing endpoints (Firebase ID Token)

Used by the frontend on behalf of a logged-in responsable.

| Header | Value | Required |
|---|---|---|
| `Authorization` | `Bearer <firebase-id-token>` | Yes |

Additionally, the user's email must exist in `apps/emails/access` (synced via `POST /api/admin/sync-access-users`). If not found, the response is `403 USER_NOT_AUTHORIZED`.

---

## Alert System Architecture

```
Email arrives at Resend inbound domain
    ↓
POST /api/email/email-inbound (Resend webhook)
    ↓
Parser extracts vehicle events
    ↓
Stored in apps/emails/dailyAlerts/{dateKey}/vehicles/{plate}
    ↓
External cron polls GET /api/email/get-pending-daily-alerts
    ↓
Cron sends emails to responsables
    ↓
Cron marks sent: POST /api/email/mark-alert-sent
```

Alternatively:
```
Local Outlook script
    ↓
POST /api/email/email-local-ingest
    ↓ (same pipeline from here)
```

---

## Endpoints

### GET /api/email/get-pending-daily-alerts

Get daily alert summaries that have not yet been sent. Returns one consolidated entry per responsable email.

**Auth:** `x-local-token` header

**Response `200`:**
```json
[
  {
    "responsableEmails": ["user@example.com"],
    "subject": "Resumen de alertas - 2026-03-19",
    "body": "<html>...</html>",
    "alertIds": ["alert-id-1", "alert-id-2"]
  }
]
```

Each item represents one email to send. `alertIds` must be passed back to `mark-alert-sent` after sending.

**Behavior:**
- Looks back up to 5 days for unsent alerts
- Consolidates all pending alerts for each responsable into a single summary email
- Does not send — returns data for external sender

---

### POST /api/email/mark-alert-sent

Mark alert IDs as sent. Called by external sender after successfully sending.

**Auth:** `x-local-token` header

**Request:**
```json
{
  "alertIds": ["alert-id-1", "alert-id-2"]
}
```

**Response `200`:**
```json
{ "success": true }
```

**Side effects:** Updates `apps/emails/dailyAlerts` documents with `sentAt` timestamp

---

### POST /api/email/email-inbound

Resend inbound email webhook. Called by Resend when a vehicle alert email is received on the inbound domain.

**Auth:** None (Resend validates via signature — no `x-local-token` required)

**Flow:**
1. Resend POSTs webhook with `email_id` (metadata only — no content)
2. Handler fetches email content from Resend Receiving API (`GET /emails/receiving/{email_id}`)
3. Retries up to 3 times with progressive backoff
4. Parses vehicle events from email body
5. Persists events to Firestore

**Response `200`:** `{ success: true }`

---

### POST /api/email/email-local-ingest

Ingest an email from a local Outlook script (alternative to Resend inbound).

**Auth:** `x-local-token` header

**Request:**
```json
{
  "source": "outlook-local",
  "email": {
    "message_id": "unique-id",
    "from": "sender@example.com",
    "to": ["recipient@example.com"],
    "subject": "Vehicle Alert",
    "body_text": "...",
    "body_html": "<html>...</html>",
    "received_at": "2026-03-20T10:00:00Z",
    "attachments": []
  }
}
```

`source` must be `"outlook-local"`.

**Response `200`:** `{ success: true }`

**Behavior:** Same parsing and storage pipeline as `email-inbound`.

---

### GET /api/email/my-alerts

Paginates alerts for the authenticated responsable. Reads from the responsables index, not from `dailyAlerts` directly.

**Auth:** Firebase ID Token (Group B)

**Query params:**

| Param | Type | Default | Description |
|---|---|---|---|
| `limit` | number | `50` | Max items per page. Capped at `200`. |
| `startAfter` | string | — | Alert document ID to use as cursor for next page. |

**Response `200`:**
```json
{
  "ok": true,
  "alerts": [
    {
      "plate": "ABC123",
      "dateKey": "2026-03-20",
      "riskScore": 74,
      "alertSent": false
    }
  ]
}
```

**Source:** `apps/emails/responsables/{email}/alerts` — ordered by `createdAt` desc.

**Notes:**
- Returns only alerts where the authenticated user is a responsable.
- Pagination is cursor-based: pass the last `alertId` as `startAfter` for the next page.
- `alertSent: false` means the daily email for that vehicle/day has not been sent yet.

---

### GET /api/email/my-alerts-vehicles

Returns vehicles where the authenticated user is a responsable, enriched with risk data from the alerts index.

**Auth:** Firebase ID Token (Group B)

**Query params:** None

**Response `200`:**
```json
{
  "ok": true,
  "vehicles": [
    {
      "plate": "ABC123",
      "operationName": "Operación Norte",
      "lastEvent": "2026-03-20",
      "riskScore": 74
    }
  ]
}
```

**Sources:**
- `apps/emails/responsables/{email}/alerts` — to compute `riskScore` and `lastEvent` per plate.
- `apps/emails/vehicles` — filtered by `responsablesNormalized array-contains email`, to get vehicle metadata.

**Notes:**
- `operationName` falls back to `operacion` field if `operationName` is absent.
- `lastEvent` is the most recent `dateKey` (YYYY-MM-DD) found in the alerts index for that plate.
- `riskScore` is the maximum `riskScore` seen across all alerts for that plate (not today-only).
- A vehicle appears in the list even if it has no alerts (riskScore will be `0`, lastEvent will be `null`).

---

### GET /api/email/my-stats

Aggregated alert statistics for the authenticated responsable. Reads all alerts without pagination.

**Auth:** Firebase ID Token (Group B)

**Query params:** None

**Response `200`:**
```json
{
  "ok": true,
  "stats": {
    "totalAlerts": 42,
    "alertsToday": 3,
    "alertsPending": 10,
    "alertsSent": 32,
    "maxRisk": 95,
    "avgRisk": 61.4
  }
}
```

**Source:** `apps/emails/responsables/{email}/alerts` (full collection scan, no limit).

**Field descriptions:**
- `totalAlerts` — total alert documents for this responsable across all dates.
- `alertsToday` — count where `dateKey` equals today's date (server-side `YYYY-MM-DD`).
- `alertsPending` — count where `alertSent !== true`.
- `alertsSent` — count where `alertSent === true`.
- `maxRisk` — highest `riskScore` across all alerts.
- `avgRisk` — mean `riskScore` across alerts that have `riskScore > 0`.

---

### GET /api/email/my-risk

Returns vehicles grouped by plate with alert count and max risk score, sorted by risk descending.

**Auth:** Firebase ID Token (Group B)

**Query params:** None

**Response `200`:**
```json
{
  "ok": true,
  "vehicles": [
    {
      "plate": "ABC123",
      "alerts": 7,
      "maxRisk": 95
    },
    {
      "plate": "XYZ456",
      "alerts": 2,
      "maxRisk": 40
    }
  ]
}
```

**Source:** `apps/emails/responsables/{email}/alerts` (full collection scan, no limit).

**Sort order:** Primary by `maxRisk` descending, secondary by `plate` ascending (alphabetical).

**Notes:**
- Only includes plates that appear at least once in the alerts index.
- Unlike `my-alerts-vehicles`, does NOT cross-reference `apps/emails/vehicles` — purely derived from the alerts index.

---

## Firestore Collections

| Collection | Purpose |
|---|---|
| `apps/emails/dailyAlerts/{dateKey}/vehicles/{plate}` | Daily alert document per vehicle per date. Contains `events[]`, `summary`, `incidentSummary`, `riskScore`, `alertSent`, `responsables`. |
| `apps/emails/vehicles/{plate}` | Vehicle master records with `responsables`, `responsablesNormalized`, `operationName`. |
| `apps/emails/responsables/{email}/alerts/{alertId}` | Alert index per responsable. One document per (plate × dateKey). Fields: `plate`, `dateKey`, `riskScore`, `alertSent`, `createdAt`. Used by `my-alerts`, `my-stats`, `my-risk`. |
| `apps/emails/config/config` | Global email recipient config (generalRecipients, ccRecipients, reportRecipients). |
| `apps/emails/access` | Synced access users list (rebuilt by `POST /api/admin/sync-access-users`). |

---

## Admin Endpoints for Email Config

Email configuration (recipients) is managed via the `/api/admin/` domain with Firebase auth (not `x-local-token`). See [07_endpoints_reference.md](./07_endpoints_reference.md):

- `GET /api/admin/email-config` — read recipient lists
- `PATCH /api/admin/email-config` — update recipient lists
- `PATCH /api/admin/vehicle-alerts` — update vehicle responsables
- `POST /api/admin/sync-access-users` — rebuild access list

---

## Environment Variables

| Variable | Purpose |
|---|---|
| `LOCAL_EMAIL_TOKEN` | Shared secret for `x-local-token` auth on email endpoints |
