import type {
  BucketKey,
  FileId,
  FolderId,
  IsoDateTime,
} from "./primitives.js";

export interface FileItem {
  readonly id: FileId;
  readonly type: "file";
  readonly userId: string;
  readonly name: string;
  readonly size: number;
  readonly mime: string;
  readonly bucketKey: BucketKey;
  readonly parentId: FolderId | null;
  readonly path: string;
  readonly ancestors: readonly string[];
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  readonly deletedAt: IsoDateTime | null;
  readonly etag?: string;
}

export interface FolderItem {
  readonly id: FolderId;
  readonly type: "folder";
  readonly userId: string;
  readonly name: string;
  readonly slug: string;
  readonly parentId: FolderId | null;
  readonly path: string;
  readonly ancestors: readonly string[];
  readonly createdAt: IsoDateTime;
  readonly modifiedAt: IsoDateTime;
  readonly deletedAt: IsoDateTime | null;
}

export type FileOrFolder = FileItem | FolderItem;

export interface ListPage<T> {
  items: T[];
  nextPage: string | null;
}

export interface EmptyTrashResult {
  deletedIds: FileId[];
  notFound: FileId[];
  unauthorized: FileId[];
}

export interface DownloadInfo {
  downloadUrl: string;
  fileName: string;
  fileSize?: number;
  expiresAt: Date;
}
