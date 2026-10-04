import { useCallback, useEffect, useState } from "react";
import { api, onConnectivity, onUnauthorized, setCsrfToken } from "./api/client";
import type { HealthResponse, SessionResponse } from "./api/types";
import { Alert, Countdown, Loading, SimulatedBadge } from "./components/ui";
import { describeError, errorCode } from "./lib/errors";
import { formatDateTime } from "./lib/format";
import { Activity } from "./screens/Activity";
import { Assistant, clearAssistantStorage } from "./screens/Assistant";
import { Bills } from "./screens/Bills";
import { Overview } from "./screens/Overview";
import { Payments } from "./screens/Payments";
import { Security } from "./screens/Security";
import { SignIn } from "./screens/SignIn";
import { Subscriptions } from "./screens/Subscriptions";
import { Transactions } from "./screens/Transactions";
import { readRoute, routes, type RoutePath } from "./router";
import { holdActive, SessionProvider, useSession } from "./session";

type Phase =
  | { kind: "loading" }
  | { kind: "signedOut"; notice?: string }
  | { kind: "unreachable"; message: string }
  | { kind: "signedIn"; session: SessionResponse };

export function App() {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [online, setOnline] = useState(true);
  const [health, setHealth] = useState<HealthResponse | null>(null);

  const probe = useCallback(async () => {
    setPhase({ kind: "loading" });
    try {
      setPhase({ kind: "signedIn", session: await api.me() });
    } catch (reason) {
      const code = errorCode(reason);
      if (code === "NETWORK_ERROR") setPhase({ kind: "unreachable", message: describeError(reason) });
      else setPhase({ kind: "signedOut" });
    }
  }, []);

  useEffect(() => {
    onUnauthorized(() => {
      setCsrfToken(null);
      clearAssistantStorage();
      setPhase({ kind: "signedOut", notice: "Your session ended. Please sign in again." });
    });
    onConnectivity(setOnline);
    void probe();
    api.health().then(setHealth, () => setHealth(null));
    return () => {
      onUnauthorized(null);
      onConnectivity(null);
    };
  }, [probe]);

  // While the backend is unreachable, poll health so the banner clears on recovery.
  useEffect(() => {
    if (online) return;
    const timer = window.setInterval(() => {
      api.health().then(setHealth, () => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [online]);

  const updateSession = useCallback((session: SessionResponse) => {
    setCsrfToken(session.csrfToken);
    setPhase({ kind: "signedIn", session });
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // The local session is discarded either way; the server session expires on its own.
    }
    setCsrfToken(null);
    clearAssistantStorage();
    setPhase({ kind: "signedOut", notice: "You have signed out." });
  }, []);

  if (phase.kind === "loading") return <Loading label="Connecting to the simulated bank…" />;
  if (phase.kind === "unreachable")
    return (
      <div className="center-page">
        <Alert
          tone="danger"
          title="Banking service unreachable"
          action={
            <button type="button" className="btn" onClick={probe}>
              Try again
            </button>
          }
        >
          {phase.message}
        </Alert>
      </div>
    );
  if (phase.kind === "signedOut")
    return <SignIn notice={phase.notice} health={health} onSignedIn={updateSession} />;

  return (
    <SessionProvider session={phase.session} updateSession={updateSession} signOut={signOut}>
      <Shell online={online} health={health} />
    </SessionProvider>
  );
}

function Shell({ online, health }: { online: boolean; health: HealthResponse | null }) {
  const { session, signOut } = useSession();
  const [route, setRoute] = useState<RoutePath>(readRoute);

  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    document.querySelector("main")?.scrollTo({ top: 0 });
  }, [route]);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">◆</span>
          <span className="brand-name">Bank AI</span>
          <SimulatedBadge label="Synthetic banking" />
        </div>
        <div className="topbar-user">
          <span className="user-name">{session.customer.name}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>

      <nav className="sidenav" aria-label="Main">
        {routes.map((r) => (
          <a
            key={r.path}
            href={`#/${r.path}`}
            className={route === r.path ? "nav-link active" : "nav-link"}
            aria-current={route === r.path ? "page" : undefined}
          >
            <span className="nav-icon" aria-hidden="true">{r.icon}</span>
            <span className="nav-label">{r.label}</span>
          </a>
        ))}
        <div className="nav-footer small muted">
          {health ? (
            <>
              Banking: simulated
              <br />
              Assistant model: {health.model === "API_CONFIGURED" ? "configured" : "not configured"}
              <br />
              SMS: {health.sms === "LOCAL_TEST_OUTBOX" ? "local test outbox" : "disabled"}
            </>
          ) : (
            "Service status unknown"
          )}
        </div>
      </nav>

      <main className="content">
        {!online && (
          <Alert tone="danger" title="Banking service unreachable">
            Showing the last known information. Nothing is assumed to have succeeded; statuses refresh once the connection returns.
          </Alert>
        )}
        {holdActive(session) && (
          <Alert tone="warning" title="Recovery hold active">
            After Passkey recovery, transfers, subscription changes and key changes are restricted until{" "}
            {formatDateTime(session.security.holdUntil)} (<Countdown until={session.security.holdUntil} /> left). Pending transfers are not replayed when it ends.
          </Alert>
        )}
        {session.security.locked && (
          <Alert tone="danger" title="Account locked">
            Sensitive operations require bank review. Balances and history remain available.
          </Alert>
        )}
        {route === "overview" && <Overview />}
        {route === "assistant" && <Assistant />}
        {route === "payments" && <Payments />}
        {route === "transactions" && <Transactions />}
        {route === "bills" && <Bills />}
        {route === "subscriptions" && <Subscriptions />}
        {route === "security" && <Security />}
        {route === "activity" && <Activity />}
      </main>
    </div>
  );
}
