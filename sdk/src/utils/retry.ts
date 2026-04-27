import { isRetryableError, isUserAbort } from "../errors.js";

export interface RetryOptions {
  retries?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
}

export interface RetryConfig {
  retries: number;
  minDelayMs: number;
  maxDelayMs: number;
}

export function resolveRetry(
  override: RetryOptions | undefined,
  defaults: RetryConfig,
): RetryConfig {
  return {
    retries: override?.retries ?? defaults.retries,
    minDelayMs: override?.minDelayMs ?? defaults.minDelayMs,
    maxDelayMs: override?.maxDelayMs ?? defaults.maxDelayMs,
  };
}

function backoffDelay(attempt: number, cfg: RetryConfig): number {
  const exp = cfg.minDelayMs * Math.pow(2, attempt);
  const jitter = Math.floor(Math.random() * 200);
  return Math.min(cfg.maxDelayMs, exp + jitter);
}

export async function retryWithBackoff<T>(
  fn: (attempt: number) => Promise<T>,
  cfg: RetryConfig,
  signal?: AbortSignal,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= cfg.retries; attempt++) {
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (isUserAbort(err)) throw err;
      if (attempt >= cfg.retries) break;
      if (!isRetryableError(err)) break;
      await sleep(backoffDelay(attempt, cfg), signal);
    }
  }
  throw lastErr;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
