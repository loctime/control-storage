import type { HttpClient } from "../http.js";
import type {
  DownloadInfo,
  EmptyTrashResult,
  FileItem,
  FileOrFolder,
  FolderItem,
  ListPage,
} from "../types/file.js";
import type {
  BucketKey,
  FileId,
  FolderId,
  IsoDateTime,
} from "../types/primitives.js";
import { DEFAULT_PAGE_SIZE, PRESIGN_DOWNLOAD_TTL_MS } from "../config.js";
import { toBlob, buildFormData } from "../utils/form-data.js";
import type { ProgressCallback, UploadInput } from "../types/upload.js";

interface RawFile {
  id: string;
  type?: string;
  userId?: string;
  uid?: string;
  name: string;
  size?: number;
  mime?: string;
  bucketKey?: string;
  b2Key?: string;
  objectKey?: string;
  key?: string;
  parentId: string | null;
  path?: string;
  ancestors?: string[];
  createdAt: string;
  updatedAt?: string;
  modifiedAt?: string;
  deletedAt?: string | null;
  etag?: string;
  slug?: string;
}

export function parseFileOrFolder(raw: RawFile): FileOrFolder {
  const isFolder = raw.type === "folder";
  const userId = raw.userId ?? raw.uid ?? "";
  const ancestors = raw.ancestors ?? [];
  const path = raw.path ?? "";
  const deletedAt = (raw.deletedAt ?? null) as IsoDateTime | null;

  if (isFolder) {
    const folder: FolderItem = {
      id: raw.id,
      type: "folder",
      userId,
      name: raw.name,
      slug: raw.slug ?? "",
      parentId: raw.parentId,
      path,
      ancestors,
      createdAt: raw.createdAt as IsoDateTime,
      modifiedAt: (raw.modifiedAt ?? raw.updatedAt ?? raw.createdAt) as IsoDateTime,
      deletedAt,
    };
    return folder;
  }

  const bucketKey = (raw.bucketKey ?? raw.b2Key ?? raw.objectKey ?? raw.key ?? "") as BucketKey;
  const file: FileItem = {
    id: raw.id,
    type: "file",
    userId,
    name: raw.name,
    size: raw.size ?? 0,
    mime: raw.mime ?? "application/octet-stream",
    bucketKey,
    parentId: raw.parentId,
    path,
    ancestors,
    createdAt: raw.createdAt as IsoDateTime,
    updatedAt: (raw.updatedAt ?? raw.createdAt) as IsoDateTime,
    deletedAt,
    etag: raw.etag,
  };
  return file;
}

export class FilesDomain {
  constructor(private readonly http: HttpClient) {}

  async list(params?: {
    parentId?: string | null;
    pageSize?: number;
    cursor?: string;
    signal?: AbortSignal;
  }): Promise<ListPage<FileOrFolder>> {
    const raw = await this.http.request<{
      items: RawFile[];
      nextPage: string | null;
    }>({
      method: "GET",
      path: "/v1/files/list",
      query: {
        parentId: params?.parentId ?? undefined,
        pageSize: params?.pageSize ?? DEFAULT_PAGE_SIZE,
        cursor: params?.cursor,
      },
      signal: params?.signal,
    });
    return {
      items: raw.items.map(parseFileOrFolder),
      nextPage: raw.nextPage,
    };
  }

  async *iterate(params?: {
    parentId?: string | null;
    pageSize?: number;
    signal?: AbortSignal;
  }): AsyncGenerator<FileOrFolder, void, void> {
    let cursor: string | undefined;
    do {
      const page = await this.list({ ...params, cursor });
      for (const item of page.items) yield item;
      cursor = page.nextPage ?? undefined;
    } while (cursor);
  }

  async softDelete(fileId: FileId, opts?: { signal?: AbortSignal }): Promise<void> {
    await this.http.request({
      path: "/v1/files/delete",
      json: { fileId },
      signal: opts?.signal,
      expect: "void",
    });
  }

  async restore(fileId: FileId, opts?: { signal?: AbortSignal }): Promise<void> {
    await this.http.request({
      path: "/v1/files/restore",
      json: { fileId },
      signal: opts?.signal,
      expect: "void",
    });
  }

  async permanentDelete(
    fileId: FileId,
    opts?: { signal?: AbortSignal },
  ): Promise<void> {
    await this.http.request({
      path: "/v1/files/permanent-delete",
      json: { fileId },
      signal: opts?.signal,
      expect: "void",
    });
  }

  async emptyTrash(
    fileIds: FileId[],
    opts?: { signal?: AbortSignal },
  ): Promise<EmptyTrashResult> {
    return this.http.request<EmptyTrashResult>({
      path: "/v1/files/empty-trash",
      json: { fileIds },
      signal: opts?.signal,
    });
  }

  async rename(
    fileId: FileId | FolderId,
    newName: string,
    opts?: { signal?: AbortSignal },
  ): Promise<void> {
    await this.http.request({
      path: "/v1/files/rename",
      json: { fileId, newName },
      signal: opts?.signal,
      expect: "void",
    });
  }

  async getDownloadUrl(
    fileId: FileId,
    opts?: { signal?: AbortSignal },
  ): Promise<DownloadInfo> {
    const raw = await this.http.request<{
      downloadUrl: string;
      fileName: string;
      fileSize?: number;
    }>({
      path: "/v1/files/presign-get",
      json: { fileId },
      signal: opts?.signal,
    });
    return {
      downloadUrl: raw.downloadUrl,
      fileName: raw.fileName,
      fileSize: raw.fileSize,
      expiresAt: new Date(Date.now() + PRESIGN_DOWNLOAD_TTL_MS),
    };
  }

  async download(
    fileId: FileId,
    opts?: { signal?: AbortSignal },
  ): Promise<{
    stream: ReadableStream<Uint8Array>;
    fileName: string;
    fileSize?: number;
  }> {
    const info = await this.getDownloadUrl(fileId, opts);
    const res = await fetch(info.downloadUrl, { signal: opts?.signal });
    if (!res.ok || !res.body) {
      throw new Error(`Failed to download file: HTTP ${res.status}`);
    }
    return {
      stream: res.body as ReadableStream<Uint8Array>,
      fileName: info.fileName,
      fileSize: info.fileSize,
    };
  }

  async zip(
    fileIds: FileId[],
    opts?: { zipName?: string; signal?: AbortSignal },
  ): Promise<{ stream: ReadableStream<Uint8Array>; suggestedFileName: string }> {
    const stream = await this.http.request<ReadableStream<Uint8Array>>({
      path: "/v1/files/zip",
      json: { fileIds, zipName: opts?.zipName },
      signal: opts?.signal,
      expect: "stream",
    });
    return {
      stream,
      suggestedFileName: `${opts?.zipName ?? "seleccion"}.zip`,
    };
  }

  async replace(
    fileId: FileId,
    file: UploadInput,
    opts: {
      name: string;
      mime: string;
      signal?: AbortSignal;
      onProgress?: ProgressCallback;
    },
  ): Promise<{ size: number; mime: string }> {
    const blob = await toBlob(file, opts.mime);
    const fd = buildFormData({ fileId }, { name: opts.name, blob });
    return this.http.request<{ size: number; mime: string }>({
      path: "/v1/files/replace",
      body: fd,
      signal: opts.signal,
    });
  }
}
