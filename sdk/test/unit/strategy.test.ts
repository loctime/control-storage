import { describe, it, expect } from "vitest";
import { MULTIPART_THRESHOLD, MAX_FILE_SIZE } from "../../src/config.js";
import {
  shouldUseMultipart,
  chooseSimpleStrategy,
  isMultipartResponse,
} from "../../src/upload/strategy.js";
import { ValidationError } from "../../src/errors.js";
import type {
  PresignSimple,
  PresignResponse,
} from "../../src/types/upload.js";

describe("shouldUseMultipart", () => {
  it("returns false just below threshold", () => {
    expect(shouldUseMultipart(MULTIPART_THRESHOLD - 1)).toBe(false);
  });
  it("returns true at threshold", () => {
    expect(shouldUseMultipart(MULTIPART_THRESHOLD)).toBe(true);
  });
  it("returns true above threshold", () => {
    expect(shouldUseMultipart(MULTIPART_THRESHOLD + 1)).toBe(true);
  });
  it("returns true for max file size", () => {
    expect(shouldUseMultipart(MAX_FILE_SIZE)).toBe(true);
  });
});

const presignWithProxy: PresignSimple = {
  uploadSessionId: "s1",
  url: "https://b2.example.com/upload?sig=abc",
  method: "PUT",
  proxyUpload: {
    method: "POST",
    path: "/v1/uploads/proxy-upload",
    contentType: "multipart/form-data",
    fileField: "file",
    sessionIdField: "sessionId",
  },
};

const presignNoProxy: PresignSimple = {
  uploadSessionId: "s2",
  url: "https://b2.example.com/upload?sig=def",
  method: "PUT",
};

describe("chooseSimpleStrategy", () => {
  it("auto + browser + proxy available → simple-proxy", () => {
    expect(chooseSimpleStrategy(presignWithProxy, "auto", true)).toBe(
      "simple-proxy",
    );
  });
  it("auto + node → simple-direct", () => {
    expect(chooseSimpleStrategy(presignWithProxy, "auto", false)).toBe(
      "simple-direct",
    );
  });
  it("auto + browser + no proxy → simple-direct", () => {
    expect(chooseSimpleStrategy(presignNoProxy, "auto", true)).toBe(
      "simple-direct",
    );
  });
  it("direct mode → simple-direct regardless of env", () => {
    expect(chooseSimpleStrategy(presignWithProxy, "direct", true)).toBe(
      "simple-direct",
    );
    expect(chooseSimpleStrategy(presignWithProxy, "direct", false)).toBe(
      "simple-direct",
    );
  });
  it("proxy mode without proxy metadata throws ValidationError", () => {
    expect(() => chooseSimpleStrategy(presignNoProxy, "proxy", true)).toThrow(
      ValidationError,
    );
  });
  it("proxy mode with proxy metadata → simple-proxy", () => {
    expect(chooseSimpleStrategy(presignWithProxy, "proxy", false)).toBe(
      "simple-proxy",
    );
  });
});

describe("isMultipartResponse", () => {
  it("returns true for multipart shape", () => {
    const r: PresignResponse = {
      uploadSessionId: "x",
      multipart: { uploadId: "u", parts: [] },
    };
    expect(isMultipartResponse(r)).toBe(true);
  });
  it("returns false for simple shape", () => {
    expect(isMultipartResponse(presignWithProxy)).toBe(false);
    expect(isMultipartResponse(presignNoProxy)).toBe(false);
  });
});
