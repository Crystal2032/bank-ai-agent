# Frontend Handoff to Claude Code

Backend owner: Codex. Frontend owner: Claude Code, assigned by the project owner on October 3, 2026. Model inference is API-only. Use one orchestrator; multiple autonomous agents are not required.

## Domain and Authenticator Update

Codex added the requested independent TOTP verification, adaptive recovery and Agent-triggered credential operations to the existing UI. SecurityOperation is shared by Security center and Assistant SECURITY_REQUEST cards; PaymentVerification selects password/Passkey/TOTP and reports higher-risk progress. Login stays password-only. Enough proof automatically continues; credential inputs/QR remain outside chat. Server policy controls available backups/count, normal recovery has no funds hold, and stop cancels requests. See AUTHENTICATOR.md and contracts/backend.ts. Cloud endpoint: https://aibank.yfyckbkb.com; Android 1.0.5/code 6 shares the same assets/domain RP. Actual device ceremonies remain unverified.

## Backend Review Update

Claude Code has implemented the frontend. Codex reviewed its four reported backend issues: release now returns the appended event; shared response types now include health/envelopes/Passkey/options/enrollment/audit/task events; GET /api/tasks discovers owned summaries; RUN_STARTED.data.customerMessage persists accepted follow-ups. The SMS policy remains intact with retryAfterSeconds/Retry-After and resendAvailableAt metadata. API.md defines pagination, history compatibility and wait semantics.

Codex has now adopted server-based history in the shared Assistant. ConversationHistory retrieves paginated owned summaries and opens a fresh TaskView; conversationTimeline renders customerMessage in run order as customer text without duplicating older locally saved copies. sessionStorage retains a customer-scoped selected ID for reload convenience; existing old message caches are read only for compatibility. Initial legacy input is preserved and unavailable old follow-ups are not reconstructed from model transcripts. Opening history never resumes planning or changes payment/security state. SMS wait metadata still needs display without automatic resend, accounting for a rolling-budget wait longer than the minute cooldown.

## Ownership and Startup

Read README, REQUIREMENTS, DECISIONS, SECURITY, API, and HANDOFF before editing. Build frontend files under `frontend/` with a separate package manifest. Backend-owned scope: `src/`, `tests/`, `scripts/`, `contracts/backend.ts`, root package/lock/config, and API documentation. Keep shared contracts coordinated rather than silently changing server interfaces. No frontend has been implemented by Codex.

Follow the root sequential-work rule: backend development/background processes must finish before frontend writes begin in this checkout. Parallel work requires separate worktrees and explicit ownership. Do not modify security policy or replace Pi when adding the client. All UI text, comments, fixtures and prompts must be English.

Backend setup: Node >=24.19, `pnpm install --frozen-lockfile`, `pnpm setup:demo`, `pnpm dev`. The setup command creates an ignored .env and random synthetic password; it refuses to overwrite existing .env. Login usernames are `alex` and `jordan`; the password is provisioned through DEMO_PASSWORD. Keep it out of client source, bundles, commits, screenshots and docs.

Default browser API origin: `http://localhost:3001` (server binds to 127.0.0.1). Default client: `http://localhost:5173`. Use localhost for both browser URLs: mixing a localhost client with a 127.0.0.1 API makes them cross-site and blocks SameSite=Strict cookies. Configure CLIENT_ORIGIN, RP_ID and secure cookies together if changing the origin. Localhost Passkey ceremonies use the browser secure-context exception; other devices require a properly configured HTTPS origin and RP ID, not an arbitrary LAN HTTP address.

## Product Screens

- Sign-in and account overview with synthetic-banking indication.
- Transactions, evidence-linked monthly bills and candidate recurring/unusual charges.
- Assistant conversation with structured progress, clarification, pending action cards, stop and manual control.
- Transfer review showing exact recipient, integer-derived amount, currency, note, current tier and dependencies.
- Subscription lookup confirmation, then separate cancellation or mandate-revocation review. Cancelling merchant service and blocking debit authority have different consequences.
- Protected password/Passkey/SMS verification forms outside chat.
- Security center: key metadata, enrollment, removal, lost-key recovery, masked existing phone and recovery-hold status.
- Canonical receipts and visible partial-completion outcomes.

