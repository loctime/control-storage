# ControlFile – Overview

> **Authoritative source:** `TRUTH.md`
> This document derives from TRUTH.md. In case of conflict, TRUTH.md takes precedence.

---

## What is ControlFile?

ControlFile is the **centralized file management infrastructure** for the Control\* ecosystem.

It is a **shared backend platform** — not an application. Multiple independent applications use it as their file storage layer:

- **ControlAudit** — audit and compliance documents
- **ControlDoc** — document management
- **ControlGastos** — expense receipts and attachments
- **ControlBio** — biometric and HR files
- _(and any future Control\* application)_

---

## What ControlFile Is Responsible For

| Responsibility | Owner |
|---|---|
| File storage (upload, download, delete) | ControlFile |
| Folder hierarchy management | ControlFile |
| Authentication enforcement | ControlFile |
| Presigned URL generation | ControlFile |
| Public share links | ControlFile |
| Storage quota tracking | ControlFile |
| CORS-safe image serving | ControlFile |
| B2 integration | ControlFile |

---

## What ControlFile Is NOT Responsible For

| Concern | Owner |
|---|---|
| Business logic of apps | Each app's own backend |
| App-specific Firestore collections | Each app's own backend |
| Business validation limits | Each app's own backend |
| UI and frontend rendering | Each app's frontend |
| Generating presigned URLs in apps | ControlFile only |
| Direct B2 access from apps | Prohibited |

---

## Core Principle

> **A file does not belong to an app. It belongs to the system.**

Applications reference files by `fileId`. They request access via share tokens. ControlFile decides how, when, and to whom files are exposed.

---

## What ControlFile Provides

### 1. File & Folder Management
A unified `files` Firestore collection stores both files and folders (differentiated by `type`). Operations: create, rename, soft-delete, restore, permanent-delete.

### 2. Upload Pipeline
A 3-step flow: create session → client uploads directly to B2 → confirm. Quota is validated before upload. Files are never streamed through the backend for standard uploads.

### 3. Download Access
Two paths:
- **Private:** Authenticated presigned URL via `POST /api/files/presign-get` (5 min TTL)
- **Public:** Share token access via `POST /api/shares/{token}/download`

### 4. Share Links
Token-based public access to files. Supports expiration, revocation, download counting, and CORS-safe image proxying.

### 5. Storage Backend
All files stored in Backblaze B2 (S3-compatible). No file content passes through the ControlFile backend except for the image proxy endpoint and `controlfile/upload` alternate path.

### 6. Identity / IAM Layer
ControlFile also acts as a shared IAM service. It creates Firebase Auth users and applies custom claims on behalf of app backends.

---

## Relationship with External Apps

```
┌──────────────────────────────────────────────────────────┐
│                    External App Backend                   │
│           (ControlAudit, ControlDoc, etc.)                │
└───────────────┬──────────────────────────────────────────┘
                │ API calls with Firebase ID Token
                ▼
┌──────────────────────────────────────────────────────────┐
│                  ControlFile Backend                      │
│           Shared infrastructure for all apps              │
└──────┬───────────────────────┬───────────────────────────┘
       │                       │
       ▼                       ▼
┌─────────────┐       ┌────────────────┐
│  Firestore  │       │  Backblaze B2  │
│  (Metadata) │       │  (File bytes)  │
└─────────────┘       └────────────────┘
```

**An app calls ControlFile to:**
- Upload a file on behalf of a user
- List/retrieve that user's files
- Create a public share link for a file
- Delete or rename a file
- Create a user account in Firebase Auth

**An app does NOT:**
- Generate presigned URLs directly against B2
- Access B2 directly
- Manage its own copy of file metadata
- Serve files to end users without going through ControlFile

---

## Technology Stack

| Component | Technology |
|---|---|
| Backend | Node.js + Express |
| Authentication | Firebase Auth (Admin SDK) |
| Metadata storage | Firestore |
| File storage | Backblaze B2 (S3-compatible API) |
| Backend deploy | Render |
| Frontend proxy layer | Next.js 14 (App Router) |

---

## Navigation

- [Architecture →](./02_architecture.md)
- [Authentication →](./03_authentication.md)
- [Files & Folders →](./04_files_and_folders.md)
- [Uploads →](./05_uploads.md)
- [Shares →](./06_shares.md)
- [Endpoint Reference →](./07_endpoints_reference.md)
- [Data Models →](./08_data_models.md)
- [Best Practices →](./09_best_practices.md)
