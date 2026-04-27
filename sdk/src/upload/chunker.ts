import type { UploadInput } from "../types/upload.js";

export interface ChunkPlan {
  partSize: number;
  totalParts: number;
}

export function planChunks(totalSize: number, totalParts: number): ChunkPlan {
  if (totalParts <= 0) throw new Error("totalParts must be > 0");
  return { partSize: Math.ceil(totalSize / totalParts), totalParts };
}

export async function materializeAsBlob(
  input: UploadInput,
  mime: string,
): Promise<Blob> {
  if (typeof Blob === "undefined") {
    throw new Error("Blob is not available in this runtime.");
  }
  if (input instanceof Blob) return input;
  if (input instanceof ArrayBuffer) return new Blob([input], { type: mime });
  if (ArrayBuffer.isView(input)) {
    const view = input as ArrayBufferView;
    const copy = new Uint8Array(view.byteLength);
    copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    return new Blob([copy], { type: mime });
  }
  if (typeof ReadableStream !== "undefined" && input instanceof ReadableStream) {
    const reader = input.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.byteLength;
      }
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.byteLength;
    }
    return new Blob([merged], { type: mime });
  }
  throw new TypeError("Unsupported UploadInput type");
}

export function sliceBlob(blob: Blob, start: number, end: number): Blob {
  return blob.slice(start, end);
}
