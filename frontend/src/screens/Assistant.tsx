import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { api, ApiError } from "../api/client";
import type {
  AccountsResponse,
  ActionView,
  BillReport,
  ContactView,
  TaskEvent,
  TaskView,
} from "../api/types";
import { ActionCard, summarizeAction } from "../components/ActionCard";
import { BillReportView } from "../components/BillReportView";
import {
  Alert,
  Chip,
  Loading,
  Modal,
  SimulatedBadge,
  Spinner,
} from "../components/ui";
import { describeError, errorCode } from "../lib/errors";
import {
  currentBankMonth,
  formatDateTime,
  formatMonth,
  humanize,
} from "../lib/format";
import { formatMinor } from "../lib/money";
import { useLoad } from "../lib/useLoad";
import { navigate } from "../router";
import {
  SecurityOperation,
  securityTitles,
} from "../components/SecurityOperation";
import type { SecurityRequestView } from "../api/types";
import { ConversationHistory } from "../components/ConversationHistory";
import {
  conversationTimeline,
  type LegacySentMessage,
} from "../lib/conversation";
import { useSession } from "../session";

// Task IDs are not secrets; they let a reload reattach to the conversation in this tab only.
const TASK_KEY = "bank.assistant.taskId";
const sentKey = (taskId: string) => `bank.assistant.sent.${taskId}`;
const POLL_MS = 1000;

type SentMessage = LegacySentMessage;

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key: string, value: unknown) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be unavailable (private mode); the conversation still works in memory.
  }
}

export function clearAssistantStorage() {
  try {
    for (const key of Object.keys(sessionStorage))
      if (key.startsWith("bank.assistant.")) sessionStorage.removeItem(key);
  } catch {
    // Ignore unavailable storage.
  }
}

const statusLabel: Record<
  TaskView["status"],
  {
    text: string;
    tone: "info" | "pending" | "success" | "muted" | "warning" | "danger";
  }
> = {
  RUNNING: { text: "Working", tone: "info" },
  WAITING: { text: "Waiting for you", tone: "pending" },
  COMPLETED: { text: "Completed", tone: "success" },
  STOPPED: { text: "Stopped", tone: "muted" },
  NEEDS_REVIEW: { text: "Needs review", tone: "warning" },
  FAILED: { text: "Failed", tone: "danger" },
};

const suggestions = () => [
  "What is my current balance?",
  `Analyze my bills for ${formatMonth(currentBankMonth())} (${currentBankMonth()}).`,
  "Send CNY 50.00 to Jordan for lunch.",
  "Find my subscriptions and help me cancel Stream Plus.",
];

