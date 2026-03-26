# ControlFile – Dashboard & Horarios

---

## Dashboard

### Overview

The dashboard domain provides aggregated fleet monitoring statistics for ControlAudit. It reads from `apps/emails/dailyAlerts` and vehicle data.

**Prefix:** `/api/dashboard/` ONLY — no `/v1/` path.

**Auth:** Required (Firebase ID Token)

---

### GET /api/dashboard/summary

Get aggregated dashboard statistics for a given date.

**Auth:** Required
**Backend:** `GET /api/dashboard/summary`

**Query parameters:**

| Param | Required | Description |
|---|---|---|
| `date` | No | Date to query (`YYYY-MM-DD`). Defaults to the last date with data in Firestore |

**Response `200`:**
```json
{
  "ok": true,
  "date": "2026-03-19",
  "summary": { ... },
  "distribution": { ... },
  "criticalAlerts": [ ... ],
  "topVehicles": [ ... ],
  "recentEvents": [ ... ],
  "riskMap": { ... }
}
```

If no `date` is provided, the backend automatically selects the most recent date that has data in `apps/emails/dailyAlerts`.

If no data exists at all:
```json
{ "ok": true, "date": null, "summary": {}, ... }
```

**Errors:** `400` invalid date format · `500` internal error

---

### Data Source

The dashboard reads from:
- `apps/emails/dailyAlerts/{dateKey}` — daily alert summaries
- `apps/emails/dailyAlerts/{dateKey}/meta/meta` — aggregated daily metadata
- `apps/emails/vehicles` — vehicle records with plate, company, responsable info

Timezone: `America/Argentina/Buenos_Aires` for all date calculations.

---

## Horarios

### Overview

The horarios domain manages weekly schedule images (PNG) for ControlAudit. Images are stored in B2 and served/uploaded via this API.

**Prefix:** `/api/horarios/` ONLY — no `/v1/` path.

There is also a **public route** at `publicHorarios.routes.js` that serves images without auth.

---

### GET /api/horarios/semana-actual

Get the current week's schedule image. Streams PNG directly from B2.

**Auth:** Not required (public endpoint)

**Query parameters:**

| Param | Required | Description |
|---|---|---|
| `ownerId` | Yes | Owner identifier |
| `format` | No | `"webp"` to serve as WebP (default: PNG) |

**Response `200`:**
```http
Content-Type: image/png
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, HEAD, OPTIONS
Cross-Origin-Resource-Policy: cross-origin
Cache-Control: public, max-age=300, stale-while-revalidate=86400
[PNG image bytes]
```

**B2 bucket path:** `horarios/{ownerId}/semana-actual.png`

**Errors:**

| Status | Code | Description |
|---|---|---|
| `400` | `OWNER_ID_REQUIRED` | Missing `ownerId` |
| `404` | `NOT_FOUND` | No schedule image found for owner |
| `500` | `INTERNAL_ERROR` | B2 stream error |

---

### POST /api/horarios/semana-actual

Upload or replace the current week's schedule image.

**Auth:** Required (Firebase ID Token — must be owner or admin)
**Content-Type:** `multipart/form-data`
**Max file size:** 10 MB
**Accepted formats:** PNG only

**Form fields:**

| Field | Required | Description |
|---|---|---|
| `image` | Yes | PNG file |
| `ownerId` | Yes | Owner identifier |

**Response `200`:**
```json
{ "success": true, "bucketKey": "horarios/{ownerId}/semana-actual.png" }
```

**Side effects:** Uploads to B2 at `horarios/{ownerId}/semana-actual.png` (overwrites existing)

**Errors:**

| Status | Description |
|---|---|
| `400` | Missing `ownerId`, no file, or non-PNG file |
| `401` | Missing or invalid Firebase token |
| `500` | B2 upload error |

---

### Notes

- Both endpoints are at `/api/horarios/` with no `/v1/` equivalent
- The GET endpoint is public (no auth) — suitable for direct `<img>` tag use
- The POST endpoint requires auth — call from admin UI or backend
- Images are cached at the CDN layer for 5 minutes (with 24h stale-while-revalidate)
