export const MULTIPART_THRESHOLD = 128 * 1024 * 1024;
export const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024;
export const DEFAULT_PAGE_SIZE = 100;
export const MAX_PAGE_SIZE = 200;
export const PRESIGN_DOWNLOAD_TTL_MS = 5 * 60 * 1000;
export const PRESIGN_UPLOAD_TTL_MS = 60 * 60 * 1000;

export const DEFAULT_RETRY = {
  retries: 3,
  minDelayMs: 200,
  maxDelayMs: 4000,
} as const;

export const DEFAULT_UPLOAD_CONCURRENCY = 4;

export const SDK_CLIENT_NAME = "@control/controlfile-sdk";

declare const __SDK_VERSION__: string;
export const SDK_VERSION: string =
  typeof __SDK_VERSION__ !== "undefined" ? __SDK_VERSION__ : "0.0.0-dev";
