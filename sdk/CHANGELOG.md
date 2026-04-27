# Changelog

All notable changes to `@control/controlfile-sdk` will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — Unreleased

### Added
- Initial release.
- `ControlFileClient` with domains: `files`, `folders`, `uploads`, `shares`, `identity`, `quota`, `billing`.
- Isomorphic upload pipeline (`uploadFile`) that auto-selects between simple-direct, simple-proxy, and multipart strategies based on size, environment, and presign metadata.
- Typed error hierarchy (`AuthError`, `QuotaExceededError`, `NotFoundError`, `ShareExpiredError`, `VirusBlockedError`, `ConflictError`, `ValidationError`, `AccountSuspendedError`, `NetworkError`).
- Refresh-on-401: SDK calls `getToken()` again and retries the failed request once.
- Canonical type names enforced (`bucketKey`, `userId`, `planQuotaBytes`, `isActive`); legacy aliases (`b2Key`, `quotaBytes`, `isPublic`) read but never written.
- Branded `BucketKey` to prevent accidental construction from string.
- CORS-safe `getShareImageUrl(token)` for `<img src>` consumers.
- Async iterator `client.files.iterate()` over paginated `list()`.
- Automatic `x-idempotency-key` on `uploads.confirm` and `folders.create`.
