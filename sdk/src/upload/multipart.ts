import { NetworkError } from "../errors.js";
import type {
  ConfirmedPart,
  ProgressCallback,
  UploadInput,
} from "../types/upload.js";
import { retryWithBackoff, type RetryConfig } from "../utils/retry.js";
import { materializeAsBlob, sliceBlob } from "./chunker.js";

export interface MultipartArgs {
  body: UploadInput;
  size: number;
  mime: string;
  parts: ReadonlyArray<{ partNumber: number; url: string }>;
  concurrency: number;
  retry: RetryConfig;
  signal?: AbortSignal;
  fetch: typeof globalThis.fetch;
  onProgress?: ProgressCallback;
}

export async function uploadMultipart(
  args: MultipartArgs,
): Promise<ConfirmedPart[]> {
  const blob = await materializeAsBlob(args.body, args.mime);
  const partSize = Math.ceil(args.size / args.parts.length);
  const result: ConfirmedPart[] = new Array(args.parts.length);
  let totalUploaded = 0;
  let partsCompleted = 0;
  const partsTotal = args.parts.length;

  let nextIndex = 0;
  const partsList = args.parts;

  async function worker(): Promise<void> {
    for (;;) {
      const i = nextIndex++;
      if (i >= partsList.length) return;
      if (args.signal?.aborted) {
        throw args.signal.reason ?? new DOMException("Aborted", "AbortError");
      }
      const partInfo = partsList[i];
      if (!partInfo) return;
      const start = i * partSize;
      const end = Math.min(start + partSize, args.size);
      const chunk = sliceBlob(blob, start, end);

      const etag = await retryWithBackoff(
        async () => {
          const res = await args.fetch(partInfo.url, {
            method: "PUT",
            body: chunk,
            signal: args.signal,
          });
          if (!res.ok) {
            throw new NetworkError(
              `B2 multipart PUT failed (part ${partInfo.partNumber}): HTTP ${res.status}`,
              { code: `B2_${res.status}`, statusCode: res.status },
            );
          }
          const raw = res.headers.get("etag");
          if (!raw) {
            throw new NetworkError(
              `Missing ETag on multipart part ${partInfo.partNumber}`,
              { code: "MISSING_ETAG" },
            );
          }
          return raw;
        },
        args.retry,
        args.signal,
      );

      result[i] = { PartNumber: partInfo.partNumber, ETag: etag };
      totalUploaded += end - start;
      partsCompleted += 1;
      args.onProgress?.({
        loaded: totalUploaded,
        total: args.size,
        partNumber: partInfo.partNumber,
        partsCompleted,
        partsTotal,
      });
    }
  }

  const workers: Array<Promise<void>> = [];
  const concurrency = Math.min(Math.max(1, args.concurrency), args.parts.length);
  for (let w = 0; w < concurrency; w++) workers.push(worker());
  await Promise.all(workers);

  return result.sort((a, b) => a.PartNumber - b.PartNumber);
}
