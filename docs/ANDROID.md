# Android Client

The cloud-connected APK is now available at [the HTTPS download endpoint](https://aibank.yfyckbkb.com/downloads/bank-ai-cloud.apk) and artifacts/android/bank-ai-cloud.apk. It connects directly to the cloud and needs no USB forwarding. See [DEPLOYMENT.md](DEPLOYMENT.md) for credentials, domain TLS and security limits. The current APK is version 1.0.5 (versionCode 6), signed with the same development certificate and configured for the aibank.yfyckbkb.com Passkey RP. It was rebuilt at the owner's request after DNS-01 migration; old published/local packages were replaced and the redundant debug artifact removed. Install this update over the previous app. The USB instructions below describe a local build; run pnpm android:build with its default API origin to regenerate that configuration.

The Android application packages the same React/Vite frontend as the web client using Capacitor 8.5.2. Source screens, styles, contracts and banking flows stay in frontend/src/. Native code is limited to the Android shell, private-cookie HTTP transport and an Android Credential Manager Passkey adapter. It is not a separate React Native or Kotlin UI implementation.

## Local USB Demonstration

The debug APK uses http://localhost:3001 through adb reverse. Its UI assets are inside the APK; no Vite server is needed. The backend/model API still runs on the computer, and AI credentials never enter the app.

Start the backend from the repository root:

```powershell
pnpm build
pnpm start:android
```

This launcher enables only the packaged https://localhost client origin, without modifying .env. The existing web origin stays available. Connect an Android 9+ phone with USB debugging enabled, then:

```powershell
adb devices
adb -s DEVICE_SERIAL reverse tcp:3001 tcp:3001
adb -s DEVICE_SERIAL install -r artifacts/android/bank-ai-debug.apk
```

Replace DEVICE_SERIAL with the selected device. Reapply the port reverse after reconnecting/rebooting. Open Bank AI Assistant, sign in with the externally provisioned synthetic account and use the same web banking screens. The debug build permits plaintext only for loopback hosts; LAN HTTP is rejected. With no backend connection, the existing offline UI appears. A debug APK is developer-signed and is not a production release.

## Rebuild from Shared Frontend

Requires Node >=24.19, pnpm, JDK 21, Android SDK platform 36 and Android build tools. Set JAVA_HOME and ANDROID_HOME for the build shell; do not store machine paths or signing secrets in Git.

```powershell
cd frontend
pnpm install --frozen-lockfile
pnpm android:build
```

The command builds the shared frontend, syncs its assets/plugins into Android, invokes Gradle and copies the debug APK plus SHA-256 file into artifacts/android/. Generated assets, native build output, local tools and signing files are ignored. Android source/build scripts and the frontend lockfile are retained. Web-only builds still use pnpm build and pnpm dev.

For a remote build, set VITE_API_ORIGIN to the backend's HTTPS origin. The release build rejects loopback plaintext and produces an unsigned artifact that must be signed through an owner-approved release process:

```powershell
$env:VITE_API_ORIGIN = 'https://aibank.yfyckbkb.com'
$env:VITE_ANDROID_PASSKEY_RP_ID = 'aibank.yfyckbkb.com'
pnpm android:build
# Use -- --release only with an authorized signing/release workflow.
```

Configure the remote backend with secure cookies and HTTPS, plus ANDROID_CLIENT_ORIGIN=https://localhost. No remote backend, domain, release key or deployment is provisioned by building the app.

## Security and Passkeys

Browser fetch remains unchanged. Android uses Capacitor's native HTTP API/private cookie manager with the bundled origin; the adapter passes the current CSRF token, disables redirects and removes transport/cookie headers before returning application responses. The backend explicitly opts in to the exact Android origin and retains ownership, CSRF, action-bound factors, risk and recovery checks. Android's native cookie transport is necessary because the bundled UI and a remote API are different sites; cookie/factor rules are not weakened on the web.

The shell disables backup and SDK logging, blocks cleartext in release builds, blocks screenshots through FLAG_SECURE, handles the hardware Back button and uses native system-bar insets. No camera/SMS/storage permission or root integration is added. SMS remains the backend's local test outbox, not on-device reading or real delivery.

Native Passkeys use AndroidX Credential Manager 1.5.0. A real HTTPS relying-party domain must be associated with the application's package and signing certificate via Digital Asset Links. Configure:

- Build: VITE_ANDROID_PASSKEY_RP_ID set to the real RP domain.
- Backend: RP_ID set to the same domain, ANDROID_CLIENT_ORIGIN=https://localhost and ANDROID_CERT_SHA256 set to the app signing certificate SHA-256 fingerprint (hex, optionally colon-separated).
- Domain: serve .well-known/assetlinks.json with delegate_permission/common.get_login_creds, package_name=com.bankai.assistant and the exact certificate fingerprint. See [Android's association instructions](https://developer.android.com/identity/credential-manager/prerequisites).

The native adapter rejects unexpected RP domains or missing required user verification. It returns Credential Manager's signed registration/assertion JSON to the existing bank verification endpoints; it never creates an approval itself. The backend accepts only the explicitly configured android:apk-key-hash certificate origin, alongside its existing web origin.

The cloud APK includes the asset_statements manifest metadata, an HTTPS Digital Asset Links include resource and the configured RP domain. The server publishes assetlinks.json with its development signing fingerprint; change both the backend and association file if a production signer is introduced. An enuma Android 16 phone is attached but the app has not been installed; actual native ceremonies and cross-device recovery remain unverified.

A default local USB build has no verified RP domain. Passkey creation/payment/recovery registration are therefore disabled with an explanatory message; fresh password verification remains available, and red password operations still require their action-specific SMS code. No simulated biometric check is substituted. Domain association, actual credential provider behavior, true cross-device recovery and native Passkey ceremonies need device/domain testing.

Primary references: [Capacitor Android](https://capacitorjs.com/docs/android), [native HTTP API](https://capacitorjs.com/docs/apis/http), [Android Credential Manager](https://developer.android.com/identity/credential-manager), and [native client origins](https://developer.android.com/identity/passkeys/create-passkeys).
