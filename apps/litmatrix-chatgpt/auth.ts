import type { Request } from "express";
import { getAuth } from "@clerk/express";

export type AuthUser = {
  subject: string;
  email?: string;
  name?: string;
};

const allowAnonymousDev =
  process.env.ALLOW_ANONYMOUS_DEV === "true";

const allowedEmails = new Set(
  (process.env.LITMATRIX_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);

export function authConfigured() {
  return Boolean(
    process.env.CLERK_PUBLISHABLE_KEY &&
    process.env.CLERK_SECRET_KEY,
  );
}

export async function authenticateRequest(
  req: Request,
): Promise<AuthUser> {
  if (!authConfigured()) {
    if (allowAnonymousDev) {
      return { subject: "dev-anonymous" };
    }

    throw new AuthError(
      "Clerk authentication is not configured.",
    );
  }

  const auth = getAuth(req, {
    acceptsToken: "oauth_token",
  });

  if (!auth.isAuthenticated) {
    throw new AuthError(
      "Invalid or expired Clerk OAuth access token.",
    );
  }

  const subject = auth.subject || auth.id;

  if (!subject) {
    throw new AuthError(
      "Clerk OAuth access token has no subject.",
    );
  }

  /*
   * OAuth authentication does not expose sessionClaims on the
   * AuthObject returned by getAuth().
   *
   * Email/name are therefore optional here. The authenticated
   * Clerk subject remains the stable owner identifier used by
   * LitlMatrix.
   */
  if (allowedEmails.size > 0) {
    throw new AuthError(
      "LITMATRIX_ALLOWED_EMAILS requires email claims, which are not exposed by the Clerk OAuth token.",
    );
  }

  return {
    subject,
  };
}

export class AuthError extends Error {
  status = 401 as const;
}