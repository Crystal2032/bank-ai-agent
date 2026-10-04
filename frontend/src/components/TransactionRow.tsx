import { useState } from "react";
import { api } from "../api/client";
import type { ReceiptView, TransactionView } from "../api/types";
import { describeError } from "../lib/errors";
import { formatDateTime } from "../lib/format";
import { formatMinor } from "../lib/money";
import { Receipt } from "./Receipt";
import { Modal, Spinner } from "./ui";

export function TransactionRow({
  transaction: t,
  highlight = false,
}: {
  transaction: TransactionView;
  highlight?: boolean;
}) {
  const [receipt, setReceipt] = useState<ReceiptView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ledger entries created by an operation link to it; resolve the receipt through the action.
  const openReceipt = async () => {
    if (!t.operationId) return;
    setBusy(true);
    setError(null);
    try {
      const action = await api.action(t.operationId);
      if (!action.receiptId) throw new Error("No receipt is recorded for this operation.");
      setReceipt(await api.receipt(action.receiptId));
    } catch (reason) {
      setError(describeError(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={highlight ? "tx-row highlight" : "tx-row"}>
      <div className="tx-main">
        <span className="tx-merchant">{t.merchant}</span>
        <span className="tx-sub small muted">
          {t.category} · {formatDateTime(t.occurredAt)}
          {t.note ? ` · ${t.note}` : ""}
        </span>
        {error && <span className="field-error">{error}</span>}
      </div>
      <div className="tx-side">
        <span className={t.amountMinor < 0 ? "tx-amount out" : "tx-amount in"}>
          {formatMinor(t.amountMinor, { signed: true })}
        </span>
        {/* Incoming transfers belong to the sender's action, which is not readable here. */}
        {t.operationId && t.amountMinor < 0 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={openReceipt} disabled={busy}>
            {busy ? <Spinner /> : "Receipt"}
          </button>
        )}
      </div>
      {receipt && (
        <Modal title="Transaction receipt" onClose={() => setReceipt(null)}>
          <Receipt receipt={receipt} />
        </Modal>
      )}
    </li>
  );
}
