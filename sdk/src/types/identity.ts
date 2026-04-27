export interface CreateUserInput {
  email: string;
  password: string;
  nombre: string;
  appId: string;
  role: string;
}

export interface CreateUserResult {
  uid: string;
  status: "created" | "exists" | "reused";
  source: string;
}
