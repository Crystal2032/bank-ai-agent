# Architecture Decisions

The owner requested an AIR-informed design and mature minimal framework reuse, then assigned backend development to Codex and frontend development to Claude Code. The implemented backend uses Pi Agent core/Pi AI 1.0.1, TypeScript/Fastify, Node >=24.19 and SQLite; the client uses React/Vite (ADR-012). Model inference is API-only with DeepSeek for testing. The authorized Docker cloud deployment is recorded in ADR-015/ADR-016; final competition acceptance and production integrations remain open.

## ADR-001: Backend Agent Runtime

- Decision: planning, tool execution, policy, and persistent tasks live in the application backend. The client handles conversation, results, and authorization interaction. The backend may run locally during development.
- Rationale: banking tasks need authoritative enforcement and recoverable execution. Hosting and inference location remain separate choices. AIR's exact deployment topology is not established by the reference discussion.

## ADR-002: Deterministic Execution and Authorization

- Decision: the LLM proposes typed actions; backend gates enforce ownership, action-bound proof, cumulative risk, and execution invariants. Results come from provider status/receipts.
- Rationale: model instructions cannot enforce ledger consistency or authorization. Atomic reservations, idempotency, and reconciliation address concurrency and ambiguous timeouts.

## ADR-003: One Orchestrator with Domain Tools

- Decision: one orchestrator, persisted business DAG, and transfer/bill/subscription tool groups. Reuse Pi Agent and Pi AI for generic runtime/provider responsibilities (ADR-007).
- Rationale: preserve modular boundaries without unnecessary autonomous sub-agent routing or infrastructure. Evaluate before adding routing or fine-tuning.

## ADR-004: Simulator behind a Banking Adapter

- Decision: synthetic data and authoritative simulated banking/merchant operations with visible labels and a replaceable provider contract. ADR-008 replaces the generic simulated-verification placeholder with real WebAuthn/password verification design; SMS can use an explicitly labeled test adapter until a provider integration is configured.
- Rationale: stateful, verifiable demonstrations without real banking access. Organizer acceptance remains unresolved.

## ADR-005: Live Data through Tools

- Decision: scoped typed tools provide account truth; isolated chat context and a small versioned policy corpus provide context. Defer persistent personalization and vector search.
- Rationale: balances, permissions, and customer isolation cannot depend on model memory. Retention guarantees require provider-specific verification.

## ADR-006: One Complete Competition Submission

- Decision: deliver one coherent competition project. Implementation order describes work dependencies, not separate planned product versions.
- Rationale: the owner explicitly corrected the repeated version framing. Keep communication and planning focused on the complete deliverable; this does not independently expand feature scope.

## ADR-007: Reuse Pi Core with Thin Banking Adaptation

- Decision: reuse upstream Pi Agent core and Pi AI; use TypeScript/Node.js for the agent backend. Default to pinned library dependencies, with narrowly scoped source vendoring/patches only when an actual interface gap requires it. Retain source provenance and notices for copied code.
- Rationale: the owner prefers mature minimal code with limited adaptation. Source inspection confirms typed tools, model API, hooks, event streaming, and turn control. Generic-loop rewrites would duplicate existing functionality. Backend business services still enforce authorization, atomic limits, and ledger reliability.
- Scope: Pi Agent core/Pi AI 1.0.1 are installed and tested through the real loop and compatible HTTP transport. The earlier inspected source snapshot is recorded in PI_INTEGRATION.md. Do not inherit coding CLI tools or assume Pi supplies bank-grade permissions or durable bank actions.

## ADR-008: Fresh Payment Verification and Separate Passkey Recovery

Historical recovery-count/hold proposals in this entry are superseded by ADR-017.

