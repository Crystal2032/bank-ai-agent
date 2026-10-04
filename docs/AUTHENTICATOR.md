# Authenticator and Backup Verification

The owner confirmed password-only login, alternative password/Passkey/TOTP verification for small transfers, two available backup options when recovering one credential, adaptive recovery for incomplete enrollment, and no routine funds waiting period. All supported banking and credential operations can be initiated through the single Pi Agent. Proofs are entered only in protected client forms, never in chat or model tools.

## Operation Policy

Small transfers require one fresh action-bound password, user-verifying Passkey or TOTP proof. Daily projected transfers above CNY 1,000 require two distinct options. Repeating the same option does not count twice. Password plus original-phone SMS remains the higher-risk fallback when neither TOTP nor a Passkey is enrolled. This preserves the competition risk boundary; organizer acceptance of specific factors remains open.

Adding an option requires one existing verified option. Replacing/removing TOTP, recovering/revoking Passkeys, or resetting a password excludes the affected option and requires two other enrolled options where present. If only one backup is enrolled, that option is accepted; the password route includes registered-phone SMS for credential management and counts as one backup option. No caller can choose a lower count. Removing then adding a credential cannot bypass this policy. With no enrolled backup, the UI explains that operator-assisted identity recovery is required; the prototype does not fabricate an identity-review provider.

Credential changes rotate the security epoch/session and invalidate pending approvals/proofs. Normal verified recovery/removal has holdUntil=0. Only five or more recorded factor failures within five minutes trigger the configured abnormal-risk restriction (RECOVERY_HOLD_MS, currently 24 hours) after recovery; this is not a routine waiting period. Known account locks remain enforced. Real SIM/device/review/notification integrations are unavailable.

## Binding and Storage

SecurityOperation renders a local QR/manual setup key after credential-purpose verification. Compatible apps use standard SHA-1, six digits, 30-second periods and a random 160-bit secret. A valid generated code activates the credential; setup expires after five minutes. Replacement retains the old credential until successful activation. Eight random 80-bit offline recovery codes appear once; save them privately. Password plus an unused offline code can remove a lost Authenticator; these codes cannot authorize transfers.

OTPAuth 9.5.2 implements RFC 6238. Accepted counters are durable and strictly increasing across purposes; allow at most +/- one step. Five failed guesses in five minutes exhaust a durable account-wide TOTP budget. AES-256-GCM encrypts seeds with random nonces and customer AAD, using an HKDF-derived AUTH_SECRET key. Recovery codes are stored as keyed hashes. Preserve AUTH_SECRET with private database backups. Status/audit/tasks contain no usable seeds, codes or proof tokens. QR rendering uses qrcode 1.5.4 locally.

## Agent and Client Sequence

1. Pi uses read_security_options and prepare_security_operation to prepare a scoped, idempotent request, with an exact owned key target for revocation. No credential changes occur during planning.
2. Assistant displays SECURITY_REQUEST and opens the shared SecurityOperation modal. The server policy supplies enrolled backup methods/count. Password/SMS, TOTP and cryptographic Passkey proofs are customer/session/epoch/purpose/target bound, single-use and expire after two minutes.
3. Once enough proofs are supplied, the client continues automatically. Passkey registration invokes the device prompt; TOTP enrollment requires scanning/activation; password reset requests the new password only in the protected form.
4. Session rotation updates the cookie and CSRF. Completion requires authoritative credential audit evidence newer than request creation's audit sequence; a model claim cannot complete it. A lost completion acknowledgement can be retried independently. Stop cancels pending security requests and leaves completed changes recorded.

Manual Security-center entry uses exactly the same protected component/policy. Signed-in password reset is implemented. Signed-out forgotten-password recovery with no usable session/backup requires an external identity-review integration and is not implemented. SMS is the private synthetic outbox, never a delivered-text claim or an HTTP code endpoint.

## Dedicated Endpoints

| Endpoint | Purpose |
| --- | --- |
| GET /api/security/authenticator | Safe enabled/recovery-code count |
| GET /api/security/verification/policy?operation=OP | Server-selected available methods/count |
| POST /api/security/verification/password/start | operation, optional target, password; credential-purpose SMS |
| POST /api/security/verification/password/verify | challengeId, code; returns proofId/expiresAt |
| POST /api/security/verification/totp | operation, optional target, current code; proofId/expiresAt |
| POST /api/security/verification/passkey/options | operation, optional target; assertion options |
| POST /api/security/verification/passkey/verify | challengeId, assertion response; proofId/expiresAt |
| POST /api/security/authenticator/setup-with-proof | proofIds; protected secret/URI/challenge |
| POST /api/security/authenticator/verify | challengeId, current code; rotated session and offline codes |
| POST /api/security/authenticator/remove | proofIds; removal and rotated session |
| POST /api/security/authenticator/recover | password, recoveryCode; offline-code loss fallback |
| POST /api/security/password/reset | proofIds, newPassword (12..256 characters) |
| POST /api/security/passkeys/enrollment/options | proofIds; normal registration options |
| POST /api/security/recovery/options | proofIds; replacement registration options |
| POST /api/security/passkeys/revocation/verify | proofIds, credentialId; exact-key removal |
| POST /api/actions/:id/verify/totp/options | Independent action-bound TOTP challenge |
| POST /api/security/payment/totp/verify | challengeId, code; waiting or authorized action |
| GET /api/security/requests/:id | Owned canonical request |
| POST /api/security/requests/:id/complete | {}; authoritative completion only |

Operations: TOTP_SETUP, TOTP_REMOVE, PASSKEY_ENROLL, PASSKEY_RECOVER, PASSKEY_REVOKE, PASSWORD_RESET. Request schemas are in /api/contract, response types in contracts/backend.ts. Legacy password/SMS enrollment and Passkey recovery remain where the server backup policy allows them; legacy password-only TOTP removal is rejected. The frontend uses proofIds flows.

## Verification Scope

Tests cover published RFC vectors, encryption/non-exposure, unchanged login, independent small-payment factors, distinct high-risk factors/legacy grant invalidation, adaptive recovery, wrong-purpose/session/replay checks, removal-bypass rejection, signed-in password reset, ordinary no-hold and abnormal-risk restrictions, restart budgets and actual Pi preparation/completion/stop boundaries. Transport tests and web/Android compilation do not prove real device ceremonies. Cloud accounts are not automatically enrolled. Real SMS/banking, authenticator scanning, Android installation and browser/native Passkey ceremonies remain unverified.

References: [RFC 6238](https://www.rfc-editor.org/rfc/rfc6238), [OTPAuth](https://github.com/hectorm/otpauth), [qrcode](https://github.com/soldair/node-qrcode), [NIST SP 800-63B](https://pages.nist.gov/800-63-4/sp800-63b.html). TOTP is susceptible to phishing; Passkeys retain origin binding.
