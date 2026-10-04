import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { TaskSummary, TaskView } from "../api/types";
import { describeError } from "../lib/errors";
import { formatDateTime, humanize } from "../lib/format";
import { Alert, Loading, Modal, Spinner } from "./ui";

export function ConversationHistory({
  currentId,
  onSelect,
  onClose,
}: {
  currentId?: string;
  onSelect: (task: TaskView) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<TaskSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const alive = useRef(false);
  const inFlight = useRef(false);

  const load = async (before?: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const page = await api.tasks(before);
      if (!alive.current) return;
      setRows((prior) =>
        before
          ? [
              ...prior,
              ...page.tasks.filter((t) => !prior.some((p) => p.id === t.id)),
            ]
          : page.tasks,
      );
      setCursor(page.nextCursor);
      setReady(true);
    } catch (reason) {
      if (alive.current) setError(describeError(reason));
    } finally {
      inFlight.current = false;
      if (alive.current) setLoading(false);
    }
  };

  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, []);

  const select = async (id: string) => {
    if (opened) return;
    setOpened(id);
    setError(null);
    try {
      const task = await api.task(id);
      if (alive.current) {
        onSelect(task);
        onClose();
      }
    } catch (reason) {
      if (alive.current) setError(describeError(reason));
    } finally {
      if (alive.current) setOpened(null);
    }
  };

  return (
    <Modal title="Conversation history" onClose={onClose}>
      <p className="small muted">
        Your saved conversations are available after signing in on another
        device. Opening one does not run the assistant or authorize a payment.
      </p>
      {error && <Alert tone="danger">{error}</Alert>}
      {!ready && loading && <Loading label="Loading conversations…" />}
      {ready && rows.length === 0 && (
        <p className="empty">No saved conversations yet.</p>
      )}
      <ul className="conversation-history">
        {rows.map((task) => (
          <li key={task.id}>
            <button
              type="button"
              className="conversation-history-item"
              aria-current={task.id === currentId ? "true" : undefined}
              disabled={opened !== null}
              onClick={() => void select(task.id)}
            >
              <span className="conversation-title">{task.input}</span>
              <span className="small muted">
                {formatDateTime(task.createdAt)} · {humanize(task.status)}
                {task.id === currentId ? " · Current" : ""}
                {opened === task.id && <Spinner />}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {cursor && (
        <button
          type="button"
          className="btn"
          disabled={loading || opened !== null}
          onClick={() => void load(cursor)}
        >
          {loading ? <Spinner /> : "Load older conversations"}
        </button>
      )}
      {error && (
        <button
          type="button"
          className="btn"
          disabled={loading || opened !== null}
          onClick={() => void load(ready ? (cursor ?? undefined) : undefined)}
        >
          Retry history loading
        </button>
      )}
    </Modal>
  );
}
