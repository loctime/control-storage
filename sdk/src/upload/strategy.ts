import type {
  PresignResponse,
  PresignSimple,
  UploadMode,
  UploadStrategy,
} from "../types/upload.js";
import { MULTIPART_THRESHOLD } from "../config.js";
import { ValidationError } from "../errors.js";

export function shouldUseMultipart(size: number): boolean {
  return size >= MULTIPART_THRESHOLD;
}

export function chooseSimpleStrategy(
  presign: PresignSimple,
  mode: UploadMode,
  isBrowser: boolean,
): UploadStrategy {
  if (mode === "direct") return "simple-direct";
  if (mode === "proxy") {
    if (!presign.proxyUpload) {
      throw new ValidationError(
        "Upload mode 'proxy' requested but the backend did not return proxyUpload metadata.",
        { code: "PROXY_UNAVAILABLE", statusCode: 400 },
      );
    }
    return "simple-proxy";
  }
  if (isBrowser && presign.proxyUpload) return "simple-proxy";
  return "simple-direct";
}

export function isMultipartResponse(
  presign: PresignResponse,
): presign is Extract<PresignResponse, { multipart: object }> {
  return "multipart" in presign && presign.multipart !== undefined;
}
