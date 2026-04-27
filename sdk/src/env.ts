export const isBrowser =
  typeof globalThis !== "undefined" &&
  typeof (globalThis as { window?: unknown }).window !== "undefined" &&
  typeof (globalThis as { document?: unknown }).document !== "undefined";

export const isNode =
  !isBrowser &&
  typeof globalThis !== "undefined" &&
  typeof (globalThis as { process?: { versions?: { node?: string } } }).process
    ?.versions?.node === "string";

export function getGlobalFetch(): typeof fetch {
  const g = globalThis as { fetch?: typeof fetch };
  if (!g.fetch) {
    throw new Error(
      "Global fetch is not available. Use Node >=18 or pass `fetch` in client options.",
    );
  }
  return g.fetch.bind(globalThis);
}
