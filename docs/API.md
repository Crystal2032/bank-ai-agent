# Backend API Contract

Credential endpoints and current policy are detailed in [AUTHENTICATOR.md](AUTHENTICATOR.md). Login stays password-only. Small transfers accept one of password/Passkey/TOTP; higher-risk transfers require distinct options. Recovery uses available backups and no routine funds hold. Protected proofs remain outside model tools; Pi can prepare all supported credential operations.

Browser base URL: http://localhost:3001; the server binds to 127.0.0.1. Use localhost for both client and API to retain SameSite=Strict cookies. Banking operations are simulated. Model inference is an externally configured API; no local model is loaded. Request schemas and endpoint descriptions are available at GET /api/contract. Response types: [contracts/backend.ts](../contracts/backend.ts).

The authorized cloud endpoint is https://aibank.yfyckbkb.com, with a same-origin web client and opt-in bundled Android origin. Secure cookie/CSRF and all factors remain required. The Docker backend port is private behind its header-replacing reverse proxy. See [DEPLOYMENT.md](DEPLOYMENT.md) for domain TLS, credential handling and Passkey device-test limits.

Money is integer CNY minor units: 30000 means CNY 300.00. Timestamps ending At/Until in security/session/action records are Unix milliseconds; observedAt, occurredAt and executedAt are ISO strings. All resource access derives the customer from the cookie; supplied customer identities cannot authorize access.

All POST requests require the configured Origin. Authenticated POST requests additionally require X-CSRF-Token from login/me and the HttpOnly bank_session cookie. Empty-body operations require `{}`. Use JSON, credentials included, and English UI copy. Errors use `{ error: { code, message, retryAfterSeconds? } }`. SMS throttling includes an integer Retry-After header, also exposed through CORS.

## Endpoints

| Method / path | Body or query | Result |
| --- | --- | --- |
| GET /health | None | Liveness, simulation and configuration flags; no secrets |
| GET /api/contract | None | Implemented request schemas |
| POST /api/auth/login | username, password | Session cookie, CSRF, customer and restriction state |
| GET /api/auth/me | Cookie | SessionResponse |
| POST /api/auth/logout | {} | signedOut |
| GET /api/bank/accounts | None | accounts, observedAt, simulated |
| GET /api/bank/transactions | None | transactions, simulated |
| GET /api/bank/contacts | None | contacts |
| GET /api/bank/bill-report | month=YYYY-MM | BillReport with evidence IDs and candidate labels |
| POST /api/actions | kind, params, idempotencyKey, optional dependsOn | Immutable ActionView |
| GET /api/actions | None | Own action list |
| GET /api/actions/:id | None | ActionView |
| POST /api/actions/:id/confirm | version | ActionView; transfer awaits verification |
| POST /api/actions/:id/execute | {} | Authorized result or existing completed result |
| POST /api/actions/:id/cancel | {} | Cancelled pending action |
| GET /api/receipts/:id | None | ReceiptView |
| POST /api/actions/:id/verify/password | password | Authorized/waiting action with verification progress; SMS fallback if no other option enrolled |
| POST /api/security/payment/sms/verify | challengeId, code | Authorized action |
| POST /api/actions/:id/verify/passkey/options | {} | challengeId, options, expiresAt |
| POST /api/security/payment/passkey/verify | challengeId, response | Authorized/waiting action |
| GET /api/security/passkeys | None | Safe key metadata |
| POST /api/security/passkeys/enrollment/start | password | SMS challenge |
| POST /api/security/passkeys/enrollment/options | challengeId, code | Registration options |
| POST /api/security/passkeys/enrollment/verify | challengeId, response, label | Rotated SessionResponse, recovered=false |
| POST /api/security/recovery/start | password | SMS challenge, recoveryId; original phone only |
| POST /api/security/recovery/options | challengeId, code | Restricted replacement options |
| POST /api/security/recovery/verify | challengeId, response, label | Rotated restricted session, recovered=true |
| POST /api/security/passkeys/revocation/start | credentialId, password | Key-bound SMS challenge |
| POST /api/security/passkeys/revocation/verify | challengeId, code | Rotated session after removal |
| POST /api/tasks | message | 202 TaskView |
| GET /api/tasks | optional limit=1..100 (default 20), before=taskId | TaskListResponse: own summaries and nextCursor |
| GET /api/tasks/:id | None | TaskView including structured events/actions |
| GET /api/tasks/:id/events | optional after=sequence | New events, running, status |
| POST /api/tasks/:id/messages | message | 202 resumed TaskView |
| POST /api/tasks/:id/stop | {} | Stop and cancel unexecuted work |
| POST /api/tasks/:id/takeover | {} | Manual-control lease; preserve pending actions |
| POST /api/tasks/:id/release | {} | Release manual lease without automatic execution |
| GET /api/audit | None | Last 200 own sanitized append-only events |

Action params: TRANSFER uses contactId, amountMinor and optional note; SUBSCRIPTION_LOOKUP uses {}; SUBSCRIPTION_CANCEL and MANDATE_REVOKE use subscriptionId. Params and dependency edges are immutable; modifying intent requires cancelling pending work and preparing a new reviewed action. Dependency IDs must already exist and belong to the customer, producing an acyclic incremental DAG. Agent-created dependencies cannot cross tasks.

## State and Authorization

