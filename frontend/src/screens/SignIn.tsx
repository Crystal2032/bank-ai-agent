import { useState, type FormEvent } from "react";
import { api } from "../api/client";
import type { HealthResponse, SessionResponse } from "../api/types";
import { Alert, Field, Spinner } from "../components/ui";
import { describeError } from "../lib/errors";

export function SignIn({
  notice,
  health,
  onSignedIn,
}: {
  notice?: string;
  health: HealthResponse | null;
  onSignedIn: (session: SessionResponse) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const typed = password;
    setPassword("");
    try {
      onSignedIn(await api.login(username.trim(), typed));
    } catch (reason) {
      setError(describeError(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="signin-page">
      <div className="signin-card">
        <div className="brand signin-brand">
          <span className="brand-mark" aria-hidden="true">◆</span>
          <span className="brand-name">Bank AI</span>
        </div>
        <h1>Sign in</h1>
        <Alert tone="warning" title="Synthetic banking simulator">
          All accounts, balances and payments are simulated. No real money moves and no real bank is contacted.
        </Alert>
        {notice && <Alert tone="info">{notice}</Alert>}
        {error && <Alert tone="danger">{error}</Alert>}
        <form className="stack" onSubmit={submit}>
          <Field label="Username">
            <input
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              maxLength={100}
              autoFocus
            />
          </Field>
          <Field label="Password">
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              maxLength={256}
            />
          </Field>
          <button type="submit" className="btn btn-primary btn-block" disabled={busy || !username || !password}>
            {busy ? <Spinner /> : "Sign in"}
          </button>
        </form>
        <p className="small muted">
          Demo usernames are provisioned by the backend setup. The password is configured locally by the operator and is never shown in this app.
        </p>
        <p className="small muted service-status">
          {health
            ? `Service online · assistant model ${health.model === "API_CONFIGURED" ? "configured" : "not configured"} · SMS ${health.sms === "LOCAL_TEST_OUTBOX" ? "local test outbox" : "disabled"}`
            : "Service status unavailable"}
        </p>
      </div>
    </div>
  );
}
