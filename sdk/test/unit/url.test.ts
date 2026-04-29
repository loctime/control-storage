import { describe, it, expect } from "vitest";
import { joinUrl, encodeQuery } from "../../src/utils/url.js";

describe("joinUrl", () => {
  it("joins with single slash", () => {
    expect(joinUrl("https://api.example.com", "/v1/files")).toBe(
      "https://api.example.com/v1/files",
    );
  });
  it("strips trailing slashes from base", () => {
    expect(joinUrl("https://api.example.com/", "/v1/files")).toBe(
      "https://api.example.com/v1/files",
    );
    expect(joinUrl("https://api.example.com//", "/v1/files")).toBe(
      "https://api.example.com/v1/files",
    );
  });
  it("adds leading slash when missing", () => {
    expect(joinUrl("https://api.example.com", "v1/files")).toBe(
      "https://api.example.com/v1/files",
    );
  });
});

describe("encodeQuery", () => {
  it("returns empty string when no params", () => {
    expect(encodeQuery({})).toBe("");
  });
  it("skips undefined", () => {
    expect(encodeQuery({ a: undefined, b: "x" })).toBe("?b=x");
  });
  it("encodes null as 'null'", () => {
    expect(encodeQuery({ parentId: null })).toBe("?parentId=null");
  });
  it("encodes special chars", () => {
    expect(encodeQuery({ name: "a b/c" })).toBe("?name=a%20b%2Fc");
  });
  it("preserves numbers and booleans", () => {
    expect(encodeQuery({ pageSize: 100, deleted: true })).toBe(
      "?pageSize=100&deleted=true",
    );
  });
});