export function Assistant() {
  const { session } = useSession();
  const taskKey = `${TASK_KEY}.${session.customer.id}`;
  const health = useLoad(() => api.health(), []);
  const [taskId, setTaskId] = useState<string | null>(() =>
    readStorage<string | null>(taskKey, null),
  );
  const [task, setTask] = useState<TaskView | null>(null);
  const [sent, setSent] = useState<SentMessage[]>([]);
  const [loadingTask, setLoadingTask] = useState(taskId !== null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const feedEnd = useRef<HTMLDivElement>(null);
  const pollFailures = useRef(0);

  const adopt = useCallback(
    (next: TaskView) => {
      setTask(next);
      setTaskId(next.id);
      writeStorage(taskKey, next.id);
    },
    [taskKey],
  );

  // Reattach to the stored conversation.
  useEffect(() => {
    if (!taskId || task) return;
    let cancelled = false;
    api.task(taskId).then(
      (t) => {
        if (cancelled) return;
        setTask(t);
        setSent(readStorage<SentMessage[]>(sentKey(t.id), []));
        setLoadingTask(false);
      },
      (reason) => {
        if (cancelled) return;
        if (errorCode(reason) === "NOT_FOUND") {
          writeStorage(taskKey, null);
          setTaskId(null);
        } else setError(describeError(reason));
        setLoadingTask(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [taskId, task, taskKey]);

  // Poll incremental events while the agent runs; refetch the full task when something changes.
  const running = task?.running ?? false;
  useEffect(() => {
    if (!task || !running) return;
    const id = task.id;
    let stopped = false;
    let timer = 0;
    const tick = async () => {
      try {
        const after = task.events.at(-1)?.sequence ?? 0;
        const update = await api.taskEvents(id, after);
        pollFailures.current = 0;
        if (stopped) return;
        if (
          update.events.length ||
          !update.running ||
          update.status !== task.status
        ) {
          const full = await api.task(id);
          if (!stopped) setTask(full);
          return;
        }
      } catch {
        pollFailures.current++;
      }
      if (!stopped)
        timer = window.setTimeout(
          tick,
          POLL_MS * Math.min(5, 1 + pollFailures.current),
        );
    };
    timer = window.setTimeout(tick, POLL_MS);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [task, running]);

  useEffect(() => {
    feedEnd.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [task?.events.length, sent.length, running]);

  const canResume =
    !!task &&
    !task.running &&
    task.leaseOwner === "AGENT" &&
    task.status !== "STOPPED" &&
    task.failures < 3 &&
    task.runs < 10;
  const blocked = !!task && (task.running || task.leaseOwner === "HUMAN");
  const startsNew = !task || (!canResume && !blocked);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message) return;
    setBusy("send");
    setError(null);
    try {
      if (startsNew) {
        const created = await api.createTask(message);
        setSent([]);
        adopt(created);
      } else if (task) {
        const resumed = await api.sendTaskMessage(task.id, message);
        adopt(resumed);
      }
      setDraft("");
    } catch (reason) {
      setError(describeError(reason));
      if (reason instanceof ApiError && reason.responseLost && task) {
        // The message may have been accepted; re-read the task before the customer retries.
        api.task(task.id).then(setTask, () => undefined);
      } else if (task && errorCode(reason) === "TASK_BUSY")
        api.task(task.id).then(setTask, () => undefined);
    } finally {
      setBusy(null);
    }
  };

  const control = async (kind: "stop" | "takeover" | "release") => {
    if (!task) return;
    setBusy(kind);
    setError(null);
    try {
      const next =
        kind === "stop"
          ? await api.stopTask(task.id)
          : kind === "takeover"
            ? await api.takeoverTask(task.id)
            : await api.releaseTask(task.id);
      setTask(next);
      // The release response is built before its event is appended; re-read to show it.
      api.task(task.id).then(setTask, () => undefined);
    } catch (reason) {
      setError(describeError(reason));
      api.task(task.id).then(setTask, () => undefined);
    } finally {
      setBusy(null);
      setConfirmStop(false);
    }
  };

  const newConversation = () => {
    writeStorage(taskKey, null);
    setTask(null);
    setTaskId(null);
    setSent([]);
    setError(null);
  };

  const updateAction = (updated: ActionView) =>
    setTask((t) =>
      t
        ? {
            ...t,
            actions: t.actions.map((a) => (a.id === updated.id ? updated : a)),
          }
        : t,
    );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void send(draft);
  };

  const lastEvent = task?.events.at(-1);
  const openClarification =
    task && !task.running && lastEvent?.type === "RUN_FINISHED"
      ? [...task.events]
          .reverse()
          .find(
            (e) =>
              e.type === "CLARIFICATION" &&
              e.sequence > lastRunStart(task.events),
          )
      : undefined;
  const settledActions =
    task?.actions.filter((a) =>
      ["SUCCEEDED", "CANCELLED", "FAILED"].includes(a.status),
    ) ?? [];

  return (
    <div className="page assistant-page">
      <div className="assistant-header">
        <h1 className="page-title">Assistant</h1>
        <div className="row wrap">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy !== null || loadingTask}
            onClick={() => setShowHistory(true)}
          >
            Conversation history
          </button>
          {task && (
            <Chip tone={statusLabel[task.status].tone}>
              {statusLabel[task.status].text}
            </Chip>
          )}
          {task?.leaseOwner === "HUMAN" && (
            <Chip tone="warning">Manual control</Chip>
          )}
          {task && !task.running && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={newConversation}
            >
              New conversation
            </button>
          )}
        </div>
      </div>

      {health.data?.model === "NOT_CONFIGURED" && (
        <Alert tone="warning" title="Assistant model not configured">
          The backend reports no model API key, so new assistant requests will
          likely be refused. All banking screens keep working.
        </Alert>
      )}

      <div className="assistant-note small muted">
        The assistant reads your data and prepares actions; it cannot move
        money. Only verified bank results and action cards appear here — the
        model's own wording is never shown as a balance, result or receipt.
        Never type passwords or codes into the chat.
      </div>

      <div className="feed" aria-live="polite">
        {loadingTask && <Loading label="Restoring conversation…" />}
        {!task && !loadingTask && (
          <div className="feed-empty">
            <p>
              Ask about balances, bills or subscriptions, or ask to prepare a
              transfer.
            </p>
            <div className="suggestions">
              {suggestions().map((s) => (
                <button
                  key={s}
                  type="button"
                  className="suggestion"
                  onClick={() => setDraft(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {task && (
          <Feed
            task={task}
            sent={sent}
            canReply={canResume && busy === null}
            onReply={send}
            onActionUpdated={updateAction}
          />
        )}
        {task?.running && (
          <div className="bubble bubble-system working">
            <Spinner /> The assistant is working…
          </div>
        )}
        <div ref={feedEnd} />
      </div>

      {task && (
        <div className="task-controls">
          {task.leaseOwner === "AGENT" && task.status !== "STOPPED" && (
            <>
              <button
                type="button"
                className="btn btn-sm btn-danger-ghost"
                onClick={() => setConfirmStop(true)}
                disabled={busy !== null}
              >
                Stop
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => control("takeover")}
                disabled={busy !== null}
              >
                {busy === "takeover" ? <Spinner /> : "Take over manually"}
              </button>
            </>
          )}
          {task.leaseOwner === "HUMAN" && !task.running && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => control("release")}
              disabled={busy !== null}
            >
              {busy === "release" ? <Spinner /> : "Hand back to assistant"}
            </button>
          )}
          {canResume && settledActions.length > 0 && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => send("Continue using the updated action results.")}
              disabled={busy !== null}
            >
              Continue with updated results
            </button>
          )}
          <span className="small muted">
            Runs {task.runs}/10 · failures {task.failures}/3
          </span>
        </div>
      )}
      {task?.leaseOwner === "HUMAN" && (
        <Alert tone="info">
          You have manual control. The assistant is paused; use the action cards
          above directly. Handing back does not run anything automatically.
        </Alert>
      )}

      {error && <Alert tone="danger">{error}</Alert>}
      {openClarification && (
        <Alert tone="info">Answer the question above to continue.</Alert>
      )}

      <form className="composer" onSubmit={submit}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={4000}
          rows={2}
          placeholder={
            blocked
              ? task?.running
                ? "Wait for the assistant, or stop it."
                : "Hand back to the assistant to send messages."
              : startsNew && task
                ? "This conversation has ended. Your next message starts a new one."
                : openClarification
                  ? "Type your answer…"
                  : "Ask the assistant…"
          }
          disabled={blocked || busy !== null}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              void send(draft);
            }
          }}
          aria-label="Message to assistant"
        />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={blocked || busy !== null || !draft.trim()}
        >
          {busy === "send" ? <Spinner /> : startsNew ? "Start" : "Send"}
        </button>
      </form>

      {confirmStop && task && (
        <Modal
          title="Stop the assistant?"
          onClose={() => setConfirmStop(false)}
          dismissible={busy === null}
        >
          <p>
            Stopping cancels every action in this conversation that has not been
            executed yet. Completed operations stay recorded and are not
            reversed.
          </p>
          <p className="small muted">
            To keep pending cards and finish them yourself, use "Take over
            manually" instead.
          </p>
          <div className="row">
            <button
              type="button"
              className="btn"
              onClick={() => setConfirmStop(false)}
              disabled={busy !== null}
            >
              Keep running
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => control("stop")}
              disabled={busy !== null}
            >
              {busy === "stop" ? <Spinner /> : "Stop and cancel pending"}
            </button>
          </div>
        </Modal>
      )}
      {showHistory && (
        <ConversationHistory
          currentId={task?.id}
          onClose={() => setShowHistory(false)}
          onSelect={(next) => {
            adopt(next);
            setSent(readStorage<SentMessage[]>(sentKey(next.id), []));
            setLoadingTask(false);
            setDraft("");
            setError(null);
          }}
        />
      )}
    </div>
  );
}

