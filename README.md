# Bank AI Agent

An AI agent for a banking use case and an innovation competition.

The project targets one complete competition submission: an assistant embedded in a simulated retail banking application. The implemented backend uses TypeScript, Fastify, SQLite, Pi Agent core and Pi AI, with deterministic banking authorization/execution services. It supports immediate transfers, monthly bill analysis and subscription/mandate management. Model inference uses an OpenAI-compatible API; DeepSeek is the selected testing provider. Codex owns the backend; Claude Code owns the frontend, a React/Vite web client in [frontend/](frontend/README.md).

## Collaboration

Both coding tools work in this directory and read AGENTS.md. Before switching tools, the outgoing agent updates docs/HANDOFF.md. The incoming agent checks the handoff record, Git state, and relevant code before continuing.

Work sequentially by default. Use separate Git worktrees for parallel development and define task ownership and file scope first.

All project artifacts and communication between coding agents use English. Chinese is reserved for direct conversation between the project owner and Codex.

## Project Documents

| File | Purpose |
| --- | --- |
| [SUBMISSION.md](SUBMISSION.md) | Source submission contents, clean setup, checks and simulation scope |
| [AGENTS.md](AGENTS.md) | Shared development, language, and handoff rules |
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | Product requirements, competition constraints, and acceptance criteria |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Confirmed decisions, rationale, and pending technology choices |
| [docs/DESIGN.md](docs/DESIGN.md) | AIR-informed design baseline, execution boundaries, demo, and acceptance cases |
| [docs/PI_INTEGRATION.md](docs/PI_INTEGRATION.md) | Pi source review, reuse boundaries, integration semantics, and attribution |
| [docs/SECURITY.md](docs/SECURITY.md) | Transaction verification, Passkey lifecycle, recovery, and security acceptance cases |
| [docs/AUTHENTICATOR.md](docs/AUTHENTICATOR.md) | TOTP enrollment, protected operations and removal/recovery |
| [docs/AIR_GAP_REVIEW.md](docs/AIR_GAP_REVIEW.md) | Official requirement alignment, AIR engineering evidence, design gaps, and evaluation recommendations |
| [docs/API.md](docs/API.md) | Implemented endpoints, authorization/state sequencing and integration limits |
| [docs/FRONTEND_HANDOFF.md](docs/FRONTEND_HANDOFF.md) | Claude Code ownership, frontend screens, protected flows and integration checks |
| [contracts/backend.ts](contracts/backend.ts) | Browser-safe response interfaces |
| [docs/HANDOFF.md](docs/HANDOFF.md) | Current progress, verification results, and next actions |
| [docs/ANDROID.md](docs/ANDROID.md) | Shared-frontend Android APK, build, USB backend connection and Passkey setup |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Docker cloud service, domain TLS/renewal and cloud-connected Android client |

## Current Environment and Commands

Requires Node.js >=24.19 and pnpm 11.19 (validated locally). Pi Agent core and Pi AI are pinned to 1.0.1; dependencies are locked. The backend enforces fresh verification for transfers, yellow subscription confirmation, cumulative risk, immutable actions, session/epoch-bound grants, atomic ledger changes and receipts. SimpleWebAuthn verifies Passkey ceremonies; SMS uses a disabled or local synthetic outbox adapter. Banking is entirely simulated.

```powershell
pnpm install --frozen-lockfile
pnpm setup:demo
pnpm dev
```

The setup command creates an ignored .env with random synthetic credentials and refuses to overwrite an existing file. Synthetic login usernames: alex and jordan. Read DEMO_PASSWORD locally from .env; never commit it or place it in frontend code. The local SMS test outbox is ignored and has no HTTP endpoint.

Set MODEL_API_KEY in .env to enable AI calls. Defaults are MODEL_BASE_URL=https://api.deepseek.com and MODEL_ID=deepseek-flash, following the [official DeepSeek API documentation](https://api-docs.deepseek.com/) checked October 3, 2026. API configuration is server-only. Without a key, bank APIs work and task creation returns MODEL_NOT_CONFIGURED; no fake model is silently substituted. No local model deployment is used.

Browser API URL: http://localhost:3001 (server binds to 127.0.0.1). Allowed client origin: http://localhost:5173. Keep both browser URLs on localhost so SameSite=Strict cookies work. See FRONTEND_HANDOFF before changing the origin/RP ID. Health: GET /health. Machine-readable request schemas: GET /api/contract.

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

The automated suite includes the real Pi loop, an HTTP/SSE compatible-model test server, cryptographic software-authenticator fixtures, recovery, ownership/CSRF, cumulative risk, ledger rollback and restart/idempotency. These tests do not constitute live DeepSeek, real SMS, real bank, browser/device or production-security validation. Runtime limits and remaining integrations are in API.md.

Inspect the working state:

```powershell
git status --short --branch
git diff
```

Start the web client in a second terminal after the backend is running, then open http://localhost:5173:

```powershell
cd frontend
pnpm install --frozen-lockfile
pnpm dev
```

Frontend checks are `pnpm typecheck`, `pnpm test` and `pnpm build` inside frontend/. See [frontend/README.md](frontend/README.md).

Development source is in src/, tests in tests/, and ignored local state in .data/. Use pnpm start for the compiled backend after building. Do not run another development tool in the same checkout while this backend task is writing files.

## Next Step

The owner-authorized cloud deployment serves the web client and backend at [https://aibank.yfyckbkb.com](https://aibank.yfyckbkb.com). DeepSeek is configured server-side and a live balance task passed. See [DEPLOYMENT.md](docs/DEPLOYMENT.md) for Docker operations, private credentials, certificate renewal, verified scope and the cloud APK. The owner-controlled domain is configured as the web and Android Passkey RP; device ceremonies still need phone verification.

The Android shell in frontend/android/ packages the same web frontend. See [ANDROID.md](docs/ANDROID.md) for pnpm android:build, the APK location, adb reverse and verified-domain Passkey requirements. Start the local backend with pnpm start:android after building it; the packaged client uses no Vite server.

The web client is implemented in frontend/. Continue provider task evaluations, verify the cloud Android client on a phone, test domain-associated Passkeys and rehearse the end-to-end demonstration. Organizer acceptance, real SMS/notifications/review, provider privacy terms, and broader adversarial/model evaluations remain open. Future commits/pushes/deployments still require owner authorization.

The shared Assistant includes Conversation history: sign in, open the history button and select a saved conversation to restore accepted messages and verified results. History is persisted on the server and customer-isolated, so signing out or changing devices does not erase it. Opening a conversation does not resume planning or execute any operation; explicitly send a follow-up to continue an eligible task.
