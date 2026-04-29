import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { server } from "../msw/server.js";
import { baseUrl } from "../msw/handlers.js";
import { ControlFileClient } from "../../src/client.js";

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

describe("uploads.uploadFile (simple)", () => {
  it("uploads a small Blob and returns fileId (simple-direct in node)", async () => {
    const client = makeClient();
    const blob = new Blob(["hello world"], { type: "text/plain" });
    const result = await client.uploads.uploadFile({
      body: blob,
      name: "hello.txt",
      size: blob.size,
      mime: "text/plain",
      mode: "direct",
    });
    expect(result.fileId).toBe("file-confirmed");
    expect(result.strategy).toBe("simple-direct");
    expect(result.etag).toBe("etag-simple");
    expect(result.bytesUploaded).toBe(blob.size);
  });

  it("uses simple-proxy when mode=proxy and proxyUpload metadata is present", async () => {
    const client = makeClient();
    const blob = new Blob(["hi"], { type: "text/plain" });
    const result = await client.uploads.uploadFile({
      body: blob,
      name: "hi.txt",
      size: blob.size,
      mime: "text/plain",
      mode: "proxy",
    });
    expect(result.strategy).toBe("simple-proxy");
    expect(result.etag).toBe("etag-proxy");
  });

  it("rejects MIME with invalid shape", async () => {
    const client = makeClient();
    const blob = new Blob(["x"], { type: "application/octet-stream" });
    await expect(
      client.uploads.uploadFile({
        body: blob,
        name: "x",
        size: 1,
        mime: "not-a-mime",
      }),
    ).rejects.toMatchObject({ code: "INVALID_MIME" });
  });

  it("rejects size <= 0", async () => {
    const client = makeClient();
    const blob = new Blob(["x"]);
    await expect(
      client.uploads.uploadFile({
        body: blob,
        name: "x",
        size: 0,
        mime: "text/plain",
      }),
    ).rejects.toMatchObject({ code: "INVALID_SIZE" });
  });
});