function lastRunStart(events: TaskEvent[]) {
  return (
    [...events].reverse().find((e) => e.type === "RUN_STARTED")?.sequence ?? 0
  );
}

function Feed({
  task,
  sent,
  canReply,
  onReply,
  onActionUpdated,
}: {
  task: TaskView;
  sent: SentMessage[];
  canReply: boolean;
  onReply: (message: string) => void;
  onActionUpdated: (action: ActionView) => void;
}) {
  const live = useMemo(
    () => new Map(task.actions.map((a) => [a.id, a])),
    [task.actions],
  );
  const shownActions = new Set<string>();
  const latestClarification = [...task.events]
    .reverse()
    .find((e) => e.type === "CLARIFICATION")?.sequence;

  const items: ReactNode[] = [];
  for (const entry of conversationTimeline(task, sent)) {
    if (entry.kind === "message") {
      items.push(<UserBubble key={entry.key} text={entry.text} />);
      continue;
    }
    const event = entry.event;
    if (event.type === "ACTION") {
      const snapshot = event.data as ActionView;
      if (shownActions.has(snapshot.id)) {
        // Idempotent preparation returned an action that is already on screen.
        items.push(
          <SystemLine
            key={event.sequence}
            text={`The assistant referred to an existing action: ${summarizeAction(live.get(snapshot.id) ?? snapshot)} (${humanize((live.get(snapshot.id) ?? snapshot).status)}). No new action was created.`}
            at={formatDateTime(event.at)}
          />,
        );
        continue;
      }
      shownActions.add(snapshot.id);
      items.push(
        <div key={event.sequence} className="feed-card">
          <ActionCard
            action={live.get(snapshot.id) ?? snapshot}
            related={task.actions}
            onUpdated={onActionUpdated}
          />
        </div>,
      );
      continue;
    }
    items.push(
      <EventItem
        key={event.sequence}
        event={event}
        canReply={canReply && event.sequence === latestClarification}
        onReply={onReply}
        canPickContact={canReply}
      />,
    );
  }
  return <>{items}</>;
}

