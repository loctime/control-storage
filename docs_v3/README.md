# ControlFile – Backend Documentation v3

**Authoritative backend documentation. Clean, consolidated, no legacy confusion.**

> Ground truth: `TRUTH.md` (in `docs/docs_v2/`)
> This documentation was generated from an audit of all prior docs and verified against the actual route files.

---

## Documents

| File | Contents |
|---|---|
| [00_AUDIT_REPORT.md](./00_AUDIT_REPORT.md) | What was wrong with previous docs and what was fixed · Phase 2 bug fixes |
| [01_overview.md](./01_overview.md) | What ControlFile is · Role as shared backend · App relationships |
| [02_architecture.md](./02_architecture.md) | System components · Proxy layer · Request lifecycle · Route prefix rules |
| [03_authentication.md](./03_authentication.md) | Firebase ID Tokens · Custom claims · Ownership enforcement · IAM |
| [04_files_and_folders.md](./04_files_and_folders.md) | Unified `files` collection · Hierarchy · Soft delete · Quota |
| [05_uploads.md](./05_uploads.md) | 3-step upload flow · Presign → B2 → Confirm · Multipart · Platform account guard |
| [06_shares.md](./06_shares.md) | Share links · Token access · Image proxy · Public endpoints |
| [07_endpoints_reference.md](./07_endpoints_reference.md) | Complete endpoint reference (all methods, bodies, responses) |
| [08_data_models.md](./08_data_models.md) | Firestore schemas · Security rules · Field name standards · Platform account |
| [09_best_practices.md](./09_best_practices.md) | Anti-patterns · Integration checklist · Common mistakes |
| [10_platform_and_billing.md](./10_platform_and_billing.md) | Platform accounts · Plans · Stripe billing · Dual quota system |
| [11_uploads_external.md](./11_uploads_external.md) | External upload (ControlAudit) · Quota bypass · 7-day TTL |
| [12_email_domain.md](./12_email_domain.md) | Email alerts · x-local-token auth · Resend inbound webhook |
| [13_logistics.md](./13_logistics.md) | Logistics v2 · Remitos · Recepciones · Devoluciones · Pedidos internos |
| [14_training.md](./14_training.md) | Training catalog · Plans · Sessions · Attendance · Dashboard |
| [15_chat_and_repositories.md](./15_chat_and_repositories.md) | Repository indexing (GitHub) · Chat queries · Lifecycle states |
| [16_audio.md](./16_audio.md) | Audio mastering endpoint |
| [17_dashboard_and_horarios.md](./17_dashboard_and_horarios.md) | Fleet monitoring dashboard · Weekly schedule image upload |
| [18_users_extended.md](./18_users_extended.md) | user.js vs users.js collision · Settings · Taskbar · Plan endpoint |
| [19_internal_and_debug.md](./19_internal_and_debug.md) | Debug endpoints · Cache middleware · create-user disambiguation |

---

## Key Facts (Quick Reference)

**Collections:** `files` (unified files+folders) · `shares` · `uploadSessions` · `users`

**NOT a separate `folders` collection.** Folders live in `files` with `type: "folder"`.

**Storage field:** `bucketKey` (never `b2Key`, `objectKey`, etc.)

**Quota field:** `planQuotaBytes` (never `quotaBytes`)

**Share active field:** `isActive` (write) · also read `isPublic` for legacy compat

**Auth:** `Authorization: Bearer <firebase-id-token>` on all protected endpoints

**Backend prefix:** Most endpoints are at `BACKEND_URL/v1/...`
Exception: `users/initialize` and `users/profile` → `BACKEND_URL/api/...`

**Endpoints without Next.js proxy:**
- `POST /v1/files/restore`
- `POST /v1/files/permanent-delete` (single file)
- `GET /v1/shares/` (list user shares)

---

## Key Corrections (Phase 2)

- **Quota error code is `413`**, not `402` (corrected in `05_uploads.md` and `07_endpoints_reference.md`)
- **Quota formula is a hard cap**, not a remaining-space check: `size > limits.storageBytes`, not `usedBytes + size <= planQuota`
- **`confirm` does NOT update `usedBytes`** — only creates the `files` document
- **`bucketKey` format** is `{uid}/{parentPath}/{timestamp}_{randomId}_{name}`, not `users/{uid}/files/{timestamp}-{name}`
- **Route prefixes have exceptions** — email, dashboard, logistics, horarios have no `/v1/` path; repositories has no `/api/` path
- **Two quota systems exist** — platform account guard (presign) and users collection (restore/plan); external upload bypasses both

## What's New in v3

- Single authoritative endpoint reference (no more duplication across 5 files)
- Legacy `folders` collection fully removed from documentation
- All field names standardized (`bucketKey`, `planQuotaBytes`, `isActive`)
- Upload flow documented with multipart support
- Image proxy vs download endpoint distinction clearly explained
- Anti-patterns and integration checklists added
- Zero frontend content
- Consistent multi-tenant framing throughout
- **Phase 2:** 10 new domain files (platform, external upload, email, logistics, training, chat, audio, dashboard, users extended, internal)
- **Phase 2:** 8 correctness bugs fixed in existing files
