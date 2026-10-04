import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { api } from "../api/client";
import type {
  AuthenticatorSetup,
  FactorOperation,
  SmsChallengeResponse,
} from "../api/types";
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from "../platform/passkeys";
import { useSession } from "../session";
import { useLoad } from "../lib/useLoad";
import { describeError } from "../lib/errors";
import { Alert, Countdown, Field, Modal, Spinner } from "./ui";

export const securityTitles: Record<FactorOperation, string> = {
  TOTP_SETUP: "Set up or recover Authenticator",
  TOTP_REMOVE: "Remove Authenticator",
  PASSKEY_ENROLL: "Add Passkey",
  PASSKEY_RECOVER: "Recover Passkeys",
  PASSKEY_REVOKE: "Remove Passkey",
  PASSWORD_RESET: "Reset account password",
};
function ProvisionQr({ uri }: { uri: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (ref.current)
      void QRCode.toCanvas(ref.current, uri, { width: 240, margin: 2 }).catch(
        () => setError(true),
      );
  }, [uri]);
  return error ? (
    <p>Use the manual key below.</p>
  ) : (
    <canvas
      ref={ref}
      aria-label="Authenticator provisioning QR"
      role="img"
      style={{ maxWidth: "100%" }}
    />
  );
}
export function SecurityOperation({
  operation,
  target,
  requestId,
  onClose,
  onDone,
}: {
  operation: FactorOperation;
  target?: string;
  requestId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { session, updateSession } = useSession();
  const policy = useLoad(
    () => api.factorPolicy(operation),
    [operation, session.csrfToken],
  );
  const [proofs, setProofs] = useState<
    { id: string; method: string; expiresAt: number }[]
  >([]);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [label, setLabel] = useState("This device");
  const [sms, setSms] = useState<SmsChallengeResponse | null>(null);
  const [setup, setSetup] = useState<AuthenticatorSetup | null>(null);
  const [backups, setBackups] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [completionPending, setCompletionPending] = useState(false);
  const recordProof = (
    proof: { proofId: string; expiresAt: number },
    method: string,
  ) =>
    setProofs((values) => [
      ...values.filter((p) => p.method !== method && p.expiresAt > Date.now()),
      { id: proof.proofId, method, expiresAt: proof.expiresAt },
    ]);
  const attempt = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };
  const verifyPassword = () =>
    attempt(async () => {
      const typed = password;
      setPassword("");
      setSms(await api.factorPasswordStart(operation, typed, target));
    });
  const verifySms = () =>
    attempt(async () => {
      if (!sms) return;
      const typed = code;
      setCode("");
      recordProof(
        await api.factorPasswordVerify(sms.challengeId, typed),
        "PASSWORD",
      );
      setSms(null);
    });
  const verifyTotp = () =>
    attempt(async () => {
      const typed = code;
      setCode("");
      recordProof(await api.factorTotp(operation, typed, target), "TOTP");
    });
  const verifyPasskey = () =>
    attempt(async () => {
      const c = await api.factorPasskeyOptions(operation, target);
      const response = await startAuthentication({ optionsJSON: c.options });
      recordProof(
        await api.factorPasskeyVerify(c.challengeId, response),
        "PASSKEY_UV",
      );
    });
  const completeRequest = async () => {
    setDone(true);
    if (requestId) {
      setCompletionPending(true);
      await api.securityRequestComplete(requestId);
      setCompletionPending(false);
    }
    onDone();
  };
  const assertPending = async () => {
    if (
      requestId &&
      (await api.securityRequest(requestId)).status !== "PENDING"
    )
      throw new Error(
        "This security request is no longer pending. Refresh the task.",
      );
  };
  const run = () =>
    attempt(async () => {
      await assertPending();
      const ids = proofs
        .filter((p) => p.expiresAt > Date.now())
        .map((p) => p.id);
      if (operation === "TOTP_SETUP") {
        setSetup(await api.authenticatorSetupWithProof(ids));
        return;
      }
      if (operation === "PASSKEY_ENROLL" || operation === "PASSKEY_RECOVER") {
        const recovery = operation === "PASSKEY_RECOVER";
        const c = await api.enrollmentWithProof(ids, recovery);
        const response = await startRegistration({ optionsJSON: c.options });
        updateSession(
          await api.enrollmentVerify(
            c.challengeId,
            response,
            label.trim(),
            recovery,
          ),
        );
      } else if (operation === "PASSKEY_REVOKE") {
        if (!target) throw new Error("Select the exact Passkey to remove.");
        updateSession(await api.revocationWithProof(ids, target));
      } else if (operation === "TOTP_REMOVE")
        updateSession(await api.authenticatorRemoveWithProof(ids));
      else updateSession(await api.passwordReset(ids, newPassword));
      await completeRequest();
    });
  const activate = () =>
    attempt(async () => {
      if (!setup) return;
      await assertPending();
      const typed = code;
      setCode("");
      const result = await api.authenticatorVerify(setup.challengeId, typed);
      updateSession(result);
      setSetup(null);
      setBackups(result.recoveryCodes);
      await completeRequest();
    });
  const activeProofs = proofs.filter((p) => p.expiresAt > Date.now());
  const enough = Boolean(
    policy.data?.requiredMethods &&
    activeProofs.length >= policy.data.requiredMethods,
  );
  const ready =
    operation !== "PASSWORD_RESET" ||
    (newPassword.length >= 12 && newPassword === confirmPassword);
  const initiated = useRef(false);
  useEffect(() => {
    if (enough && ready && !setup && !done && !busy && !initiated.current) {
      initiated.current = true;
      void run();
    }
  }, [enough, ready, setup, done, busy]);
  return (
    <Modal
      title={securityTitles[operation]}
      onClose={onClose}
      dismissible={!busy}
    >
      <p>
        This operation rotates sessions and invalidates pending approvals.
        Normal verified recovery has no automatic funds waiting period.
      </p>
      {operation === "PASSKEY_RECOVER" && (
        <Alert tone="warning">
          Replacement removes existing Passkeys. Working Authenticator/password
          options remain available.
        </Alert>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      {done && completionPending && (
        <button
          className="btn"
          disabled={busy}
          onClick={() => void attempt(completeRequest)}
        >
          Retry task completion update
        </button>
      )}
      {policy.error ? (
        <Alert tone="danger">{describeError(policy.error)}</Alert>
      ) : null}
      {done && !backups && (
        <Alert tone="success">
          Operation completed. Other sessions were signed out.
        </Alert>
      )}
      {backups && (
        <div className="stack">
          <Alert tone="warning">
            Save these one-time recovery codes privately. They are shown once
            and cannot authorize transfers.
          </Alert>
          {backups.map((c) => (
            <code key={c}>{c}</code>
          ))}
          <button className="btn btn-primary" onClick={onClose}>
            I saved the recovery codes
          </button>
        </div>
      )}
      {!done && !setup && (
        <div className="stack">
          {operation === "PASSWORD_RESET" && (
            <>
              <Field label="New password">
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={256}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </Field>
              <Field label="Confirm new password">
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </Field>
            </>
          )}
          {(operation === "PASSKEY_ENROLL" ||
            operation === "PASSKEY_RECOVER") && (
            <Field label="Passkey name">
              <input
                value={label}
                maxLength={80}
                onChange={(e) => setLabel(e.target.value)}
              />
            </Field>
          )}
          {policy.data && (
            <Alert tone="info">
              Verify {policy.data.requiredMethods}{" "}
              {policy.data.requiredMethods === 1
                ? "option"
                : "different options"}
              .{" "}
              {policy.data.limitedOptions &&
                "You have fewer enrolled backup options; the available option is accepted with its recovery safeguards."}{" "}
              {activeProofs.length > 0 && `${activeProofs.length} verified.`}
            </Alert>
          )}
          {policy.data?.requiredMethods === 0 && (
            <Alert tone="warning">
              No enrolled backup option is available. Contact the operator for
              registered-phone identity recovery; this environment has no
              staffed recovery provider.
            </Alert>
          )}
          {!enough && ready && (
            <>
              {sms ? (
                <div className="stack">
                  <Alert tone="info">
                    SMS to {sms.maskedPhone}, expires in{" "}
                    <Countdown until={sms.expiresAt} />.{" "}
                    {sms.smsSimulated &&
                      "SMS uses the private synthetic outbox."}
                  </Alert>
                  <Field label="SMS code">
                    <input
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={code}
                      onChange={(e) =>
                        setCode(e.target.value.replace(/\D/g, ""))
                      }
                    />
                  </Field>
                  <button
                    className="btn"
                    disabled={busy || code.length !== 6}
                    onClick={verifySms}
                  >
                    Verify SMS
                  </button>
                </div>
              ) : (
                <>
                  {policy.data?.availableMethods.includes("PASSWORD") &&
                    !activeProofs.some((p) => p.method === "PASSWORD") && (
                      <div className="stack">
                        <Field label="Account password">
                          <input
                            type="password"
                            autoComplete="current-password"
                            value={password}
                            maxLength={256}
                            onChange={(e) => setPassword(e.target.value)}
                          />
                        </Field>
                        <button
                          className="btn"
                          disabled={busy || !password}
                          onClick={verifyPassword}
                        >
                          Use password + registered-phone SMS
                        </button>
                      </div>
                    )}
                  {policy.data?.availableMethods.includes("TOTP") &&
                    !activeProofs.some((p) => p.method === "TOTP") && (
                      <div className="stack">
                        <Field label="Authenticator code">
                          <input
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            maxLength={6}
                            value={code}
                            onChange={(e) =>
                              setCode(e.target.value.replace(/\D/g, ""))
                            }
                          />
                        </Field>
                        <button
                          className="btn"
                          disabled={busy || code.length !== 6}
                          onClick={verifyTotp}
                        >
                          Use Authenticator
                        </button>
                      </div>
                    )}
                  {policy.data?.availableMethods.includes("PASSKEY_UV") &&
                    !activeProofs.some((p) => p.method === "PASSKEY_UV") && (
                      <button
                        className="btn"
                        disabled={busy || !browserSupportsWebAuthn()}
                        onClick={verifyPasskey}
                      >
                        Use Passkey
                      </button>
                    )}
                </>
              )}
            </>
          )}
          {enough && ready && (
            <button
              className="btn btn-primary"
              disabled={
                busy ||
                Boolean(
                  operation.startsWith("PASSKEY") && !browserSupportsWebAuthn(),
                ) ||
                !label.trim()
              }
              onClick={run}
            >
              {busy ? <Spinner /> : "Complete verified operation"}
            </button>
          )}
        </div>
      )}
      {setup && (
        <div className="stack">
          <p>
            Scan in your Authenticator app. Expires in{" "}
            <Countdown until={setup.expiresAt} />.
          </p>
          <ProvisionQr uri={setup.uri} />
          <Field label="Manual setup key">
            <code style={{ overflowWrap: "anywhere" }}>{setup.secret}</code>
          </Field>
          <Field label="Current Authenticator code">
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          </Field>
          <button
            className="btn btn-primary"
            disabled={
              busy || code.length !== 6 || setup.expiresAt <= Date.now()
            }
            onClick={activate}
          >
            Enable Authenticator
          </button>
        </div>
      )}
    </Modal>
  );
}
