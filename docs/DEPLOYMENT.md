# Cloud Deployment

The owner authorized Docker deployment on the supplied Ubuntu server, DeepSeek API configuration, ACME-issued TLS and an Android build pointing to the cloud. The owner subsequently authorized switching to aibank.yfyckbkb.com. The public application is [https://aibank.yfyckbkb.com](https://aibank.yfyckbkb.com). Banking remains synthetic; SMS uses the private server test outbox. This is a competition demonstration, not a real banking integration.

## Layout and Configuration

The server installation is in /opt/bank-ai/. The repository's Dockerfile builds the existing backend with Node 24.19.0 and pnpm 11.19.0. Only compiled backend code and production dependencies enter the runtime image. It runs as the non-root node user, with a read-only root filesystem and a writable persistent /data mount. No model key, password, database or certificate enters the build context/image.

deploy/compose.yaml defines the backend and Nginx 1.30.5 edge. Only Nginx exposes ports 80/443; port 3001 is private to the Compose network. Nginx serves the shared frontend and proxies /api/ and /health. The frontend is built with VITE_API_ORIGIN=https://aibank.yfyckbkb.com. Backend requests accept the same HTTPS web origin and the exact bundled Android origin, https://localhost. Cookie, CSRF, ownership and transaction verification policies remain enforced.

backend.env is a server-only file with mode 600. deploy/backend.env.example documents its public settings. AUTH_SECRET and DEMO_PASSWORD are generated independently for the cloud installation; MODEL_API_KEY is provisioned through encrypted SSH. Credentials are not committed or printed. The owner's local .env and banking database were preserved. The cloud demonstration password is available in the ignored, access-restricted local .tools/cloud-access.env and server cloud-access.env; do not publish these files. Synthetic usernames remain alex and jordan.

TRUST_PROXY_HOPS=1 is enabled only for the isolated backend. Nginx replaces incoming forwarding headers with the actual peer address, and the backend trusts exactly one hop so rate limits distinguish clients. Leave it at 0 for direct development access. Do not publish the backend port or enable unrestricted proxy trust.

## Build and Update

The deployed directory has app/ (backend build context), web/ (compiled frontend and APK downloads), data/ (SQLite/WAL and synthetic SMS outbox), tls/, acme/ (pinned client source) and acme-dns/ (private DNS-01 account/configuration). The old challenges/ directory and read-only bind mount remain unused for historical rollback; Nginx no longer exposes an HTTP challenge route. Upload only the backend source/manifests/Dockerfile/.dockerignore to app/, and compiled frontend assets to web/. Keep server credentials and persistent data outside source archives.

Run on the server after uploading an authorized update:

```sh
cd /opt/bank-ai
docker compose config --quiet
docker compose build backend
docker compose up -d
docker compose exec -T edge nginx -t
docker compose exec -T edge nginx -s reload
docker compose ps
curl --retry 6 --retry-delay 2 --retry-all-errors --fail https://aibank.yfyckbkb.com/health
```

Reload Nginx after recreating the backend, so its upstream address is refreshed. Each container restarts unless explicitly stopped; Docker is enabled at boot. Logs rotate with bounded size. Container memory limits are 384 MiB for the backend and 64 MiB for Nginx. The observed steady-state footprint after testing was approximately 51 MiB plus 3 MiB; this is not a load/capacity benchmark.

The SQLite bind mount survives container replacement. Keep backups together with backend.env and certificate/ACME account state in a private location. For a consistent offline snapshot, stop only the backend and archive data/ before restarting it; never use docker compose down --volumes as a backup step. No automated backup or restore rehearsal has been configured.

## Domain DNS, ACME Certificates and Renewal

Spaceship hosts the unchanged authoritative nameservers launch1.spaceship.net and launch2.spaceship.net. The A record has host aibank, value 38.55.104.33 and TTL 300 seconds. External DNS resolution passed. HTTP requests, including the former challenge path, redirect to the canonical domain. Direct IP/unknown-host HTTPS handshakes are rejected. Old IP-connected Android clients must install the domain-connected APK.

The owner authorized accepting Spaceship API terms and creating the dedicated Bank AI ACME DNS key. It uses Custom access with DNS Records Read/Write only; domain billing, transfer, contacts, Async Operations, Hyperlift and SellerHub permissions are disabled. These are provider DNS-record scopes, not a documented single-host restriction. The root-private /opt/bank-ai/dns-api.env (mode 600) supplies SPACESHIP_API_KEY and SPACESHIP_API_SECRET; deploy/dns-api.env.example contains placeholders only. The application containers do not mount this file or the private ACME account. The temporary local provisioning copy was removed after server verification.

The canonical domain uses an EC-256 Let's Encrypt tlsserver certificate in tls/domain/. An actual DNS-01 issuance on October 4, 2026 added _acme-challenge.aibank.yfyckbkb.com through the Spaceship API, verified public TXT propagation, completed CA validation and deleted the TXT record. A separate private ACME account/configuration in acme-dns/ prevented reuse of the previous HTTP authorization. The installed certificate has DNS SAN aibank.yfyckbkb.com, issuer YE1 and validity October 4 at 08:32:38 UTC to November 18, 2026 at 08:32:37 UTC. Its persisted days=20 policy schedules the initial renewal for October 23 at 09:31:10 UTC. These dates describe this issuance; future certificates will have different dates.

The deployed acme.sh source remains pinned to upstream commit 807da6498377ee5e0cf43a78091f46f12dc59a89, using its official dns_spaceship plugin. No standalone challenge server or HTTP challenge route is active. Port 80 serves ordinary HTTPS redirects only and is not needed for issuance/renewal. DNS-01 cannot validate IP addresses, so old HTTP domain/IP renewal entries were removed without deleting their archived certificate files. See [Let's Encrypt challenge types](https://letsencrypt.org/docs/challenge-types/) and the [official acme.sh Spaceship plugin guidance](https://github.com/acmesh-official/acme.sh/wiki/dnsapi2#182-use-spaceship-dns-api).

For authorized issuance/install maintenance, load the private environment without printing it:

```sh
umask 077
set -a
. /opt/bank-ai/dns-api.env
set +a
/opt/bank-ai/acme/acme.sh --issue --home /opt/bank-ai/acme \
  --config-home /opt/bank-ai/acme-dns --server letsencrypt \
  --dns dns_spaceship --cert-profile tlsserver --days 20 \
  --keylength ec-256 -d aibank.yfyckbkb.com
/opt/bank-ai/acme/acme.sh --install-cert --ecc --home /opt/bank-ai/acme \
  --config-home /opt/bank-ai/acme-dns -d aibank.yfyckbkb.com \
  --key-file /opt/bank-ai/tls/domain/privkey.pem \
  --fullchain-file /opt/bank-ai/tls/domain/fullchain.pem \
  --reloadcmd 'cd /opt/bank-ai && docker compose exec -T edge nginx -t && docker compose exec -T edge nginx -s reload'
```

Keep dns-api.env, acme-dns/account.conf and private keys at mode 600, with the account directory mode 700. The install hook validates Nginx before reloading it. deploy/bank-ai-acme.service and deploy/bank-ai-acme.timer are installed; the boot-enabled hourly timer runs only the new DNS configuration and loads the private EnvironmentFile. A post-check fails the service if the installed domain certificate has fewer than 48 hours remaining. Actual DNS issuance, TXT cleanup, installation/reload and a no-renewal-needed service run passed (Result=success, ExecMainStatus=0). Future scheduled renewal has not yet occurred.

Pre-migration domain certificates, Nginx, Compose and service copies are preserved privately in /opt/bank-ai/snapshots/dns01-migration/. Restore the old service/configuration only as an intentional rollback; it would restore HTTP challenge dependence.

Inspect renewal and expiry on the server:

```sh
systemctl list-timers bank-ai-acme.timer
systemctl status bank-ai-acme.service
journalctl -u bank-ai-acme.service --no-pager -n 30
openssl x509 -in /opt/bank-ai/tls/domain/fullchain.pem -noout -issuer -dates -ext subjectAltName
```

## Android and Passkey Configuration

Download the [cloud-connected APK](https://aibank.yfyckbkb.com/downloads/bank-ai-cloud.apk). It packages the same frontend, targets the HTTPS cloud API and needs neither USB forwarding nor a Vite server. It is signed with the existing development certificate for installation/testing. A production signing key/store release was not created. The local build output and checksum are in artifacts/android/. The current update is version 1.0.5 (versionCode 6), 11,948,277 bytes; SHA-256 b043a0424ab1dd27a5451a0ff104696225637cee2915da643a8118718a71007e. Rebuild using ANDROID.md with VITE_API_ORIGIN=https://aibank.yfyckbkb.com and VITE_ANDROID_PASSKEY_RP_ID=aibank.yfyckbkb.com.

CLIENT_ORIGIN=https://aibank.yfyckbkb.com and RP_ID=aibank.yfyckbkb.com are set on the backend. ANDROID_CERT_SHA256 pins the existing development signer; deploy/assetlinks.json associates that signer and com.bankai.assistant with the domain. Nginx serves the association endpoint as HTTP 200/application/json; the APK includes the corresponding manifest metadata/include resource. Browser and Android adapters can now use the domain RP. Actual device credential-provider registration, authorization and recovery still need phone tests. Higher-risk password-only enrollment retains action-specific SMS, currently available only in the private synthetic outbox. See the [WebAuthn origin/domain requirement](https://www.w3.org/TR/webauthn-3/#relying-party-identifier) and [Android domain association requirements](https://developer.android.com/identity/credential-manager/prerequisites). No factor is bypassed or simulated as a biometric approval.

## Authenticator Update

The shared frontend includes Authenticator binding/removal/recovery. Login remains password-only; small transfers choose password/Passkey/TOTP, recovery uses available backups and normal recovery has no funds waiting period. See [AUTHENTICATOR.md](AUTHENTICATOR.md) for factor selection, Agent-triggered protected flows, encrypted seed storage and conditional risk restrictions. Existing cloud accounts are not automatically bound. Preserve AUTH_SECRET with private database backups; it also derives the TOTP encryption key.

Before the update, the backend alone was stopped briefly for a consistent data archive in /opt/bank-ai/snapshots/authenticator-update/data.tar.gz (mode 600) and restarted. The previous image is tagged bank-ai-backend:before-authenticator. Backend image rebuilt; the existing SQLite mount, external credentials and domain certificate were retained. The first immediate post-recreation curl preceded service readiness; subsequent externally validated health/login/data checks passed. No balance mutation or new model call was needed for this update.

## Verified Scope

- Backend typecheck/build and 33 tests passed in the security deployment; the subsequent conversation-history update passed frontend typecheck, 35 tests, two backend history/restart regressions, HTTPS bundle and Android build.
- The Docker image built and the backend health check passed. TLS chain/hostname validation succeeded from outside the server without disabling certificate validation.
- scripts/cloud-smoke.mjs exercised HTTPS authentication, secure HttpOnly/SameSite cookies, CSRF, origin/tenant restrictions, blocked unverified execution, password approval, a CNY 1.00 synthetic transfer and receipt/idempotency. It then ran a real DeepSeek task that returned ACCOUNTS evidence and completed. This changed only the fresh cloud synthetic database.
- Restarting the backend preserved the smoke-test receipt and database. Certificate installation/reload and the hourly service passed. APK signature, HTTPS endpoint, native configuration, shared assets and SHA-256 were checked.
- Domain migration also passed external DNS/TLS, canonical redirects, shared index/security headers, Digital Asset Links, public APK checksum and both browser/native-origin login checks. The pre-migration balance, receipt and completed model task persisted after backend recreation; no additional transfer was made. Private pre-migration configuration/certificate copies are in /opt/bank-ai/snapshots/domain-migration/.
- After DNS-01 migration, .tools/domain-check.mjs passed externally validated domain TLS, HTTP redirects including the removed challenge path, rejected direct-IP TLS, health, unchanged public APK/Digital Asset Links and browser/native-origin login/data preservation. The DNS certificate itself was issued through a real provider API challenge; automatic future renewal remains unobserved.
- The conversation-history update changed only shared frontend assets and APK 1.0.5. Live API checks passed pagination/isolation/durable messages without new runs or operations; browser checks passed list/selection/reload and sign-out/re-login retention. Internal Pi transcripts stay private. Existing bank data and the user's pending transfer were preserved, and no model call/transfer was made by this update. A private index snapshot supports frontend rollback; older hashed assets are retained for already-open clients.
- An enuma Android 16 device is attached but the app is not installed; actual Android TLS/cookie/session behavior, credential providers and native Passkeys remain unverified. No real SMS or banking transaction occurred. Browser rendering, load testing, host reboot and backup restore were not exercised.

The smoke script requires an external credentials file and writes one CNY 1.00 synthetic transfer per run; do not rerun it casually against a demonstration account. It prints sanitized results, never passwords, API keys or cookies.
