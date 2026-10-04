# Authentication, Authorization and Credential Recovery

The October 4 owner policy supersedes earlier stacked-TOTP and routine recovery-hold proposals. [AUTHENTICATOR.md](AUTHENTICATOR.md) defines implemented flows, endpoints and test scope. Login stays username/password. Banking and SMS remain synthetic; cryptographic factor verification is real but is not regulatory certification.

## Effective Operation Policy

| Operation | Server requirement |
| --- | --- |
| Scoped balances, transactions, bills | Valid session and ownership |
| Small transfer | Exact review and one fresh password, Passkey with UV, or TOTP |
| Daily projected transfers above CNY 1,000 | Two distinct fresh options; password/SMS fallback if no other option enrolled |
| Subscription lookup | Explicit yellow confirmation |
| Subscription/mandate writes | Explicit confirmation; fresh factor when Authenticator is enrolled |
| Add security option | One existing verified option; password route includes registered-phone SMS |
| Replace/remove an option or reset password | Two other enrolled options where available; one if only one backup exists |
| No enrolled backup | Explain operator-assisted identity recovery; no unauthenticated reset shortcut |
| Normal verified recovery | Rotate sessions/epoch/approvals; no automatic funds waiting period |
| Verified recovery after repeated failed factors | Conditional risk restriction, enforced on every sensitive-write path |

The CNY 1,000 daily boundary includes pending reservations and completed transfers for the Asia/Shanghai day. Every transfer has fresh verification, exceeding yellow confirmation minimum. Organizer acceptance of Passkeys/TOTP as red factors remains open. Account locks still apply. Authentication establishes a session; transaction proof authorizes exactly one immutable action; credential-management proof cannot authorize money.

## Transaction and Credential Binding

Actions bind customer/session, recipient, integer minor-unit amount, currency, version/digest, dependencies and idempotency key. Review canonical details before fresh proof. Challenge/grant expiry is at most two minutes; SMS expires after five minutes without extending grant validity. Proofs bind security epoch and purpose; credential proofs also bind operation/target. Distinct fresh factors accumulate only in one session/epoch/action. At dispatch, recheck risk and grant factor count, including older persisted grants, ownership, restrictions, dependencies, reservations and balance. SQLite ledger/audit/receipt/action updates are atomic; repeated execution returns the same receipt.

Credential recovery excludes the recovered option. Password plus SMS counts as one backup option for recovery, so it cannot replace two other options on fully enrolled accounts. Removal follows the same backup policy to prevent delete-and-enroll bypass. Incomplete enrollment uses available backups without routinely locking funds. Successful changes invalidate old sessions and pending proofs/grants; pending money requires fresh review/verification, never replay. Five recorded failed factors in five minutes activate the configured abnormal-risk restriction after verified recovery. Real SIM/device risk and staffed review are not represented as checked.

## Passkeys and Protected Forms

SimpleWebAuthn verifies origin, RP ID, challenge, ceremony, ownership, public-key signature, user presence/verification and counters. Registration and assertion require UV; private keys, PINs and biometric templates remain with the provider. Synced or another working key can avoid unnecessary recovery. Normal addition preserves working keys; lost-key replacement revokes existing keys after valid registration. Revocation prevents server use but does not delete remote private keys. A WebAuthn popup does not independently display/sign the bank amount; application review and immutable server binding supply that boundary.

The domain RP is aibank.yfyckbkb.com. The bundled Android origin and exact signer are opt-in, backed by Digital Asset Links. Public association checks are not evidence of completed device ceremonies. Never silently downgrade a failed Passkey. Password/TOTP/SMS entry, provisioning QR and new-password input stay outside chat, request logs, model prompts and analytics. Seeds are encrypted; password hashes are salted; SMS/offline-code verifiers are keyed hashes. CSRF, strict origins, secure HttpOnly cookies, rotation, endpoint budgets and no-store responses remain enforced.

## Agent Boundary and Recovery Limits

One Pi Agent reads safe availability and prepares credential requests; protected client forms execute them after proof. No model tool verifies factors, changes credentials, waives counts, unlocks accounts or sees seeds/OTPs/new passwords. Completion follows fresh authoritative credential audit evidence; stop cancels pending requests. The shared executor guards manual/API actions too.

Password reset currently requires a signed-in session and available backups. No-backup/signed-out loss needs a separate identity-review integration; staff/KYC/SIM checks, external notifications and real SMS are unimplemented. Existing phone cannot be replaced in recovery payloads. Synthetic outbox codes have no HTTP retrieval endpoint. Do not describe synthetic operations or recorded notifications as real banking/delivery.

## Verification

Backend tests use signed software authenticator ceremonies and isolated databases for origin/UV/ownership/session/expiry/replay, risk upgrades, epoch rotation, adaptive recovery, no normal hold, conditional restrictions, atomic execution/restart, factor non-exposure and Pi request lifecycle. Web/Android builds and transport unit tests do not verify actual browser/phone provider behavior, production assurance or organizer acceptance.

## Reference Sources

Reviewed October 3, 2026; standards and product-specific examples inform this design and do not prove compliance:

- [W3C WebAuthn](https://www.w3.org/TR/webauthn-3/#sctn-verifying-assertion): scoped credentials and relying-party verification. Our transaction binding and hold policy are application controls.
- [OWASP transaction authorization](https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html): operation details, unique/expiring authorization, and a final execution gate.
- [Revolut lost-device Passkeys](https://help.revolut.com/help/more/i-lost-access-to-a-device-my-passkey-is-stored-on/): availability can depend on synchronized storage; revocation is available.
- [Binance security-factor recovery](https://www.binance.com/en-KZ/support/faq/detail/2de25ddf8c5b4f59adaebe9452f7b64b): financial operations can remain restricted for up to 48 hours after factor reset. Exchange waiting periods are examples, not our normal recovery policy.
- [NIST authenticator guidance](https://pages.nist.gov/800-63-4/sp800-63b/authenticators/): SMS/PSTN has restricted status and requires attention to device/SIM/number-change risks. SMS plus password is the owner's fallback requirement, not a claim of Passkey-equivalent phishing resistance.
