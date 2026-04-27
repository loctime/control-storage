import type { IsoDateTime } from "./primitives.js";

export interface PlatformAccount {
  uid: string;
  status: "active" | "suspended";
  planId: string;
  limits: { storageBytes: number };
  enabledApps: Record<string, boolean>;
  paidUntil: IsoDateTime | null;
  trialEndsAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt?: IsoDateTime;
}

export interface Plan {
  planId: string;
  name: string;
  limits: { storageBytes: number };
  apps: Record<string, boolean>;
  pricing: { monthly: number; yearly: number };
  isActive: boolean;
  description?: string;
  features?: string[];
}
