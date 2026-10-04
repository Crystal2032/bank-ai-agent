import { randomInt, randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  type AuthenticatorTransport,
} from "@simplewebauthn/server";
import { Bank } from "./bank.js";
import {
  checkPassword,
  digest,
  hashPassword,
  otpDigest,
  safeEqual,
  token,
} from "./crypto.js";
import type { Config } from "./config.js";
import { Authenticator } from "./authenticator.js";
import { FactorProofs } from "./factor-proofs.js";
import { AppError, type Challenge, type Session } from "./types.js";
export class Security {
  readonly authenticator: Authenticator;
  readonly factorProofs: FactorProofs;
  private dummyHash = hashPassword(token());
  constructor(
    readonly bank: Bank,
    readonly config: Config,
  ) {
    this.authenticator = new Authenticator(this);
    this.factorProofs = new FactorProofs(this);
  }
  get store() {
    return this.bank.store;
  }
  newSession(customerId: string) {
    const customer = this.store.get("customers", customerId)!;
    const raw = token();
    const session: Session = {
      id: digest(raw),
      customerId,
      epoch: customer.epoch,
      csrfToken: token(),
      expiresAt: this.bank.now() + 8 * 3600000,
    };
    this.store.put("sessions", session);
    return { raw, session };
  }
  login(username: string, password: string) {
    const customer = this.store
      .all("customers")
      .find((c) => c.username === username);
    const valid = checkPassword(
      password,
      customer?.passwordHash ?? this.dummyHash,
    );
    if (!valid || !customer)
      throw new AppError(
        "INVALID_CREDENTIALS",
        "Invalid sign-in details.",
        401,
      );
    return this.store.transaction(() => {
      const result = this.newSession(customer.id);
      this.store.audit(customer.id, "SESSION_CREATED", {}, this.bank.now());
      return result;
    });
  }
  session(raw?: string) {
    if (!raw) throw new AppError("UNAUTHENTICATED", "Sign in required.", 401);
    const session = this.store.get("sessions", digest(raw));
    if (!session)
      throw new AppError("UNAUTHENTICATED", "Sign in required.", 401);
    this.bank.customer(session);
    return session;
  }
  password(session: Session, password: string) {
    const customer = this.bank.customer(session);
    if (!checkPassword(password, customer.passwordHash)) {
      this.store.audit(
        customer.id,
        "FACTOR_REJECTED",
        { method: "PASSWORD" },
        this.bank.now(),
      );
      throw new AppError("FACTOR_REJECTED", "Verification failed.", 403);
    }
    return customer;
  }
  challenge(session: Session, id: string, purpose: Challenge["purpose"]) {
    this.bank.customer(session);
    const c = this.store.get("challenges", id);
    if (
      !c ||
      c.customerId !== session.customerId ||
      c.sessionId !== session.id ||
      c.epoch !== session.epoch ||
      c.purpose !== purpose ||
      c.consumed ||
      c.expiresAt <= this.bank.now() ||
      c.attempts >= 5
    )
      throw new AppError(
        "CHALLENGE_INVALID",
        "Challenge expired or unavailable.",
        403,
      );
    return c;
  }
  sendOtp(
    session: Session,
    purpose: Challenge["purpose"],
    extras: Partial<Challenge> = {},
  ) {
    if (this.config.smsMode !== "file")
      throw new AppError(
        "SMS_UNAVAILABLE",
        "SMS provider is not configured.",
        503,
      );
    const customer = this.bank.customer(session);
    const now = this.bank.now();
    const previous = this.store
      .all("challenges")
      .filter(
        (c) =>
          c.customerId === customer.id &&
          c.otpHash &&
          (c.createdAt ?? c.expiresAt - 300000) > now - 30 * 60000,
      );
    const issuedAt = previous
      .map((c) => c.createdAt ?? c.expiresAt - 300000)
      .sort((a, b) => a - b);
    const resendAt = (issuedAt.at(-1) ?? now - 60000) + 60000;
    const budgetAt =
      issuedAt.length >= 6 ? issuedAt[issuedAt.length - 6]! + 30 * 60000 : now;
    const retryAfterSeconds = Math.ceil(
      (Math.max(resendAt, budgetAt) - now) / 1000,
    );
    if (retryAfterSeconds > 0)
      throw new AppError(
        "SMS_RATE_LIMIT",
        `Wait ${retryAfterSeconds} seconds before requesting another code.`,
        429,
        retryAfterSeconds,
      );
    const id = randomUUID();
    const code = String(randomInt(100000, 1000000));
    const c: Challenge = {
      ...extras,
      id,
      customerId: customer.id,
      sessionId: session.id,
      epoch: session.epoch,
      purpose,
      otpHash: otpDigest(this.config.authSecret, id, code),
      attempts: 0,
      createdAt: now,
      expiresAt: now + 300000,
      consumed: false,
    };
    mkdirSync(dirname(this.config.smsOutboxPath), { recursive: true });
    appendFileSync(
      this.config.smsOutboxPath,
      JSON.stringify({
        simulated: true,
        challengeId: id,
        purpose,
        recipient: customer.phone,
        code,
        expiresAt: c.expiresAt,
      }) + "\n",
      { mode: 0o600 },
    );
    this.store.transaction(() => {
      for (const old of previous.filter(
        (c) => c.purpose === purpose && !c.consumed,
      )) {
        old.consumed = true;
        this.store.put("challenges", old);
      }
      this.store.put("challenges", c);
      this.store.audit(
        customer.id,
        "SMS_TEST_DELIVERED",
        { challengeId: id, purpose },
        now,
      );
    });
    return {
      challengeId: id,
      maskedPhone: `***${customer.phone.slice(-4)}`,
      expiresAt: c.expiresAt,
      resendAvailableAt: now + 60000,
      smsSimulated: true,
    };
  }
  consumeOtp(
    session: Session,
    id: string,
    purpose: Challenge["purpose"],
    code: string,
  ) {
    const result = this.store.transaction(() => {
      const c = this.challenge(session, id, purpose);
      if (!c.otpHash)
        throw new AppError("CHALLENGE_INVALID", "Wrong challenge type.", 403);
      c.attempts++;
      const valid = safeEqual(
        c.otpHash,
        otpDigest(this.config.authSecret, id, code),
      );
      if (valid) c.consumed = true;
      this.store.put("challenges", c);
      this.store.audit(
        session.customerId,
        valid ? "OTP_VERIFIED" : "FACTOR_REJECTED",
        { challengeId: id, purpose, method: "SMS" },
        this.bank.now(),
      );
      return { valid, c };
    });
    if (!result.valid)
      throw new AppError("FACTOR_REJECTED", "Verification failed.", 403);
    return result.c;
  }
  verifyPaymentPassword(session: Session, id: string, password: string) {
    this.password(session, password);
    this.bank.assertWritable(session);
    const action = this.bank.awaitingPayment(session, id);
    if (
      action.kind === "SUBSCRIPTION_LOOKUP" ||
      action.status !== "WAITING_FOR_VERIFICATION"
    )
      throw new AppError(
        "INVALID_STATE",
        "Payment is not awaiting verification.",
        409,
      );
    const tier = this.bank.risk(action);
    const otherAvailable =
      this.authenticator.enabled(session.customerId) ||
      this.store
        .all("passkeys")
        .some((k) => k.customerId === session.customerId && !k.revoked);
    if (tier === "RED" && !otherAvailable)
      return {
        verificationRequired: "SMS",
        ...this.sendOtp(session, "PAYMENT", {
          actionId: id,
          digest: action.digest,
          tier,
        }),
      };
    return this.store.transaction(() =>
      this.bank.grant(session, id, tier, "PASSWORD"),
    );
  }
  verifyPaymentOtp(session: Session, id: string, code: string) {
    const c = this.consumeOtp(session, id, "PAYMENT", code);
    return this.store.transaction(() => {
      const action = this.bank.ownedAction(session, c.actionId!);
      if (action.digest !== c.digest)
        throw new AppError("ACTION_CHANGED", "Action changed.", 409);
      return this.bank.grant(session, action.id, "RED", "PASSWORD_SMS");
    });
  }
  async paymentPasskeyOptions(session: Session, id: string) {
    this.bank.assertWritable(session);
    const action = this.bank.awaitingPayment(session, id);
    if (
      action.kind === "SUBSCRIPTION_LOOKUP" ||
      action.status !== "WAITING_FOR_VERIFICATION"
    )
      throw new AppError(
        "INVALID_STATE",
        "Payment is not awaiting verification.",
        409,
      );
    const keys = this.store
      .all("passkeys")
      .filter((k) => k.customerId === session.customerId && !k.revoked);
    if (!keys.length)
      throw new AppError(
        "PASSKEY_UNAVAILABLE",
        "Enroll or recover a Passkey.",
        409,
      );
    const options = await generateAuthenticationOptions({
      rpID: this.config.rpId,
      userVerification: "required",
      allowCredentials: keys.map((k) => ({
        id: k.id,
        transports: k.transports as AuthenticatorTransport[],
      })),
    });
    this.bank.customer(session);
    const c: Challenge = {
      id: randomUUID(),
      customerId: session.customerId,
      sessionId: session.id,
      epoch: session.epoch,
      purpose: "PAYMENT",
      challenge: options.challenge,
      actionId: id,
      digest: action.digest,
      tier: this.bank.risk(action),
      expiresAt: this.bank.now() + 120000,
      attempts: 0,
      consumed: false,
    };
    this.store.put("challenges", c);
    return { challengeId: c.id, options, expiresAt: c.expiresAt };
  }
  async verifyPaymentPasskey(
    session: Session,
    id: string,
    response: AuthenticationResponseJSON,
  ) {
    const c = this.challenge(session, id, "PAYMENT");
    if (!c.challenge)
      throw new AppError("CHALLENGE_INVALID", "Wrong challenge type.", 403);
    const key = this.store.get("passkeys", response.id);
    if (!key || key.customerId !== session.customerId || key.revoked)
      throw new AppError("FACTOR_REJECTED", "Verification failed.", 403);
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: c.challenge,
      expectedOrigin: [
        this.config.origin,
        ...(this.config.androidPasskeyOrigin
          ? [this.config.androidPasskeyOrigin]
          : []),
      ],
      expectedRPID: this.config.rpId,
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
    if (!verification.verified)
      throw new AppError("FACTOR_REJECTED", "Verification failed.", 403);
    return this.store.transaction(() => {
      const fresh = this.challenge(session, id, "PAYMENT");
      const freshKey = this.store.get("passkeys", key.id)!;
      if (freshKey.revoked || freshKey.counter !== key.counter)
        throw new AppError("FACTOR_REJECTED", "Credential changed.", 403);
      const action = this.bank.ownedAction(session, fresh.actionId!);
      if (action.digest !== fresh.digest)
        throw new AppError("ACTION_CHANGED", "Action changed.", 409);
      fresh.consumed = true;
      this.store.put("challenges", fresh);
      freshKey.counter = verification.authenticationInfo.newCounter;
      this.store.put("passkeys", freshKey);
      return this.bank.grant(session, action.id, "RED", "PASSKEY_UV");
    });
  }
  startEnrollment(
    session: Session,
    password: string,
    recovery: boolean,
    totpCode?: string,
  ) {
    this.password(session, password);
    this.bank.assertWritable(session);
    if (
      recovery &&
      this.factorProofs.policy(session, "PASSKEY_RECOVER").requiredMethods > 1
    )
      throw new AppError(
        "RECOVERY_FACTORS_REQUIRED",
        "Use two enrolled backup options to recover this Passkey.",
        403,
      );
    if (!recovery) return this.sendOtp(session, "ENROLLMENT");
    const request = {
      id: randomUUID(),
      customerId: session.customerId,
      sessionId: session.id,
      epoch: session.epoch,
      state: "VERIFYING_FACTORS" as const,
      expiresAt: this.bank.now() + 600000,
    };
    const result = this.sendOtp(session, "RECOVERY", {
      recoveryId: request.id,
    });
    this.store.put("recoveries", request);
    return { ...result, recoveryId: request.id };
  }
  async enrollmentOptions(
    session: Session,
    id: string,
    code: string,
    recovery: boolean,
    proofId?: string | string[],
  ) {
    const c = proofId
      ? (() => {
          this.factorProofs.consume(
            session,
            proofId,
            recovery ? "PASSKEY_RECOVER" : "PASSKEY_ENROLL",
          );
          if (!recovery) return { recoveryId: undefined };
          const request = {
            id: randomUUID(),
            customerId: session.customerId,
            sessionId: session.id,
            epoch: session.epoch,
            state: "VERIFYING_FACTORS" as const,
            expiresAt: this.bank.now() + 600000,
          };
          this.store.put("recoveries", request);
          return { recoveryId: request.id };
        })()
      : this.consumeOtp(
          session,
          id,
          recovery ? "RECOVERY" : "ENROLLMENT",
          code,
        );
    this.bank.assertWritable(session);
    const customer = this.bank.customer(session);
    const options = await generateRegistrationOptions({
      rpName: "Bank AI Simulator",
      rpID: this.config.rpId,
      userName: customer.username,
      userID: new TextEncoder().encode(customer.id),
      attestationType: "none",
      supportedAlgorithmIDs: [-7, -257],
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "required",
      },
      excludeCredentials: this.store
        .all("passkeys")
        .filter((k) => k.customerId === customer.id && !k.revoked)
        .map((k) => ({ id: k.id })),
    });
    this.bank.customer(session);
    const registration: Challenge = {
      id: randomUUID(),
      customerId: customer.id,
      sessionId: session.id,
      epoch: session.epoch,
      purpose: recovery ? "RECOVERY" : "ENROLLMENT",
      recoveryId: c.recoveryId,
      challenge: options.challenge,
      attempts: 0,
      consumed: false,
      expiresAt: this.bank.now() + 120000,
    };
    this.store.transaction(() => {
      if (recovery) {
        const request = this.store.get("recoveries", c.recoveryId!);
        if (
          !request ||
          request.expiresAt <= this.bank.now() ||
          request.epoch !== session.epoch
        )
          throw new AppError("RECOVERY_EXPIRED", "Start recovery again.", 403);
        request.state = "ENROLLING_REPLACEMENT";
        this.store.put("recoveries", request);
      }
      this.store.put("challenges", registration);
    });
    return {
      challengeId: registration.id,
      options,
      expiresAt: registration.expiresAt,
    };
  }
  async completeEnrollment(
    session: Session,
    id: string,
    response: RegistrationResponseJSON,
    label: string,
    recovery: boolean,
  ) {
    const purpose = recovery ? "RECOVERY" : "ENROLLMENT";
    const c = this.challenge(session, id, purpose);
    if (!c.challenge)
      throw new AppError("CHALLENGE_INVALID", "Wrong challenge type.", 403);
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: c.challenge,
      expectedOrigin: [
        this.config.origin,
        ...(this.config.androidPasskeyOrigin
          ? [this.config.androidPasskeyOrigin]
          : []),
      ],
      expectedRPID: this.config.rpId,
      requireUserVerification: true,
      requireUserPresence: true,
      supportedAlgorithmIDs: [-7, -257],
    }).catch(() => {
      throw new AppError("FACTOR_REJECTED", "Registration failed.", 403);
    });
    if (!verification.verified)
      throw new AppError("FACTOR_REJECTED", "Registration failed.", 403);
    return this.store.transaction(() => {
      const fresh = this.challenge(session, id, purpose);
      const customer = this.bank.assertWritable(session);
      const credential = verification.registrationInfo.credential;
      if (this.store.get("passkeys", credential.id))
        throw new AppError(
          "CREDENTIAL_EXISTS",
          "Credential already registered.",
          409,
        );
      if (recovery) {
        const request = this.store.get("recoveries", fresh.recoveryId!);
        if (
          !request ||
          request.state !== "ENROLLING_REPLACEMENT" ||
          request.expiresAt <= this.bank.now()
        )
          throw new AppError("RECOVERY_EXPIRED", "Start recovery again.", 403);
        for (const key of this.store
          .all("passkeys")
          .filter((k) => k.customerId === customer.id)) {
          key.revoked = true;
          this.store.put("passkeys", key);
        }
        customer.holdUntil = this.recoveryHold(session);
        request.state =
          customer.holdUntil > this.bank.now() ? "RESTRICTED" : "COMPLETED";
        request.holdUntil = customer.holdUntil;
        this.store.put("recoveries", request);
      }
      this.store.put("passkeys", {
        id: credential.id,
        customerId: customer.id,
        label,
        publicKey: Buffer.from(credential.publicKey).toString("base64url"),
        counter: credential.counter,
        transports: credential.transports,
        revoked: false,
        createdAt: this.bank.now(),
      });
      fresh.consumed = true;
      this.store.put("challenges", fresh);
      customer.epoch++;
      this.store.put("customers", customer);
      for (const old of this.store
        .all("sessions")
        .filter((s) => s.customerId === customer.id))
        this.store.delete("sessions", old.id);
      for (const action of this.store
        .all("actions")
        .filter(
          (a) => a.customerId === customer.id && (a.grant || a.proofs?.length),
        )) {
        delete action.grant;
        delete action.proofs;
        if (action.status === "AUTHORIZED")
          action.status =
            action.kind === "TRANSFER"
              ? "WAITING_FOR_VERIFICATION"
              : "WAITING_FOR_CONFIRMATION";
        this.store.put("actions", action);
      }
      this.store.audit(
        customer.id,
        recovery ? "PASSKEY_RECOVERED" : "PASSKEY_ENROLLED",
        {
          credentialId: credential.id,
          epoch: customer.epoch,
          holdUntil: customer.holdUntil,
          notificationsSimulated: true,
        },
        this.bank.now(),
      );
      return {
        ...this.newSession(customer.id),
        holdUntil: customer.holdUntil,
        recovered: recovery,
      };
    });
  }
  keys(session: Session) {
    this.bank.customer(session);
    return this.store
      .all("passkeys")
      .filter((k) => k.customerId === session.customerId)
      .map(({ publicKey: _publicKey, counter: _counter, ...key }) => key);
  }
  startRevocation(
    session: Session,
    keyId: string,
    password: string,
    totpCode?: string,
  ) {
    this.password(session, password);
    this.bank.assertWritable(session);
    const key = this.store.get("passkeys", keyId);
    if (!key || key.customerId !== session.customerId || key.revoked)
      throw new AppError("NOT_FOUND", "Passkey unavailable.", 404);
    if (this.factorProofs.policy(session, "PASSKEY_REVOKE").requiredMethods > 1)
      throw new AppError(
        "RECOVERY_FACTORS_REQUIRED",
        "Verify two enrolled backup options in the protected security flow.",
        403,
      );
    return this.sendOtp(session, "KEY_REVOCATION", { digest: keyId });
  }
  completeRevocation(
    session: Session,
    challengeId: string,
    code: string,
    proofId?: string | string[],
    keyId?: string,
  ) {
    const challenge = proofId
      ? (() => {
          this.factorProofs.consume(session, proofId, "PASSKEY_REVOKE", keyId);
          return { digest: keyId };
        })()
      : this.consumeOtp(session, challengeId, "KEY_REVOCATION", code);
    return this.store.transaction(() => {
      const customer = this.bank.assertWritable(session);
      const key = this.store.get("passkeys", challenge.digest!);
      if (!key || key.customerId !== customer.id || key.revoked)
        throw new AppError("NOT_FOUND", "Passkey unavailable.", 404);
      key.revoked = true;
      this.store.put("passkeys", key);
      customer.epoch++;
      this.store.put("customers", customer);
      for (const old of this.store
        .all("sessions")
        .filter((s) => s.customerId === customer.id))
        this.store.delete("sessions", old.id);
      for (const action of this.store
        .all("actions")
        .filter(
          (a) => a.customerId === customer.id && (a.grant || a.proofs?.length),
        )) {
        delete action.grant;
        delete action.proofs;
        if (action.status === "AUTHORIZED")
          action.status =
            action.kind === "TRANSFER"
              ? "WAITING_FOR_VERIFICATION"
              : "WAITING_FOR_CONFIRMATION";
        this.store.put("actions", action);
      }
      this.store.audit(
        customer.id,
        "PASSKEY_REVOKED",
        { credentialId: key.id, epoch: customer.epoch },
        this.bank.now(),
      );
      return this.newSession(customer.id);
    });
  }
  recoveryHold(session: Session) {
    const failures = this.store
      .auditFor(session.customerId)
      .filter(
        (e) =>
          e.event === "FACTOR_REJECTED" &&
          Date.parse(String(e.occurredAt)) > this.bank.now() - 300000,
      );
    const until =
      failures.length >= 5 ? this.bank.now() + this.config.recoveryHoldMs : 0;
    if (until)
      this.store.audit(
        session.customerId,
        "RECOVERY_RISK_RESTRICTION",
        { reason: "REPEATED_FACTOR_FAILURES", holdUntil: until },
        this.bank.now(),
      );
    return until;
  }
}
