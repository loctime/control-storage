import { describe, it, expect } from "vitest";
import {
  buildErrorFromResponse,
  AuthError,
  QuotaExceededError,
  NotFoundError,
  ConflictError,
  ShareExpiredError,
  VirusBlockedError,
  ValidationError,
  AccountSuspendedError,
  ControlFileError,
  isRetryableError,
  isUserAbort,
  NetworkError,
} from "../../src/errors.js";

describe("buildErrorFromResponse", () => {
  it("401 → AuthError", () => {
    const err = buildErrorFromResponse(401, {
      error: "Token expirado",
      code: "AUTH_TOKEN_EXPIRED",
    });
    expect(err).toBeInstanceOf(AuthError);
    expect(err.code).toBe("AUTH_TOKEN_EXPIRED");
    expect(err.statusCode).toBe(401);
  });

  it("403 with ACCOUNT_NOT_ACTIVE → AccountSuspendedError", () => {
    const err = buildErrorFromResponse(403, {
      error: "Cuenta suspendida",
      code: "ACCOUNT_NOT_ACTIVE",
    });
    expect(err).toBeInstanceOf(AccountSuspendedError);
  });

  it("404 → NotFoundError", () => {
    const err = buildErrorFromResponse(404, { error: "Not found" });
    expect(err).toBeInstanceOf(NotFoundError);
  });

  it("409 → ConflictError", () => {
    const err = buildErrorFromResponse(409, {
      error: "Already completed",
      code: "ALREADY_COMPLETED",
    });
    expect(err).toBeInstanceOf(ConflictError);
  });

  it("410 → ShareExpiredError", () => {
    const err = buildErrorFromResponse(410, { error: "Share expired" });
    expect(err).toBeInstanceOf(ShareExpiredError);
    expect(err.code).toBe("SHARE_EXPIRED");
  });

  it("413 → QuotaExceededError with available/requested bytes", () => {
    const err = buildErrorFromResponse(413, {
      error: "Quota exceeded",
      code: "QUOTA_EXCEEDED",
      availableBytes: 100,
      requestedBytes: 500,
    });
    expect(err).toBeInstanceOf(QuotaExceededError);
    const q = err as QuotaExceededError;
    expect(q.availableBytes).toBe(100);
    expect(q.requestedBytes).toBe(500);
  });

  it("451 → VirusBlockedError", () => {
    const err = buildErrorFromResponse(451, { error: "Virus detected" });
    expect(err).toBeInstanceOf(VirusBlockedError);
  });

  it("400 → ValidationError", () => {
    const err = buildErrorFromResponse(400, { error: "Invalid" });
    expect(err).toBeInstanceOf(ValidationError);
  });

  it("500 → ControlFileError (base)", () => {
    const err = buildErrorFromResponse(500, null);
    expect(err).toBeInstanceOf(ControlFileError);
    expect(err.code).toBe("SERVER_ERROR");
  });
});

describe("isRetryableError", () => {
  it("retries on NetworkError", () => {
    expect(
      isRetryableError(new NetworkError("x", { code: "NETWORK_ERROR" })),
    ).toBe(true);
  });
  it("retries on 5xx", () => {
    expect(isRetryableError(buildErrorFromResponse(503, null))).toBe(true);
    expect(isRetryableError(buildErrorFromResponse(502, null))).toBe(true);
  });
  it("retries on 408 and 429", () => {
    expect(isRetryableError(buildErrorFromResponse(408, null))).toBe(true);
    expect(isRetryableError(buildErrorFromResponse(429, null))).toBe(true);
  });
  it("does NOT retry on 4xx", () => {
    expect(isRetryableError(buildErrorFromResponse(400, null))).toBe(false);
    expect(isRetryableError(buildErrorFromResponse(401, null))).toBe(false);
    expect(isRetryableError(buildErrorFromResponse(404, null))).toBe(false);
    expect(isRetryableError(buildErrorFromResponse(413, null))).toBe(false);
  });
  it("does not retry on plain Error", () => {
    expect(isRetryableError(new Error("boom"))).toBe(false);
  });
});

describe("isUserAbort", () => {
  it("detects DOMException AbortError", () => {
    const e = new DOMException("Aborted", "AbortError");
    expect(isUserAbort(e)).toBe(true);
  });
  it("does not match other errors", () => {
    expect(isUserAbort(new Error("x"))).toBe(false);
    expect(isUserAbort(null)).toBe(false);
  });
});