- Decision: every transfer/payment requires explicit operation review and fresh action-bound Passkey or account-password verification. An eligible user-verifying Passkey is preferred. Red-risk password fallback also requires an action-specific second factor. The security service verifies factors outside Pi; the shared executor validates resulting grants and account restrictions.
- Decision: unavailable-key recovery uses account password plus SMS to the pre-existing verified phone, followed by restricted replacement enrollment. Revoke affected keys and old sessions, invalidate pending grants, and enforce a financial hold. Synced/other existing keys can avoid unnecessary recovery. SECURITY.md defines the flow and labels its proposed timing defaults.
- Rationale: owner-confirmed requirements protect each financial operation and support device migration. Recovery must not become a shortcut around transaction verification; login, payment approval, and key replacement use distinct proof purposes. Borrow established banking/exchange patterns while distinguishing project choices from their product policies.
- Scope: password and cryptographic WebAuthn verification, epochs and recovery holds are implemented and tested with software-authenticator fixtures. Browser/device ceremonies remain unverified. Banking remains simulated; SMS provider and review integration remain open. No claim of production or regulatory certification follows from the design.

## ADR-009: Official Security Baseline and Evidence-Bounded AIR Reference

- Decision: use the official domestic AI problem explanation as the competition security baseline, retaining owner-required payment verification and recovery. AIR supplies reference engineering patterns; company-wide platform capabilities and proposed project mechanisms must remain separately labelled.
- Rationale: the owner explicitly directed official problem alignment. Product marketing and partial engineering disclosures do not establish AIR's exact implementation or our compliance. AIR_GAP_REVIEW.md records missing contracts and evaluation evidence without expanding approved domains or replacing Pi.
- Scope: Passkey acceptance for red operations, generated-code sandbox expectations, and client/simulator acceptance remain organizer questions. Authentication timers and recovery holds remain proposed defaults.

## ADR-010: Backend/Frontend Ownership and API-Only Models

- Decision: Codex implements backend services, tests and shared contracts; Claude Code implements the frontend after the backend handoff. Preserve sequential writes unless separate-worktree parallel ownership is defined. Use one Pi orchestrator with domain tools.
- Decision: call an OpenAI-compatible model API, using DeepSeek for provider testing. Server-owned environment configuration holds endpoint, model and key; missing keys fail explicitly. deepseek-flash is a replaceable default from current official documentation, not an evaluated model-quality claim.
- Rationale: direct owner instructions. No local model weights or training pipeline are necessary for this scope.

## ADR-011: Minimal Stateful Backend Implementation

- Decision: Fastify 5.12.5 with strict JSON schemas, credentialed origin-restricted cookie sessions/CSRF; Node >=24.19 built-in SQLite with synchronous atomic simulator transactions; SimpleWebAuthn 14.0.3 for signature verification. Pin Pi libraries at 1.0.1 and configure sequential tools. Keep generic runtime/model transport upstream.
- Rationale: small deployment surface, durable actions and deterministic ledger/receipt/audit consistency. JSON records simplify competition fixtures; this single-process simulator is not a production-scale banking database or distributed workflow service.
- Decision: expose canonical tool evidence/actions and backend-defined clarification, suppressing free-form model financial claims. Use incremental dependency edges only to existing owned actions. Keep account factors outside model tools and default to non-thinking DeepSeek requests. Limit model turns/tools/runs and failures.
- Scope: no real bank/provider dispatch, model fallback, staff review, external notifications, sandbox execution or frontend. Local SMS outbox is explicit simulation. Browser/device, live DeepSeek and competition acceptance remain unverified.

## ADR-012: Frontend Client

- Decision: a single-page React 19 + Vite 8 + TypeScript client in frontend/ with its own package manifest, lockfile and pnpm workspace root, so frontend installs never touch the backend lockfile. Passkey ceremonies use @simplewebauthn/browser 14.0.0, matching the server's SimpleWebAuthn 14 JSON shapes. No router, state or UI library: hash routes and hand-written CSS keep the dependency surface small.
- Decision: the browser calls http://localhost:3001 directly with credentials included (no dev proxy), keeps the CSRF token only in memory and adopts rotated tokens from enrollment/recovery/removal responses. Only task IDs and the customer's own sent assistant messages are kept in sessionStorage so a reload can reattach to a conversation; they are cleared on sign-out or session loss.
- Decision: shared response types are imported from contracts/backend.ts. The backend review consolidated the previously client-local health, envelopes, Passkey/options, enrollment, audit and task-events shapes into that file; frontend/src/api/types.ts re-exports them and retains client helpers. WebAuthn shape imports are type-only and erased from emitted client code. Success is displayed only from SUCCEEDED plus a fetched canonical receipt; model prose is never rendered.
- Rationale: mainstream, well-documented tooling suits a competition demonstration and hand-over between agents. Responsive layout covers desktop and phone widths. Android packaging was subsequently requested by the owner and is defined in ADR-014.
- Scope: verified in headless Chrome with a CDP virtual authenticator against the real backend and Pi runtime using a scripted model stream; real device authenticators, other browsers and live DeepSeek output remain unverified.

