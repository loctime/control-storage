export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  planId: string;
  planQuotaBytes: number;
  usedBytes: number;
  pendingBytes: number;
}

export interface UserSettings {
  billingInterval: "monthly" | "yearly" | null;
}

export interface TaskbarItem {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  type?: string;
  isCustom?: boolean;
  folderId?: string;
}

export interface TaskbarState {
  items: TaskbarItem[];
}
