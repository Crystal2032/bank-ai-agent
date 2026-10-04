import { randomUUID } from "node:crypto";
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
} from "@simplewebauthn/server";
import { digest } from "./crypto.js";
import { AppError, type Session } from "./types.js";
import type { Security } from "./security.js";

export type FactorOperation =
  | "TOTP_SETUP"
  | "TOTP_REMOVE"
  | "PASSKEY_ENROLL"
  | "PASSKEY_RECOVER"
  | "PASSKEY_REVOKE"
  | "PASSWORD_RESET";
export class FactorProofs {
  constructor(private security: Security) {}
  policy(s: Session, operation: FactorOperation) {
    this.security.bank.customer(s);
    const available: string[] = ["PASSWORD"];
    if (this.security.authenticator.enabled(s.customerId))
      available.push("TOTP");
    if (
      this.security.store
        .all("passkeys")
        .some((k) => k.customerId === s.customerId && !k.revoked)
    )
      available.push("PASSKEY_UV");
    const recovering =
      operation === "PASSKEY_RECOVER" ||
      operation === "PASSKEY_REVOKE" ||
      operation === "TOTP_REMOVE" ||
      operation === "PASSWORD_RESET" ||
      (operation === "TOTP_SETUP" &&
        this.security.authenticator.enabled(s.customerId));
    const excluded = recovering
      ? operation === "PASSWORD_RESET"
        ? "PASSWORD"
        : operation === "PASSKEY_RECOVER" || operation === "PASSKEY_REVOKE"
          ? "PASSKEY_UV"
          : "TOTP"
      : undefined;
    const usable = available.filter((m) => m !== excluded);
    return {
      availableMethods: usable,
      requiredMethods: recovering ? Math.min(2, usable.length) : 1,
      recovering,
      limitedOptions: recovering && usable.length < 2,
    };
  }
  private issue(
    s: Session,
    binding: string,
    method: "TOTP" | "PASSKEY_UV" | "PASSWORD_SMS",
  ) {
    this.security.bank.assertWritable(s);
    const id = randomUUID();
    const expiresAt = this.security.bank.now() + 120000;
    this.security.store.put("challenges", {
      id,
      customerId: s.customerId,
      sessionId: s.id,
      epoch: s.epoch,
      purpose: "FACTOR_MANAGEMENT",
      method,
      challenge: "VERIFIED",
      digest: binding,
      expiresAt,
      attempts: 0,
      consumed: false,
    });
    return { proofId: id, expiresAt };
  }
  totp(
    s: Session,
    operation: FactorOperation,
    target: string | undefined,
    code: string,
  ) {
    this.security.bank.assertWritable(s);
    if (!this.security.authenticator.enabled(s.customerId))
      throw new AppError(
        "TOTP_UNAVAILABLE",
        "Authenticator is not enabled.",
        409,
      );
    this.security.authenticator.verifyCurrent(s, code);
    return this.issue(s, digest({ operation, target: target ?? "" }), "TOTP");
  }
  passwordStart(
    s: Session,
    operation: FactorOperation,
    target: string | undefined,
    password: string,
  ) {
    this.security.password(s, password);
    this.security.bank.assertWritable(s);
    return this.security.sendOtp(s, "FACTOR_PASSWORD", {
      digest: digest({ operation, target: target ?? "" }),
    });
  }
  passwordVerify(s: Session, id: string, code: string) {
    const c = this.security.consumeOtp(s, id, "FACTOR_PASSWORD", code);
    return this.issue(s, c.digest!, "PASSWORD_SMS");
  }
  async options(s: Session, operation: FactorOperation, target?: string) {
    this.security.bank.assertWritable(s);
    const keys = this.security.store
      .all("passkeys")
      .filter((k) => k.customerId === s.customerId && !k.revoked);
    if (!keys.length)
      throw new AppError(
        "PASSKEY_UNAVAILABLE",
        "Use another verification method.",
        409,
      );
    const options = await generateAuthenticationOptions({
      rpID: this.security.config.rpId,
      userVerification: "required",
      allowCredentials: keys.map((k) => ({
        id: k.id,
        transports: k.transports as AuthenticatorTransport[],
      })),
    });
    this.security.bank.assertWritable(s);
    const id = randomUUID();
    const expiresAt = this.security.bank.now() + 120000;
    this.security.store.put("challenges", {
      id,
      customerId: s.customerId,
      sessionId: s.id,
      epoch: s.epoch,
      purpose: "FACTOR_PASSKEY",
      digest: digest({ operation, target: target ?? "" }),
      challenge: options.challenge,
      expiresAt,
      attempts: 0,
      consumed: false,
    });
    return { challengeId: id, options, expiresAt };
  }
  async passkey(s: Session, id: string, response: AuthenticationResponseJSON) {
    const c = this.security.challenge(s, id, "FACTOR_PASSKEY");
    const key = this.security.store.get("passkeys", response.id);
    if (!key || key.customerId !== s.customerId || key.revoked)
      throw new AppError("FACTOR_REJECTED", "Verification failed.", 403);
    const verified = await verifyAuthenticationResponse({
      response,
      expectedChallenge: c.challenge!,
      expectedOrigin: [
        this.security.config.origin,
        ...(this.security.config.androidPasskeyOrigin
          ? [this.security.config.androidPasskeyOrigin]
          : []),
      ],
      expectedRPID: this.security.config.rpId,
      requireUserVerification: true,
      credential: {
        id: key.id,
        publicKey: new Uint8Array(Buffer.from(key.publicKey, "base64url")),
        counter: key.counter,
        transports: key.transports as AuthenticatorTransport[],
      },
    }).catch(() => {
      throw new AppError("FACTOR_REJECTED", "Verification failed.", 403);
    });
    if (!verified.verified)
      throw new AppError("FACTOR_REJECTED", "Verification failed.", 403);
    return this.security.store.transaction(() => {
      const fresh = this.security.challenge(s, id, "FACTOR_PASSKEY");
      const current = this.security.store.get("passkeys", key.id)!;
      if (current.revoked || current.counter !== key.counter)
        throw new AppError("FACTOR_REJECTED", "Credential changed.", 403);
      current.counter = verified.authenticationInfo.newCounter;
      this.security.store.put("passkeys", current);
      fresh.consumed = true;
      this.security.store.put("challenges", fresh);
      return this.issue(s, fresh.digest!, "PASSKEY_UV");
    });
  }
  consume(
    s: Session,
    ids: string[] | string,
    operation: FactorOperation,
    target?: string,
  ) {
    this.security.bank.assertWritable(s);
    const proofs = (typeof ids === "string" ? [ids] : ids).map((id) =>
      this.security.challenge(s, id, "FACTOR_MANAGEMENT"),
    );
    const policy = this.policy(s, operation);
    const methods = new Set(
      proofs.map((c) => (c.method === "PASSWORD_SMS" ? "PASSWORD" : c.method)),
    );
    if (
      !policy.requiredMethods ||
      methods.size < policy.requiredMethods ||
      [...methods].some((m) => !policy.availableMethods.includes(m ?? ""))
    )
      throw new AppError(
        "RECOVERY_FACTORS_REQUIRED",
        policy.requiredMethods
          ? `Verify ${policy.requiredMethods} available security option(s).`
          : "No enrolled backup option is available. Registered-phone identity recovery requires operator assistance.",
        403,
      );
    for (const c of proofs)
      if (
        c.challenge !== "VERIFIED" ||
        c.digest !== digest({ operation, target: target ?? "" })
      )
        throw new AppError(
          "CHALLENGE_INVALID",
          "Verification belongs to a different security operation.",
          403,
        );
    for (const c of proofs) {
      c.consumed = true;
      this.security.store.put("challenges", c);
    }
    this.security.store.audit(
      s.customerId,
      "CREDENTIAL_RECOVERY_FACTORS",
      {
        operation,
        methods: [...methods],
        limitedOptions: policy.limitedOptions,
      },
      this.security.bank.now(),
    );
    return proofs[0]!;
  }
}
