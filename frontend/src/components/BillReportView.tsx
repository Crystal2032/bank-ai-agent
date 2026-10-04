import { useState } from "react";
import type { BillReport, TransactionView } from "../api/types";
import { formatDateTime, formatMonth } from "../lib/format";
import { formatMinor } from "../lib/money";
import { TransactionRow } from "./TransactionRow";
import { Chip, EmptyState, SimulatedBadge } from "./ui";

/**
 * Renders a backend-computed bill report. Every figure links to the transaction IDs it was
 * derived from; candidate labels are pattern matches, not confirmed subscriptions or fraud.
 */
export function BillReportView({
  report,
  transactions,
  compact = false,
}: {
  report: BillReport;
  transactions?: TransactionView[];
  compact?: boolean;
}) {
  const [evidence, setEvidence] = useState<{ title: string; ids: string[] } | null>(null);
  const categories = Object.entries(report.categories).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...categories.map(([, v]) => v));
  const byId = new Map((transactions ?? []).map((t) => [t.id, t]));

  const evidenceButton = (title: string, ids: string[]) =>
    transactions ? (
      <button
        type="button"
        className="link-btn small"
        onClick={() => setEvidence(evidence?.title === title ? null : { title, ids })}
        aria-expanded={evidence?.title === title}
      >
        {ids.length} evidence transaction{ids.length === 1 ? "" : "s"}
      </button>
    ) : (
      <span className="small muted">
        {ids.length} evidence transaction{ids.length === 1 ? "" : "s"}
      </span>
    );

  return (
    <div className="bill-report">
      <div className="bill-total">
        <div>
          <div className="small muted">Total outgoing · {formatMonth(report.month)}</div>
          <div className="balance-amount">{formatMinor(report.totalOutgoingMinor)}</div>
        </div>
        <div className="bill-total-meta small muted">
          {evidenceButton("All outgoing this month", report.transactionIds)}
          <span>
            Computed {formatDateTime(report.observedAt)} <SimulatedBadge />
          </span>
        </div>
      </div>

      {evidence && (
        <div className="evidence">
          <h4>{evidence.title}</h4>
          <ul className="tx-list">
            {evidence.ids.map((id) => {
              const t = byId.get(id);
              return t ? (
                <TransactionRow key={id} transaction={t} highlight />
              ) : (
                <li key={id} className="tx-row small muted">
                  Transaction <code>{id}</code> (not in the loaded history)
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {categories.length ? (
        <div className="categories">
          {categories.map(([name, value]) => (
            <div key={name} className="category">
              <div className="category-label">
                <span>{name}</span>
                <span>{formatMinor(value)}</span>
              </div>
              <div className="bar" aria-hidden="true">
                <span style={{ width: `${Math.max(2, (value / max) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState>No outgoing transactions this month.</EmptyState>
      )}

      {!compact && (
        <>
          <h3 className="section-label">Possible recurring charges</h3>
          {report.recurringCandidates.length ? (
            <ul className="candidates">
              {report.recurringCandidates.map((c) => (
                <li key={`${c.merchant}:${c.amountMinor}`}>
                  <div className="candidate-head">
                    <strong>{c.merchant}</strong>
                    <span>{formatMinor(c.amountMinor)}</span>
                    <Chip tone="pending">Candidate</Chip>
                  </div>
                  <p className="small muted">{c.reason}</p>
                  {evidenceButton(`Recurring: ${c.merchant}`, c.transactionIds)}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>No recurring patterns found.</EmptyState>
          )}

          <h3 className="section-label">Unusual charges</h3>
          {report.unusualCandidates.length ? (
            <ul className="candidates">
              {report.unusualCandidates.map((c) => (
                <li key={c.transactionId}>
                  <div className="candidate-head">
                    <strong>{c.merchant}</strong>
                    <span>{formatMinor(c.amountMinor)}</span>
                    <Chip tone="warning">Candidate</Chip>
                  </div>
                  <p className="small muted">
                    Usual amount around {formatMinor(c.referenceMedianMinor)}. {c.reason}
                  </p>
                  {evidenceButton(`Unusual: ${c.merchant}`, [c.transactionId])}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>No unusual charges found.</EmptyState>
          )}
          <p className="small muted">
            Candidates are pattern matches computed by the bank. A recurring candidate is not proof of an active subscription, and an unusual charge is not a fraud determination.
          </p>
        </>
      )}
      {compact && (report.recurringCandidates.length > 0 || report.unusualCandidates.length > 0) && (
        <p className="small muted">
          {report.recurringCandidates.length} recurring and {report.unusualCandidates.length} unusual candidate
          {report.unusualCandidates.length === 1 ? "" : "s"} — open Bills for the evidence.
        </p>
      )}
    </div>
  );
}
