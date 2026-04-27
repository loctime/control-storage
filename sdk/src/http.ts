import {
  buildErrorFromResponse,
  ControlFileError,
  NetworkError,
  isUserAbort,
} from "./errors.js";
import { joinUrl } from "./utils/url.js";
import { retryWithBackoff, type RetryConfig } from "./utils/retry.js";
import { SDK_CLIENT_NAME, SDK_VERSION } from "./config.js";

export interface HttpClientOptions {
  baseUrl: string;
  getToken: () => Promise<string>;
  fetch: typeof fetch;
  sdkClient: string;
  sdkVersion: string;
  retry: RetryConfig;
  hooks?: {
    onRequest?: (req: { method: string; url: string; headers: Headers }) => void;
    onResponse?: (res: { status: number; url: string; requestId?: string }) => void;
    onError?: (err: ControlFileError) => void;
  };
}

export interface RequestInit_ {
  method?: string;
  path: string;
  body?: BodyInit | null;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | null | undefined>;
  signal?: AbortSignal;
  auth?: boolean;
  json?: unknown;
  expect?: "json" | "stream" | "void";
  retry?: RetryConfig;
  idempotencyKey?: string;
  /** @internal */
  _didRefresh?: boolean;
}

export class HttpClient {
  constructor(private readonly opts: HttpClientOptions) {}

  async request<T = unknown>(init: RequestInit_): Promise<T> {
    const cfg = init.retry ?? this.opts.retry;
    return retryWithBackoff(
      (attempt) => this.doRequest<T>(init, attempt),
      cfg,
      init.signal,
    );
  }

  private async doRequest<T>(init: RequestInit_, _attempt: number): Promise<T> {
    const url = this.buildUrl(init.path, init.query);
    const headers = await this.buildHeaders(init);

    const requestInit: RequestInit = {
      method: init.method ?? (init.json !== undefined || init.body ? "POST" : "GET"),
      headers,
      signal: init.signal,
    };

    if (init.json !== undefined) {
      requestInit.body = JSON.stringify(init.json);
    } else if (init.body !== undefined) {
      requestInit.body = init.body;
    }

    this.opts.hooks?.onRequest?.({
      method: requestInit.method ?? "GET",
      url,
      headers,
    });

    let res: Response;
    try {
      res = await this.opts.fetch(url, requestInit);
    } catch (err) {
      if (isUserAbort(err)) throw err;
      const netErr = new NetworkError(
        err instanceof Error ? err.message : "Network request failed",
        { code: "NETWORK_ERROR", cause: err },
      );
      this.opts.hooks?.onError?.(netErr);
      throw netErr;
    }

    const requestId = res.headers.get("x-request-id") ?? undefined;
    this.opts.hooks?.onResponse?.({ status: res.status, url, requestId });

    if (res.status === 401 && init.auth !== false && !init._didRefresh) {
      const refreshed = await this.tryRefreshAndRetry<T>(init);
      if (refreshed.ok) return refreshed.value;
    }

    if (!res.ok) {
      const body = await this.safeJson(res);
      const err = buildErrorFromResponse(res.status, body, requestId);
      this.opts.hooks?.onError?.(err);
      throw err;
    }

    return this.parseBody<T>(res, init.expect);
  }

  private async tryRefreshAndRetry<T>(
    init: RequestInit_,
  ): Promise<{ ok: true; value: T } | { ok: false }> {
    try {
      const next = { ...init, _didRefresh: true } as RequestInit_;
      const value = await this.doRequest<T>(next, 0);
      return { ok: true, value };
    } catch {
      return { ok: false };
    }
  }

  private buildUrl(
    path: string,
    query?: Record<string, string | number | boolean | null | undefined>,
  ): string {
    const url = joinUrl(this.opts.baseUrl, path);
    if (!query) return url;
    const parts: string[] = [];
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      const stringValue = value === null ? "null" : String(value);
      parts.push(
        `${encodeURIComponent(key)}=${encodeURIComponent(stringValue)}`,
      );
    }
    return parts.length > 0 ? `${url}?${parts.join("&")}` : url;
  }

  private async buildHeaders(init: RequestInit_): Promise<Headers> {
    const headers = new Headers();
    headers.set("Accept", "application/json");
    headers.set("X-SDK-Client", this.opts.sdkClient);
    headers.set("X-SDK-Version", this.opts.sdkVersion);

    if (init.json !== undefined) {
      headers.set("Content-Type", "application/json");
    }

    if (init.idempotencyKey) {
      headers.set("x-idempotency-key", init.idempotencyKey);
    }

    if (init.auth !== false) {
      const token = await this.opts.getToken();
      headers.set("Authorization", `Bearer ${token}`);
    }

    if (init.headers) {
      for (const [k, v] of Object.entries(init.headers)) {
        headers.set(k, v);
      }
    }

    return headers;
  }

  private async parseBody<T>(
    res: Response,
    expect: RequestInit_["expect"],
  ): Promise<T> {
    if (expect === "stream") {
      return res.body as unknown as T;
    }
    if (expect === "void" || res.status === 204) {
      return undefined as unknown as T;
    }
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      return (await res.json()) as T;
    }
    if (expect === "json") {
      const text = await res.text();
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new ControlFileError("Expected JSON response", {
          code: "INVALID_RESPONSE",
          statusCode: res.status,
        });
      }
    }
    return res.body as unknown as T;
  }

  private async safeJson(
    res: Response,
  ): Promise<{
    error?: string;
    message?: string;
    code?: string;
    availableBytes?: number;
    requestedBytes?: number;
  } | null> {
    try {
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("application/json")) return null;
      return await res.json();
    } catch {
      return null;
    }
  }
}

export function createHttpClient(opts: HttpClientOptions): HttpClient {
  return new HttpClient(opts);
}

export function defaultSdkHeaders(): { client: string; version: string } {
  return { client: SDK_CLIENT_NAME, version: SDK_VERSION };
}
