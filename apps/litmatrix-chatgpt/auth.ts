import type { Request } from "express";
import { getAuth } from "@clerk/express";

export type AuthUser = {
  subject: string;
  email?: string;
  name?: string;
};

const allowAnonymousDev = process.env.ALLOW_ANONYMOUS_DEV === "true";

const allowedEmails = new Set(
  (process.env.LITMATRIX_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);

export function authConfigured() {
  return Boolean(
    process.env.CLERK_PUBLISHABLE_KEY &&
    process.env.CLERK_SECRET_KEY
  );
}

export async function authenticateRequest(
  req: Request,
): Promise<AuthUser> {
  if (!authConfigured()) {
    if (allowAnonymousDev) {
      return { subject: "dev-anonymous" };
    }

    throw new AuthError("Clerk authentication is not configured.");
  }

  const auth = getAuth(req, {
    acceptsToken: "oauth_token",
  });

  if (!auth.isAuthenticated || !auth.userId) {
    throw new AuthError("Invalid or expired Clerk OAuth access token.");
  }

  const subject = auth.userId;

  const claims = auth.sessionClaims as Record<string, unknown> | undefined;

  const email =
    typeof claims?.email === "string"
      ? claims.email.trim().toLowerCase()
      : undefined;

  const name =
    typeof claims?.name === "string"
      ? claims.name
      : undefined;

  if (allowedEmails.size > 0) {
    if (!email) {
      throw new AuthError(
        "This account does not have an email address available for LitlMatrix access.",
      );
    }

    if (!allowedEmails.has(email)) {
      throw new AuthError(
        "This email address is not authorized to use LitlMatrix.",
      );
    }
  }

  return {
    subject,
    email,
    name,
  };
}

export class AuthError extends Error {
  status = 401 as const;
}