# @control/controlfile-sdk

TypeScript SDK for ControlFile — the centralized file management infrastructure for Control* apps (ControlAudit, ControlDoc, ControlGastos, ControlBio, ...).

Isomorphic: runs in browsers (SPAs) and in Node ≥ 18 backends. No Firebase SDK dependency.

## Install

```bash
pnpm add @control/controlfile-sdk
```

This is a private package published to GitHub Packages. Each consuming app needs an `.npmrc`:

```
@control:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

## Quickstart

```ts
import { ControlFileClient, QuotaExceededError } from "@control/controlfile-sdk";

const client = new ControlFileClient({
  baseUrl: "https://controlfile.example.com",
  // Return a fresh Firebase ID Token. The SDK calls this on every request.
  // On 401, the SDK calls it again once to get a refreshed token.
  getToken: async () => firebaseUser.getIdToken(),
  appId: "controlaudit",
});

// Resolve (or create) a folder under the app context
const { folderId } = await client.folders.resolve({
  contextType: "auditoria",
  companyId: "ACME",
});

// Upload — picks simple-direct, simple-proxy, or multipart automatically
const file: File = /* from <input type="file">  */ ...;
try {
  const result = await client.uploads.uploadFile({
    body: file,
    name: file.name,
    size: file.size,
    mime: file.type,
    parentId: folderId,
    onProgress: (e) => console.log(`${e.loaded}/${e.total}`),
  });
  console.log("Uploaded as", result.fileId, "via", result.strategy);
} catch (err) {
  if (err instanceof QuotaExceededError) {
    alert(`No space (need ${err.requestedBytes}, have ${err.availableBytes}).`);
  } else {
    throw err;
  }
}

// Download (presigned URL, expires in 5 minutes)
const { downloadUrl, fileName } = await client.files.getDownloadUrl(result.fileId);

// Public share
const share = await client.shares.create(result.fileId, { expiresInHours: 24 });

// CORS-safe image proxy (use directly in <img src>; B2 URLs do not have CORS headers)
imgEl.src = client.getShareImageUrl(share.shareToken);
```

## API surface

- `client.files` — `list`, `iterate` (async iterator), `softDelete`, `restore`, `permanentDelete`, `emptyTrash`, `rename`, `getDownloadUrl`, `download`, `zip`, `replace`
- `client.folders` — `create`, `getRoot`, `resolve` (idempotent), `setMain`, `permanentDelete`
- `client.uploads` — `uploadFile` (high-level), `presign`, `proxyUpload`, `confirm`
- `client.shares` — `create`, `revoke`, `listMine`, `getPublicMetadata`, `getPublicDownloadUrl`
- `client.identity` — `createUser` (backend only — never call from a frontend)
- `client.quota` — `initializeUser`, `getProfile`, `updateProfile`, `getSettings`, `updateSettings`, `getTaskbar`, `updateTaskbar`, `ensurePlatformAccount`
- `client.billing` — `listPlans`, `changePlan`, `checkout`

## Errors

The SDK throws typed errors so apps can branch on `instanceof` without parsing strings:

| Error | When |
|---|---|
| `AuthError` | 401 (token missing/expired/revoked/failed) |
| `QuotaExceededError` | 413 — has `availableBytes` and `requestedBytes` |
| `NotFoundError` | 404 |
| `ShareExpiredError` | 410 |
| `VirusBlockedError` | 451 |
| `ConflictError` | 409 |
| `ValidationError` | 400 |
| `AccountSuspendedError` | 403 with `ACCOUNT_NOT_ACTIVE` |
| `NetworkError` | fetch failures, timeouts |
| `ControlFileError` | base class — always catchable |

## Upload strategies

`uploadFile` decides between three strategies:

| Strategy | When | Notes |
|---|---|---|
| `simple-direct` | Size < 128 MB and `mode: "direct"`, or no proxy hint | PUT directly to Backblaze B2 (the URL is the credential, no `Authorization` header) |
| `simple-proxy` | Size < 128 MB, browser env, presign returned `proxyUpload` | POST multipart through ControlFile backend — avoids B2 CORS |
| `multipart` | Size ≥ 128 MB | Parallel PUT to each part URL, default concurrency 4 |

Default mode in browsers: `auto` (picks proxy if available, else direct).
Default mode in Node: `direct` (your backend has egress to B2 and there's no CORS).

## Progress

In the browser, upload progress for simple uploads requires `XMLHttpRequest` (the Fetch API does not expose upload progress). v1 emits start/end events in simple uploads when `onProgress` is set. Multipart progress fires per part completed (`partsCompleted`/`partsTotal`).

## Cancellation

All methods accept `signal?: AbortSignal`. Cancellation only affects local requests — the backend's upload session expires after 24 h on its own.

## Versioning

Strict semver. Breaking changes in the SDK (renames, dropped methods) ⇒ major bump. Backend contract changes typically map to minor bumps with code mapping.

## Development

```bash
pnpm install
pnpm build       # tsup → dist/
pnpm test        # vitest
pnpm typecheck   # tsc --noEmit
pnpm smoke       # scripts/smoke.ts (against staging — requires CF_TEST_ID_TOKEN)
```
