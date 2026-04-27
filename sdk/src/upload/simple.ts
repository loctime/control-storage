import { NetworkError } from "../errors.js";
import type { UploadInput } from "../types/upload.js";
import { retryWithBackoff, type RetryConfig } from "../utils/retry.js";
import { buildFormData } from "../utils/form-data.js";
import { materializeAsBlob } from "./chunker.js";

export interface SimpleDirectArgs {
  body: UploadInput;
  url: string;
  mime: string;
  retry: RetryConfig;
  signal?: AbortSignal;
  fetch: typeof globalThis.fetch;
}

export async function uploadSimpleDirect(args: SimpleDirectArgs): Promise<string> {
  const blob = await materializeAsBlob(args.body, args.mime);
  return retryWithBackoff(
    async () => {
      const res = await args.fetch(args.url, {
        method: "PUT",
        body: blob,
        headers: { "Content-Type": args.mime },
        signal: args.signal,
      });
      if (!res.ok) {
        throw new NetworkError(`B2 upload failed: HTTP ${res.status}`, {
          code: `B2_${res.status}`,
          statusCode: res.status,
        });
      }
      const etag = (res.headers.get("etag") ?? "").replace(/"/g, "");
      return etag;
    },
    args.retry,
    args.signal,
  );
}

export interface SimpleProxyArgs {
  body: UploadInput;
  name: string;
  mime: string;
  sessionId: string;
  proxyPath: string;
  baseUrl: string;
  getToken: () => Promise<string>;
  retry: RetryConfig;
  signal?: AbortSignal;
  fetch: typeof globalThis.fetch;
  sdkClient: string;
  sdkVersion: string;
}

export async function uploadSimpleProxy(args: SimpleProxyArgs): Promise<string> {
  const blob = await materializeAsBlob(args.body, args.mime);
  return retryWithBackoff(
    async () => {
      const fd = buildFormData(
        { sessionId: args.sessionId },
        { name: args.name, blob },
      );
      const token = await args.getToken();
      const url = joinAbsolute(args.baseUrl, args.proxyPath);
      const res = await args.fetch(url, {
        method: "POST",
        body: fd,
        headers: {
          Authorization: `Bearer ${token}`,
          "X-SDK-Client": args.sdkClient,
          "X-SDK-Version": args.sdkVersion,
        },
        signal: args.signal,
      });
      if (!res.ok) {
        throw new NetworkError(`Proxy upload failed: HTTP ${res.status}`, {
          code: `PROXY_${res.status}`,
          statusCode: res.status,
        });
      }
      const json = (await res.json()) as { etag?: string };
      return json.etag ?? "";
    },
    args.retry,
    args.signal,
  );
}

function joinAbsolute(base: string, rel: string): string {
  if (/^https?:\/\//.test(rel)) return rel;
  const b = base.replace(/\/+$/, "");
  const r = rel.startsWith("/") ? rel : `/${rel}`;
  return `${b}${r}`;
}
