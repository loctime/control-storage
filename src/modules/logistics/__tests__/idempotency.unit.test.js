const { describe, it, expect } = require("vitest");
const { computeRequestHash, computeScopeHash } = require("../utils/idempotencyHash");

describe("idempotency hash helpers", () => {
  it("genera hash estable para payload equivalente", () => {
    const a = computeRequestHash({ b: 1, a: 2 });
    const b = computeRequestHash({ a: 2, b: 1 });
    expect(a).toBe(b);
  });

  it("genera scope hash distinto por endpoint", () => {
    const x = computeScopeHash({ ownerId: "o1", endpoint: "/a", idempotencyKey: "k" });
    const y = computeScopeHash({ ownerId: "o1", endpoint: "/b", idempotencyKey: "k" });
    expect(x).not.toBe(y);
  });
});
