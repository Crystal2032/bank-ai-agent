# Bank AI Web Client

English single-page client for the simulated banking assistant. React 19, Vite 8 and TypeScript; browser Passkeys use `@simplewebauthn/browser`. UI owner: Claude Code; Android packaging/adapters: Codex. The backend contract is in [../docs/API.md](../docs/API.md) and [../contracts/backend.ts](../contracts/backend.ts).

The cloud web/API endpoint is https://aibank.yfyckbkb.com. Security center now includes the owner-requested Authenticator TOTP binding, one-time recovery codes and removal/recovery flows, shared with Android. Login remains password-only. See [AUTHENTICATOR.md](../docs/AUTHENTICATOR.md) for API sequencing, retained SMS simulation and device-test limits.

## Run

Requires Node >=24.19 and pnpm. Start the backend first (`pnpm dev` in the repository root), then:

```powershell
cd frontend
pnpm install --frozen-lockfile
pnpm dev        # http://localhost:5173
```

Open the client at `http://localhost:5173`, not `127.0.0.1`: the session cookie is SameSite=Strict and the API is `http://localhost:3001`. To point at another API origin, copy `.env.example` to `.env` and set `VITE_API_ORIGIN`; the backend's CLIENT_ORIGIN and RP_ID must match the client address. Only browser-safe values belong in this file.

Sign in with the synthetic usernames `alex` or `jordan` and the DEMO_PASSWORD from the root `.env`. The password is never embedded in the client. SMS codes are written to the backend's local test outbox (`.data/sms-outbox.jsonl`) when `SMS_MODE=file`; the client never displays them.

## Android

The same screens are packaged into an Android 9+ APK with Capacitor 8.5.2. Run `pnpm android:build` here with JDK 21 and Android SDK 36 configured. The APK is copied to `../artifacts/android/bank-ai-debug.apk`. No Vite server is needed on the phone. Run `pnpm start:android` at the repository root after building the backend, then connect it through `adb reverse tcp:3001 tcp:3001`. See [Android setup](../docs/ANDROID.md) for installation, HTTPS builds and domain-associated native Passkeys. Local debug Passkeys remain disabled until a verified RP domain is configured; password and action-bound SMS use the shared security flows.

## Checks

```powershell
pnpm typecheck   # tsc, including ../contracts/backend.ts
pnpm test        # vitest: money parsing/formatting, bank months, API client CSRF/401/outage handling
pnpm build       # typecheck + production bundle with a strict Content-Security-Policy
pnpm preview     # serve the production build on http://localhost:5173
```

## Screens

| Route | Purpose |
| --- | --- |
| Overview | Balance, profile, pending actions, recent transactions |
| Assistant | Pi conversation with paginated server history across login/devices, restored customer messages and structured evidence, clarification, action cards, stop/takeover/release and polling |
| Payments | Exact-contact transfer form with integer minor-unit preview, and every action card |
| Transactions | Ledger history with search, direction filter and receipt lookup for outgoing operations |
| Bills | Monthly report with category totals, evidence transaction links, recurring/unusual candidates |
| Subscriptions | Confirmed lookup, then separately reviewed merchant cancellation or debit-mandate revocation |
| Security | Shared protected SecurityOperation, password/Passkey/TOTP management, adaptive recovery, actual risk restrictions |
| Activity | Sanitized append-only audit log |

## Behaviour Rules

- `credentials: 'include'` on every request; the CSRF token lives only in memory and is replaced by rotated tokens from enrollment, recovery and Passkey removal. A `CSRF_REJECTED` response refreshes the token through `/api/auth/me` and retries once (the server rejects before running the handler).
- 401 returns to sign-in. 403/409/423 on action operations refresh the action state. A network failure is a "lost response": action execution re-reads `GET /api/actions/:id` and retries only the same action ID; preparation retries reuse the same idempotency key.
- One idempotency key per customer intent; editing the transfer form generates a new key.
- Transfers: confirm the exact version, then choose password/Passkey/TOTP; higher-risk transfers need distinct options, with password/SMS fallback for password-only enrollment. A rejected Passkey is reported and never silently downgraded. After authorization the client executes immediately. `RISK_UPGRADED` reopens verification.
- Success is shown only from `SUCCEEDED` plus a fetched canonical receipt. `RECONCILING` is shown as not final and cannot be cancelled.
- Model prose is never rendered. The assistant feed shows only canonical task events and live action cards.
- Conversation history uses customer-owned persistent GET /api/tasks summaries and RUN_STARTED.data.customerMessage. The shared screen restores accepted messages and verified results across login/devices; browsing never starts a run or authorizes an operation. Only the customer-scoped selected task ID is newly saved in sessionStorage, cleared on sign-out/session loss. Legacy local message caches remain read-only compatibility data, without duplicate durable messages. See docs/API.md and docs/FRONTEND_HANDOFF.md.

## Known Gaps

- Served response types, including health, account envelopes, Passkey metadata/options, enrollment results, audit and task events, now live in `contracts/backend.ts`. `src/api/types.ts` re-exports them and retains client helpers. WebAuthn imports in the shared file are type-only and do not bundle server runtime code.
- The backend review fixed stale release responses. The client still defensively re-reads the task after control calls.
- Verified in headless Chrome with a virtual authenticator only. Real platform/roaming authenticators, Safari/Firefox, live DeepSeek output and production HTTPS origins are untested.
