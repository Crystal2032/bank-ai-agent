import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ActionStatus, RiskTier } from "../api/types";
import { formatRemaining, humanize } from "../lib/format";

export function SimulatedBadge({ label = "Simulated" }: { label?: string }) {
  return (
    <span className="badge badge-sim" title="Synthetic data. No real money moves.">
      {label}
    </span>
  );
}

export function TierBadge({ tier }: { tier: RiskTier }) {
  const text =
    tier === "RED" ? "Red tier" : tier === "YELLOW" ? "Yellow tier" : "Green tier";
  return <span className={`badge badge-tier-${tier.toLowerCase()}`}>{text}</span>;
}

const statusTone: Record<ActionStatus, string> = {
  WAITING_FOR_CONFIRMATION: "pending",
  WAITING_FOR_VERIFICATION: "pending",
  AUTHORIZED: "info",
  RECONCILING: "warning",
  SUCCEEDED: "success",
  CANCELLED: "muted",
  FAILED: "danger",
};

const statusText: Record<ActionStatus, string> = {
  WAITING_FOR_CONFIRMATION: "Needs your review",
  WAITING_FOR_VERIFICATION: "Needs verification",
  AUTHORIZED: "Authorized — ready to run",
  RECONCILING: "Reconciling — outcome not final",
  SUCCEEDED: "Succeeded",
  CANCELLED: "Cancelled",
  FAILED: "Failed",
};

export function StatusBadge({ status }: { status: ActionStatus }) {
  return (
    <span className={`badge badge-${statusTone[status]}`}>{statusText[status]}</span>
  );
}

export function Chip({
  tone = "muted",
  children,
}: {
  tone?: "muted" | "info" | "success" | "warning" | "danger" | "pending";
  children: ReactNode;
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Alert({
  tone = "info",
  title,
  children,
  action,
}: {
  tone?: "info" | "success" | "warning" | "danger";
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`alert alert-${tone}`} role={tone === "danger" ? "alert" : "status"}>
      <div className="alert-body">
        {title && <strong className="alert-title">{title}</strong>}
        {children && <div>{children}</div>}
      </div>
      {action && <div className="alert-action">{action}</div>}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span className="spinner" role="status" aria-label={label}>
      <span aria-hidden="true" />
    </span>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="loading">
      <Spinner /> <span>{label}</span>
    </div>
  );
}

export function Card({
  title,
  actions,
  children,
  className = "",
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-header">
          {title && <h2 className="card-title">{title}</h2>}
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Modal({
  title,
  onClose,
  children,
  dismissible = true,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  dismissible?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        if (dismissible) onClose();
      }}
    >
      <header className="modal-header">
        <h2>{title}</h2>
        {dismissible && (
          <button type="button" className="btn-icon" aria-label="Close" onClick={onClose}>
            ×
          </button>
        )}
      </header>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

export function DetailList({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="details">
      {rows.map(([term, value], index) => (
        <div className="details-row" key={index}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

/** Re-renders every second while mounted; returns the current time. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function Countdown({ until, prefix }: { until: number; prefix?: string }) {
  const now = useNow();
  const remaining = until - now;
  return (
    <span className={remaining <= 0 ? "countdown expired" : "countdown"}>
      {prefix}
      {formatRemaining(remaining)}
    </span>
  );
}

export function KindLabel({ kind }: { kind: string }) {
  const labels: Record<string, string> = {
    TRANSFER: "Transfer",
    SUBSCRIPTION_LOOKUP: "Subscription lookup",
    SUBSCRIPTION_CANCEL: "Cancel merchant service",
    MANDATE_REVOKE: "Revoke debit mandate",
  };
  return <>{labels[kind] ?? humanize(kind)}</>;
}
