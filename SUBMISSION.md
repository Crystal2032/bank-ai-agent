# Source Submission

This package contains the current Bank AI Agent backend, shared React web client, Capacitor Android project, tests, locked dependencies and deployment templates. Start with this guide; [README.md](README.md) and [docs/DESIGN.md](docs/DESIGN.md) describe the implementation and architecture.

## Scope

- One Pi Agent with API-only inference through an OpenAI-compatible provider; DeepSeek is the testing provider.
- Simulated banking: account balances, transfers, bills and subscriptions, with deterministic authorization/execution and receipts.
- Password, Passkey and Authenticator TOTP verification; adaptive credential recovery through protected client forms.
- Server-persisted, customer-isolated conversation history shared by web and Android.
- Docker/Nginx deployment templates and DNS-01 ACME renewal configuration.

Banking data and transactions are synthetic. SMS uses a local test outbox, and real bank/SMS integrations are not included. Native credential-provider behavior still requires device testing. The source package contains no live model keys, login passwords, certificates, private signing keys or existing account database.

## Run Locally

Requires Node.js >=24.19 and pnpm 11.19. Install dependencies using the included lockfiles; dependencies are not bundled in this archive.

From the extracted project directory:

```sh
pnpm install --frozen-lockfile
pnpm setup:demo
pnpm dev
```

The setup command creates a local .env with newly generated synthetic login credentials and refuses to overwrite existing configuration. Read DEMO_PASSWORD from that local file and sign in as alex or jordan. Add your own MODEL_API_KEY to .env for AI inference. Provider base URL/model are configured there; secrets remain on the backend. Without an API key, banking screens still work and model requests explicitly report that inference is not configured.

In a separate terminal:

```sh
cd frontend
pnpm install --frozen-lockfile
pnpm dev
```

Open http://localhost:5173. The backend listens on http://localhost:3001. Use localhost consistently for browser cookie behavior.

## Checks and Builds

Backend, from the project root:

```sh
pnpm typecheck
pnpm test
pnpm build
```

Frontend, from frontend/:

```sh
pnpm typecheck
pnpm test
pnpm build
```

For Android, install JDK 21 and Android SDK platform/build tools 36, configure JAVA_HOME and ANDROID_HOME, then run pnpm android:build inside frontend/. Capacitor sync regenerates the excluded web assets and plugin intermediates. [docs/ANDROID.md](docs/ANDROID.md) explains USB development, HTTPS configuration and domain-associated Passkeys. The Gradle wrapper is included; machine-specific SDK paths and signing material are not.

## Package Contents

- src/, contracts/, tests/ and scripts/: backend implementation, shared contracts, regressions and launch/setup utilities.
- frontend/src/, frontend/tests/ and frontend/android/: shared UI, tests and native shell sources/resources.
- Dockerfile, deploy/ and environment examples: deployment configuration templates with placeholder credentials.
- docs/: requirements, architecture, security, API, attribution, deployment and actual verification records.
- SOURCE_MANIFEST.json: SHA-256 and byte count for every packaged source file, excluding the manifest itself.

See [docs/PI_INTEGRATION.md](docs/PI_INTEGRATION.md) for Pi reuse and attribution. Application dependencies are declared in package manifests and resolved by lockfiles; their upstream licenses continue to apply.

Excluded content: .env and live environment files, .data and runtime databases, node_modules, compiled frontend/backend output, APKs, local tools/caches, generated Android assets, IDE settings, Git metadata, certificates and signing keys. Existing demonstration data is generated afresh by application startup; no deployed customer history or transaction database is shipped.
