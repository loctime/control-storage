import type { HttpClient } from "../http.js";
import type { FileId, ShareToken, IsoDateTime } from "../types/primitives.js";
import { PRESIGN_DOWNLOAD_TTL_MS } from "../config.js";
import type {
  Share,
  ShareCreateResult,
  PublicShareDownload,
  PublicShareMetadata,
} from "../types/share.js";

export class SharesDomain {
  constructor(private readonly http: HttpClient) {}

  async create(
    fileId: FileId,
    opts?: { expiresInHours?: number | null; signal?: AbortSignal },
  ): Promise<ShareCreateResult> {
    return this.http.request<ShareCreateResult>({
      path: "/v1/shares/create",
      json: { fileId, expiresIn: opts?.expiresInHours ?? undefined },
      signal: opts?.signal,
    });
  }

  async revoke(
    shareToken: ShareToken,
    opts?: { signal?: AbortSignal },
  ): Promise<void> {
    await this.http.request({
      path: "/v1/shares/revoke",
      json: { shareToken },
      signal: opts?.signal,
      expect: "void",
    });
  }

  async listMine(opts?: { signal?: AbortSignal }): Promise<Share[]> {
    const raw = await this.http.request<{ shares: RawShare[] }>({
      method: "GET",
      path: "/v1/shares/",
      signal: opts?.signal,
    });
    return raw.shares.map(parseShare);
  }

  async getPublicMetadata(
    token: ShareToken,
    opts?: { signal?: AbortSignal },
  ): Promise<PublicShareMetadata> {
    return this.http.request<PublicShareMetadata>({
      method: "GET",
      path: `/v1/shares/${encodeURIComponent(token)}`,
      signal: opts?.signal,
      auth: false,
    });
  }

  async getPublicDownloadUrl(
    token: ShareToken,
    opts?: { signal?: AbortSignal },
  ): Promise<PublicShareDownload> {
    const raw = await this.http.request<{
      downloadUrl: string;
      fileName: string;
      fileSize: number;
    }>({
      method: "POST",
      path: `/v1/shares/${encodeURIComponent(token)}/download`,
      json: {},
      signal: opts?.signal,
      auth: false,
    });
    return {
      downloadUrl: raw.downloadUrl,
      fileName: raw.fileName,
      fileSize: raw.fileSize,
      expiresAt: new Date(Date.now() + PRESIGN_DOWNLOAD_TTL_MS),
    };
  }
}

interface RawShare {
  token: string;
  fileId?: string;
  fileName: string;
  fileSize: number;
  mime?: string;
  expiresAt: string | null;
  createdAt: string;
  downloadCount: number;
  shareUrl: string;
}

function parseShare(raw: RawShare): Share {
  return {
    token: raw.token,
    fileId: raw.fileId ?? "",
    fileName: raw.fileName,
    fileSize: raw.fileSize,
    mime: raw.mime ?? "application/octet-stream",
    isActive: true,
    expiresAt: raw.expiresAt as IsoDateTime | null,
    createdAt: raw.createdAt as IsoDateTime,
    downloadCount: raw.downloadCount,
    shareUrl: raw.shareUrl,
  };
}
