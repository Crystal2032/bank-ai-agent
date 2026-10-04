import { describe, expect, it } from "vitest";
import { conversationTimeline } from "../src/lib/conversation";
import type { TaskEvent } from "../src/api/types";

const event = (
  sequence: number,
  type: TaskEvent["type"],
  data: unknown = {},
): TaskEvent => ({ sequence, type, data, at: "2026-10-04T10:00:00Z" });

describe("saved conversation timeline", () => {
  it("restores every accepted message in sequence from the server without browser storage", () => {
    const task = {
      input: "Read balances.",
      events: [
        event(1, "RUN_STARTED", { customerMessage: "Read balances." }),
        event(2, "ACCOUNTS", { accounts: [] }),
        event(3, "RUN_FINISHED"),
        event(4, "RUN_STARTED", { customerMessage: "Read balances." }),
        event(5, "RUN_FAILED"),
      ],
    };
    expect(
      conversationTimeline(task).map((e) =>
        e.kind === "message" ? e.text : e.event.type,
      ),
    ).toEqual([
      "Read balances.",
      "RUN_STARTED",
      "ACCOUNTS",
      "RUN_FINISHED",
      "Read balances.",
      "RUN_STARTED",
      "RUN_FAILED",
    ]);
  });
  it("does not duplicate messages cached by older clients, while preserving genuinely older follow-ups", () => {
    const task = {
      input: "Original request.",
      events: [
        event(1, "RUN_STARTED"),
        event(2, "RUN_FINISHED"),
        event(3, "RUN_STARTED"),
        event(4, "RUN_FINISHED"),
        event(5, "RUN_STARTED", { customerMessage: "New follow-up." }),
      ],
    };
    const timeline = conversationTimeline(task, [
      { afterSequence: 2, text: "Legacy follow-up.", at: "old" },
      { afterSequence: 4, text: "New follow-up.", at: "new" },
    ]);
    expect(
      timeline.filter((e) => e.kind === "message").map((e) => e.text),
    ).toEqual(["Original request.", "Legacy follow-up.", "New follow-up."]);
  });
  it("falls back to the legacy initial request without inventing lost messages or using model prose", () => {
    const task = {
      input: "Original request.",
      events: [
        event(1, "RUN_STARTED", {
          customerMessage: { text: "not a customer string" },
        }),
        event(2, "RUN_FINISHED"),
      ],
    };
    expect(
      conversationTimeline(task)
        .filter((e) => e.kind === "message")
        .map((e) => e.text),
    ).toEqual(["Original request."]);
  });
});