Transfer: WAITING_FOR_CONFIRMATION -> WAITING_FOR_VERIFICATION -> AUTHORIZED -> SUCCEEDED. Confirmation does not authorize transfer execution. Subscription actions are yellow: lookup uses confirmation -> AUTHORIZED -> execute; writes on TOTP-enrolled accounts require fresh verification after confirmation. Subscription lookup result appears in the completed action's result; no unconditional subscription-read endpoint bypasses that rule.

Projected daily transfer usage includes completed transfers for the Asia/Shanghai calendar day and all pending transfer reservations. At or below 100000 minor units is yellow; above is red. Risk is rechecked at execution. A yellow grant upgraded to red is invalidated and the action returns to WAITING_FOR_VERIFICATION. Grants are session/epoch bound and last at most two minutes. All sensitive-write preparation and execution paths enforce account restrictions; confirmed subscription lookup remains available as a read.

Repeated execute after success returns the same receipt without another ledger mutation. The SQLite simulator updates dispatch/audit, ledger, receipt and action in one transaction. It has no external bank network or uncertain remote dispatch; RECONCILING is reserved in the contract for future provider integrations, not a claimed implemented remote reconciliation worker. Read status after an HTTP response is lost.

Pending actions expire after 15 minutes and are cancelled during mutating bank operations. No scheduled-transfer worker exists. Confirm dependencies before their dependents. Cancelling remaining steps does not undo a completed transfer; refund/reversal is unsupported.

## Model API and Result Boundary

Defaults are MODEL_BASE_URL=https://api.deepseek.com and MODEL_ID=deepseek-flash, following [DeepSeek's official OpenAI-compatible API documentation](https://api-docs.deepseek.com/) checked October 3, 2026. Configure MODEL_API_KEY externally; without it the model is disabled. Endpoint/model overrides support other compatible services. DeepSeek requests explicitly disable thinking for this tool workflow. The configured endpoint/model is server-owned. No automatic provider fallback or local inference is enabled. Request retries are disabled; limits are six model requests and twelve tool calls per task run, ten runs per task, a bounded elapsed timeout, and a three-failure task lock. Provider-reported token counts are available in internal Pi transcript metadata; price estimates are not configured and must not be reported as measured cost.

The model can read scoped balances/contacts/bills/security availability, prepare pending banking/credential operations, and request predefined clarification. It cannot confirm, execute, verify factors, perform recovery itself, access arbitrary network/files, or set customer identity. Every tool delegates to the customer-scoped backend. Prepared plans and events persist in SQLite. On restart, interrupted running tasks become NEEDS_REVIEW; no write automatically resumes.

Only canonical structured evidence and action states are exposed. Raw model text, thinking, transcript, tool errors and verification secrets are not forwarded to the client; this prevents unsupported model prose from appearing as an account fact or receipt. Backend-generated candidate explanations distinguish unusual charges from fraud and recurring patterns from confirmed subscriptions. Natural-language explanation richness and model task quality require provider-specific evaluations.

## Task History and SMS Waiting

GET /api/tasks works even without a model key and lists only the authenticated customer's tasks, ordered by immutable creation time descending and task ID descending for ties. Summaries omit model transcripts, event bodies, actions and factor state. Pass nextCursor as before for the next page; foreign and nonexistent cursors return the same NOT_FOUND response. createdAt/updatedAt are Unix milliseconds; older task records acquire timestamps from their existing event times on startup.

Every accepted task creation/follow-up atomically records RUN_STARTED with data.customerMessage before model planning begins. These are customer-supplied display strings, not assistant claims, instructions granting authority or factor proofs. The event sequence/timestamp gives the conversation order. Rejected follow-ups are not recorded. GET /api/tasks/:id and its event cursor restore messages after restart or in another authorized session without exposing the internal Pi transcript. The shared web/Android Assistant uses the paginated summary endpoint for Conversation history and restores messages/results from server events. sessionStorage holds only a customer-scoped selected task ID; existing legacy follow-up caches are read for compatibility without duplicating durable messages. Older events lack customerMessage; use input for their initial request, and do not reconstruct unavailable follow-ups from raw model messages. History reads do not resume tasks or authorize actions.

The release response includes its newly appended MANUAL_CONTROL_RELEASED event, matching a subsequent task read. Release still does not automatically resume planning or execute any pending action.

SMS issuance remains limited per customer across purposes and sessions: one send per 60 seconds and at most six in a rolling 30-minute window. The window uses issuance time, including a compatibility fallback for older challenges. Consuming or failing an OTP does not reset the send budget. SMS_RATE_LIMIT returns the remaining wait in error.retryAfterSeconds and Retry-After; successful challenges include resendAvailableAt. That timestamp describes the minute cooldown only; the rolling budget can require longer. The client should show the returned wait rather than retry automatically or bypass a factor.

## Current Integration Limits

Single backend process/local competition simulator; no real bank/merchant service, real SMS delivery, staff/KYC/SIM-risk integration, generated-code execution, scheduled payments or investment tools. The shared-frontend Android client is documented in ANDROID.md. Manual takeover is customer control, not a staffed bank-review queue. Passkey verification uses SimpleWebAuthn; browser/device ceremonies must be tested by the frontend. Recovery notifications currently record audit events with notificationsSimulated=true; external notification delivery is not implemented. Sensitive-change flows use the enrolled backup policy in AUTHENTICATOR.md; enrollment/removal rotate all customer sessions and invalidate pending grants/proofs. Signed-out/no-backup password recovery requires an unimplemented identity-review integration.

Production deployment, competition acceptance of Passkeys/client/simulator/sandbox exclusion, provider privacy terms and comprehensive adversarial/model evaluations remain unverified. No credential or approval bypass is exposed for demos.
