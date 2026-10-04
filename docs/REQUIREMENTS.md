# Project Requirements

## Confirmed

- Build a banking AI agent for an innovation competition.
- Provide persistent, customer-isolated conversation history in the shared web/Android Assistant: browse older conversations, restore accepted messages and verified results across login/devices, and explicitly continue eligible conversations. Opening history must not trigger model runs, payments or credential changes. Confirmed October 4, 2026.
- Support Authenticator TOTP as an alternative to password/Passkey for small transfers, with adaptive backup recovery and no routine financial waiting period; do not require TOTP for login. Confirmed October 4, 2026. Protect setup, removal/recovery, secret storage, replay and failure budgets while preserving the shared web/Android client and existing factors.
- Build an Android client by directly reusing Claude Code's React/Vite frontend, keeping a single UI codebase to reduce maintenance. The owner requested this after frontend completion.
- Package and deploy the backend with Docker on the owner-supplied cloud server, configure the provided DeepSeek key externally, obtain an ACME IP TLS certificate with automatic renewal and update Android to use the cloud endpoint. Deployment was explicitly authorized on October 4, 2026; secrets are excluded from project records.
- Use the owner-purchased domain with an A record for aibank.yfyckbkb.com pointing to the existing cloud server. Switch web/API and Android to that HTTPS domain and associate Passkeys without changing banking data or server credentials. Authorized October 4, 2026.
- Issue and renew the domain certificate using automated DNS-01 through a dedicated Spaceship DNS-read/write-only API key. Do not use port-80 standalone validation. API terms/key creation and private cloud provisioning were explicitly authorized October 4, 2026; port 80 is used only for ordinary HTTPS redirects.
- Use the official domestic AI problem explanation as the security baseline; AIR and banking/exchange patterns are engineering references. Preserve the owner's additional payment-factor and recovery requirements.
- Codex develops the backend; Claude Code develops the frontend afterward. Continue with one orchestrator and domain tools, without adding autonomous agents for comparison alone.
- Model inference uses API calls, with an OpenAI-compatible interface and DeepSeek for initial provider testing. Credentials remain external backend configuration; no local model deployment is requested.
- Target one complete competition submission; implementation steps do not imply separate planned product versions.
- Reuse a mature minimal agent framework, with Pi as the primary reference; suitable unchanged source reuse and limited banking/client/security adaptation are explicitly permitted by the owner. Preserve applicable attribution and notices.
- Every small transfer/payment must receive one fresh action-bound password, Passkey or Authenticator TOTP verification before execution; higher-risk transfers require distinct options. Session login or a confirmation click alone is insufficient.
- Support Passkey replacement when existing keys cannot be used on another device, using both the account password and SMS verification to the existing verified phone. Reference banking/exchange security patterns for authorization and recovery. Detailed recovery safeguards and proposed timing defaults are in SECURITY.md.
- The project directory is D:\Bank-AI-agent.
- Development may switch between Codex and Claude Code, using shared rules and handoff records.
- Use English for all project artifacts and communication between coding agents. Chinese is reserved for direct conversation between the project owner and Codex.

## Pending Confirmation

| Item | Current Status |
| --- | --- |
| Competition selection | Owner requested advice on the 2026 FinTechathon domestic AI track; participation and final product scope remain unconfirmed |
| Target users | Working baseline: retail banking customers; owner requested a concrete design using AIR as a reference |
| Primary business scenario and current pain point | Working baseline: daily banking tasks through conversation; three domains in DESIGN.md |
| Agent inputs, outputs, available tools, and human approval points | Backend schemas, shared response types and authorization flows implemented in API.md and contracts/backend.ts; English web client implemented in frontend/ (see frontend/README.md) |
| Data sources, sample materials, and accessible external services | Synthetic banking/merchant simulator baseline; official integration availability unverified |
| Model provider, budget, and runtime environment | API-only; DeepSeek deepseek-flash configured on the Docker cloud service; live balance-tool smoke passed. Broader evaluation and budget remain pending |
| Agent runtime foundation | Installed Pi Agent core/Pi AI 1.0.1; TypeScript/Fastify/Node >=24.19 with SQLite; loop and compatible HTTP transport tested |
| Authentication and recovery | Password/WebAuthn service, synthetic SMS outbox, epochs/holds and cryptographic software-authenticator tests implemented; browser ceremonies and real SMS remain unverified |
| Submission format | Official domestic AI requirements researched below; final upload details remain to be verified |

## Researched Competition Constraints

