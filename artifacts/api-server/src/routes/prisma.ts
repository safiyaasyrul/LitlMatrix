import { Router } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  accessRequests,
  allowedEmails,
  dailyAiUsage,
  users,
  workspaceSnapshots,
} from "@workspace/db/schema";

const router = Router();
const ownerEmail = process.env.PRISMA_OWNER_EMAIL?.trim().toLowerCase();

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

const perUserLimit = positiveInteger(process.env.PRISMA_MANAGED_AI_DAILY_USER_LIMIT, 100);
const dailyActiveUserLimit = positiveInteger(process.env.PRISMA_MANAGED_AI_DAILY_ACTIVE_USER_LIMIT, 100);
const globalDailyCapacity = positiveInteger(
  process.env.PRISMA_MANAGED_AI_DAILY_CAPACITY,
  perUserLimit * dailyActiveUserLimit,
);

async function identity(req: any) {
  const { userId } = getAuth(req);
  if (!userId) return null;
  const clerkUser = await clerkClient.users.getUser(userId);
  const primaryEmail = clerkUser.emailAddresses.find(
    (candidate) => candidate.id === clerkUser.primaryEmailAddressId,
  );
  if (
    !primaryEmail?.emailAddress ||
    primaryEmail.verification?.status !== "verified"
  ) {
    return null;
  }
  const email = primaryEmail.emailAddress;
  const [user] = await db.insert(users).values({
    clerkId: userId, email: email.toLowerCase(),
    name: [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || null,
  }).onConflictDoUpdate({ target: users.clerkId, set: { email: email.toLowerCase(), updatedAt: new Date() } }).returning();
  const [access] = await db.select().from(accessRequests).where(eq(accessRequests.userId, user.id)).limit(1);
  const [allowlistEntry] = await db.select().from(allowedEmails).where(eq(allowedEmails.email, email.toLowerCase())).limit(1);
  const owner = email.toLowerCase() === ownerEmail;
  return {
    user,
    access,
    owner,
    allowed: owner || Boolean(allowlistEntry) || access?.status === "approved",
  };
}

function requireIdentity(req: any, res: any, next: any) {
  identity(req).then((result) => {
    if (!result) return res.status(401).json({ error: "Sign in is required." });
    if (!result.allowed) return res.status(403).json({ error: "Access is pending approval.", status: result.access?.status ?? "pending" });
    res.locals.prismaIdentity = result;
    next();
  }).catch(next);
}

router.get("/me", async (req, res, next) => {
  try {
    const result = await identity(req);
    if (!result) return res.status(401).json({ error: "Sign in is required." });
    return res.json({
      user: result.user,
      status: result.allowed ? "approved" : result.access?.status ?? "pending",
      owner: result.owner,
      dailyLimit: perUserLimit,
    });
  } catch (error) { return next(error); }
});

router.post("/access/request", async (req, res, next) => {
  try {
    const result = await identity(req);
    if (!result) return res.status(401).json({ error: "Sign in is required." });
    if (result.owner) return res.json({ status: "approved" });
    const [request] = await db.insert(accessRequests).values({ userId: result.user.id })
      .onConflictDoUpdate({ target: accessRequests.userId, set: { status: "pending" } }).returning();
    return res.json({ status: request.status });
  } catch (error) { return next(error); }
});

router.use(requireIdentity);
router.get("/workspace", async (req, res, next) => {
  try {
    const [snapshot] = await db.select().from(workspaceSnapshots).where(eq(workspaceSnapshots.userId, res.locals.prismaIdentity.user.id)).limit(1);
    return res.json({ snapshot: snapshot?.snapshot ?? null });
  } catch (error) { return next(error); }
});
router.put("/workspace", async (req, res, next) => {
  try {
    const userId = res.locals.prismaIdentity.user.id;
    const [snapshot] = await db.insert(workspaceSnapshots).values({ userId, snapshot: req.body.snapshot ?? req.body })
      .onConflictDoUpdate({ target: workspaceSnapshots.userId, set: { snapshot: req.body.snapshot ?? req.body, updatedAt: new Date() } }).returning();
    return res.json({ snapshot: snapshot.snapshot });
  } catch (error) { return next(error); }
});

router.post("/ai/generate", async (req, res, next) => {
  try {
    const prompt = String(req.body.prompt ?? "");
    const systemInstruction = String(req.body.systemInstruction ?? "");
    if (!prompt.trim()) return res.status(400).json({ error: "A prompt is required." });
    if (prompt.length > 120_000 || systemInstruction.length > 20_000) {
      return res.status(413).json({ error: "AI request is too large." });
    }
    const requestedOutputTokens = Number(req.body.maxOutputTokens ?? 3500);
    const maxOutputTokens = Number.isFinite(requestedOutputTokens)
      ? Math.max(100, Math.min(4000, Math.floor(requestedOutputTokens)))
      : 3500;
    const userId = res.locals.prismaIdentity.user.id;
    const today = new Date().toISOString().slice(0, 10);
    const reservation = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`prisma-managed-ai:${today}`}))`,
      );

      const [existingUsage] = await tx.select({ calls: dailyAiUsage.calls })
        .from(dailyAiUsage)
        .where(and(
          eq(dailyAiUsage.userId, userId),
          eq(dailyAiUsage.usageDate, today),
        ))
        .limit(1);

      if (!existingUsage) {
        const [activeUsage] = await tx.select({
          count: sql<number>`count(*)::int`,
        }).from(dailyAiUsage).where(eq(dailyAiUsage.usageDate, today));
        if ((activeUsage?.count ?? 0) >= dailyActiveUserLimit) {
          return {
            error: "Daily managed-AI user capacity reached. Try again after the UTC-day reset or use a configured direct provider.",
            limit: dailyActiveUserLimit,
          } as const;
        }
      }

      if ((existingUsage?.calls ?? 0) >= perUserLimit) {
        return {
          error: "Daily managed-AI limit reached.",
          limit: perUserLimit,
        } as const;
      }

      const [dailyUsage] = await tx.select({
        calls: sql<number>`coalesce(sum(${dailyAiUsage.calls}), 0)::int`,
      }).from(dailyAiUsage).where(eq(dailyAiUsage.usageDate, today));
      if ((dailyUsage?.calls ?? 0) >= globalDailyCapacity) {
        return {
          error: "Daily managed-AI capacity reached. Try again after the UTC-day reset or use a configured direct provider.",
          limit: globalDailyCapacity,
        } as const;
      }

      const [usage] = await tx.insert(dailyAiUsage)
        .values({ userId, usageDate: today, calls: 1 })
        .onConflictDoUpdate({
          target: [dailyAiUsage.userId, dailyAiUsage.usageDate],
          set: { calls: sql`${dailyAiUsage.calls} + 1` },
        })
        .returning();
      return { usage } as const;
    });
    if ("error" in reservation) {
      return res.status(429).json({
        error: reservation.error,
        limit: reservation.limit,
        remaining: 0,
      });
    }
    const { usage } = reservation;
    const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    if (!baseUrl || !apiKey) return res.status(503).json({ error: "Managed AI is not configured on the server." });
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "gpt-5.6-terra", messages: [
        ...(systemInstruction ? [{ role: "system", content: systemInstruction }] : []),
        { role: "user", content: prompt },
      ], max_completion_tokens: maxOutputTokens }),
    });
    const data: any = await response.json().catch(() => ({}));
    if (!response.ok || data.error) return res.status(response.status || 502).json({ error: data.error?.message ?? "Managed AI request failed." });
    return res.json({ text: data.choices?.[0]?.message?.content ?? "", usage: { limit: perUserLimit, used: usage.calls, remaining: perUserLimit - usage.calls } });
  } catch (error) { return next(error); }
});

router.get("/admin/access", async (_req, res, next) => {
  try {
    if (!res.locals.prismaIdentity.owner) return res.status(403).json({ error: "Owner access required." });
    return res.json(await db.select({ request: accessRequests, user: users }).from(accessRequests).innerJoin(users, eq(accessRequests.userId, users.id)));
  } catch (error) { return next(error); }
});
router.get("/admin/ai-usage", async (_req, res, next) => {
  try {
    if (!res.locals.prismaIdentity.owner) return res.status(403).json({ error: "Owner access required." });
    const today = new Date().toISOString().slice(0, 10);
    const usageRows = await db.select({
      userId: dailyAiUsage.userId,
      email: users.email,
      name: users.name,
      calls: dailyAiUsage.calls,
    }).from(dailyAiUsage)
      .innerJoin(users, eq(dailyAiUsage.userId, users.id))
      .where(eq(dailyAiUsage.usageDate, today))
      .orderBy(desc(dailyAiUsage.calls));
    const used = usageRows.reduce((total, row) => total + row.calls, 0);
    const remaining = Math.max(0, globalDailyCapacity - used);
    return res.json({
      date: today,
      capacity: globalDailyCapacity,
      used,
      remaining,
      utilizationPercent: Math.min(100, Math.round((used / globalDailyCapacity) * 100)),
      activeUsers: usageRows.length,
      activeUserLimit: dailyActiveUserLimit,
      activeUserRemaining: Math.max(0, dailyActiveUserLimit - usageRows.length),
      perUserLimit,
      exhaustedUsers: usageRows.filter((row) => row.calls >= perUserLimit).length,
      users: usageRows.slice(0, 100).map((row) => ({
        userId: row.userId,
        email: row.email,
        name: row.name,
        used: row.calls,
        remaining: Math.max(0, perUserLimit - row.calls),
      })),
    });
  } catch (error) { return next(error); }
});
router.get("/admin/allowlist", async (_req, res, next) => {
  try {
    if (!res.locals.prismaIdentity.owner) return res.status(403).json({ error: "Owner access required." });
    return res.json(await db.select().from(allowedEmails).orderBy(allowedEmails.email));
  } catch (error) { return next(error); }
});
router.post("/admin/allowlist", async (req, res, next) => {
  try {
    if (!res.locals.prismaIdentity.owner) return res.status(403).json({ error: "Owner access required." });
    const email = String(req.body.email ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }
    const [entry] = await db.insert(allowedEmails).values({
      email,
      addedBy: res.locals.prismaIdentity.user.id,
    }).onConflictDoNothing({ target: allowedEmails.email }).returning();
    if (entry) return res.status(201).json(entry);
    const [existing] = await db.select().from(allowedEmails).where(eq(allowedEmails.email, email)).limit(1);
    return res.json(existing);
  } catch (error) { return next(error); }
});
router.delete("/admin/allowlist/:id", async (req, res, next) => {
  try {
    if (!res.locals.prismaIdentity.owner) return res.status(403).json({ error: "Owner access required." });
    const [removed] = await db.delete(allowedEmails).where(eq(allowedEmails.id, req.params.id)).returning();
    if (!removed) return res.status(404).json({ error: "Allowlist entry not found." });
    return res.json(removed);
  } catch (error) { return next(error); }
});
router.patch("/admin/access/:id", async (req, res, next) => {
  try {
    if (!res.locals.prismaIdentity.owner) return res.status(403).json({ error: "Owner access required." });
    const [request] = await db.update(accessRequests).set({ status: req.body.status === "approved" ? "approved" : "revoked", reviewedBy: res.locals.prismaIdentity.user.id, reviewedAt: new Date() }).where(eq(accessRequests.id, req.params.id)).returning();
    return res.json(request);
  } catch (error) { return next(error); }
});

export default router;