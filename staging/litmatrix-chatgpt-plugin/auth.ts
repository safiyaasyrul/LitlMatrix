import type { Request } from "express";

export type AuthUser = {
  subject: string;
  email?: string;
  name?: string;
};

export function authConfigured() {
  return Boolean(process.env.CLERK_SECRET_KEY);
}

export async function authenticateRequest(
  _req: Request,
): Promise<AuthUser> {
  // Bypass Clerk completely as requested by the user
  return {
    subject: "local-dummy-user",
  };
}

export class AuthError extends Error {
  status = 401 as const;
}
