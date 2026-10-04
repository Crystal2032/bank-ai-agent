import type { ReactNode } from "react";
import type { ReceiptView } from "../api/types";
import { formatDateTime } from "../lib/format";
import { formatMinor } from "../lib/money";
import { DetailList, KindLabel, SimulatedBadge } from "./ui";

/** Canonical receipt from GET /api/receipts/:id — the only basis for showing success. */
export function Receipt({ receipt }: { receipt: ReceiptView }) {
  const p = receipt.params;
  const rows: [string, ReactNode][] = [
    ["Operation", <KindLabel key="k" kind={receipt.kind} />],
    ["Status", "Succeeded"],
    ["Executed", formatDateTime(receipt.executedAt)],
  ];
  if (receipt.kind === "TRANSFER") {
    rows.push(
      ["Recipient", String(p.recipientName ?? "—")],
      ["Recipient account", <code key="r">{String(p.recipientAccountId ?? "—")}</code>],
      ["Amount", <strong key="a">{formatMinor(Number(p.amountMinor))}</strong>],
      ["Note", String(p.note || "None")],
    );
  } else if (typeof p.merchant === "string") rows.push(["Merchant", p.merchant]);
  rows.push(
    ["Receipt ID", <code key="i">{receipt.id}</code>],
    ["Action ID", <code key="x">{receipt.actionId}</code>],
  );
  return (
    <div className="receipt">
      <div className="receipt-head">
        <span className="receipt-check" aria-hidden="true">✓</span>
        <strong>Receipt</strong>
        <SimulatedBadge label="Simulated bank" />
      </div>
      <DetailList rows={rows} />
    </div>
  );
}