## ADR-013: Durable Customer Task History and Explicit SMS Waiting

- Decision: provide paginated, customer-scoped task summaries and record accepted customer messages in RUN_STARTED events before planning. Keep the internal model transcript private. Existing task/input/events endpoints remain compatible; older messages are not invented or reconstructed from model prose.
- Rationale: frontend review found that task discovery and follow-up recovery depended on tab-local storage. Durable event history supports inspection and future cross-session client recovery while preserving customer isolation and sequential execution.
- Decision: retain the per-customer SMS cooldown and rolling budget, calculate them from issuance time and expose exact wait metadata. Consolidate served response types into the backend-owned shared contract and include the release event in the release response.
- Scope: the existing frontend storage/history UI is preserved; adopting server-based conversation discovery remains a client task. Real SMS and production retention/privacy controls remain unimplemented.

## ADR-014: Android Packaging with Shared Web UI

- Decision: package the existing React/Vite frontend through Capacitor 8.5.2, with Android 9+ support, an Android Credential Manager adapter and native cookie-aware HTTP. Keep UI/domain logic and security forms shared; do not introduce a second native UI codebase.
- Rationale: the owner explicitly requested an Android client that reuses Claude Code's frontend and reduces ongoing development/maintenance. The existing browser implementation remains supported.
- Decision: opt in to the exact packaged origin through backend configuration; retain CSRF and all transaction gates. Use local USB/adb reverse for the supplied debug configuration and HTTPS for remote/release configuration. Native Passkeys require an associated real RP domain and an explicit signing-certificate origin; the local build offers fresh password/SMS routes without faking Passkeys.
- Scope: no device was attached during initial construction; domain association and real-device behavior remain unverified. Build does not authorize signing/release/deployment or change Android root/proxy settings. ANDROID.md defines setup and known limits.

## ADR-015: Authorized Docker Cloud Service with Short-Lived IP TLS

- Decision: deploy the existing backend as a non-root, read-only Docker container with a persistent SQLite mount, behind a Nginx HTTPS edge serving the shared frontend. Keep server-only secrets outside images/source. Enable exactly one trusted proxy hop only on the isolated backend, with forwarding headers replaced at the edge.
- Rationale: the owner explicitly authorized deployment on the supplied server and API-key configuration. API-only inference fits the observed 1 GiB host without a local model. Preserve existing host services and local demonstration state.
- Decision: use ACME HTTP-01, Let's Encrypt shortlived IP certificates and a private pinned acme.sh installation; an hourly systemd timer checks renewal and a saved hook validates/reloads Nginx after installation. Keep port 80 open for challenges and redirect other HTTP traffic. Update Android to the same cloud HTTPS API without introducing a separate UI.
- Scope: native/browser Passkeys require a real domain and remain disabled for IP-only hosting; fresh password and required action-specific SMS checks stay enforced. Banking and SMS remain synthetic. Real DeepSeek balance-tool execution and password transfer/idempotency passed over HTTPS; real-device testing, future renewal, broader evaluations and production signing remain outstanding. DEPLOYMENT.md records operations and limits.

## ADR-016: Owner Domain and Shared Android Passkey Association

- Decision: make https://aibank.yfyckbkb.com the canonical web/API endpoint, with a Spaceship A record pointing to the existing server. Preserve the legacy IP as an HTTPS redirect and issue an independent domain certificate with automatic renewal. Keep credentials, persistent bank state and existing host services.
- Rationale: the owner requested using their purchased domain; a domain RP also enables the existing browser/native Passkey implementation to be configured correctly.
- Decision: rebuild the same frontend/Android package for the domain, increment the APK installation version, publish Digital Asset Links for the existing development signer and configure the exact backend Android certificate origin. Default local USB builds remain independent.
- Scope: DNS, externally validated TLS, login/data preservation, APK signature/hash and association configuration passed. Real device credential-provider ceremonies remain unverified; this does not add real SMS or banking integration. No production signing key or app-store release was created.

