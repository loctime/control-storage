import type { HttpClient } from "../http.js";
import type { PlatformAccount } from "../types/platform.js";
import type {
  TaskbarItem,
  TaskbarState,
  UserProfile,
  UserSettings,
} from "../types/user.js";

interface RawProfile {
  uid: string;
  email: string;
  displayName?: string;
  planId?: string;
  planQuotaBytes?: number;
  quotaBytes?: number;
  usedBytes?: number;
  pendingBytes?: number;
}

function parseProfile(raw: RawProfile): UserProfile {
  return {
    uid: raw.uid,
    email: raw.email,
    displayName: raw.displayName ?? "",
    planId: raw.planId ?? "free",
    planQuotaBytes: raw.planQuotaBytes ?? raw.quotaBytes ?? 0,
    usedBytes: raw.usedBytes ?? 0,
    pendingBytes: raw.pendingBytes ?? 0,
  };
}

export class QuotaDomain {
  constructor(private readonly http: HttpClient) {}

  async initializeUser(
    displayName: string,
    opts?: { signal?: AbortSignal },
  ): Promise<void> {
    await this.http.request({
      path: "/v1/users/initialize",
      json: { displayName },
      signal: opts?.signal,
      expect: "void",
    });
  }

  async getProfile(opts?: { signal?: AbortSignal }): Promise<UserProfile> {
    const raw = await this.http.request<RawProfile>({
      method: "GET",
      path: "/v1/users/profile",
      signal: opts?.signal,
    });
    return parseProfile(raw);
  }

  async updateProfile(
    patch: { displayName?: string },
    opts?: { signal?: AbortSignal },
  ): Promise<void> {
    await this.http.request({
      method: "PUT",
      path: "/v1/users/profile",
      json: patch,
      signal: opts?.signal,
      expect: "void",
    });
  }

  async getSettings(opts?: { signal?: AbortSignal }): Promise<UserSettings> {
    return this.http.request<UserSettings>({
      method: "GET",
      path: "/api/user/settings",
      signal: opts?.signal,
    });
  }

  async updateSettings(
    patch: Partial<UserSettings>,
    opts?: { signal?: AbortSignal },
  ): Promise<void> {
    await this.http.request({
      path: "/api/user/settings",
      json: patch,
      signal: opts?.signal,
      expect: "void",
    });
  }

  async getTaskbar(opts?: { signal?: AbortSignal }): Promise<TaskbarState> {
    return this.http.request<TaskbarState>({
      method: "GET",
      path: "/api/user/taskbar",
      signal: opts?.signal,
    });
  }

  async updateTaskbar(
    items: TaskbarItem[],
    opts?: { signal?: AbortSignal },
  ): Promise<void> {
    await this.http.request({
      path: "/api/user/taskbar",
      json: { items },
      signal: opts?.signal,
      expect: "void",
    });
  }

  async ensurePlatformAccount(opts?: {
    signal?: AbortSignal;
  }): Promise<PlatformAccount> {
    return this.http.request<PlatformAccount>({
      path: "/v1/platform/accounts/ensure",
      json: {},
      signal: opts?.signal,
    });
  }
}
