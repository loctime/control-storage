# ControlFile – Training

---

## Overview

The training domain manages employee training programs: catalog items, training plans, sessions, and attendance. It provides a dashboard for tracking compliance status.

**Prefix:** `/api/training/`, `/v1/training/`

---

## Concepts

| Entity | Description |
|---|---|
| **Catalog** | Master list of training topics/courses available |
| **Plan** | A training plan assigned to a group or branch (references catalog items) |
| **Plan Item** | A specific catalog item within a plan |
| **Session** | A scheduled training event (date, location, topic) |
| **Attendance** | Record that an employee attended a session |

---

## Catalog Endpoints

### GET /api/training/catalog

List all training catalog items.

**Auth:** Required

**Response `200`:**
```json
[
  { "id": "...", "name": "Fire Safety", "description": "...", "duration": 60, ... }
]
```

---

### POST /api/training/catalog

Create a new catalog item.

**Auth:** Required

**Request:**
```json
{
  "name": "Fire Safety",
  "description": "...",
  "duration": 60
}
```

---

### PATCH /api/training/catalog/:id

Update an existing catalog item.

**Auth:** Required

---

### DELETE /api/training/catalog/:id

Delete a catalog item.

**Auth:** Required

---

## Plan Endpoints

### GET /api/training/plans

List training plans.

**Auth:** Required

---

### POST /api/training/plans

Create a training plan.

**Auth:** Required

---

### PATCH /api/training/plans/:id

Update a training plan.

**Auth:** Required

---

## Plan Item Endpoints

### GET /api/training/plans/:id/items

List items within a specific training plan.

**Auth:** Required

---

### POST /api/training/items

Add an item to a training plan.

**Auth:** Required

---

### PATCH /api/training/items/:id

Update a plan item.

**Auth:** Required

---

### DELETE /api/training/items/:id

Remove a plan item.

**Auth:** Required

---

## Session Endpoints

### GET /api/training/sessions

List training sessions.

**Auth:** Required

---

### POST /api/training/sessions

Create a training session.

**Auth:** Required

---

### PATCH /api/training/sessions/:id

Update a training session.

**Auth:** Required

---

### POST /api/training/sessions/:id/attendance

Register employee attendance for a session.

**Auth:** Required

**Request:**
```json
{
  "employeeId": "uid-or-id",
  "present": true
}
```

---

## Dashboard & Status Endpoints

### GET /api/training/dashboard

Get aggregated training statistics dashboard.

**Auth:** Required

**Response `200`:** Aggregated compliance and completion metrics.

---

### GET /api/training/employees/:employeeId/status

Get training status for a specific employee.

**Auth:** Required

**Response `200`:** Employee's training completion state against their assigned plan.

---

## Notes

- Training domain uses the standard dual `/api/training/` and `/v1/training/` prefix
- All endpoints use Firebase ID token auth (not `x-local-token`)
- The module is implemented via full controller/service/repository pattern under `modules/training/`
