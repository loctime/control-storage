import type { HttpClient } from "../http.js";
import type { Plan } from "../types/platform.js";

export class BillingDomain {
  constructor(private readonly http: HttpClient) {}

  async listPlans(opts?: { signal?: AbortSignal }): Promise<Plan[]> {
    const raw = await this.http.request<{ plans: Plan[] }>({
      method: "GET",
      path: "/v1/platform/plans",
      signal: opts?.signal,
    });
    return raw.plans;
  }

  async changePlan(
    params: { planId: string; interval?: "monthly" | "yearly" },
    opts?: { signal?: AbortSignal },
  ): Promise<{ ok: true }> {
    await this.http.request({
      path: "/api/user/plan",
      json: params,
      signal: opts?.signal,
      expect: "void",
    });
    return { ok: true };
  }

  async checkout(
    params: { planId: string; interval?: "monthly" | "yearly" },
    opts?: { signal?: AbortSignal },
  ): Promise<{ url: string }> {
    return this.http.request<{ url: string }>({
      path: "/v1/billing/checkout",
      json: params,
      signal: opts?.signal,
    });
  }
}
