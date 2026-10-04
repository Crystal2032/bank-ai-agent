# Pi Integration Plan

## Decision and Reviewed Source

Use Pi's existing agent runtime and model API as the project foundation. Keep the generic agent loop upstream and add a thin banking adapter, business tools, client event mapping, and deterministic security services. The owner explicitly requested mature minimal framework reuse and permitted copying suitable code with limited adaptation.

Implementation update, October 3, 2026: installed and locked both runtime packages at 1.0.1. The release uses `typebox` 1.3.27 for Pi tools; HTTP schemas separately use @sinclair/typebox. src/agent.ts uses upstream Agent and the exported Pi AI OpenAI-completions transport with server-held configuration, sequential tools and bounded turns. Actual-loop and HTTP/SSE transport tests pass. Earlier research/publication observations below describe the previous immutable source review, not the current installed state. No generic loop or model SDK was rewritten or vendored.

- Canonical repository observed on October 3, 2026: [earendil-works/pi](https://github.com/earendil-works/pi). The former `badlogic/pi-mono` URL redirects there.
- Reviewed source snapshot: [`a276dabe57911253350bffb93cb7d7aff6a73261`](https://github.com/earendil-works/pi/tree/a276dabe57911253350bffb93cb7d7aff6a73261). This identifies the research snapshot, not an installed dependency or an automatic choice of unreleased main-branch code.
- Source package names: `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai`; both package manifests declare version `1.0.0` and Node.js `>=22.19.0`. Older material uses the `@mariozechner` scope; do not mix APIs or package identities across snapshots.
- The npm latest endpoint for agent-core returned `1.0.0`; the separate pi-ai registry query timed out. Source inspection does not prove installed-package compatibility. Resolve released package versions and lock transitive dependencies when runnable code is added.
- Inspected: LICENSE, agent/ai READMEs and manifests, agent.ts, agent-loop.ts, types.ts, and the coding-agent manifest. No upstream source was executed or incorporated into application code.

## Reuse Boundaries

| Capability | Reuse | Project adaptation |
| --- | --- | --- |
| Agent loop and state | Pi `Agent` and its tool loop | Customer-scoped runtime creation and task lifecycle integration |
| Provider API | Pi AI provider/model collection and streaming | Server-owned model configuration, context minimization, deadlines, budget |
| Tool contracts | `AgentTool`, schema validation, result and update contracts | Typed banking tools with server-derived identity and a shared business executor |
| Events | Pi subscription and streaming events | Redacted, authenticated client events and persisted audit records |
| Context | `transformContext`, `convertToLlm`, and `prepareRequest` | Scoped data and canonical persisted transcript loading; no proofs or verification secrets |
| Turn control | `finishTurn`, cancellation signal, and continuation APIs | End a run while approval/reconciliation is pending; resume from persisted state |

Use the library packages directly with exact resolved versions and a lockfile. If an actual interface gap requires source changes, vendor only the necessary files or maintain a small patch, with immutable upstream commit, original paths, copyright/license, and a modification log. Reuse unchanged source where it fits. Avoid maintaining a parallel custom generic loop or model SDK layer.

The backend uses TypeScript/Fastify, Node >=24.19 and SQLite. API-only DeepSeek testing is selected; frontend framework, live provider evaluation and deployment remain open. The coding CLI's filesystem/shell tools, terminal UI, automatic extension loading, and coding prompts are outside the banking runtime loadout. Import only the required library and business tools.

## Banking Execution Boundary

Pi dispatches a tool; the registered banking tool delegates to the shared business executor, which enforces ownership, action-bound approval, risk, balance, idempotency, and reconciliation immediately before any state change. The same executor serves direct application actions. Pi hooks help coordinate the flow; they do not replace this authority.

The owner's payment-factor and recovery requirements are defined in [SECURITY.md](SECURITY.md). Passkey ceremonies, password/OTP verification, enrollment/revocation, and recovery are separate security-service/client flows; never register them as agent-callable tools. Pi receives safe pending/completed statuses only. All money-moving tools require a fresh grant and enforce account recovery restrictions before dispatch, including small transfers and direct API calls.

- `beforeToolCall` receives schema-validated arguments and can block the tool. Use it to create/reference a pending canonical action, check task/dependency state, and signal required confirmation or verification. Persist state before notifying the client. Repeated proposals must refer to the existing action rather than create duplicates.
- Awaiting a human must not keep an HTTP request or tool promise open indefinitely. Persist the pending action, block execution, and end the run through `finishTurn` when task state requires a pause. An authenticated approval endpoint verifies proof and invokes the shared executor for that exact stored action; canonical results then resume the agent narrative. Approval is not model-generated chat text.
- `terminate: true` is a batch-level hint: the inspected loop stops automatic follow-up only when every finalized result in the batch requests termination. Do not use it alone as a permission pause. `finishTurn` runs after the batch, so every subsequent tool's hook and executor must already enforce pending state and dependencies.
- The reviewed core defaults to parallel tool execution. Configure sequential dispatch for banking tools; ownership locks, atomic daily reservations, and idempotency remain necessary across sessions/workers. Read-only concurrency can be enabled only for independently safe tools.
- `afterToolCall` and event subscriptions can map/sanitize results, but durable operation records and receipts are written in the business execution path. A post-execution hook failure must not erase a committed operation or invite a duplicate retry.
- Map client events to customer-facing statuses and readable steps. Do not forward raw model/tool arguments, verification material, hidden reasoning, or privileged audit fields to the client.
- `abort()` or an aborted signal does not reverse a committed bank operation. Query its status, preserve receipts, and cancel only remaining work.
- Pi conversation state is not a bank ledger or approval database. Persist business actions, dependency edges, approval challenges, and reconciliation status separately; rehydrate scoped model context from those records. Additional upstream persistence packages require a focused compatibility review before use.

## Source Reuse and Attribution

The inspected LICENSE is MIT, copyright 2025 Mario Zechner. It grants reuse/modification/distribution subject to retaining the copyright and permission notice in copies or substantial portions. Preserve the full upstream notice with any vendored code and relevant distribution; record package licenses and third-party dependencies when installing.

When source is copied, maintain a record of original repository, commit, paths, copied-file checksums, and local changes. Clearly attribute the framework in technical/submission material and explain the team's banking/client/security contribution. Open-source permission does not settle the competition's independent-work rules; verify any organizer-specific disclosure requirement before submission.

## Integration Verification Plan

Before relying on an installed Pi release, run a provider-free fake-stream smoke test for a tool round trip, event ordering, hooks, pending approval pause/resume, cancellation, and mixed-tool batches. Then run banking invariants for cross-customer access, exact approval binding, concurrent daily limits, timeout/restart reconciliation, and duplicate prevention. Live model tests measure planning and completion separately from deterministic authorization tests.

The earlier source-research task did not install or execute Pi. Subsequent backend implementation installed 1.0.1 and tested the actual loop, multi-tool approval pause, tool abuse, run budgets and API-compatible streaming. Approval and ledger correctness are tested independently. See HANDOFF.md for results and FRONTEND_HANDOFF.md for remaining browser/provider verification. Real bank, live DeepSeek and production infrastructure are not exercised by fake-stream or local HTTP transport tests.
