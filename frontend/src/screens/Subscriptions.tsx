import { useMemo, useState } from "react";
import { api, ApiError } from "../api/client";
import type { ActionView } from "../api/types";
import { lookupResult } from "../api/types";
import { ActionCard, consequences } from "../components/ActionCard";
import { SubscriptionTable } from "../components/SubscriptionTable";
import { Alert, Card, Loading, Spinner } from "../components/ui";
import { describeError } from "../lib/errors";
import { formatDateTime } from "../lib/format";
import { newIdempotencyKey } from "../lib/ids";
import { useLoad } from "../lib/useLoad";

const OPEN = new Set(["WAITING_FOR_CONFIRMATION", "WAITING_FOR_VERIFICATION", "AUTHORIZED", "RECONCILING"]);
const SUB_KINDS = new Set(["SUBSCRIPTION_LOOKUP", "SUBSCRIPTION_CANCEL", "MANDATE_REVOKE"]);

export function Subscriptions() {
  const list = useLoad(() => api.actions(), []);
  const [lookup, setLookup] = useState<ActionView | null>(null);
  const [lookupKey, setLookupKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; lost: boolean } | null>(null);

  const actions = list.data?.actions ?? [];
  const latestLookup = useMemo(
    () =>
      actions
        .filter((a) => lookupResult(a))
        .sort((a, b) => b.createdAt - a.createdAt)[0],
    [actions],
  );
  const open = actions.filter((a) => SUB_KINDS.has(a.kind) && OPEN.has(a.status) && a.id !== lookup?.id);

  const startLookup = async () => {
    const key = lookupKey ?? newIdempotencyKey();
    setLookupKey(key);
    setBusy(true);
    setError(null);
    try {
      setLookup(await api.prepareAction({ kind: "SUBSCRIPTION_LOOKUP", params: {}, idempotencyKey: key }));
      setLookupKey(null);
    } catch (reason) {
      const lost = reason instanceof ApiError && reason.responseLost;
      if (!lost) setLookupKey(null);
      setError({ message: describeError(reason), lost });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <h1 className="page-title">Subscriptions</h1>
      <Card title="Look up subscriptions">
        <p>
          Subscription details are read only through a confirmed lookup. You review and confirm the lookup first; changes are then prepared and confirmed separately.
        </p>
        <div className="grid-2 small">
          <div className="consequence consequence-subscription_cancel">
            <strong>Cancel merchant service</strong>
            <br />
            {consequences.SUBSCRIPTION_CANCEL}
          </div>
          <div className="consequence consequence-mandate_revoke">
            <strong>Revoke debit mandate</strong>
            <br />
            {consequences.MANDATE_REVOKE}
          </div>
        </div>
        {error && (
          <Alert
            tone="danger"
            action={
              error.lost ? (
                <button type="button" className="btn btn-sm" onClick={startLookup} disabled={busy}>
                  Retry same request
                </button>
              ) : undefined
            }
          >
            {error.message}
          </Alert>
        )}
        {!lookup && (
          <button type="button" className="btn btn-primary" onClick={startLookup} disabled={busy}>
            {busy ? <Spinner /> : "Prepare subscription lookup"}
          </button>
        )}
        {lookup && (
          <ActionCard
            action={lookup}
            onUpdated={(a) => {
              setLookup(a);
              if (!OPEN.has(a.status) && a.status !== "SUCCEEDED") setLookup(null);
            }}
          />
        )}
      </Card>

      {!lookup && latestLookup && (
        <Card title="Last lookup result">
          <p className="small muted">
            From the lookup prepared {formatDateTime(latestLookup.createdAt)}. Run a new lookup for current details.
          </p>
          <SubscriptionTable subscriptions={lookupResult(latestLookup) ?? []} />
        </Card>
      )}

      <Card title="Open subscription actions">
        {list.loading && !list.data ? (
          <Loading />
        ) : list.error ? (
          <Alert tone="danger">{describeError(list.error)}</Alert>
        ) : open.length ? (
          <div className="stack">
            {open.map((a) => (
              <ActionCard key={a.id} action={a} related={actions} />
            ))}
          </div>
        ) : (
          <p className="empty">No open subscription actions.</p>
        )}
      </Card>
    </div>
  );
}
