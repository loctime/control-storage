import {
  DEFAULT_PAGE_SIZE,
  DEFAULT_RETRY,
  DEFAULT_UPLOAD_CONCURRENCY,
  SDK_CLIENT_NAME,
  SDK_VERSION,
} from "./config.js";
import { isBrowser, getGlobalFetch } from "./env.js";
import { createHttpClient } from "./http.js";
import type { ControlFileError } from "./errors.js";
import { resolveRetry, type RetryOptions } from "./utils/retry.js";
import { joinUrl } from "./utils/url.js";
import { FilesDomain } from "./domains/files.js";
import { FoldersDomain } from "./domains/folders.js";
import { SharesDomain } from "./domains/shares.js";
import { IdentityDomain } from "./domains/identity.js";
import { QuotaDomain } from "./domains/quota.js";
import { BillingDomain } from "./domains/billing.js";
import { UploadsDomain } from "./domains/uploads.js";
import type { UploadMode } from "./types/upload.js";

export interface ControlFileClientOptions {
  baseUrl: string;
  getToken: () => Promise<string>;
  appId?: string;
  fetch?: typeof fetch;
  sdkClient?: string;
  sdkVersion?: string;
  defaultPageSize?: number;
  retry?: RetryOptions;
  uploadConcurrency?: number;
  defaultBrowserUploadMode?: UploadMode;
  defaultNodeUploadMode?: UploadMode;
  hooks?: {
    onRequest?: (req: { method: string; url: string; headers: Headers }) => void;
    onResponse?: (res: { status: number; url: string; requestId?: string }) => void;
    onError?: (err: ControlFileError) => void;
  };
}

export class ControlFileClient {
  readonly files: FilesDomain;
  readonly folders: FoldersDomain;
  readonly uploads: UploadsDomain;
  readonly shares: SharesDomain;
  readonly identity: IdentityDomain;
  readonly quota: QuotaDomain;
  readonly billing: BillingDomain;

  private readonly baseUrl: string;
  private appId: string | undefined;

  constructor(opts: ControlFileClientOptions) {
    if (!opts.baseUrl) throw new Error("ControlFileClient: baseUrl is required.");
    if (typeof opts.getToken !== "function") {
      throw new Error("ControlFileClient: getToken must be a function.");
    }

    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.appId = opts.appId;

    const fetchImpl = opts.fetch ?? getGlobalFetch();
    const sdkClient = opts.sdkClient ?? SDK_CLIENT_NAME;
    const sdkVersion = opts.sdkVersion ?? SDK_VERSION;
    const retry = resolveRetry(opts.retry, DEFAULT_RETRY);

    const http = createHttpClient({
      baseUrl: this.baseUrl,
      getToken: opts.getToken,
      fetch: fetchImpl,
      sdkClient,
      sdkVersion,
      retry,
      hooks: opts.hooks,
    });

    this.files = new FilesDomain(http);
    this.folders = new FoldersDomain(http, () => this.appId);
    this.shares = new SharesDomain(http);
    this.identity = new IdentityDomain(http);
    this.quota = new QuotaDomain(http);
    this.billing = new BillingDomain(http);
    this.uploads = new UploadsDomain(http, {
      baseUrl: this.baseUrl,
      getToken: opts.getToken,
      fetch: fetchImpl,
      sdkClient,
      sdkVersion,
      defaultRetry: retry,
      defaultConcurrency: opts.uploadConcurrency ?? DEFAULT_UPLOAD_CONCURRENCY,
      defaultBrowserMode: opts.defaultBrowserUploadMode ?? "auto",
      defaultNodeMode: opts.defaultNodeUploadMode ?? "direct",
      isBrowser,
    });

    void (opts.defaultPageSize ?? DEFAULT_PAGE_SIZE);
  }

  /** URL of the CORS-safe image proxy for a public share token. Use in <img src>. */
  getShareImageUrl(token: string): string {
    return joinUrl(this.baseUrl, `/v1/shares/${encodeURIComponent(token)}/image`);
  }

  setAppId(appId: string | undefined): void {
    this.appId = appId;
  }
}
