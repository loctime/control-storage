import type { HttpClient } from "../http.js";
import type { FolderItem } from "../types/file.js";
import type { FolderId } from "../types/primitives.js";
import { parseFileOrFolder } from "./files.js";

export interface ResolveInput {
  appId?: string;
  contextType: string;
  contextEventId?: string;
  companyId?: string;
  sucursalId?: string;
  tipoArchivo?: string;
}

export class FoldersDomain {
  constructor(
    private readonly http: HttpClient,
    private readonly getDefaultAppId: () => string | undefined,
  ) {}

  async create(params: {
    name: string;
    parentId: FolderId;
    signal?: AbortSignal;
    idempotencyKey?: string;
  }): Promise<FolderItem> {
    const raw = await this.http.request<{
      id: string;
      name: string;
      slug: string;
      parentId: string | null;
      type: string;
      createdAt?: string;
      modifiedAt?: string;
      ancestors?: string[];
    }>({
      path: "/v1/folders/create",
      json: { name: params.name, parentId: params.parentId },
      signal: params.signal,
      idempotencyKey: params.idempotencyKey ?? crypto.randomUUID(),
    });
    const parsed = parseFileOrFolder({
      ...raw,
      type: "folder",
      createdAt: raw.createdAt ?? new Date().toISOString(),
    });
    return parsed as FolderItem;
  }

  async getRoot(params?: {
    appId?: string;
    signal?: AbortSignal;
  }): Promise<FolderItem> {
    const appId = params?.appId ?? this.getDefaultAppId();
    const raw = await this.http.request<{
      id: string;
      name: string;
      parentId: string | null;
      type: string;
      slug?: string;
      createdAt?: string;
      modifiedAt?: string;
      ancestors?: string[];
    }>({
      method: "GET",
      path: "/v1/folders/root",
      query: { appId },
      signal: params?.signal,
    });
    return parseFileOrFolder({
      ...raw,
      type: "folder",
      createdAt: raw.createdAt ?? new Date().toISOString(),
    }) as FolderItem;
  }

  async resolve(
    input: ResolveInput & { signal?: AbortSignal },
  ): Promise<{ folderId: string }> {
    const appId = input.appId ?? this.getDefaultAppId();
    if (!appId) {
      throw new Error(
        "folders.resolve requires `appId` either in the call or in the client constructor.",
      );
    }
    const res = await this.http.request<{ success: boolean; folderId: string }>({
      path: "/v1/folders/resolve",
      json: {
        appId,
        contextType: input.contextType,
        contextEventId: input.contextEventId,
        companyId: input.companyId,
        sucursalId: input.sucursalId,
        tipoArchivo: input.tipoArchivo,
      },
      signal: input.signal,
    });
    return { folderId: res.folderId };
  }

  async setMain(folderId: FolderId, opts?: { signal?: AbortSignal }): Promise<void> {
    await this.http.request({
      path: "/v1/folders/set-main",
      json: { folderId },
      signal: opts?.signal,
      expect: "void",
    });
  }

  async permanentDelete(
    folderId: FolderId,
    opts?: { signal?: AbortSignal },
  ): Promise<void> {
    await this.http.request({
      path: "/v1/folders/permanent-delete",
      json: { folderId },
      signal: opts?.signal,
      expect: "void",
    });
  }
}
