# Backend recommendations (optional)

These are non-blocking suggestions for the ControlFile backend. v1 of the SDK works without them; they would simplify v2 and reduce the SDK's surface area.

## 1. Standardize `/v1/` prefix for user-scoped endpoints

Today these only exist under `/api/...`:
- `GET/POST /api/user/settings`
- `GET/POST /api/user/taskbar`
- `POST /api/user/plan`

The SDK has to special-case them. Aliasing them under `/v1/users/...` (or any `/v1/`) lets the SDK use a single base prefix.

## 2. Always include `availableBytes`/`requestedBytes` on 413

`QuotaExceededError` exposes these fields when the backend returns them, but they are not consistently present in every 413 response (see `requireStorage`, the soft-quota check on uploads). Always emitting them lets app UIs show "you need 12 MB more" without an extra fetch.

## 3. Return `expiresAt` (ISO) on `/v1/files/presign-get`

Today the SDK computes `Date.now() + 5 * 60_000`. If the backend ever changes the TTL, every consumer drifts. Returning the exact expiry from the backend makes it authoritative.

## 4. Include `partSize` in multipart presign response

The SDK currently computes `Math.ceil(size / parts.length)` to slice the body. If the backend's chunking math drifts (e.g. min part size of 5 MB on B2), the SDK could miscalculate. Have the presign response carry `multipart.partSize` and use it directly.

## 5. Endpoint to abort a multipart upload

When a user cancels a 5 GB upload mid-way, the SDK can only abort local requests; the server-side multipart session lingers until the 24h expiry. A `POST /v1/uploads/abort { uploadSessionId }` would let the SDK tear it down promptly.

## 6. Accept streamed bodies on `/v1/uploads/proxy-upload`

For server-side uploads in Node, having to materialize the full Blob in memory is wasteful for big files. Accepting `Transfer-Encoding: chunked` on the proxy endpoint lets the SDK stream straight from disk.

## 7. Reuse upload sessions on retry

`POST /v1/uploads/confirm` returning 409 `ALREADY_COMPLETED` for a duplicate confirm is good. Consider also accepting a presign retry that returns the same session if the same `(uid, name, size, mime, parentId)` tuple is presented within N minutes — would simplify SDK retry logic.

## 8. Stable error code dictionary

Document the canonical set of `code` values per status. Today the SDK maps a known set; new codes added on the backend silently degrade to the base `ControlFileError`. A contract file (`docs_v3/ERROR_CODES.md`) would be nice.
