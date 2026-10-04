import { useMemo, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import type { ActionView } from "../api/types";
import { ActionCard } from "../components/ActionCard";
import { Alert, Card, EmptyState, Field, Loading, Spinner } from "../components/ui";
import { describeError } from "../lib/errors";
import { newIdempotencyKey } from "../lib/ids";
import { formatMinor, parseAmount } from "../lib/money";
import { useLoad } from "../lib/useLoad";
import { holdActive, useSession } from "../session";

const PENDING = new Set(["WAITING_FOR_CONFIRMATION", "WAITING_FOR_VERIFICATION", "AUTHORIZED", "RECONCILING"]);
type Filter = "pending" | "all";

export function Payments() {
  // Not keyed on bankVersion: cards update themselves, so a completed card stays visible with its receipt.
  const list = useLoad(() => api.actions(), []);
  const [filter, setFilter] = useState<Filter>("pending");
  const [prepared, setPrepared] = useState<ActionView[]>([]);
  const [overrides, setOverrides] = useState<Record<string, ActionView>>({});
  // Cards stay listed once shown, so they don't vanish (with their receipt) the moment they complete.
  const seen = useRef(new Set<string>());

  const all = useMemo(() => {
    const merged = new Map<string, ActionView>();
    for (const a of list.data?.actions ?? []) merged.set(a.id, a);
    for (const a of prepared) merged.set(a.id, a);
    for (const a of Object.values(overrides)) merged.set(a.id, a);
    return [...merged.values()].sort((a, b) => b.createdAt - a.createdAt);
  }, [list.data, prepared, overrides]);

  const shown = all.filter((a) => filter === "all" || PENDING.has(a.status) || seen.current.has(a.id));
  for (const a of shown) seen.current.add(a.id);

  const update = (a: ActionView) => setOverrides((o) => ({ ...o, [a.id]: a }));

  return (
    <div className="page">
      <h1 className="page-title">Payments</h1>
      <TransferForm onPrepared={(a) => setPrepared((p) => [a, ...p.filter((x) => x.id !== a.id)])} />

      <Card
        title="Actions"
        actions={
          <>
            <div className="segmented" role="group" aria-label="Filter actions">
              {(["pending", "all"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={filter === f ? "active" : ""}
                  onClick={() => {
                    seen.current.clear();
                    setFilter(f);
                  }}
                >
                  {f === "pending" ? "Needs attention" : "All"}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setOverrides({});
                seen.current.clear();
                list.reload();
              }}
            >
              Refresh
            </button>
          </>
        }
      >
        {list.loading && !list.data ? (
          <Loading />
        ) : list.error ? (
          <Alert tone="danger">{describeError(list.error)}</Alert>
        ) : shown.length ? (
          <div className="stack">
            {shown.map((a) => (
              <ActionCard key={a.id} action={a} related={all} onUpdated={update} />
            ))}
          </div>
        ) : (
          <EmptyState>{filter === "pending" ? "No actions need your attention." : "No actions yet."}</EmptyState>
        )}
      </Card>
    </div>
  );
}

function TransferForm({ onPrepared }: { onPrepared: (action: ActionView) => void }) {
  const { session, bankVersion, bankChanged } = useSession();
  const contacts = useLoad(() => api.contacts(), [bankVersion]);
  const accounts = useLoad(() => api.accounts(), [bankVersion]);
  const [contactId, setContactId] = useState("");
  const [amountText, setAmountText] = useState("");
  const [note, setNote] = useState("");
  // A new key whenever the intent changes; the same key is reused when retrying a lost response.
  const [intentKey, setIntentKey] = useState(newIdempotencyKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lost, setLost] = useState(false);
  const [touched, setTouched] = useState(false);

  const amount = parseAmount(amountText);
  const contact = contacts.data?.contacts.find((c) => c.id === contactId);
  const restricted = holdActive(session) || session.security.locked;

  const edit = <T,>(setter: (v: T) => void) => (value: T) => {
    setter(value);
    setIntentKey(newIdempotencyKey());
    setLost(false);
    setError(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!contact || !amount.ok) return;
    setBusy(true);
    setError(null);
    try {
      const action = await api.prepareAction({
        kind: "TRANSFER",
        params: { contactId: contact.id, amountMinor: amount.minor, ...(note.trim() ? { note: note.trim() } : {}) },
        idempotencyKey: intentKey,
      });
      onPrepared(action);
      bankChanged();
      setContactId("");
      setAmountText("");
      setNote("");
      setTouched(false);
      setLost(false);
      setIntentKey(newIdempotencyKey());
    } catch (reason) {
      setLost(reason instanceof ApiError && reason.responseLost);
      setError(describeError(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="New transfer">
      {restricted && (
        <Alert tone="warning">Transfers are restricted on this account right now.</Alert>
      )}
      <form className="transfer-form" onSubmit={submit}>
        <fieldset className="field">
          <legend className="field-label">Recipient</legend>
          {contacts.loading && !contacts.data ? (
            <Loading />
          ) : contacts.error ? (
            <Alert tone="danger">{describeError(contacts.error)}</Alert>
          ) : contacts.data?.contacts.length ? (
            <div className="contact-options">
              {contacts.data.contacts.map((c) => (
                <label key={c.id} className={contactId === c.id ? "contact-option selected" : "contact-option"}>
                  <input
                    type="radio"
                    name="contact"
                    value={c.id}
                    checked={contactId === c.id}
                    onChange={() => edit(setContactId)(c.id)}
                  />
                  <span>
                    <strong>{c.name}</strong>
                    <span className="small muted">
                      {" "}· ***{c.phone.slice(-4)}
                      {c.note ? ` · ${c.note}` : ""}
                    </span>
                    <br />
                    <code className="small">{c.recipientAccountId}</code>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <EmptyState>No saved contacts.</EmptyState>
          )}
          {touched && !contact && <span className="field-error">Select an exact recipient.</span>}
        </fieldset>

        <Field
          label="Amount (CNY)"
          error={touched || amountText ? (amount.ok ? null : amount.reason) : null}
          hint={
            accounts.data?.accounts[0]
              ? `Balance ${formatMinor(accounts.data.accounts[0].balanceMinor)} (pending transfers reserve funds)`
              : undefined
          }
        >
          <input
            inputMode="decimal"
            placeholder="0.00"
            value={amountText}
            onChange={(e) => edit(setAmountText)(e.target.value)}
            autoComplete="off"
          />
        </Field>
        {amount.ok && (
          <p className="amount-preview">
            You will review <strong>{formatMinor(amount.minor)}</strong>{" "}
            <span className="muted small">= {amount.minor.toLocaleString("en-US")} minor units</span>
          </p>
        )}

        <Field label="Note (optional)" hint={`${note.length}/200`}>
          <input value={note} maxLength={200} onChange={(e) => edit(setNote)(e.target.value)} />
        </Field>

        <p className="small muted">
          Preparing does not move money. You will review the exact details, then verify with a Passkey or your password. If today's transfers including pending ones exceed CNY 1,000.00, the transfer is red tier and needs a Passkey or password plus SMS code.
        </p>
        {error && (
          <Alert
            tone="danger"
            action={
              lost ? (
                <button type="submit" className="btn btn-sm" disabled={busy}>
                  Retry same request
                </button>
              ) : undefined
            }
          >
            {error}
          </Alert>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy || restricted}>
          {busy ? <Spinner /> : "Prepare for review"}
        </button>
      </form>
    </Card>
  );
}
