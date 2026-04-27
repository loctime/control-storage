import type { HttpClient } from "../http.js";
import { ValidationError } from "../errors.js";
import { MAX_FILE_SIZE } from "../config.js";
import type { RetryConfig } from "../utils/retry.js";
import {
  chooseSimpleStrategy,
  isMultipartResponse,
} from "../upload/strategy.js";
import { uploadMultipart } from "../upload/multipart.js";
import { uploadSimpleDirect, uploadSimpleProxy } from "../upload/simple.js";
import type {
  ConfirmedPart,
  PresignResponse,
  UploadFileInput,
  UploadFileResult,
  UploadMode,
} from "../types/upload.js";
import type { UploadSessionId } from "../types/primitives.js";

const MIME_PATTERN = /^[\w!#$&^_.+-]+\/[\w!#$&^_.+-]+$/;

export interface UploadsDomainOptions {
  baseUrl: string;
  getToken: () => Promise<string>;
  fetch: typeof fetch;
  sdkClient: string;
  sdkVersion: string;
  defaultRetry: RetryConfig;
  defaultConcurrency: number;
  defaultBrowserMode: UploadMode;
  defaultNodeMode: UploadMode;
  isBrowser: boolean;
}

export class UploadsDomain {
  constructor(
    private readonly http: HttpClient,
    private readonly cfg: UploadsDomainOptions,
  ) {}

  async uploadFile(input: UploadFileInput): Promise<UploadFileResult> {
    this.validate(input);
    const start = Date.now();

    const presign = await this.presign({
      name: input.name,
      size: input.size,
      mime: input.mime,
      parentId: input.parentId ?? undefined,
      signal: input.signal,
    });

    if (isMultipartResponse(presign)) {
      const parts = await uploadMultipart({
        body: input.body,
        size: input.size,
        mime: input.mime,
        parts: presign.multipart.parts,
        concurrency: input.concurrency ?? this.cfg.defaultConcurrency,
        retry: this.cfg.defaultRetry,
        signal: input.signal,
        fetch: this.cfg.fetch,
        onProgress: input.onProgress,
      });
      const confirmed = await this.confirm({
        uploadSessionId: presign.uploadSessionId,
        parts,
        signal: input.signal,
      });
      return {
        fileId: confirmed.fileId,
        uploadSessionId: presign.uploadSessionId,
        strategy: "multipart",
        parts,
        bytesUploaded: input.size,
        durationMs: Date.now() - start,
      };
    }

    const mode = input.mode ?? this.defaultMode();
    const strategy = chooseSimpleStrategy(presign, mode, this.cfg.isBrowser);

    let etag: string;
    if (strategy === "simple-proxy") {
      const proxy = presign.proxyUpload;
      if (!proxy) {
        throw new ValidationError(
          "Simple-proxy strategy chosen but proxyUpload metadata missing.",
          { code: "PROXY_UNAVAILABLE", statusCode: 400 },
        );
      }
      etag = await uploadSimpleProxy({
        body: input.body,
        name: input.name,
        mime: input.mime,
        sessionId: presign.uploadSessionId,
        proxyPath: proxy.path,
        baseUrl: this.cfg.baseUrl,
        getToken: this.cfg.getToken,
        retry: this.cfg.defaultRetry,
        signal: input.signal,
        fetch: this.cfg.fetch,
        sdkClient: this.cfg.sdkClient,
        sdkVersion: this.cfg.sdkVersion,
      });
    } else {
      etag = await uploadSimpleDirect({
        body: input.body,
        url: presign.url,
        mime: input.mime,
        retry: this.cfg.defaultRetry,
        signal: input.signal,
        fetch: this.cfg.fetch,
      });
    }

    const confirmed = await this.confirm({
      uploadSessionId: presign.uploadSessionId,
      etag,
      signal: input.signal,
    });

    return {
      fileId: confirmed.fileId,
      uploadSessionId: presign.uploadSessionId,
      strategy,
      etag,
      bytesUploaded: input.size,
      durationMs: Date.now() - start,
    };
  }

  async presign(params: {
    name: string;
    size: number;
    mime: string;
    parentId?: string;
    signal?: AbortSignal;
  }): Promise<PresignResponse> {
    return this.http.request<PresignResponse>({
      path: "/v1/uploads/presign",
      json: {
        name: params.name,
        size: params.size,
        mime: params.mime,
        parentId: params.parentId,
      },
      signal: params.signal,
    });
  }

  async proxyUpload(params: {
    sessionId: UploadSessionId;
    body: Blob;
    name: string;
    signal?: AbortSignal;
  }): Promise<{ etag: string }> {
    const fd = new FormData();
    fd.append("sessionId", params.sessionId);
    fd.append("file", params.body, params.name);
    return this.http.request<{ etag: string }>({
      path: "/v1/uploads/proxy-upload",
      body: fd,
      signal: params.signal,
    });
  }

  async confirm(params: {
    uploadSessionId: UploadSessionId;
    etag?: string;
    parts?: ReadonlyArray<ConfirmedPart>;
    signal?: AbortSignal;
    idempotencyKey?: string;
  }): Promise<{ fileId: string }> {
    const json: Record<string, unknown> = {
      uploadSessionId: params.uploadSessionId,
    };
    if (params.parts) json.parts = params.parts;
    else if (params.etag !== undefined) json.etag = params.etag;
    return this.http.request<{ fileId: string }>({
      path: "/v1/uploads/confirm",
      json,
      signal: params.signal,
      idempotencyKey: params.idempotencyKey ?? crypto.randomUUID(),
    });
  }

  private defaultMode(): UploadMode {
    return this.cfg.isBrowser ? this.cfg.defaultBrowserMode : this.cfg.defaultNodeMode;
  }

  private validate(input: UploadFileInput): void {
    if (!input.name || typeof input.name !== "string") {
      throw new ValidationError("Upload name is required.", {
        code: "INVALID_NAME",
        statusCode: 400,
      });
    }
    if (typeof input.size !== "number" || input.size <= 0) {
      throw new ValidationError("Upload size must be a positive number.", {
        code: "INVALID_SIZE",
        statusCode: 400,
      });
    }
    if (input.size > MAX_FILE_SIZE) {
      throw new ValidationError(
        `File exceeds the 5 GB limit (size=${input.size}).`,
        { code: "FILE_TOO_LARGE", statusCode: 413 },
      );
    }
    if (!input.mime || !MIME_PATTERN.test(input.mime)) {
      throw new ValidationError(
        `Invalid MIME type: "${input.mime ?? ""}".`,
        { code: "INVALID_MIME", statusCode: 400 },
      );
    }
  }
}
