import type { FileId, IsoDateTime, ShareToken } from "./primitives.js";

export interface Share {
  readonly token: ShareToken;
  readonly fileId: FileId;
  readonly fileName: string;
  readonly fileSize: number;
  readonly mime: string;
  readonly isActive: true;
  readonly expiresAt: IsoDateTime | null;
  readonly createdAt: IsoDateTime;
  readonly downloadCount: number;
  readonly shareUrl: string;
}

export interface ShareCreateResult {
  readonly shareToken: ShareToken;
  readonly shareUrl: string;
  readonly expiresAt: IsoDateTime | null;
  readonly fileName: string;
}

export interface PublicShareMetadata {
  readonly fileName: string;
  readonly fileSize: number;
  readonly mime: string;
  readonly expiresAt: IsoDateTime | null;
  readonly downloadCount: number;
}

export interface PublicShareDownload {
  readonly downloadUrl: string;
  readonly fileName: string;
  readonly fileSize: number;
  readonly expiresAt: Date;
}
