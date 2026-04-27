import type { HttpClient } from "../http.js";
import type {
  CreateUserInput,
  CreateUserResult,
} from "../types/identity.js";

export class IdentityDomain {
  constructor(private readonly http: HttpClient) {}

  /**
   * Create a Firebase Auth user and apply custom claims. Backend-to-backend only:
   * the caller's token must carry an admin role for the target appId. Frontend
   * code must not call this — proxy through your app backend.
   */
  async createUser(input: CreateUserInput & { signal?: AbortSignal }): Promise<CreateUserResult> {
    return this.http.request<CreateUserResult>({
      path: "/v1/admin/create-user",
      json: {
        email: input.email,
        password: input.password,
        nombre: input.nombre,
        appId: input.appId,
        role: input.role,
      },
      signal: input.signal,
    });
  }
}
