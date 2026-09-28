import type { Request } from "express";
import { getAuth, clerkClient } from "@clerk/express";

export type AuthUser = {
  subject: string;
  email?: string;
  name?: string;
};

export function authConfigured() {
  return Boolean(process.env.CLERK_SECRET_KEY);
}

function getAllowedEmails(): Set<string> | null {
  const raw = process.env.LITMATRIX_ALLOWED_EMAILS?.trim();
  if (!raw) return null; // Unset → allow any authenticated user (documented behavior)
  const emails = raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return new Set(emails);
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

  const subject = auth.userId;

  if (!subject) {
    throw new AuthError(
      "Authenticated Clerk request has no subject.",
    );
  }

  const allowedEmails = getAllowedEmails();

  // Only fetch the full user record (and enforce the allowlist) when one is configured.
  // Skipping this when unset avoids an extra Clerk API round-trip on every request.
  if (allowedEmails) {
    const clerkUser = await clerkClient.users.getUser(subject);

    const primaryEmail = clerkUser.emailAddresses.find(
      (candidate) => candidate.id === clerkUser.primaryEmailAddressId,
    );

    const email = primaryEmail?.emailAddress?.trim().toLowerCase();

    if (!email) {
      throw new AuthError(
        "Authenticated user has no primary email address.",
      );
    }

    if (!allowedEmails.has(email)) {
      throw new AuthError(
        "This account is not on the LitlMatrix access allowlist.",
      );
    }

    return {
      subject,
      email,
      name: [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || undefined,
    };
  }

  return {
    subject,
  };
}

export class AuthError extends Error {
  status = 401 as const;
}
