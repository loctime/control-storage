/* eslint-disable no-console */
/**
 * Manual smoke test against a real ControlFile backend.
 *
 * Required env:
 *   CF_BASE_URL        e.g. https://controlfile-staging.example.com
 *   CF_TEST_ID_TOKEN   Firebase ID Token of a test user
 *   CF_APP_ID          e.g. controlaudit_smoke
 *
 * Usage: pnpm smoke
 */
import { ControlFileClient, ShareExpiredError } from "../src/index.js";

const BASE = process.env.CF_BASE_URL;
const TOKEN = process.env.CF_TEST_ID_TOKEN;
const APP_ID = process.env.CF_APP_ID ?? "smoke";

if (!BASE || !TOKEN) {
  console.error("Missing CF_BASE_URL or CF_TEST_ID_TOKEN.");
  process.exit(2);
}

const client = new ControlFileClient({
  baseUrl: BASE,
  getToken: async () => TOKEN,
  appId: APP_ID,
});

async function main(): Promise<void> {
  log("step", "ensurePlatformAccount");
  const acc = await client.quota.ensurePlatformAccount();
  log("account", { uid: acc.uid, planId: acc.planId, status: acc.status });

  log("step", "folders.resolve");
  const { folderId } = await client.folders.resolve({
    contextType: "smoke",
    contextEventId: `run-${Date.now()}`,
  });
  log("folder", { folderId });

  log("step", "upload simple");
  const small = new Blob([new Uint8Array(1024 * 1024)], {
    type: "application/octet-stream",
  });
  const t0 = Date.now();
  const simple = await client.uploads.uploadFile({
    body: small,
    name: `smoke-${Date.now()}.bin`,
    size: small.size,
    mime: "application/octet-stream",
    parentId: folderId,
  });
  log("uploaded", {
    ...simple,
    durationMs: Date.now() - t0,
  });

  log("step", "files.list");
  const page = await client.files.list({ parentId: folderId, pageSize: 10 });
  log("list", { count: page.items.length });

  log("step", "files.getDownloadUrl");
  const dl = await client.files.getDownloadUrl(simple.fileId);
  log("download", { fileName: dl.fileName, fileSize: dl.fileSize });

  log("step", "shares.create + getShareImageUrl");
  const share = await client.shares.create(simple.fileId, { expiresInHours: 1 });
  const imgUrl = client.getShareImageUrl(share.shareToken);
  log("share", { token: share.shareToken, imgUrl });

  log("step", "shares.revoke");
  await client.shares.revoke(share.shareToken);
  try {
    await client.shares.getPublicMetadata(share.shareToken);
    log("warning", "Share metadata was still accessible after revoke");
  } catch (err) {
    if (err instanceof ShareExpiredError) {
      log("share.revoked", "ok (410 ShareExpiredError)");
    } else {
      throw err;
    }
  }

  log("step", "cleanup");
  await client.files.softDelete(simple.fileId);
  await client.files.permanentDelete(simple.fileId);
  await client.folders.permanentDelete(folderId);

  log("done", "smoke test passed");
}

function log(tag: string, payload: unknown): void {
  console.log(JSON.stringify({ tag, payload }));
}

main().catch((err) => {
  console.error(JSON.stringify({ tag: "fatal", error: String(err), stack: (err as Error).stack }));
  process.exit(1);
});
