import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError } from "../api/client";
import type { ActionView, ReceiptView } from "../api/types";
import { isTransfer, lookupResult } from "../api/types";
import { describeError, errorCode } from "../lib/errors";
import { formatDateTime, shortId } from "../lib/format";
import { formatMinor } from "../lib/money";
import { useSession } from "../session";
import { PaymentVerification } from "./PaymentVerification";
import { Receipt } from "./Receipt";
import { SubscriptionTable } from "./SubscriptionTable";
import {
  Alert,
  Countdown,
  DetailList,
  KindLabel,
  SimulatedBadge,
  Spinner,
  StatusBadge,
  TierBadge,
  useNow,
} from "./ui";

const PENDING_TTL_MS = 15 * 60000;
const EXPIRING = new Set([
  "WAITING_FOR_CONFIRMATION",
  "WAITING_FOR_VERIFICATION",
  "AUTHORIZED",
]);

export const consequences: Record<string, string> = {
  SUBSCRIPTION_LOOKUP:
    "Reads your subscriptions and debit mandates from the simulated bank. Nothing is changed.",
  SUBSCRIPTION_CANCEL:
    "Ends the service with the merchant. Your debit mandate is NOT revoked by this step — the merchant could still be authorised to debit your account until you revoke the mandate separately.",
  MANDATE_REVOKE:
    "Blocks the merchant from debiting your account. It does NOT cancel the service contract — the merchant may still consider you subscribed or bill you by other means.",
};

const confirmLabel: Record<string, string> = {
  TRANSFER: "Confirm details & verify",
  SUBSCRIPTION_LOOKUP: "Confirm lookup",
  SUBSCRIPTION_CANCEL: "Confirm merchant cancellation",
  MANDATE_REVOKE: "Confirm mandate revocation",
};

