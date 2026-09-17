import type { Request } from "express";
import { getAuth } from "@clerk/express";

export type AuthUser = {
  subject: string;
  email?: string;
  name?: string;
};

export function authConfigured() {
  return Boolean(process.env.CLERK_SECRET_KEY);
}

export async function authenticateRequest(
  req: Request,
): Promise<AuthUser> {
  if (!authConfigured()) {
    throw new AuthError(
      "Clerk authentication is not configured.",
    );
  }

  const auth = getAuth(req);

  if (!auth.isAuthenticated) {
    throw new AuthError(
      "Clerk authentication failed.",
    );
  }

  const subject = auth.subject || auth.userId;

  if (!subject) {
    throw new AuthError(
      "Authenticated Clerk request has no subject.",
    );
  }

  return {
    subject,
  };
}

export class AuthError extends Error {
  status = 401 as const;
}