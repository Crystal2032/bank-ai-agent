import { api } from "../api/client";
import { Alert, Card, EmptyState, Loading } from "../components/ui";
import { describeError } from "../lib/errors";
import { formatDateTime, humanize } from "../lib/format";
import { useLoad } from "../lib/useLoad";
import { useSession } from "../session";

const tone = (event: string) =>
  /REJECTED|FAILED|EXPIRED|UPGRADED/.test(event)
    ? "danger"
    : /SUCCEEDED|VERIFIED|ENROLLED|RECOVERED|CREATED/.test(event)
      ? "success"
      : "muted";

function renderValue(value: unknown) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function Activity() {
  const { bankVersion } = useSession();
  const { data, error, loading, reload } = useLoad(() => api.audit(), [bankVersion]);
  return (
    <div className="page">
      <h1 className="page-title">Security & activity log</h1>
      <Card
        title="Last 200 events"
        actions={
          <button type="button" className="btn btn-ghost btn-sm" onClick={reload}>
            Refresh
          </button>
        }
      >
        <p className="small muted">
          The bank's append-only audit trail for your account. Secrets and codes are never recorded here.
        </p>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <Alert tone="danger">{describeError(error)}</Alert>
        ) : data?.events.length ? (
          <ol className="audit-list">
            {data.events.map((e) => (
              <li key={e.sequence}>
                <span className={`audit-dot ${tone(e.event)}`} aria-hidden="true" />
                <div>
                  <strong>{humanize(e.event)}</strong>{" "}
                  <span className="small muted">{formatDateTime(e.occurredAt)}</span>
                  {Object.keys(e.data).length > 0 && (
                    <div className="audit-data small muted">
                      {Object.entries(e.data).map(([k, v]) => (
                        <span key={k}>
                          {k}: <code>{renderValue(v)}</code>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState>No activity recorded yet.</EmptyState>
        )}
      </Card>
    </div>
  );
}