## ADR-017: Alternative Factors, Adaptive Recovery and Agent Preparation

- Decision: standard OTPAuth 9.5.2 and local qrcode 1.5.4 provisioning; password-only login. Small transfers choose password/Passkey/TOTP; high-risk transfers require distinct options, retaining original-phone SMS for password-only enrollment.
- Decision: recover/remove one option with two other enrolled options when available, one with its safeguards when only one exists. Exclude the affected option; password/SMS counts as one recovery backup. No backup requires external identity review. Prevent deletion/re-enrollment bypass.
- Decision: normal verified recovery has no automatic financial hold. Five recorded failed factors in five minutes can cause a configured abnormal-risk restriction. Rotate epochs/sessions/grants/proofs for changes; no automatic pending-payment replay.
- Decision: one Pi Agent exposes safe read_security_options and prepare_security_operation. Protected shared SecurityOperation executes after identity proof; audit-sequence-backed completion and stop cancellation enforce lifecycle. Model tools never receive factors or mutate credentials.
- Decision: encrypt seeds with AES-256-GCM/customer AAD and HKDF from AUTH_SECRET; durable counters/failure budgets and hashed one-time offline codes. Preserve AUTH_SECRET with backups.
- Scope: APIs/shared web/Android are implemented and tested. Signed-in password reset is supported; no-backup/signed-out identity review, real SMS/banking, real-device ceremonies and production signing remain external integration work.

## ADR-018: Automated DNS-01 Domain TLS

- Decision: replace HTTP-01 domain/IP renewal with dns_spaceship using the existing pinned acme.sh source, a separate root-private ACME configuration/account and a DNS Records Read/Write-only API key. Keep credentials outside source and application containers. Hourly systemd renewal loads the private environment, installs the certificate and validates/reloads Nginx.
- Rationale: the owner requested DNS validation without port-80 standalone mode and explicitly approved provider terms/key creation. A separate ACME account exercised a real DNS challenge rather than cached HTTP authorization.
- Decision: remove the HTTP challenge route and old renewal entries. Keep HTTP-to-domain redirects; reject direct-IP/unknown-host TLS because DNS-01 cannot validate IP addresses. The updated Android package already uses the domain, so this TLS change needs no additional APK rebuild. This supersedes the legacy IP redirect/HTTP renewal portions of ADR-015/016.
- Scope: actual DNS TXT creation, propagation, CA validation, cleanup, certificate installation, Nginx reload, successful renewal service run and external web/API/APK checks passed. Existing nameservers, other DNS records and bank data are preserved. Future scheduled renewal remains unobserved; private configuration/certificate snapshots support rollback.

## ADR-019: Durable Shared Conversation History

- Decision: expose the existing customer-owned persistent tasks/events through a paginated Conversation history modal in the shared Assistant. Restore accepted customer messages from RUN_STARTED.customerMessage alongside canonical structured results/cards. Keep model transcripts private and preserve stopped/interrupted states; reading history never starts a model run or executes an operation.
- Rationale: server durability and ownership/pagination already exist, but the client previously restored only one sessionStorage-selected task and locally cached follow-ups. The owner requested usable conversation history across sessions/devices without a second UI or storage system.
- Decision: store only the customer-scoped selected task ID for reload convenience, retain read-only compatibility with old local message caches, and avoid duplicating messages recorded by both the old client and backend. Initial legacy input remains available; unavailable old follow-ups are not fabricated from internal Pi messages. Explicitly sending a follow-up uses existing run/risk/authentication gates.
- Scope: shared web and Android package, existing SQLite persistence and bank data remain in place. No automatic execution, new factors or history deletion is added.

## Remaining Choices

- Owner confirmation or revision of the three-domain baseline and responsive client format in DESIGN.md.
- Broader live DeepSeek evaluations and cost budget; cloud configuration and a live balance-tool smoke are complete.
- Real SMS/review/notification integrations, recovery timing policy, deployment and organizer acceptance.

See [DESIGN.md](DESIGN.md) for contracts, demonstration, acceptance cases, and open competition questions.

Record each confirmed decision with its rationale and main tradeoffs after the business and competition requirements are defined. Shared collaboration rules are maintained in AGENTS.md.
