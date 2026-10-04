import { useMemo, useState } from "react";
import { api } from "../api/client";
import { TransactionRow } from "../components/TransactionRow";
import { Alert, Card, EmptyState, Loading, SimulatedBadge } from "../components/ui";
import { describeError } from "../lib/errors";
import { formatMinor } from "../lib/money";
import { useLoad } from "../lib/useLoad";
import { useSession } from "../session";

type Direction = "all" | "out" | "in";

export function Transactions() {
  const { bankVersion } = useSession();
  const { data, error, loading, reload } = useLoad(() => api.transactions(), [bankVersion]);
  const [query, setQuery] = useState("");
  const [direction, setDirection] = useState<Direction>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.transactions ?? []).filter(
      (t) =>
        (direction === "all" || (direction === "out" ? t.amountMinor < 0 : t.amountMinor > 0)) &&
        (!q || `${t.merchant} ${t.category} ${t.note}`.toLowerCase().includes(q)),
    );
  }, [data, query, direction]);
  const net = filtered.reduce((sum, t) => sum + t.amountMinor, 0);

  return (
    <div className="page">
      <h1 className="page-title">Transactions</h1>
      <Card
        title="Account history"
        actions={
          <>
            <SimulatedBadge />
            <button type="button" className="btn btn-ghost btn-sm" onClick={reload}>
              Refresh
            </button>
          </>
        }
      >
        <div className="toolbar">
          <input
            type="search"
            placeholder="Search merchant, category or note"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search transactions"
          />
          <div className="segmented" role="group" aria-label="Direction">
            {(["all", "out", "in"] as const).map((d) => (
              <button
                key={d}
                type="button"
                className={direction === d ? "active" : ""}
                onClick={() => setDirection(d)}
              >
                {d === "all" ? "All" : d === "out" ? "Money out" : "Money in"}
              </button>
            ))}
          </div>
        </div>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <Alert tone="danger">{describeError(error)}</Alert>
        ) : filtered.length ? (
          <>
            <p className="small muted">
              {filtered.length} transaction{filtered.length === 1 ? "" : "s"} · net {formatMinor(net, { signed: true })}
            </p>
            <ul className="tx-list">
              {filtered.map((t) => (
                <TransactionRow key={t.id} transaction={t} />
              ))}
            </ul>
          </>
        ) : (
          <EmptyState>No matching transactions.</EmptyState>
        )}
      </Card>
    </div>
  );
}
