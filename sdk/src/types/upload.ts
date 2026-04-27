import type { UploadSessionId } from "./primitives.js";

export type UploadInput =
  | Blob
  | ArrayBuffer
  | ArrayBufferView
  | ReadableStream<Uint8Array>;

export interface PresignSimple {
  uploadSessionId: UploadSessionId;
  url: string;
  uploadUrl?: string;
  method: "PUT";
  headers?: Record<string, string>;
  proxyUpload?: {
    method: "POST";
    path: string;
    contentType: "multipart/form-data";
    fileField: "file";
    sessionIdField: "sessionId";
  };
  multipart?: undefined;
}

export interface PresignMultipart {
  uploadSessionId: UploadSessionId;
  multipart: {
    uploadId: string;
    parts: ReadonlyArray<{ partNumber: number; url: string }>;
  };
  proxyUpload?: undefined;
}

export type PresignResponse = PresignSimple | PresignMultipart;

export type UploadStrategy = "simple-direct" | "simple-proxy" | "multipart";

export type UploadMode = "auto" | "direct" | "proxy";

export interface ProgressEvent {
  loaded: number;
  total: number;
  partNumber?: number;
  partsCompleted?: number;
  partsTotal?: number;
}

export type ProgressCallback = (event: ProgressEvent) => void;

export interface UploadFileInput {
  body: UploadInput;
  name: string;
  size: number;
  mime: string;
  parentId?: string | null;
  mode?: UploadMode;
  onProgress?: ProgressCallback;
  concurrency?: number;
  signal?: AbortSignal;
  multipartChunkSize?: number;
}

export interface UploadFileResult {
  fileId: string;
  uploadSessionId: UploadSessionId;
  strategy: UploadStrategy;
  etag?: string;
  parts?: ReadonlyArray<{ PartNumber: number; ETag: string }>;
  bytesUploaded: number;
  durationMs: number;
}

export interface ConfirmedPart {
  PartNumber: number;
  ETag: string;
}
