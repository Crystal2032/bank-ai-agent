import { useState, type FormEvent } from "react";
import {
  browserSupportsWebAuthn,
  startAuthentication,
  passkeyUnavailableMessage,
} from "../platform/passkeys";
import { api, isSmsChallenge, isTotpChallenge } from "../api/client";
import type {
  ActionView,
  SmsChallengeResponse,
  TotpChallengeResponse,
} from "../api/types";
import { isTransfer } from "../api/types";
import { describeError, errorCode } from "../lib/errors";
import { formatMinor } from "../lib/money";
import { useLoad } from "../lib/useLoad";
import {
  Alert,
  Countdown,
  DetailList,
  Field,
  Modal,
  Spinner,
  TierBadge,
} from "./ui";

type Step =
  | { kind: "choose" }
  | { kind: "password" }
  | { kind: "sms"; challenge: SmsChallengeResponse }
  | { kind: "totp"; challenge: TotpChallengeResponse }
  | { kind: "passkey" };

/**
 * Fresh, action-bound proof for one transfer. Factors go only to dedicated security
 * endpoints, never through assistant messages. A rejected Passkey is reported, never
 * silently downgraded to a weaker factor.
 */
export function PaymentVerification({
  action,
  notice,
  onAuthorized,
  onStateChanged,
  onClose,
}: {
  action: ActionView;
  notice?: string | null;
  onAuthorized: (action: ActionView) => void;
  /** Called when the server says the action moved on, so the caller can refresh it. */
  onStateChanged: () => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>({ kind: "choose" });
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const webAuthn = browserSupportsWebAuthn();
  const available = useLoad(
    async () => ({
      totp: await api.authenticator(),
      keys: await api.passkeys(),
    }),
    [],
  );

  const fail = (reason: unknown) => {
    setError(describeError(reason));
    const code = errorCode(reason);
    if (code === "CHALLENGE_INVALID") setStep({ kind: "choose" });
    if (
      code === "INVALID_STATE" ||
      code === "ACTION_EXPIRED" ||
      code === "ACTION_CHANGED" ||
      code === "RECOVERY_HOLD" ||
      code === "ACCOUNT_LOCKED"
    )
      onStateChanged();
  };

  const verifyWithPasskey = async () => {
    setBusy(true);
    setError(null);
    setStep({ kind: "passkey" });
    try {
      const { challengeId, options } = await api.paymentPasskeyOptions(
        action.id,
      );
      const assertion = await startAuthentication({ optionsJSON: options });
      const result = await api.verifyPaymentPasskey(challengeId, assertion);
      if (isTotpChallenge(result)) {
        setCode("");
        setStep({ kind: "totp", challenge: result });
      } else accept(result);
    } catch (reason) {
      fail(reason);
      setStep({ kind: "choose" });
    } finally {
      setBusy(false);
    }
  };

  const accept = (result: ActionView) => {
    if (result.status === "AUTHORIZED") onAuthorized(result);
    else {
      setCode("");
      setStep({ kind: "choose" });
      setError(
        "One option verified. Verify another option for this higher-risk operation.",
      );
      onStateChanged();
    }
  };
  const verifyWithTotp = async () => {
    setBusy(true);
    setError(null);
    try {
      setStep({
        kind: "totp",
        challenge: await api.paymentTotpOptions(action.id),
      });
    } catch (reason) {
      fail(reason);
    } finally {
      setBusy(false);
    }
  };
  const submitPassword = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const typed = password;
    setPassword("");
    try {
      const result = await api.verifyPaymentPassword(action.id, typed);
      if (isTotpChallenge(result)) {
        setCode("");
        setStep({ kind: "totp", challenge: result });
      } else if (isSmsChallenge(result)) {
        setCode("");
        setStep({ kind: "sms", challenge: result });
      } else accept(result);
    } catch (reason) {
      fail(reason);
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (event: FormEvent) => {
    event.preventDefault();
    if (step.kind !== "sms" && step.kind !== "totp") return;
    setBusy(true);
    setError(null);
    try {
      const result = await (step.kind === "totp"
        ? api.verifyPaymentTotp(step.challenge.challengeId, code)
        : api.verifyPaymentSms(step.challenge.challengeId, code));
      if (isTotpChallenge(result)) {
        setCode("");
        setStep({ kind: "totp", challenge: result });
      } else accept(result);
    } catch (reason) {
      setCode("");
      fail(reason);
    } finally {
      setBusy(false);
    }
  };

  const params = isTransfer(action) ? action.params : null;

  return (
    <Modal title="Verify this operation" onClose={onClose} dismissible={!busy}>
      {params && (
        <DetailList
          rows={[
            ["Recipient", params.recipientName],
            [
              "Amount",
              <strong key="a">{formatMinor(params.amountMinor)}</strong>,
            ],
            ["Note", params.note || "None"],
            ["Risk tier", <TierBadge key="t" tier={action.tier} />],
          ]}
        />
      )}
      <p className="muted small">
        Choose password, Passkey or Authenticator. Small operations need one
        option; higher-risk operations need two different options. If only a
        password is enrolled, registered-phone SMS backs up higher-risk
        verification.
      </p>
      {notice && <Alert tone="warning">{notice}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}

      {step.kind === "choose" && (
        <div className="stack">
          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={verifyWithTotp}
            disabled={
              busy ||
              !available.data?.totp.enabled ||
              action.verification?.verifiedMethods.includes("TOTP")
            }
          >
            Verify with Authenticator
          </button>
          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={verifyWithPasskey}
            disabled={
              busy ||
              !webAuthn ||
              !available.data?.keys.passkeys.some((k) => !k.revoked) ||
              action.verification?.verifiedMethods.includes("PASSKEY_UV")
            }
          >
            Verify with Passkey
          </button>
          {!webAuthn && (
            <p className="field-hint">{passkeyUnavailableMessage}</p>
          )}
          <button
            type="button"
            className="btn btn-block"
            onClick={() => {
              setError(null);
              setStep({ kind: "password" });
            }}
            disabled={
              busy || action.verification?.verifiedMethods.includes("PASSWORD")
            }
          >
            Use password
          </button>
        </div>
      )}

      {step.kind === "passkey" && (
        <div className="loading">
          <Spinner /> Follow your browser or device prompt…
        </div>
      )}

      {step.kind === "password" && (
        <form className="stack" onSubmit={submitPassword}>
          <Field label="Account password">
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
              maxLength={256}
            />
          </Field>
          <div className="row">
            <button
              type="button"
              className="btn"
              onClick={() => setStep({ kind: "choose" })}
              disabled={busy}
            >
              Back
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy || !password}
            >
              {busy ? <Spinner /> : "Verify"}
            </button>
          </div>
        </form>
      )}

      {(step.kind === "sms" || step.kind === "totp") && (
        <form className="stack" onSubmit={submitCode}>
          {step.kind === "sms" ? (
            <Alert tone="info">
              A 6-digit code was sent to {step.challenge.maskedPhone}. Code
              expires in <Countdown until={step.challenge.expiresAt} />.
              {step.challenge.smsSimulated && (
                <div className="small muted">
                  SMS is simulated in this environment; operators read codes
                  from the local test outbox.
                </div>
              )}
            </Alert>
          ) : (
            <Alert tone="info">
              Enter the current 6-digit code from your Authenticator app.
              Approval expires in <Countdown until={step.challenge.expiresAt} />
              . Each code can be used once; wait for a new code after another
              verification.
            </Alert>
          )}
          <Field
            label={step.kind === "sms" ? "SMS code" : "Authenticator code"}
          >
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              required
              autoFocus
            />
          </Field>
          <div className="row">
            <button
              type="button"
              className="btn"
              onClick={() => setStep({ kind: "choose" })}
              disabled={busy}
            >
              Start over
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy || code.length !== 6}
            >
              {busy ? <Spinner /> : "Verify code"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