export function ActionCard({
  action: initial,
  related = [],
  onUpdated,
  headline,
}: {
  action: ActionView;
  /** Other known actions, used to show dependency status. */
  related?: ActionView[];
  onUpdated?: (action: ActionView) => void;
  headline?: ReactNode;
}) {
  const { bankChanged } = useSession();
  const [action, setAction] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyNotice, setVerifyNotice] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptView | null>(null);
  const [statusUnknown, setStatusUnknown] = useState(false);
  const mounted = useRef(true);
  const now = useNow(5000);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Accept newer server state pushed from the parent (e.g. task polling).
  useEffect(() => {
    setAction((current) =>
      initial.id !== current.id ||
      initial.status !== current.status ||
      initial.tier !== current.tier ||
      initial.receiptId !== current.receiptId
        ? initial
        : current,
    );
  }, [initial]);

  const apply = (next: ActionView) => {
    if (!mounted.current) return;
    setAction(next);
    onUpdated?.(next);
  };

  const loadReceipt = async (next: ActionView) => {
    if (next.status !== "SUCCEEDED" || !next.receiptId) return;
    try {
      const r = await api.receipt(next.receiptId);
      if (mounted.current) setReceipt(r);
    } catch (reason) {
      if (mounted.current)
        setError(`Receipt unavailable: ${describeError(reason)}`);
    }
  };

  const refresh = async () => {
    setBusy("refresh");
    try {
      const next = await api.action(action.id);
      apply(next);
      setStatusUnknown(false);
      await loadReceipt(next);
      return next;
    } catch (reason) {
      setError(describeError(reason));
      return null;
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  /**
   * Executes exactly this action. If the response is lost, read the status first and
   * retry only the same action ID. Success is shown only from SUCCEEDED plus a receipt.
   */
  const execute = async (current: ActionView) => {
    setBusy("execute");
    setError(null);
    setNotice(null);
    try {
      let result: ActionView;
      try {
        result = await api.executeAction(current.id);
      } catch (reason) {
        if (!(reason instanceof ApiError) || !reason.responseLost) throw reason;
        setNotice(
          "The response was lost. Checking the action status before any retry…",
        );
        const status = await api.action(current.id).catch(() => null);
        if (!status) {
          setStatusUnknown(true);
          throw reason;
        }
        result =
          status.status === "AUTHORIZED"
            ? await api.executeAction(current.id)
            : status;
        setNotice(null);
      }
      apply(result);
      bankChanged();
      if (result.status === "SUCCEEDED") await loadReceipt(result);
      else if (result.status === "RECONCILING")
        setNotice(
          "The outcome is being reconciled. This is not a success yet.",
        );
    } catch (reason) {
      const code = errorCode(reason);
      if (code === "RISK_UPGRADED") {
        const next = await refresh();
        setVerifyNotice(describeError(reason));
        if (next?.status === "WAITING_FOR_VERIFICATION") setVerifying(true);
      } else {
        setError(describeError(reason));
        if (
          reason instanceof ApiError &&
          [403, 409, 423].includes(reason.status)
        )
          await refresh();
      }
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  const confirm = async () => {
    setBusy("confirm");
    setError(null);
    try {
      const next = await api.confirmAction(action.id, action.version);
      apply(next);
      if (next.status === "WAITING_FOR_VERIFICATION") {
        setVerifyNotice(null);
        setVerifying(true);
      } else if (next.status === "AUTHORIZED") await execute(next);
    } catch (reason) {
      setError(describeError(reason));
      if (reason instanceof ApiError && [403, 409, 423].includes(reason.status))
        await refresh();
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  const cancel = async () => {
    setBusy("cancel");
    setError(null);
    try {
      apply(await api.cancelAction(action.id));
      bankChanged();
    } catch (reason) {
      setError(describeError(reason));
      await refresh();
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  const expiresAt = action.createdAt + PENDING_TTL_MS;
  const expired = EXPIRING.has(action.status) && expiresAt <= now;
  const pendingDeps = action.dependsOn.filter(
    (id) => related.find((a) => a.id === id)?.status !== "SUCCEEDED",
  );
  const subscriptions = lookupResult(action);
  const working = busy !== null;

  return (
    <article className={`action-card status-${action.status.toLowerCase()}`}>
      <header className="action-head">
        <div>
          <div className="action-kind">
            <KindLabel kind={action.kind} />
            {action.taskId && (
              <span className="muted small"> · prepared by assistant</span>
            )}
          </div>
          {headline}
        </div>
        <div className="action-badges">
          <TierBadge tier={action.tier} />
          <StatusBadge status={action.status} />
        </div>
      </header>

      <ActionDetails action={action} />

      {action.dependsOn.length > 0 && (
        <div className="deps">
          <span className="small muted">Runs after:</span>
          <ul>
            {action.dependsOn.map((id) => {
              const dep = related.find((a) => a.id === id);
              return (
                <li key={id}>
                  {dep ? <KindLabel kind={dep.kind} /> : "Action"}{" "}
                  <code>{shortId(id)}</code>{" "}
                  {dep ? (
                    <StatusBadge status={dep.status} />
                  ) : (
                    <span className="muted small">status unknown</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="action-meta small muted">
        Prepared {formatDateTime(action.createdAt)} · version {action.version} ·
        ID <code title={action.id}>{shortId(action.id)}</code>
        {EXPIRING.has(action.status) && !expired && (
          <>
            {" "}
            · expires in <Countdown until={expiresAt} />
          </>
        )}{" "}
        · <SimulatedBadge />
      </div>

      {expired && (
        <Alert tone="warning">
          This pending action expired after 15 minutes and will be cancelled by
          the bank. Prepare a new one if you still need it.
        </Alert>
      )}
      {action.status === "RECONCILING" && (
        <Alert tone="warning" title="Outcome not final">
          The bank is reconciling this operation. It is not a success and cannot
          be cancelled as if nothing happened. Check the status again later.
        </Alert>
      )}
      {action.status === "AUTHORIZED" && action.kind === "TRANSFER" && (
        <Alert tone="info">
          Verified. Authorization lasts about two minutes and is bound to this
          session.
        </Alert>
      )}
      {notice && <Alert tone="warning">{notice}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      {statusUnknown && (
        <Alert
          tone="warning"
          title="Status unknown"
          action={
            <button
              type="button"
              className="btn btn-sm"
              onClick={refresh}
              disabled={working}
            >
              Check status
            </button>
          }
        >
          The bank could not be reached. Do not assume success or failure; check
          the status before trying again.
        </Alert>
      )}

      {receipt && <Receipt receipt={receipt} />}
      {subscriptions && (
        <SubscriptionTable
          subscriptions={subscriptions}
          observedLabel="Lookup result"
        />
      )}

      <footer className="action-controls">
        {action.status === "WAITING_FOR_CONFIRMATION" && !expired && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={confirm}
            disabled={working || pendingDeps.length > 0}
            title={
              pendingDeps.length
                ? "Complete the earlier steps first."
                : undefined
            }
          >
            {busy === "confirm" || busy === "execute" ? (
              <Spinner />
            ) : (
              confirmLabel[action.kind]
            )}
          </button>
        )}
        {action.status === "WAITING_FOR_VERIFICATION" && !expired && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setVerifyNotice(null);
              setVerifying(true);
            }}
            disabled={working}
          >
            Verify & send
          </button>
        )}
        {action.status === "AUTHORIZED" && !expired && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => execute(action)}
            disabled={working}
          >
            {busy === "execute" ? (
              <Spinner />
            ) : action.kind === "TRANSFER" ? (
              "Send now"
            ) : (
              "Run now"
            )}
          </button>
        )}
        {action.status === "SUCCEEDED" && !receipt && action.receiptId && (
          <button
            type="button"
            className="btn"
            onClick={() => loadReceipt(action)}
            disabled={working}
          >
            View receipt
          </button>
        )}
        {[
          "WAITING_FOR_CONFIRMATION",
          "WAITING_FOR_VERIFICATION",
          "AUTHORIZED",
        ].includes(action.status) && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={cancel}
            disabled={working}
          >
            {busy === "cancel" ? <Spinner /> : "Cancel"}
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={refresh}
          disabled={working}
        >
          {busy === "refresh" ? <Spinner /> : "Refresh status"}
        </button>
      </footer>
      {pendingDeps.length > 0 &&
        action.status === "WAITING_FOR_CONFIRMATION" && (
          <p className="small muted">
            Complete the earlier steps before confirming this one.
          </p>
        )}

      {verifying && (
        <PaymentVerification
          action={action}
          notice={verifyNotice}
          onClose={() => setVerifying(false)}
          onStateChanged={() => void refresh()}
          onAuthorized={(authorized) => {
            setVerifying(false);
            apply(authorized);
            void execute(authorized);
          }}
        />
      )}
    </article>
  );
}

export function ActionDetails({ action }: { action: ActionView }) {
  if (isTransfer(action)) {
    const p = action.params;
    return (
      <DetailList
        rows={[
          ["Recipient", <strong key="n">{p.recipientName}</strong>],
          ["Recipient account", <code key="a">{p.recipientAccountId}</code>],
          [
            "Amount",
            <span key="m">
              <strong className="amount-lg">
                {formatMinor(p.amountMinor)}
              </strong>{" "}
              <span className="muted small">
                ({p.amountMinor.toLocaleString("en-US")} minor units)
              </span>
            </span>,
          ],
          ["Currency", p.currency],
          ["Note", p.note || <span className="muted">None</span>],
        ]}
      />
    );
  }
  const merchant =
    typeof action.params.merchant === "string" ? action.params.merchant : null;
  return (
    <div className="stack-sm">
      {merchant && (
        <DetailList
          rows={[["Merchant", <strong key="m">{merchant}</strong>]]}
        />
      )}
      <p className={`consequence consequence-${action.kind.toLowerCase()}`}>
        {consequences[action.kind]}
      </p>
    </div>
  );
}

/** One-line description built only from canonical action parameters. */
export function summarizeAction(action: ActionView) {
  if (isTransfer(action))
    return `Transfer ${formatMinor(action.params.amountMinor)} to ${action.params.recipientName}`;
  const merchant =
    typeof action.params.merchant === "string" ? action.params.merchant : "";
  if (action.kind === "SUBSCRIPTION_CANCEL")
    return `Cancel ${merchant} service`;
  if (action.kind === "MANDATE_REVOKE")
    return `Revoke ${merchant} debit mandate`;
  return "Look up subscriptions";
}
