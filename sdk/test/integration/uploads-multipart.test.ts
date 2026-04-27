import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { server } from "../msw/server.js";
import { baseUrl } from "../msw/handlers.js";
import { ControlFileClient } from "../../src/client.js";
import { MULTIPART_THRESHOLD } from "../../src/config.js";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("uploads.uploadFile (multipart)", () => {
  it("splits a large Blob into 4 parts and confirms with parts list", async () => {
    const client = new ControlFileClient({
      baseUrl,
      getToken: async () => "fake-token",
      sdkVersion: "0.0.0-test",
      uploadConcurrency: 2,
    });

    const size = MULTIPART_THRESHOLD;
    const buf = new Uint8Array(size);
    const blob = new Blob([buf], { type: "application/octet-stream" });

    let lastProgress = 0;
    let lastPartsCompleted = 0;
    const result = await client.uploads.uploadFile({
      body: blob,
      name: "big.bin",
      size,
      mime: "application/octet-stream",
      onProgress: (e) => {
        lastProgress = e.loaded;
        lastPartsCompleted = e.partsCompleted ?? lastPartsCompleted;
      },
    });

    expect(result.strategy).toBe("multipart");
    expect(result.parts).toHaveLength(4);
    expect(result.parts?.[0]).toEqual({ PartNumber: 1, ETag: '"etag-1"' });
    expect(result.parts?.[3]).toEqual({ PartNumber: 4, ETag: '"etag-4"' });
    expect(lastProgress).toBe(size);
    expect(lastPartsCompleted).toBe(4);
    expect(result.fileId).toBe("file-confirmed");
  });
});
