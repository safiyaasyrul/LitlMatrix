import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider, SignIn, SignUp, useAuth, useUser } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { Route, Switch, Redirect, Link, useLocation, Router as WouterRouter } from "wouter";
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
  const [requests, setRequests] = useState<any[]>([]);
  const [allowlist, setAllowlist] = useState<any[]>([]);
  const [email, setEmail] = useState("");
  const load = () => Promise.all([
    fetch("/api/prisma/admin/access", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : []),
    fetch("/api/prisma/admin/allowlist", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : []),
  ]).then(([nextRequests, nextAllowlist]) => {
    setRequests(nextRequests);
    setAllowlist(nextAllowlist);
  });
  useEffect(() => { void load(); }, []);
  return <aside className="fixed right-4 top-16 z-50 max-h-[75vh] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
    <h2 className="font-semibold text-slate-900">Allowed users</h2>
    <p className="mb-3 text-xs text-slate-500">Add a paid customer’s sign-in email.</p>
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
  </aside>;
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