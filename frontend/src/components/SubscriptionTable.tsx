import { useState } from "react";
import { api, ApiError } from "../api/client";
import type { ActionView, SubscriptionView } from "../api/types";
import { describeError } from "../lib/errors";
import { formatDate } from "../lib/format";
import { newIdempotencyKey } from "../lib/ids";
import { formatMinor } from "../lib/money";
import { holdActive, useSession } from "../session";
import { ActionCard } from "./ActionCard";
import { Alert, Chip, EmptyState, Spinner } from "./ui";

type ChangeKind = "SUBSCRIPTION_CANCEL" | "MANDATE_REVOKE";

/**
 * Shows subscriptions returned by a confirmed lookup and lets the customer prepare the
 * two distinct changes. Each preparation is reviewed separately on its own action card.
 */
export function SubscriptionTable({
  subscriptions,
  observedLabel,
}: {
  subscriptions: SubscriptionView[];
  observedLabel?: string;
}) {
  const { session, bankChanged } = useSession();
  // One idempotency key per intent; kept until the bank acknowledges, reused on retry.
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [prepared, setPrepared] = useState<ActionView[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ intent: string; message: string; lost: boolean } | null>(null);
  const restricted = holdActive(session);
  // Rows reflect the canonical result of any change completed here, not just the lookup snapshot.
  const changed = new Map(
    [...prepared]
      .reverse() // newest last, so the latest result wins
      .filter((a) => a.status === "SUCCEEDED" && a.result && typeof a.result === "object")
      .map((a) => [(a.result as SubscriptionView).id, a.result as SubscriptionView]),
  );
  const rows = subscriptions.map((s) => changed.get(s.id) ?? s);

  const prepare = async (subscription: SubscriptionView, kind: ChangeKind) => {
    const intent = `${subscription.id}:${kind}`;
    const key = keys[intent] ?? newIdempotencyKey();
    setKeys((k) => ({ ...k, [intent]: key }));
    setBusy(intent);
    setError(null);
    try {
      const action = await api.prepareAction({
        kind,
        params: { subscriptionId: subscription.id },
        idempotencyKey: key,
      });
      setPrepared((list) => [action, ...list.filter((a) => a.id !== action.id)]);
      setKeys(({ [intent]: _done, ...rest }) => rest);
      bankChanged();
    } catch (reason) {
      const lost = reason instanceof ApiError && reason.responseLost;
      if (!lost) setKeys(({ [intent]: _failed, ...rest }) => rest);
      setError({ intent, message: describeError(reason), lost });
    } finally {
      setBusy(null);
    }
  };

  if (!subscriptions.length)
    return <EmptyState>No subscriptions were found for your account.</EmptyState>;

  return (
    <div className="subscriptions">
      {observedLabel && <h3 className="section-label">{observedLabel}</h3>}
      {restricted && (
        <Alert tone="warning">
          A recovery hold is active. Subscription changes are restricted until it ends.
        </Alert>
      )}
      <ul className="sub-list">
        {rows.map((s) => (
          <li key={s.id} className="sub-item">
            <div className="sub-main">
              <strong>{s.merchant}</strong>
              <span>{formatMinor(s.amountMinor)} / month</span>
              <span className="muted small">Next renewal {formatDate(s.nextRenewal)}</span>
            </div>
            <div className="sub-flags">
              <Chip tone={s.status === "ACTIVE" ? "success" : "muted"}>
                Service {s.status === "ACTIVE" ? "active" : "cancelled"}
              </Chip>
              <Chip tone={s.mandateActive ? "warning" : "muted"}>
                Debit mandate {s.mandateActive ? "active" : "revoked"}
              </Chip>
            </div>
            <div className="sub-actions">
              {(["SUBSCRIPTION_CANCEL", "MANDATE_REVOKE"] as const).map((kind) => {
                const intent = `${s.id}:${kind}`;
                const done =
                  kind === "SUBSCRIPTION_CANCEL" ? s.status !== "ACTIVE" : !s.mandateActive;
                return (
                  <button
                    key={kind}
                    type="button"
                    className="btn btn-sm"
                    disabled={done || restricted || busy !== null}
                    onClick={() => prepare(s, kind)}
                  >
                    {busy === intent ? (
                      <Spinner />
                    ) : kind === "SUBSCRIPTION_CANCEL" ? (
                      "Review: cancel service"
                    ) : (
                      "Review: revoke mandate"
                    )}
                  </button>
                );
              })}
            </div>
            {error && error.intent.startsWith(`${s.id}:`) && (
              <Alert
                tone="danger"
                action={
                  error.lost ? (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() =>
                        prepare(s, error.intent.endsWith("MANDATE_REVOKE") ? "MANDATE_REVOKE" : "SUBSCRIPTION_CANCEL")
                      }
                    >
                      Retry same request
                    </button>
                  ) : undefined
                }
              >
                {error.message}
              </Alert>
            )}
          </li>
        ))}
      </ul>
      <p className="small muted">
        Cancelling the service and revoking the debit mandate are separate operations with different consequences. Each is reviewed and confirmed on its own.
      </p>
      {prepared.map((a) => (
        <ActionCard
          key={a.id}
          action={a}
          onUpdated={(next) => setPrepared((list) => list.map((x) => (x.id === next.id ? next : x)))}
        />
      ))}
    </div>
  );
}
