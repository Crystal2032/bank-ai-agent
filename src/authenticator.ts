import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { Secret, TOTP } from "otpauth";
import { otpDigest, safeEqual, hashPassword } from "./crypto.js";
import { AppError, type Session } from "./types.js";
import type { Security } from "./security.js";

export class Authenticator {
  private key: Buffer;
  constructor(private security: Security) {
    this.key = Buffer.from(
      hkdfSync(
        "sha256",
        security.config.authSecret,
        "bank-ai-totp-v1",
        "encryption",
        32,
      ),
    );
  }
  private get bank() {
    return this.security.bank;
  }
  private get store() {
    return this.security.store;
  }
  enabled(customerId: string) {
    return this.store.get("totp", customerId)?.enabled === true;
  }
  status(session: Session) {
    this.bank.customer(session);
    const credential = this.store.get("totp", session.customerId);
    return {
      enabled: credential?.enabled === true,
      recoveryCodesRemaining: credential?.enabled
        ? credential.recoveryHashes.length
        : 0,
    };
  }
  private encrypt(secret: string, owner: string) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    cipher.setAAD(Buffer.from(owner));
    const bytes = Buffer.concat([
      cipher.update(secret, "utf8"),
      cipher.final(),
    ]);
    return [nonce, cipher.getAuthTag(), bytes]
      .map((b) => b.toString("base64url"))
      .join(".");
  }
  private decrypt(encoded: string, owner: string) {
    const [nonce, tag, bytes] = encoded
      .split(".")
      .map((b) => Buffer.from(b, "base64url"));
    const cipher = createDecipheriv("aes-256-gcm", this.key, nonce!);
    cipher.setAAD(Buffer.from(owner));
    cipher.setAuthTag(tag!);
    return Buffer.concat([cipher.update(bytes!), cipher.final()]).toString(
      "utf8",
    );
  }
  private totp(secret: string, label = "Account") {
    return new TOTP({
      issuer: "Bank AI",
      label,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret,
    });
  }
  private budget(customerId: string) {
    const now = this.bank.now();
    const stored = this.store.get("totpAttempts", customerId);
    const budget =
      stored && stored.windowStart + 300000 > now
        ? stored
        : { id: customerId, failures: 0, windowStart: now };
    if (budget.failures >= 5) {
      const retry = Math.ceil((budget.windowStart + 300000 - now) / 1000);
      throw new AppError(
        "TOTP_RATE_LIMIT",
        "Wait before trying another Authenticator code.",
        429,
        retry,
      );
    }
    return budget;
  }
  // Called outside business transactions so failed attempts remain durable.
  private candidate(
    session: Session,
    encrypted: string,
    code: string,
    lastCounter: number,
  ) {
    this.bank.customer(session);
    const budget = this.budget(session.customerId);
    const delta = /^\d{6}$/.test(code)
      ? this.totp(this.decrypt(encrypted, session.customerId)).validate({
          token: code,
          timestamp: this.bank.now(),
          window: 1,
        })
      : null;
    const counter =
      delta === null ? -1 : Math.floor(this.bank.now() / 30000) + delta;
    if (delta === null || counter <= lastCounter) {
      budget.failures++;
      this.store.put("totpAttempts", budget);
      this.store.audit(
        session.customerId,
        "FACTOR_REJECTED",
        { method: "TOTP" },
        this.bank.now(),
      );
      throw new AppError(
        "FACTOR_REJECTED",
        "Invalid or already used Authenticator code. Wait for a new code if needed.",
        403,
      );
    }
    return counter;
  }
  verifyCurrent(session: Session, code?: string) {
    if (!this.enabled(session.customerId)) return;
    const credential = this.store.get("totp", session.customerId)!;
    const counter = this.candidate(
      session,
      credential.encryptedSecret,
      code ?? "",
      credential.lastCounter,
    );
    this.store.transaction(() => this.consumeCounter(session, counter));
  }
  private consumeCounter(session: Session, counter: number) {
    this.bank.customer(session);
    const credential = this.store.get("totp", session.customerId);
    if (!credential?.enabled || counter <= credential.lastCounter)
      throw new AppError(
        "FACTOR_REJECTED",
        "Authenticator changed or code already used.",
        403,
      );
    credential.lastCounter = counter;
    this.store.put("totp", credential);
    this.store.audit(session.customerId, "TOTP_VERIFIED", {}, this.bank.now());
  }
  start(session: Session, password: string) {
    this.security.password(session, password);
    this.bank.assertWritable(session);
    if (
      this.enabled(session.customerId) &&
      this.security.factorProofs.policy(session, "TOTP_SETUP").requiredMethods >
        1
    )
      throw new AppError(
        "RECOVERY_FACTORS_REQUIRED",
        "Use two enrolled backup options to replace the Authenticator.",
        403,
      );
    return this.security.sendOtp(session, "TOTP_ENROLLMENT");
  }
  setup(session: Session, challengeId: string, code: string) {
    this.bank.assertWritable(session);
    this.security.consumeOtp(session, challengeId, "TOTP_ENROLLMENT", code);
    return this.provision(session);
  }
  setupWithProof(session: Session, proofId: string | string[]) {
    this.security.factorProofs.consume(session, proofId, "TOTP_SETUP");
    return this.provision(session);
  }
  private provision(session: Session) {
    const customer = this.bank.customer(session);
    const secret = new Secret({ size: 20 }).base32;
    const id = randomUUID();
    const expiresAt = this.bank.now() + 300000;
    this.store.transaction(() => {
      for (const old of this.store
        .all("challenges")
        .filter(
          (c) =>
            c.customerId === customer.id &&
            c.purpose === "TOTP_SETUP" &&
            !c.consumed,
        )) {
        old.consumed = true;
        this.store.put("challenges", old);
      }
      this.store.put("challenges", {
        id,
        customerId: customer.id,
        sessionId: session.id,
        epoch: session.epoch,
        purpose: "TOTP_SETUP",
        digest: this.enabled(session.customerId) ? "REPLACEMENT" : "ADDITIONAL",
        encryptedSecret: this.encrypt(secret, customer.id),
        expiresAt,
        attempts: 0,
        consumed: false,
      });
    });
    return {
      challengeId: id,
      secret,
      uri: this.totp(secret, customer.username).toString(),
      expiresAt,
    };
  }
  complete(session: Session, id: string, code: string) {
    const challenge = this.security.challenge(session, id, "TOTP_SETUP");
    const counter = this.candidate(
      session,
      challenge.encryptedSecret!,
      code,
      -1,
    );
    const recoveryCodes = Array.from({ length: 8 }, () =>
      randomBytes(10).toString("hex"),
    );
    return this.store.transaction(() => {
      this.bank.assertWritable(session);
      const fresh = this.security.challenge(session, id, "TOTP_SETUP");
      if (this.enabled(session.customerId) && fresh.digest !== "REPLACEMENT")
        throw new AppError(
          "TOTP_ALREADY_ENABLED",
          "Authenticator already enabled.",
          409,
        );
      this.store.put("totp", {
        id: session.customerId,
        encryptedSecret: fresh.encryptedSecret!,
        enabled: true,
        lastCounter: counter,
        createdAt: this.bank.now(),
        recoveryHashes: recoveryCodes.map((code) =>
          this.recoveryHash(session.customerId, code),
        ),
      });
      fresh.consumed = true;
      delete fresh.encryptedSecret;
      this.store.put("challenges", fresh);
      return {
        ...this.rotate(
          session,
          "TOTP_ENROLLED",
          fresh.digest === "REPLACEMENT",
        ),
        recoveryCodes,
      };
    });
  }
  paymentChallenge(session: Session, actionId: string, method: "TOTP") {
    if (!this.enabled(session.customerId))
      throw new AppError(
        "TOTP_UNAVAILABLE",
        "Bind an Authenticator first.",
        409,
      );
    this.bank.assertWritable(session);
    const action = this.bank.awaitingPayment(session, actionId);
    const id = randomUUID();
    const expiresAt = this.bank.now() + 120000;
    for (const old of this.store
      .all("challenges")
      .filter(
        (c) =>
          c.customerId === session.customerId &&
          c.actionId === actionId &&
          c.purpose === "TOTP_PAYMENT" &&
          !c.consumed,
      )) {
      old.consumed = true;
      this.store.put("challenges", old);
    }
    this.store.put("challenges", {
      id,
      customerId: session.customerId,
      sessionId: session.id,
      epoch: session.epoch,
      purpose: "TOTP_PAYMENT",
      actionId,
      digest: action.digest,
      method,
      expiresAt,
      attempts: 0,
      consumed: false,
    });
    return {
      verificationRequired: "TOTP" as const,
      challengeId: id,
      expiresAt,
    };
  }
  payment(session: Session, id: string, code: string) {
    const c = this.security.challenge(session, id, "TOTP_PAYMENT");
    const credential = this.store.get("totp", session.customerId);
    if (!credential?.enabled)
      throw new AppError(
        "TOTP_UNAVAILABLE",
        "Authenticator is not enabled.",
        409,
      );
    const counter = this.candidate(
      session,
      credential.encryptedSecret,
      code,
      credential.lastCounter,
    );
    return this.store.transaction(() => {
      const fresh = this.security.challenge(session, id, "TOTP_PAYMENT");
      const action = this.bank.awaitingPayment(session, fresh.actionId!);
      if (action.digest !== fresh.digest)
        throw new AppError("ACTION_CHANGED", "Action changed.", 409);
      this.consumeCounter(session, counter);
      fresh.consumed = true;
      this.store.put("challenges", fresh);
      return this.bank.grant(
        session,
        action.id,
        this.bank.risk(action),
        "TOTP",
      );
    });
  }
  private recoveryHash(customerId: string, code: string) {
    return otpDigest(
      this.security.config.authSecret,
      `totp-recovery:${customerId}`,
      code.toLowerCase(),
    );
  }
  remove(session: Session, password: string, code: string, recovery: boolean) {
    this.security.password(session, password);
    this.bank.assertWritable(session);
    const credential = this.store.get("totp", session.customerId);
    if (!credential?.enabled)
      throw new AppError(
        "TOTP_UNAVAILABLE",
        "Authenticator is not enabled.",
        409,
      );
    const recoveryHash = this.recoveryHash(session.customerId, code);
    if (!recovery)
      throw new AppError(
        "RECOVERY_FACTORS_REQUIRED",
        "Use the protected security flow to verify available backup options.",
        403,
      );
    if (recovery) {
      const budget = this.budget(session.customerId);
      if (
        !credential.recoveryHashes.some((hash) => safeEqual(hash, recoveryHash))
      ) {
        budget.failures++;
        this.store.put("totpAttempts", budget);
        this.store.audit(
          session.customerId,
          "FACTOR_REJECTED",
          { method: "RECOVERY_CODE" },
          this.bank.now(),
        );
        throw new AppError(
          "FACTOR_REJECTED",
          "Invalid or already used recovery code.",
          403,
        );
      }
    }
    return this.store.transaction(() => {
      const fresh = this.store.get("totp", session.customerId)!;
      if (
        !fresh.enabled ||
        (recovery && !fresh.recoveryHashes.includes(recoveryHash))
      )
        throw new AppError("FACTOR_REJECTED", "Authenticator changed.", 403);
      this.store.delete("totp", session.customerId);
      return this.rotate(
        session,
        recovery ? "TOTP_RECOVERED" : "TOTP_REMOVED",
        true,
      );
    });
  }
  removeWithProof(session: Session, proofId: string | string[]) {
    return this.store.transaction(() => {
      this.security.factorProofs.consume(session, proofId, "TOTP_REMOVE");
      if (!this.enabled(session.customerId))
        throw new AppError(
          "TOTP_UNAVAILABLE",
          "Authenticator is not enabled.",
          409,
        );
      this.store.delete("totp", session.customerId);
      return this.rotate(session, "TOTP_REMOVED", true);
    });
  }
  resetPassword(
    session: Session,
    newPassword: string,
    proofId?: string | string[],
    password?: string,
  ) {
    if (!proofId) this.security.password(session, password ?? "");
    return this.store.transaction(() => {
      if (proofId)
        this.security.factorProofs.consume(session, proofId, "PASSWORD_RESET");
      const customer = this.bank.assertWritable(session);
      customer.passwordHash = hashPassword(newPassword);
      this.store.put("customers", customer);
      return this.rotate(session, "PASSWORD_CHANGED", true);
    });
  }
  private rotate(session: Session, event: string, hold: boolean) {
    const customer = this.bank.assertWritable(session);
    customer.epoch++;
    if (hold) customer.holdUntil = this.security.recoveryHold(session);
    this.store.put("customers", customer);
    for (const s of this.store
      .all("sessions")
      .filter((s) => s.customerId === customer.id))
      this.store.delete("sessions", s.id);
    for (const a of this.store
      .all("actions")
      .filter(
        (a) => a.customerId === customer.id && (a.grant || a.proofs?.length),
      )) {
      delete a.grant;
      delete a.proofs;
      if (a.status === "AUTHORIZED")
        a.status =
          a.kind === "TRANSFER"
            ? "WAITING_FOR_VERIFICATION"
            : "WAITING_FOR_CONFIRMATION";
      this.store.put("actions", a);
    }
    this.store.audit(
      customer.id,
      event,
      {
        epoch: customer.epoch,
        holdUntil: customer.holdUntil,
        notificationsSimulated: true,
      },
      this.bank.now(),
    );
    return this.security.newSession(customer.id);
  }
}
