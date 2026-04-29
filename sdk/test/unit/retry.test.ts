import { describe, it, expect, vi } from "vitest";
import { retryWithBackoff, resolveRetry } from "../../src/utils/retry.js";
import { NetworkError, ValidationError } from "../../src/errors.js";

const fastCfg = { retries: 3, minDelayMs: 1, maxDelayMs: 4 };

describe("retryWithBackoff", () => {
  it("returns the value on first success", async () => {
    const fn = vi.fn(async () => "ok");
    const got = await retryWithBackoff(fn, fastCfg);
    expect(got).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on NetworkError until success", async () => {
    let attempt = 0;
    const fn = vi.fn(async () => {
      if (attempt++ < 2) {
        throw new NetworkError("transient", { code: "NETWORK_ERROR" });
      }
      return "ok";
    });
    const got = await retryWithBackoff(fn, fastCfg);
    expect(got).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-retryable errors", async () => {
    const fn = vi.fn(async () => {
      throw new ValidationError("nope", { code: "INVALID", statusCode: 400 });
    });
    await expect(retryWithBackoff(fn, fastCfg)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives up after exhausting retries", async () => {
    const fn = vi.fn(async () => {
      throw new NetworkError("perma", { code: "NETWORK_ERROR" });
    });
    await expect(retryWithBackoff(fn, fastCfg)).rejects.toBeInstanceOf(
      NetworkError,
    );
    expect(fn).toHaveBeenCalledTimes(1 + fastCfg.retries);
  });

  it("respects user abort signal", async () => {
    const ac = new AbortController();
    ac.abort();
    const fn = vi.fn(async () => "ok");
    await expect(retryWithBackoff(fn, fastCfg, ac.signal)).rejects.toBeDefined();
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("resolveRetry", () => {
  it("uses defaults when no override", () => {
    expect(resolveRetry(undefined, fastCfg)).toEqual(fastCfg);
  });
  it("merges override over defaults", () => {
    const merged = resolveRetry({ retries: 7 }, fastCfg);
    expect(merged.retries).toBe(7);
    expect(merged.minDelayMs).toBe(fastCfg.minDelayMs);
    expect(merged.maxDelayMs).toBe(fastCfg.maxDelayMs);
  });
});