Verified on October 3, 2026 from the official [competition page](https://fintechathon.g-ican.com/#/) (domestic AI problem explanation) and [rules page](https://fintechathon.g-ican.com/#/rule). These are external competition constraints, not approved implementation commitments.

- Build a natural-language banking agent that plans and executes operations through an application or messaging channel. Cover at least three of six directions: transfers, bill analysis, investment operations, card management, subscription/direct-debit management, and cross-scenario workflows. The explanation explicitly calls the scenario table illustrative; it does not independently require every listed example within a selected direction.
- Scoring: task completion 40%, safety/compliance 30%, innovation and interaction experience 30%.
- Permission levels: green queries execute automatically; yellow operations require explicit confirmation; red operations require strong verification. The transfer boundary is daily cumulative amount: up to CNY 1,000 is yellow, above CNY 1,000 is red. Subscription query/cancellation and virtual-card application are listed as yellow; card loss reporting/restoration and investment purchase are listed as red.
- Security requirements include grounded account/transaction results, prompt-injection defense, auditable decisions and execution, circuit breaking, and isolation of generated code. Complex tasks require an ordered DAG, interruption, recovery, and human takeover.
- Teams must contain 2-5 full-time students eligible for the domestic track; each student may join only one team.
- Registration closes November 1, 2026; works are due November 2. Finalists are announced November 10; the on-site hackathon and defense run November 21-22. Dates follow China Standard Time (UTC+8); exact cutoff hours are unverified.
- Required: architecture/algorithm/security documentation, defense slides for a presentation of at most 10 minutes, source code with README/repository/deployment instructions/tests, and a security self-assessment with known risks. A video of at most 5 minutes is optional according to the rules page; the problem explanation also lists it among work materials. Prepare one and verify the upload requirements. The problem explanation requires a work introduction of at most 200 Chinese characters.
- Unverified: availability of an official banking sandbox/API, acceptance of a team-built simulator and authentication evidence (including our proposed user-verifying Passkey route), repository visibility rules, onsite change requirements, and expectations for generated-code isolation when generated-code execution is excluded.

The explanation was re-read in the rendered official domestic AI modal on October 3, 2026. Detailed evidence, design gaps, and recommendations are in [AIR_GAP_REVIEW.md](AIR_GAP_REVIEW.md). Recommendations do not independently expand confirmed product scope.

The owner subsequently requested a concrete AIR-informed design, mature agent-framework reuse and backend development. [DESIGN.md](DESIGN.md) defines the implemented transfer, bill-analysis and subscription baseline; card loss reporting/restoration remains optional and unimplemented. Pi is the selected runtime foundation. Frontend and production integration choices remain open. See [PI_INTEGRATION.md](PI_INTEGRATION.md).

## Acceptance Criteria

Acceptance criteria for the design baseline. Backend coverage is implemented and tested as documented in API.md/HANDOFF; client, live DeepSeek and production integrations remain unverified:

1. The customer can analyze bills, prepare/execute an immediate simulated transfer, and manage a seeded subscription through English conversation in a banking client.
2. Ambiguity produces clarification; a structured DAG orders dependencies and pauses for required confirmation or verification.
3. Backend tools provide grounded monetary totals, enforce customer isolation, and prevent expired/changed/replayed approval, cumulative-limit bypass, and duplicate ledger writes.
4. Results include verifiable receipts. Unknown outcomes are reconciled; interruption, cancellation, partial completion, and restart preserve truthful state.
5. Reproducible synthetic-data demonstration and a versioned evaluation set cover normal, security, and failure cases in DESIGN.md.
6. Each transfer/payment rejects missing, stale, or mismatched factor proof. Actual WebAuthn assertions and account-password verification are designed in SECURITY.md; red-risk password fallback also requires an action-bound second factor.
7. Credential recovery uses two other enrolled options when available, or one available backup with its safeguards when enrollment is incomplete. Replacement invalidates affected keys/sessions/approvals. Normal verified recovery has no automatic financial hold; restrictions require an actual risk signal. Another working/synchronized key can avoid reset.
8. All supported banking and credential operations can be triggered by the single Agent; only protected client forms accept identity proof and new credentials. No-backup/signed-out identity review requires an explicitly scoped integration.

No real banking operations, generated-code execution, trained proprietary model, or provider retention guarantees are included in this baseline. The Android client packages the shared web UI as requested by the owner; setup and verification limits are in ANDROID.md. The backend performs actual password and WebAuthn signature verification; real-device behavior, production assurance and real SMS delivery remain unverified. Banking/SMS test adapters must remain visibly distinguished from real integrations. Structured evidence is exposed instead of unsupported model financial prose; model task quality and fuller natural-language explanations require evaluation.

See [SECURITY.md](SECURITY.md) for client flows, factor eligibility, recovery states, and authentication acceptance cases. This security requirement does not itself add a merchant-payment product to the current feature scope.

## Scope Management

Mark whether new requirements have been confirmed by the user. Keep unresolved features as candidates rather than expanding development scope. Maintain explicit project features, scope boundaries, and acceptance criteria for the complete competition submission.