function UserBubble({ text }: { text: string }) {
  return <div className="bubble bubble-user">{text}</div>;
}

function EventItem({
  event,
  canReply,
  canPickContact,
  onReply,
}: {
  event: TaskEvent;
  canReply: boolean;
  canPickContact: boolean;
  onReply: (message: string) => void;
}) {
  const data = (event.data ?? {}) as Record<string, unknown>;
  const at = formatDateTime(event.at);
  switch (event.type) {
    case "SECURITY_REQUEST":
      return <SecurityRequestCard requestId={String(data.id)} />;
    case "SECURITY_COMPLETED":
      return (
        <SystemLine text="Verified security operation completed" at={at} />
      );
    case "SECURITY_OPTIONS":
      return (
        <SystemLine
          text="Enrolled security option availability checked; credentials remain private"
          at={at}
        />
      );
    case "RUN_STARTED":
      return <SystemLine text="Assistant started working" at={at} />;
    case "RUN_FINISHED":
      return (
        <SystemLine
          text={`Run finished · ${humanize(String(data.status ?? ""))}. ${String(data.message ?? "")}`}
          at={at}
        />
      );
    case "RUN_FAILED":
      return (
        <div className="bubble bubble-system tone-danger">
          <strong>Assistant unavailable</strong> ({String(data.code ?? "ERROR")}
          ). {String(data.message ?? "")}
        </div>
      );
    case "INTERRUPTED":
      return (
        <SystemLine
          text="The run was interrupted by a service restart. Review the action cards; nothing resumes automatically."
          at={at}
          tone="warning"
        />
      );
    case "STOPPED":
      return (
        <SystemLine
          text={`Stopped. ${String(data.message ?? "")}`}
          at={at}
          tone="warning"
        />
      );
    case "MANUAL_TAKEOVER":
      return (
        <SystemLine
          text={`You took manual control. ${String(data.message ?? "")}`}
          at={at}
          tone="warning"
        />
      );
    case "MANUAL_CONTROL_RELEASED":
      return (
        <SystemLine
          text="Control handed back to the assistant. Nothing was run automatically."
          at={at}
        />
      );
    case "ACCOUNTS": {
      const accounts = event.data as AccountsResponse;
      return (
        <div className="bubble bubble-evidence">
          <div className="evidence-head">
            Verified balance <SimulatedBadge />
          </div>
          {accounts.accounts.map((a) => (
            <div key={a.id}>
              <span className="balance-amount">
                {formatMinor(a.balanceMinor)}
              </span>{" "}
              <span className="small muted">
                {a.id} · as of {formatDateTime(accounts.observedAt)}
              </span>
            </div>
          ))}
        </div>
      );
    }
    case "CONTACTS": {
      const contacts = (
        Array.isArray(event.data) ? event.data : []
      ) as ContactView[];
      return (
        <div className="bubble bubble-evidence">
          <div className="evidence-head">
            {contacts.length === 0
              ? "No matching contacts"
              : contacts.length === 1
                ? "Matching contact"
                : `${contacts.length} contacts match — choose the exact recipient`}
          </div>
          <ul className="contact-matches">
            {contacts.map((c) => (
              <li key={c.id}>
                <span>
                  <strong>{c.name}</strong>{" "}
                  <span className="small muted">
                    ***{c.phone.slice(-4)}
                    {c.note ? ` · ${c.note}` : ""} ·{" "}
                    <code>{c.recipientAccountId}</code>
                  </span>
                </span>
                {contacts.length > 1 && canPickContact && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() =>
                      onReply(`Use the contact ${c.name} (contact ID ${c.id}).`)
                    }
                  >
                    Choose
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      );
    }
    case "BILL_REPORT": {
      const report = event.data as BillReport;
      return (
        <div className="bubble bubble-evidence">
          <div className="evidence-head">
            Bill report · {formatMonth(report.month)}
            <button
              type="button"
              className="link-btn small"
              onClick={() => navigate("bills")}
            >
              Open in Bills
            </button>
          </div>
          <BillReportView report={report} compact />
        </div>
      );
    }
    case "CLARIFICATION":
      return (
        <div className="bubble bubble-assistant">
          <div className="evidence-head">Question</div>
          <p>{String(data.question ?? "Please clarify your request.")}</p>
          {canReply && data.field === "RECIPIENT" && (
            <ContactPicker onPick={onReply} />
          )}
          {canReply && data.field === "MONTH" && (
            <MonthPicker onPick={onReply} />
          )}
        </div>
      );
    default:
      return <SystemLine text={humanize(event.type)} at={at} />;
  }
}

function SystemLine({
  text,
  at,
  tone,
}: {
  text: string;
  at: string;
  tone?: "warning";
}) {
  return (
    <div className={`system-line${tone ? ` tone-${tone}` : ""}`}>
      <span>{text}</span> <span className="muted">{at}</span>
    </div>
  );
}
function SecurityRequestCard({ requestId }: { requestId: string }) {
  const request = useLoad(() => api.securityRequest(requestId), [requestId]);
  const [open, setOpen] = useState(false);
  const value = request.data as SecurityRequestView | undefined;
  return (
    <div className="bubble bubble-evidence">
      <strong>
        {value ? securityTitles[value.operation] : "Security operation"}
      </strong>
      {request.error ? (
        <Alert tone="danger">{describeError(request.error)}</Alert>
      ) : null}
      {value && (
        <>
          <p>
            {value.status === "COMPLETED"
              ? "Verified and completed"
              : value.status === "CANCELLED"
                ? "This security request was cancelled."
                : "The assistant prepared this operation. Verify your identity in the protected form; no credentials go to chat."}
          </p>
          <button
            className="btn btn-primary"
            disabled={value.status !== "PENDING"}
            onClick={() => setOpen(true)}
          >
            Verify identity
          </button>
          {open && (
            <SecurityOperation
              operation={value.operation}
              target={value.target}
              requestId={value.id}
              onClose={() => setOpen(false)}
              onDone={request.reload}
            />
          )}
        </>
      )}
    </div>
  );
}

function ContactPicker({ onPick }: { onPick: (message: string) => void }) {
  const contacts = useLoad(() => api.contacts(), []);
  if (!contacts.data) return contacts.loading ? <Spinner /> : null;
  return (
    <div className="row wrap">
      {contacts.data.contacts.map((c) => (
        <button
          key={c.id}
          type="button"
          className="btn btn-sm"
          onClick={() =>
            onPick(`Use the contact ${c.name} (contact ID ${c.id}).`)
          }
        >
          {c.name}
        </button>
      ))}
    </div>
  );
}

function MonthPicker({ onPick }: { onPick: (message: string) => void }) {
  const [month, setMonth] = useState(currentBankMonth());
  return (
    <div className="row wrap">
      <input
        type="month"
        value={month}
        max={currentBankMonth()}
        onChange={(e) => setMonth(e.target.value)}
        aria-label="Month"
      />
      <button
        type="button"
        className="btn btn-sm"
        disabled={!/^\d{4}-\d{2}$/.test(month)}
        onClick={() => onPick(`Use the month ${month}.`)}
      >
        Use {month}
      </button>
    </div>
  );
}
