import { describe, it, expect } from "vitest";
import {
  materializeAsBlob,
  planChunks,
  sliceBlob,
} from "../../src/upload/chunker.js";

describe("planChunks", () => {
  it("computes ceil partSize", () => {
    expect(planChunks(1000, 4)).toEqual({ partSize: 250, totalParts: 4 });
    expect(planChunks(1001, 4)).toEqual({ partSize: 251, totalParts: 4 });
  });
  it("throws on zero parts", () => {
    expect(() => planChunks(100, 0)).toThrow();
  });
});

describe("materializeAsBlob", () => {
  it("returns the same Blob untouched", async () => {
    const b = new Blob(["hello"], { type: "text/plain" });
    const out = await materializeAsBlob(b, "text/plain");
    expect(out).toBe(b);
  });

  it("wraps an ArrayBuffer", async () => {
    const data = new TextEncoder().encode("hello");
    const out = await materializeAsBlob(data.buffer, "text/plain");
    expect(out.size).toBe(5);
    expect(await out.text()).toBe("hello");
  });

  it("wraps a Uint8Array view", async () => {
    const data = new TextEncoder().encode("world");
    const out = await materializeAsBlob(data, "text/plain");
    expect(out.size).toBe(5);
    expect(await out.text()).toBe("world");
  });

  it("collects a ReadableStream", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("foo"));
        controller.enqueue(new TextEncoder().encode("bar"));
        controller.close();
      },
    });
    const out = await materializeAsBlob(stream, "text/plain");
    expect(await out.text()).toBe("foobar");
  });
});

describe("sliceBlob", () => {
  it("slices at byte boundaries", async () => {
    const b = new Blob(["abcdefgh"], { type: "text/plain" });
    expect(await sliceBlob(b, 0, 4).text()).toBe("abcd");
    expect(await sliceBlob(b, 4, 8).text()).toBe("efgh");
  });
});
