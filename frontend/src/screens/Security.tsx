import { useState } from "react";
import { api } from "../api/client";
import type { FactorOperation } from "../api/types";
import {
  Card,
  Alert,
  DetailList,
  Countdown,
  Chip,
  EmptyState,
} from "../components/ui";
import { SecurityOperation } from "../components/SecurityOperation";
import { useLoad } from "../lib/useLoad";
import { describeError } from "../lib/errors";
import { formatDateTime } from "../lib/format";
import { holdActive, useSession } from "../session";
export function Security() {
  const { session } = useSession();
  const keys = useLoad(() => api.passkeys(), [session.csrfToken]);
  const totp = useLoad(() => api.authenticator(), [session.csrfToken]);
  const [flow, setFlow] = useState<{
    operation: FactorOperation;
    target?: string;
  } | null>(null);
  const active = (keys.data?.passkeys ?? []).filter((k) => !k.revoked);
  const blocked = holdActive(session) || session.security.locked;
  const finish = () => {
    keys.reload();
    totp.reload();
  };
  return (
    <div className="page">
      <h1 className="page-title">Security center</h1>
      <Card title="Account protection">
        <DetailList
          rows={[
            ["Registered phone", session.customer.maskedPhone],
            ["Active Passkeys", String(active.length)],
            ["Authenticator", totp.data?.enabled ? "Enabled" : "Not enabled"],
            [
              "Risk restriction",
              holdActive(session) ? (
                <span>
                  Until {formatDateTime(session.security.holdUntil)} (
                  <Countdown until={session.security.holdUntil} />)
                </span>
              ) : (
                "None"
              ),
            ],
            [
              "Account lock",
              session.security.locked
                ? "Locked - review required"
                : "Not locked",
            ],
          ]}
        />
        <p className="small muted">
          Small transfers use one option: Authenticator, Passkey or password.
          Recovery prefers two other enrolled options; fewer options use the
          available fallback. Normal verified recovery has no automatic funds
          waiting period. Password recovery here requires an existing signed-in
          session; signed-out recovery without a usable password requires
          operator identity review.
        </p>
      </Card>
      <Card title="Authenticator">
        <p>
          Use a standard TOTP app. Login remains password-only. Binding and
          replacement use locally generated QR codes; recovery codes are shown
          once.
        </p>
        {totp.error ? (
          <Alert tone="danger">{describeError(totp.error)}</Alert>
        ) : null}
        <div className="row">
          <button
            className="btn btn-primary"
            disabled={blocked || totp.loading}
            onClick={() => setFlow({ operation: "TOTP_SETUP" })}
          >
            {totp.data?.enabled
              ? "Recover or replace Authenticator"
              : "Add Authenticator"}
          </button>
          {totp.data?.enabled && (
            <button
              className="btn"
              disabled={blocked}
              onClick={() => setFlow({ operation: "TOTP_REMOVE" })}
            >
              Remove Authenticator
            </button>
          )}
        </div>
      </Card>
      <Card
        title="Passkeys"
        actions={
          <button
            className="btn btn-primary btn-sm"
            disabled={blocked}
            onClick={() => setFlow({ operation: "PASSKEY_ENROLL" })}
          >
            Add Passkey
          </button>
        }
      >
        {keys.error ? (
          <Alert tone="danger">{describeError(keys.error)}</Alert>
        ) : null}
        {active.length ? (
          <ul className="key-list">
            {active.map((k) => (
              <li key={k.id} className="key-item">
                <div className="key-main">
                  <strong>{k.label}</strong>
                  <span className="small muted">
                    Added {formatDateTime(k.createdAt)}
                  </span>
                </div>
                <Chip tone="success">Active</Chip>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={blocked}
                  onClick={() =>
                    setFlow({ operation: "PASSKEY_REVOKE", target: k.id })
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>
            No active Passkeys. Add a device credential as a backup.
          </EmptyState>
        )}
        <button
          className="btn"
          disabled={blocked || !active.length}
          onClick={() => setFlow({ operation: "PASSKEY_RECOVER" })}
        >
          Lost Passkeys? Recover with backup options
        </button>
      </Card>
      <Card title="Account password">
        <p>
          Reset using enrolled backup options. The server selects two options
          where available and accepts fewer when the account lacks enough
          enrolled backups.
        </p>
        <button
          className="btn"
          disabled={blocked}
          onClick={() => setFlow({ operation: "PASSWORD_RESET" })}
        >
          Reset password
        </button>
      </Card>
      {flow && (
        <SecurityOperation
          operation={flow.operation}
          target={flow.target}
          onClose={() => setFlow(null)}
          onDone={finish}
        />
      )}
    </div>
  );
}
