export function composeSignals(
  ...signals: ReadonlyArray<AbortSignal | undefined>
): AbortSignal | undefined {
  const valid = signals.filter((s): s is AbortSignal => s !== undefined);
  if (valid.length === 0) return undefined;
  if (valid.length === 1) return valid[0];

  const anyFn = (
    AbortSignal as unknown as { any?: (s: ReadonlyArray<AbortSignal>) => AbortSignal }
  ).any;
  if (typeof anyFn === "function") return anyFn(valid);

  const controller = new AbortController();
  for (const s of valid) {
    if (s.aborted) {
      controller.abort(s.reason);
      return controller.signal;
    }
    s.addEventListener("abort", () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}
