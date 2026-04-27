export interface ControlFileErrorOptions {
  code: string;
  statusCode?: number;
  requestId?: string;
  cause?: unknown;
}

export class ControlFileError extends Error {
  readonly code: string;
  readonly statusCode?: number;
  readonly requestId?: string;
  override readonly cause?: unknown;

  constructor(message: string, opts: ControlFileErrorOptions) {
    super(message);
    this.name = "ControlFileError";
    this.code = opts.code;
    this.statusCode = opts.statusCode;
    this.requestId = opts.requestId;
    this.cause = opts.cause;
  }
}

export class AuthError extends ControlFileError {
  constructor(message: string, opts: ControlFileErrorOptions) {
    super(message, opts);
    this.name = "AuthError";
  }
}

export class QuotaExceededError extends ControlFileError {
  readonly availableBytes?: number;
  readonly requestedBytes?: number;

  constructor(
    message: string,
    opts: ControlFileErrorOptions & {
      availableBytes?: number;
      requestedBytes?: number;
    },
  ) {
    super(message, { ...opts, code: opts.code ?? "QUOTA_EXCEEDED" });
    this.name = "QuotaExceededError";
    this.availableBytes = opts.availableBytes;
    this.requestedBytes = opts.requestedBytes;
  }
}

export class NotFoundError extends ControlFileError {
  constructor(message: string, opts: ControlFileErrorOptions) {
    super(message, opts);
    this.name = "NotFoundError";
  }
}

export class ShareExpiredError extends ControlFileError {
  constructor(message: string, opts: ControlFileErrorOptions) {
    super(message, { ...opts, code: opts.code ?? "SHARE_EXPIRED" });
    this.name = "ShareExpiredError";
  }
}

export class VirusBlockedError extends ControlFileError {
  constructor(message: string, opts: ControlFileErrorOptions) {
    super(message, { ...opts, code: opts.code ?? "VIRUS_BLOCKED" });
    this.name = "VirusBlockedError";
  }
}

export class ConflictError extends ControlFileError {
  constructor(message: string, opts: ControlFileErrorOptions) {
    super(message, opts);
    this.name = "ConflictError";
  }
}

export class ValidationError extends ControlFileError {
  constructor(message: string, opts: ControlFileErrorOptions) {
    super(message, opts);
    this.name = "ValidationError";
  }
}

export class AccountSuspendedError extends ControlFileError {
  constructor(message: string, opts: ControlFileErrorOptions) {
    super(message, { ...opts, code: opts.code ?? "ACCOUNT_NOT_ACTIVE" });
    this.name = "AccountSuspendedError";
  }
}

export class NetworkError extends ControlFileError {
  constructor(message: string, opts: ControlFileErrorOptions) {
    super(message, opts);
    this.name = "NetworkError";
  }
}

interface ParsedErrorBody {
  error?: string;
  message?: string;
  code?: string;
  availableBytes?: number;
  requestedBytes?: number;
}

export function buildErrorFromResponse(
  status: number,
  body: ParsedErrorBody | null,
  requestId?: string,
): ControlFileError {
  const message = body?.error ?? body?.message ?? `HTTP ${status}`;
  const code = body?.code ?? defaultCodeForStatus(status);
  const opts: ControlFileErrorOptions = { code, statusCode: status, requestId };

  switch (status) {
    case 400:
      return new ValidationError(message, opts);
    case 401:
      return new AuthError(message, opts);
    case 403:
      if (code === "ACCOUNT_NOT_ACTIVE") {
        return new AccountSuspendedError(message, opts);
      }
      return new ControlFileError(message, opts);
    case 404:
      return new NotFoundError(message, opts);
    case 409:
      return new ConflictError(message, opts);
    case 410:
      return new ShareExpiredError(message, opts);
    case 413:
      return new QuotaExceededError(message, {
        ...opts,
        availableBytes: body?.availableBytes,
        requestedBytes: body?.requestedBytes,
      });
    case 451:
      return new VirusBlockedError(message, opts);
    default:
      return new ControlFileError(message, opts);
  }
}

function defaultCodeForStatus(status: number): string {
  if (status >= 500) return "SERVER_ERROR";
  if (status === 429) return "RATE_LIMITED";
  if (status === 408) return "REQUEST_TIMEOUT";
  if (status === 410) return "SHARE_EXPIRED";
  if (status === 413) return "QUOTA_EXCEEDED";
  if (status === 451) return "VIRUS_BLOCKED";
  return `HTTP_${status}`;
}

export function isRetryableError(err: unknown): boolean {
  if (err instanceof NetworkError) return true;
  if (err instanceof ControlFileError) {
    const s = err.statusCode;
    if (s === undefined) return false;
    if (s >= 500 && s < 600) return true;
    if (s === 408 || s === 429) return true;
    return false;
  }
  return false;
}

export function isUserAbort(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" || (err as { code?: string }).code === "ABORT_ERR")
  );
}