Responsive client format remains a competition acceptance question. This handoff does not claim native-client or cross-device ceremonies were tested.

## Session and API Rules

Use `credentials: 'include'` on fetch. Login and GET /api/auth/me return a CSRF token; keep it in memory and send it as X-CSRF-Token on every authenticated POST. Enrollment/recovery/removal rotate the cookie and return a new CSRF token. Replace the old client token immediately. Never store the session cookie or model key in browser storage.

The browser sends Origin automatically; every POST must originate from CLIENT_ORIGIN, including login. CORS credentials are enabled only for that origin. If using a frontend proxy, preserve the correct origin and cookie behavior. Error responses are `{ error: { code, message } }`; handle 401 by returning to sign-in and 403/409/423 by refreshing the operation/security state. Do not silently weaken verification after a rejected Passkey.

GET /api/contract exposes the implemented request schemas and descriptions. Browser-safe response interfaces are in [backend.ts](../contracts/backend.ts). [API.md](API.md) describes lifecycle sequencing. POST endpoints documented with an empty body expect `{}`.

## Payment Interaction

1. Prepare an action. Generate one idempotency key per user intent and reuse it on response-loss retry. Never generate a fresh key just because a payment response is missing.
2. Display canonical action parameters. Confirm with the returned version.
3. For a transfer, choose password/Passkey/TOTP. Continue until the canonical result is AUTHORIZED; a higher-risk first proof returns WAITING_FOR_VERIFICATION with progress. Password/SMS is the fallback for higher-risk password-only enrollment.
4. Use a maintained WebAuthn browser library (for example SimpleWebAuthn browser compatible with the server) to serialize options/assertions. Submit the response with challengeId to the dedicated security endpoint. Do not send factors through task messages.
5. After AUTHORIZED, execute the exact action. A risk upgrade returns RISK_UPGRADED and requires refreshing/reverification. Every transfer requires fresh proof even within the yellow amount range.
6. If execute loses its response, GET the action first; retry execute on the same action ID. Show success only from SUCCEEDED plus the canonical receipt. RECONCILING is not success and cannot be cancelled as if nothing happened.

Model free-form prose is intentionally not forwarded as a financial result. Render verified ACCOUNTS, BILL_REPORT, CONTACTS and ACTION events; clarification uses backend-selected text. Do not invent a success bubble from a model response or treat RUN_FINISHED as payment completion.

## Tasks and Recovery

POST /api/tasks returns 202, then poll GET /api/tasks/:id or /events?after=<sequence> while running. A WAITING task shows pending actions or clarification. Complete operations via protected endpoints, then POST /messages with the customer's next instruction or a request to continue using updated results. The backend adds current action states to model context. Stop cancels unexecuted work; settled operations remain. Takeover stops the agent and preserves pending cards for manual controls. Release returns the lease to the agent; it does not execute anything automatically.

Use SecurityOperation and server verification policy/proofIds for credential changes. The Agent request opens the same protected form; credential completion updates the canonical request/task through authoritative audit evidence. Recovery excludes the affected option and accepts one remaining backup if enrollment is incomplete. Normal recovery rotates sessions/CSRF with holdUntil=0; show actual restrictions only when returned. See AUTHENTICATOR.md for no-backup/signed-out review limits.

SMS_MODE=file is a local synthetic test outbox, not delivered SMS. It is never available through a frontend API. Do not build a client bypass or show a code returned by the server; test operators read the ignored outbox locally. Production SMS, SIM-risk checks and bank staff review are not integrated.

## Frontend Verification

Check sign-in/logout, CSRF refresh, owned data, account/receipt refresh after actions, ambiguous-recipient selection, yellow/red display, subscription lookup confirmation, distinct cancellation/revocation, API outage, task polling/stop/takeover, wrong/expired verification, recovery restrictions, and Passkey registration/assertion on an actual browser. Backend tests use cryptographically signed software-authenticator fixtures; they do not prove browser/device support. Keep known limitations visible in the handoff.
