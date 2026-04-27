import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { server } from "../msw/server.js";
import { baseUrl } from "../msw/handlers.js";
import { ControlFileClient } from "../../src/client.js";
import { ShareExpiredError } from "../../src/errors.js";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeClient() {
  return new ControlFileClient({
    baseUrl,
    getToken: async () => "fake-token",
    sdkVersion: "0.0.0-test",
  });
}

describe("files + shares basic flows", () => {
  it("lists files and parses canonical fields", async () => {
    const client = makeClient();
    const page = await client.files.list({ parentId: null });
    expect(page.items).toHaveLength(1);
    const item = page.items[0];
    expect(item).toBeDefined();
    if (!item) return;
    expect(item.type).toBe("file");
    if (item.type !== "file") return;
    expect(item.name).toBe("doc.pdf");
    expect(item.bucketKey).toBe("u1/2026/doc.pdf");
    expect(item.deletedAt).toBeNull();
  });

  it("getDownloadUrl returns a string and a future expiresAt", async () => {
    const client = makeClient();
    const info = await client.files.getDownloadUrl("f1");
    expect(info.downloadUrl).toContain("download?sig=");
    expect(info.fileName).toBe("doc.pdf");
    expect(info.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("creates a share and returns the share token", async () => {
    const client = makeClient();
    const res = await client.shares.create("f1", { expiresInHours: 24 });
    expect(res.shareToken).toBe("tok-abc");
    expect(res.shareUrl).toContain("tok-abc");
    expect(res.fileName).toBe("file-f1");
  });

  it("getShareImageUrl returns the SDK proxy URL (no fetch)", () => {
    const client = makeClient();
    const url = client.getShareImageUrl("tok-abc");
    expect(url).toBe(`${baseUrl}/v1/shares/tok-abc/image`);
  });

  it("public share metadata 410 → ShareExpiredError", async () => {
    const client = makeClient();
    await expect(
      client.shares.getPublicMetadata("tok-expired"),
    ).rejects.toBeInstanceOf(ShareExpiredError);
  });

  it("public share metadata 200 returns parsed body", async () => {
    const client = makeClient();
    const meta = await client.shares.getPublicMetadata("tok-good");
    expect(meta.fileName).toBe("doc.pdf");
    expect(meta.downloadCount).toBe(3);
  });
});
