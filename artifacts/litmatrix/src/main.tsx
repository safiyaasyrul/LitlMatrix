import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider, SignIn, SignUp, useAuth, useUser } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { Route, Switch, Redirect, Link, useLocation, Router as WouterRouter } from "wouter";
import { Activity, RefreshCw, ShieldCheck, Users, X } from "lucide-react";
import App from "./App.tsx";
import "./index.css";

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const WORKSPACE_CACHE_KEYS = [
  "slr_protocol_v1",
  "slr_records_v1",
  "slr_dupes_v1",
  "slr_screening_v1",
  "slr_chars_v1",
  "slr_synthesis_v1",
  "slr_discussion_v1",
  "slr_checklist_v1",
  "slr_prisma_s_checklist_v1",
  "slr_roses_checklist_v1",
] as const;

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

function AccessGate() {
  const { user } = useUser();
  const [access, setAccess] = useState<{ status: string; owner?: boolean } | null>(null);
  useEffect(() => {
    if (!user) return;
    fetch("/api/prisma/me", { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : null).then(setAccess).catch(() => undefined);
  }, [user?.id]);
  if (!access || (access.status !== "approved" && !access.owner)) {
    return <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">PRISMA Workbench</h1>
      <p>Your account is awaiting owner approval.</p>
      <button className="rounded border px-4 py-2" onClick={() => fetch("/api/prisma/access/request", { method: "POST", credentials: "same-origin" }).then(() => setAccess({ status: "pending" }))}>Request access</button>
    </main>;
  }
  const cacheOwner = sessionStorage.getItem("prisma_cache_owner");
  if ((cacheOwner && cacheOwner !== user?.id) || (!cacheOwner && !access.owner)) {
    WORKSPACE_CACHE_KEYS.forEach((key) => localStorage.removeItem(key));
  }
  if (user?.id) sessionStorage.setItem("prisma_cache_owner", user.id);
  return <>{access.owner && <AdminAccess />}<App /></>;
}

function AdminAccess() {
  type AIUsageSummary = {
    date: string;
    capacity: number;
    used: number;
    remaining: number;
    utilizationPercent: number;
    activeUsers: number;
    perUserLimit: number;
    exhaustedUsers: number;
    users: Array<{
      userId: string;
      email: string;
      name: string | null;
      used: number;
      remaining: number;
    }>;
  };

  const [requests, setRequests] = useState<any[]>([]);
  const [allowlist, setAllowlist] = useState<any[]>([]);
  const [aiUsage, setAiUsage] = useState<AIUsageSummary | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const load = () => {
    setUsageLoading(true);
    return Promise.all([
    fetch("/api/prisma/admin/access", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : []),
    fetch("/api/prisma/admin/allowlist", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : []),
    fetch("/api/prisma/admin/ai-usage", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : null),
  ]).then(([nextRequests, nextAllowlist, nextAiUsage]) => {
    setRequests(nextRequests);
    setAllowlist(nextAllowlist);
    setAiUsage(nextAiUsage);
  }).finally(() => {
    setUsageLoading(false);
  });
  };
  useEffect(() => { void load(); }, []);
  return <>
    <button
      type="button"
      aria-label={isOpen ? "Close allowed user access" : "Open allowed user access"}
      title={isOpen ? "Close allowed user access" : "Allowed user access"}
      aria-expanded={isOpen}
      onClick={() => setIsOpen((open) => !open)}
      className="fixed right-4 top-16 z-[60] flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-lg transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
    >
      {isOpen ? <X className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
    </button>
    {isOpen && (
      <aside className="fixed right-4 top-28 z-50 max-h-[calc(75vh-3rem)] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-900">Allowed users</h2>
            <p className="text-xs text-slate-500">Add a paid customer’s sign-in email.</p>
          </div>
          <span className="rounded-full bg-indigo-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-indigo-700">
            Owner
          </span>
        </div>
        <section className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                <Activity className="h-4 w-4 text-indigo-600" />
                Managed AI usage
              </h3>
              <p className="text-[11px] text-slate-500">
                {aiUsage ? `${aiUsage.date} · app calls` : "Loading today’s usage"}
              </p>
            </div>
            <button
              type="button"
              aria-label="Refresh managed AI usage"
              title="Refresh managed AI usage"
              onClick={() => void load()}
              disabled={usageLoading}
              className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 transition hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${usageLoading ? "animate-spin" : ""}`} />
            </button>
          </div>
          {aiUsage ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg bg-white p-2.5 shadow-xs">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">Used</div>
                  <div className="mt-0.5 text-lg font-bold text-slate-900">{aiUsage.used}</div>
                </div>
                <div className="rounded-lg bg-white p-2.5 shadow-xs">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">Remaining</div>
                  <div className="mt-0.5 text-lg font-bold text-emerald-700">{aiUsage.remaining}</div>
                </div>
                <div className="rounded-lg bg-white p-2.5 shadow-xs">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">Capacity</div>
                  <div className="mt-0.5 text-lg font-bold text-slate-900">{aiUsage.capacity}</div>
                </div>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
                <div
                  className={`h-full rounded-full transition-all ${
                    aiUsage.utilizationPercent >= 90
                      ? "bg-rose-500"
                      : aiUsage.utilizationPercent >= 70
                        ? "bg-amber-500"
                        : "bg-emerald-500"
                  }`}
                  style={{ width: `${aiUsage.utilizationPercent}%` }}
                />
              </div>
              <div className="mt-1.5 flex justify-between text-[10px] text-slate-500">
                <span>{aiUsage.utilizationPercent}% used</span>
                <span>{aiUsage.perUserLimit} calls/user/day</span>
              </div>
              <div className="mt-3 flex items-center gap-3 border-t border-slate-200 pt-3 text-xs text-slate-600">
                <span className="flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" />
                  {aiUsage.activeUsers} active
                </span>
                <span>{aiUsage.exhaustedUsers} at limit</span>
              </div>
              {aiUsage.users.length > 0 && (
                <div className="mt-3 max-h-36 space-y-1 overflow-y-auto">
                  {aiUsage.users.map((usageUser) => (
                    <div key={usageUser.userId} className="flex items-center justify-between gap-3 rounded-lg bg-white px-2.5 py-2 text-xs">
                      <span className="min-w-0 truncate text-slate-700" title={usageUser.email}>
                        {usageUser.email}
                      </span>
                      <span className="shrink-0 font-mono text-slate-500">
                        {usageUser.used}/{aiUsage.perUserLimit}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-3 text-[10px] leading-relaxed text-slate-500">
                Remaining capacity is measured against the app’s configured daily monitoring budget, not the provider account balance.
              </p>
            </>
          ) : (
            <div className="rounded-lg bg-white p-3 text-xs text-slate-500">
              Usage data is temporarily unavailable.
            </div>
          )}
        </section>
        <form className="flex gap-2" onSubmit={(event) => {
          event.preventDefault();
          fetch("/api/prisma/admin/allowlist", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email }),
          }).then((response) => {
            if (!response.ok) throw new Error("Could not add email.");
            setEmail("");
            return load();
          }).catch(() => undefined);
        }}>
          <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="customer@example.com" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <button className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white">Add</button>
        </form>
        <div className="mt-3 space-y-1">
          {allowlist.map((entry) => <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2" key={entry.id}>
            <span className="truncate text-sm">{entry.email}</span>
            <button className="text-xs font-semibold text-rose-700" onClick={() => fetch(`/api/prisma/admin/allowlist/${entry.id}`, { method: "DELETE", credentials: "same-origin" }).then(load)}>Remove</button>
          </div>)}
        </div>
        {requests.length > 0 && <h3 className="mb-1 mt-4 border-t border-slate-200 pt-3 text-sm font-semibold">Access requests</h3>}
        {requests.map(({ request, user }) => <div className="flex items-center justify-between gap-3 border-t py-2" key={request.id}>
          <span className="text-sm">{user.email} ({request.status})</span>
          <button className="rounded border px-2 py-1 text-xs" onClick={() => fetch(`/api/prisma/admin/access/${request.id}`, { method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: request.status === "approved" ? "revoked" : "approved" }) }).then(load)}>{request.status === "approved" ? "Revoke" : "Approve"}</button>
        </div>)}
      </aside>
    )}
  </>;
}

function PublicLanding() {
  return <main className="min-h-screen flex flex-col items-center justify-center gap-5 p-6 text-center">
    <h1 className="text-4xl font-semibold">PRISMA 2020 Workbench</h1>
    <p className="max-w-lg">An invite-only workspace for rigorous systematic reviews.</p>
    <div className="flex gap-3"><Link href="/sign-in">Sign in</Link><Link href="/sign-up">Request an invite</Link></div>
  </main>;
}

function AuthRoutes() {
  const { isSignedIn } = useAuth();
  return <Switch>
    <Route path="/sign-in/*?"><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></Route>
    <Route path="/sign-up/*?"><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></Route>
    <Route path="/">{isSignedIn ? <AccessGate /> : <PublicLanding />}</Route>
    <Route><Redirect to="/" /></Route>
  </Switch>;
}

function ClerkRoutes() {
  const [, setLocation] = useLocation();
  return <ClerkProvider
    publishableKey={clerkPubKey}
    proxyUrl={clerkProxyUrl}
    signInUrl={`${basePath}/sign-in`}
    signUpUrl={`${basePath}/sign-up`}
    routerPush={(to) => setLocation(stripBase(to))}
    routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
  >
    <AuthRoutes />
  </ClerkProvider>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><WouterRouter base={basePath}><ClerkRoutes /></WouterRouter></StrictMode>,
);