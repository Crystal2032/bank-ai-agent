import { api } from "../api/client";
import { summarizeAction } from "../components/ActionCard";
import { TransactionRow } from "../components/TransactionRow";
import { Alert, Card, EmptyState, Loading, SimulatedBadge, StatusBadge, TierBadge } from "../components/ui";
import { describeError } from "../lib/errors";
import { formatDateTime } from "../lib/format";
import { formatMinor } from "../lib/money";
import { useLoad } from "../lib/useLoad";
import { navigate } from "../router";
import { useSession } from "../session";

const PENDING = new Set(["WAITING_FOR_CONFIRMATION", "WAITING_FOR_VERIFICATION", "AUTHORIZED", "RECONCILING"]);

export function Overview() {
  const { session, bankVersion } = useSession();
  const accounts = useLoad(() => api.accounts(), [bankVersion]);
  const transactions = useLoad(() => api.transactions(), [bankVersion]);
  const actions = useLoad(() => api.actions(), [bankVersion]);
  const pending = (actions.data?.actions ?? [])
    .filter((a) => PENDING.has(a.status))
    .sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div className="page">
      <h1 className="page-title">Hello, {session.customer.name.split(" ")[0]}</h1>

      <div className="grid-2">
        <Card title="Current account" actions={<SimulatedBadge />}>
          {accounts.loading && !accounts.data ? (
            <Loading />
          ) : accounts.error ? (
            <Alert tone="danger">{describeError(accounts.error)}</Alert>
          ) : (
            accounts.data?.accounts.map((a) => (
              <div key={a.id} className="balance">
                <div className="balance-amount">{formatMinor(a.balanceMinor)}</div>
                <div className="small muted">
                  Account <code>{a.id}</code> · as of {formatDateTime(accounts.data?.observedAt)}
                </div>
              </div>
            ))
          )}
          <div className="row wrap">
            <button type="button" className="btn btn-primary" onClick={() => navigate("payments")}>
              New transfer
            </button>
            <button type="button" className="btn" onClick={() => navigate("assistant")}>
              Ask the assistant
            </button>
            <button type="button" className="btn" onClick={() => navigate("bills")}>
              Monthly bills
            </button>
          </div>
        </Card>

        <Card title="Profile">
          <dl className="details">
            <div className="details-row">
              <dt>Name</dt>
              <dd>{session.customer.name}</dd>
            </div>
            <div className="details-row">
              <dt>Username</dt>
              <dd>{session.customer.username}</dd>
            </div>
            <div className="details-row">
              <dt>Registered phone</dt>
              <dd>{session.customer.maskedPhone}</dd>
            </div>
          </dl>
          <button type="button" className="btn btn-sm" onClick={() => navigate("security")}>
            Security center
          </button>
        </Card>
      </div>

      <Card
        title={`Pending actions${pending.length ? ` (${pending.length})` : ""}`}
        actions={
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate("payments")}>
            Review in Payments
          </button>
        }
      >
        {actions.error ? (
          <Alert tone="danger">{describeError(actions.error)}</Alert>
        ) : pending.length ? (
          <ul className="pending-list">
            {pending.slice(0, 5).map((a) => (
              <li key={a.id}>
                <span>{summarizeAction(a)}</span>
                <TierBadge tier={a.tier} />
                <StatusBadge status={a.status} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>Nothing is waiting for you.</EmptyState>
        )}
      </Card>

      <Card
        title="Recent transactions"
        actions={
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate("transactions")}>
            View all
          </button>
        }
      >
        {transactions.loading && !transactions.data ? (
          <Loading />
        ) : transactions.error ? (
          <Alert tone="danger">{describeError(transactions.error)}</Alert>
        ) : transactions.data?.transactions.length ? (
          <ul className="tx-list">
            {transactions.data.transactions.slice(0, 6).map((t) => (
              <TransactionRow key={t.id} transaction={t} />
            ))}
          </ul>
        ) : (
          <EmptyState>No transactions yet.</EmptyState>
        )}
      </Card>
    </div>
  );
}
