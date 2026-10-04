import type { TaskEvent, TaskView } from "../api/types";

export interface LegacySentMessage {
  afterSequence: number;
  text: string;
  at: string;
}

export type ConversationEntry =
  | { kind: "message"; key: string; text: string }
  | { kind: "event"; key: string; event: TaskEvent };

function customerMessage(event?: TaskEvent): string | undefined {
  if (event?.type !== "RUN_STARTED" || !event.data) return undefined;
  const text = (event.data as Record<string, unknown>).customerMessage;
  return typeof text === "string" ? text : undefined;
}

// Public customer messages and verified events only; never reconstruct Pi transcripts.
export function conversationTimeline(
  task: Pick<TaskView, "input" | "events">,
  legacySent: LegacySentMessage[] = [],
): ConversationEntry[] {
  const entries: ConversationEntry[] = [];
  const starts = task.events.filter((e) => e.type === "RUN_STARTED");
  if (customerMessage(starts[0]) === undefined)
    entries.push({ kind: "message", key: "input", text: task.input });
  // Older clients cached messages also recorded by the backend. Prefer the server copy.
  const pending = legacySent.filter(
    (m) =>
      customerMessage(starts.find((e) => e.sequence > m.afterSequence)) ===
      undefined,
  );
  for (const event of task.events) {
    while (pending.length && pending[0]!.afterSequence < event.sequence) {
      const m = pending.shift()!;
      entries.push({ kind: "message", key: `legacy-${m.at}`, text: m.text });
    }
    const text = customerMessage(event);
    if (text !== undefined)
      entries.push({ kind: "message", key: `message-${event.sequence}`, text });
    entries.push({ kind: "event", key: `event-${event.sequence}`, event });
  }
  for (const m of pending)
    entries.push({ kind: "message", key: `legacy-${m.at}`, text: m.text });
  return entries;
}
