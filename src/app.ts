import Fastify, {
  type FastifyReply,
  type FastifyRequest,
  type HTTPMethods,
} from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { Type, type TSchema } from "@sinclair/typebox";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { Config } from "./config.js";
import { Store } from "./store.js";
import { seed } from "./seed.js";
import { Bank } from "./bank.js";
import { Security } from "./security.js";
import { Tasks } from "./agent.js";
import { AppError, type ActionKind, type Session } from "./types.js";
import { safeEqual } from "./crypto.js";
const object = (fields: Record<string, TSchema>) =>
  Type.Object(fields, { additionalProperties: false });
const identifier = Type.String({ minLength: 1, maxLength: 128 });
const password = Type.String({ minLength: 1, maxLength: 256 });
const code = Type.String({ pattern: "^\\d{6}$" });
const empty = object({});
type Body = Record<string, any>;
export async function buildApp(
  config: Config,
  options: { now?: () => number; testStream?: StreamFn } = {},
) {
  const store = new Store(config.databasePath);
  const bank = new Bank(store, options.now);
  if (!store.all("customers").length) {
    if (!config.demoPassword || config.demoPassword.length < 12) {
      store.close();
      throw new Error(
        "DEMO_PASSWORD must contain at least 12 characters to provision synthetic accounts.",
      );
    }
    seed(store, config.demoPassword, bank.now());
  }
  const security = new Security(bank, config);
  const tasks = new Tasks(bank, config, options.testStream);
  const app = Fastify({
    logger: false,
    trustProxy: config.proxyHops === 1 ? (_address, hop) => hop < 1 : false,
    bodyLimit: 65536,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  });
  await app.register(cookie);
  await app.register(cors, {
    origin: [
      config.origin,
      ...(config.androidOrigin ? [config.androidOrigin] : []),
    ],
    credentials: true,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "X-CSRF-Token"],
    exposedHeaders: ["Retry-After"],
  });
  await app.register(rateLimit, { max: 120, timeWindow: 60000 });
  app.addHook("onRequest", async (request, reply) => {
    reply
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff")
      .header(
        "Content-Security-Policy",
        "default-src 'none'; frame-ancestors 'none'",
      )
      .header("Referrer-Policy", "no-referrer");
    if (
      request.method === "POST" &&
      ![config.origin, config.androidOrigin]
        .filter(Boolean)
        .includes(request.headers.origin)
    )
      throw new AppError(
        "ORIGIN_REJECTED",
        "Use the configured client origin.",
        403,
      );
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      if (error.retryAfterSeconds !== undefined)
        reply.header("Retry-After", error.retryAfterSeconds);
      return reply.code(error.status).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.retryAfterSeconds === undefined
            ? {}
            : { retryAfterSeconds: error.retryAfterSeconds }),
        },
      });
    }
    const e = error as { validation?: unknown; statusCode?: number };
    if (e.validation)
      return reply.code(400).send({
        error: {
          code: "INVALID_REQUEST",
          message: "Request does not match the API schema.",
        },
      });
    if (e.statusCode === 429)
      return reply.code(429).send({
        error: { code: "RATE_LIMITED", message: "Too many requests." },
      });
    return reply.code(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message:
          "Request failed. Check action status before retrying a payment.",
      },
    });
  });
  const contract: {
    method: string;
    path: string;
    authenticated: boolean;
    csrfRequired: boolean;
    body?: TSchema;
    query?: TSchema;
    description: string;
  }[] = [];
  const session = (request: FastifyRequest) =>
    security.session(request.cookies.bank_session);
  const setSession = (
    reply: FastifyReply,
    result: ReturnType<Security["newSession"]>,
  ) => {
    reply.setCookie("bank_session", result.raw, {
      httpOnly: true,
      secure: config.secureCookie,
      sameSite: "strict",
      path: "/api",
      maxAge: 8 * 3600,
    });
    const c = bank.customer(result.session);
    return {
      csrfToken: result.session.csrfToken,
      customer: {
        id: c.id,
        name: c.name,
        username: c.username,
        maskedPhone: `***${c.phone.slice(-4)}`,
      },
      security: { holdUntil: c.holdUntil, locked: c.locked },
      bankingSimulated: true,
    };
  };
  function route(
    method: HTTPMethods,
    path: string,
    description: string,
    handler: (
      s: Session,
      body: Body,
      request: FastifyRequest,
      reply: FastifyReply,
    ) => unknown,
    body?: TSchema,
    authenticated = true,
    sensitive = false,
    query?: TSchema,
  ) {
    contract.push({
      method,
      path,
      description,
      authenticated,
      csrfRequired: authenticated && method === "POST",
      body,
      query,
    });
    app.route({
      method,
      url: path,
      schema: {
        ...(body ? { body } : {}),
        ...(query ? { querystring: query } : {}),
      },
      config: sensitive ? { rateLimit: { max: 10, timeWindow: 60000 } } : {},
      handler: async (request, reply) => {
        const s = authenticated ? session(request) : undefined;
        if (
          s &&
          method === "POST" &&
          !safeEqual(String(request.headers["x-csrf-token"] ?? ""), s.csrfToken)
        )
          throw new AppError(
            "CSRF_REJECTED",
            "Refresh your security token.",
            403,
          );
        return handler(s!, (request.body ?? {}) as Body, request, reply);
      },
    });
  }
  const id = (request: FastifyRequest) => String((request.params as Body).id);
  app.get("/health", async () => ({
    status: "ok",
    banking: "SIMULATED",
    model: config.model ? "API_CONFIGURED" : "NOT_CONFIGURED",
    sms: config.smsMode === "file" ? "LOCAL_TEST_OUTBOX" : "DISABLED",
  }));
  app.get("/api/contract", async () => ({
    version: "1",
    currency: "CNY",
    amountUnit: "INTEGER_MINOR_UNITS",
    routes: contract,
  }));
  route(
    "POST",
    "/api/auth/login",
    "Sign in to a synthetic account; returns cookie and CSRF token.",
    (_s, b, _r, reply) =>
      setSession(reply, security.login(b.username, b.password)),
    object({
      username: Type.String({ minLength: 1, maxLength: 100 }),
      password,
    }),
    false,
    true,
  );
  route(
    "GET",
    "/api/auth/me",
    "Restore session and CSRF token.",
    (s, _b, _r, reply) => {
      const c = bank.customer(s);
      return {
        csrfToken: s.csrfToken,
        customer: {
          id: c.id,
          name: c.name,
          username: c.username,
          maskedPhone: `***${c.phone.slice(-4)}`,
        },
        security: { holdUntil: c.holdUntil, locked: c.locked },
        bankingSimulated: true,
      };
    },
  );
  route(
    "POST",
    "/api/auth/logout",
    "Invalidate current session.",
    (s, _b, _r, reply) => {
      store.delete("sessions", s.id);
      reply.clearCookie("bank_session", { path: "/api" });
      return { signedOut: true };
    },
    empty,
  );
  route(
    "GET",
    "/api/bank/accounts",
    "Read authoritative owned balances.",
    (s) => ({
      accounts: [bank.account(s.customerId)],
      observedAt: new Date(bank.now()).toISOString(),
      simulated: true,
    }),
  );
  route("GET", "/api/bank/transactions", "Read owned transactions.", (s) => ({
    transactions: store
      .all("ledger")
      .filter((e) => e.customerId === s.customerId)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
    simulated: true,
  }));
  route("GET", "/api/bank/contacts", "Select an exact owned contact.", (s) => ({
    contacts: store
      .all("contacts")
      .filter((c) => c.customerId === s.customerId),
  }));
  route(
    "GET",
    "/api/bank/bill-report",
    "Compute monthly totals and recurring-charge candidates.",
    (s, _b, r) => bank.report(s, String((r.query as Body).month)),
    undefined,
    true,
    false,
    object({ month: Type.String({ pattern: "^\\d{4}-(0[1-9]|1[0-2])$" }) }),
  );
  const actionBody = Type.Union([
    object({
      kind: Type.Literal("TRANSFER"),
      params: object({
        contactId: identifier,
        amountMinor: Type.Integer({ minimum: 1, maximum: 100000000 }),
        note: Type.Optional(Type.String({ maxLength: 200 })),
      }),
      idempotencyKey: identifier,
      dependsOn: Type.Optional(
        Type.Array(identifier, { maxItems: 10, uniqueItems: true }),
      ),
    }),
    object({
      kind: Type.Literal("SUBSCRIPTION_LOOKUP"),
      params: empty,
      idempotencyKey: identifier,
      dependsOn: Type.Optional(
        Type.Array(identifier, { maxItems: 10, uniqueItems: true }),
      ),
    }),
    object({
      kind: Type.Union([
        Type.Literal("SUBSCRIPTION_CANCEL"),
        Type.Literal("MANDATE_REVOKE"),
      ]),
      params: object({ subscriptionId: identifier }),
      idempotencyKey: identifier,
      dependsOn: Type.Optional(
        Type.Array(identifier, { maxItems: 10, uniqueItems: true }),
      ),
    }),
  ]);
  route(
    "POST",
    "/api/actions",
    "Prepare an immutable action, without executing it.",
    (s, b) =>
      bank.prepare(
        s,
        b.kind as ActionKind,
        b.params,
        b.idempotencyKey,
        b.dependsOn,
      ),
    actionBody,
  );
  route("GET", "/api/actions", "Read own canonical action cards.", (s) => ({
    actions: store
      .all("actions")
      .filter((a) => a.customerId === s.customerId)
      .map((a) => bank.publicAction(a, s)),
  }));
  route(
    "GET",
    "/api/actions/:id",
    "Get action status; use after response loss before retry.",
    (s, _b, r) => bank.publicAction(bank.ownedAction(s, id(r)), s),
  );
  route(
    "POST",
    "/api/actions/:id/confirm",
    "Confirm reviewed action/version. Transfers then require verification.",
    (s, b, r) => bank.confirm(s, id(r), b.version),
    object({ version: Type.Integer({ minimum: 1 }) }),
  );
  route(
    "POST",
    "/api/actions/:id/execute",
    "Execute exactly the approved action or return existing result.",
    (s, _b, r) => bank.execute(s, id(r)),
    empty,
  );
  route(
    "POST",
    "/api/actions/:id/cancel",
    "Cancel pending work; never reverse completed payments.",
    (s, _b, r) => bank.cancel(s, id(r)),
    empty,
  );
  route("GET", "/api/receipts/:id", "Read canonical receipt.", (s, _b, r) => {
    const receipt = store.get("receipts", id(r));
    if (!receipt || receipt.customerId !== s.customerId)
      throw new AppError("NOT_FOUND", "Receipt not found.", 404);
    return receipt;
  });
  route(
    "POST",
    "/api/actions/:id/verify/password",
    "Authorize one reviewed action with fresh password, independently of TOTP/Passkeys.",
    (s, b, r) => security.verifyPaymentPassword(s, id(r), b.password),
    object({ password }),
    true,
    true,
  );
  route(
    "POST",
    "/api/security/payment/sms/verify",
    "Complete red password-plus-SMS proof.",
    (s, b) => security.verifyPaymentOtp(s, b.challengeId, b.code),
    object({ challengeId: identifier, code }),
    true,
    true,
  );
  route(
    "GET",
    "/api/security/authenticator",
    "Read Authenticator status without secrets.",
    (s) => security.authenticator.status(s),
  );
  route(
    "POST",
    "/api/actions/:id/verify/totp/options",
    "Start independent action-bound Authenticator verification.",
    (s, _b, r) => security.authenticator.paymentChallenge(s, id(r), "TOTP"),
    empty,
    true,
    true,
  );
  route(
    "POST",
    "/api/security/authenticator/start",
    "Begin password-plus-SMS Authenticator enrollment.",
    (s, b) => security.authenticator.start(s, b.password),
    object({ password }),
    true,
    true,
  );
  route(
    "POST",
    "/api/security/authenticator/setup",
    "Consume enrollment SMS and issue a short-lived provisioning secret.",
    (s, b) => security.authenticator.setup(s, b.challengeId, b.code),
    object({ challengeId: identifier, code }),
    true,
    true,
  );
  route(
    "POST",
    "/api/security/authenticator/verify",
    "Confirm a real TOTP code, enable Authenticator and rotate sessions.",
    (s, b, _r, reply) => {
      const result = security.authenticator.complete(s, b.challengeId, b.code);
      return {
        ...setSession(reply, result),
        recoveryCodes: result.recoveryCodes,
      };
    },
    object({ challengeId: identifier, code }),
    true,
    true,
  );
  route(
    "POST",
    "/api/security/payment/totp/verify",
    "Verify a one-time, action/session-bound Authenticator proof.",
    (s, b) => security.authenticator.payment(s, b.challengeId, b.code),
    object({ challengeId: identifier, code }),
    true,
    true,
  );
  route(
    "POST",
    "/api/security/authenticator/remove",
    "Remove Authenticator using the available backup policy; rotate sessions.",
    (s, b, _r, reply) =>
      setSession(
        reply,
        b.proofIds
          ? security.authenticator.removeWithProof(s, b.proofIds)
          : security.authenticator.remove(s, b.password, "", false),
      ),
    Type.Union([
      object({ password }),
      object({
        proofIds: Type.Array(identifier, {
          minItems: 1,
          maxItems: 3,
          uniqueItems: true,
        }),
      }),
    ]),
    true,
    true,
  );
  route(
    "POST",
    "/api/security/authenticator/recover",
    "Remove a lost Authenticator with password and an offline recovery code; rotate sessions.",
    (s, b, _r, reply) =>
      setSession(
        reply,
        security.authenticator.remove(s, b.password, b.recoveryCode, true),
      ),
    object({
      password,
      recoveryCode: Type.String({ pattern: "^[a-fA-F0-9]{20}$" }),
    }),
    true,
    true,
  );
  route(
    "POST",
    "/api/actions/:id/verify/passkey/options",
    "Create action-bound WebAuthn authentication options.",
    (s, _b, r) => security.paymentPasskeyOptions(s, id(r)),
    empty,
    true,
    true,
  );
  const assertion = Type.Object({
    id: identifier,
    rawId: identifier,
    type: Type.Literal("public-key"),
    response: Type.Object({
      clientDataJSON: Type.String({ maxLength: 8192 }),
      authenticatorData: Type.String({ maxLength: 8192 }),
      signature: Type.String({ maxLength: 8192 }),
      userHandle: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    }),
    clientExtensionResults: Type.Object({}, { additionalProperties: true }),
    authenticatorAttachment: Type.Optional(Type.String()),
  });
  route(
    "POST",
    "/api/security/payment/passkey/verify",
    "Verify challenge, signature, ownership, origin, RP ID and UV.",
    (s, b) =>
      security.verifyPaymentPasskey(
        s,
        b.challengeId,
        b.response as AuthenticationResponseJSON,
      ),
    object({ challengeId: identifier, response: assertion }),
    true,
    true,
  );
  route(
    "GET",
    "/api/security/passkeys",
    "Read Passkey metadata without public-key material.",
    (s) => ({ passkeys: security.keys(s) }),
  );
  const operation = Type.Union(
    [
      "TOTP_SETUP",
      "TOTP_REMOVE",
      "PASSKEY_ENROLL",
      "PASSKEY_RECOVER",
      "PASSKEY_REVOKE",
      "PASSWORD_RESET",
    ].map((v) => Type.Literal(v)),
  );
  route(
    "GET",
    "/api/security/verification/policy",
    "Determine available backup options and distinct verification count.",
    (s, _b, r) => security.factorProofs.policy(s, (r.query as Body).operation),
    undefined,
    true,
    false,
    object({ operation }),
  );
  route(
    "POST",
    "/api/security/verification/password/start",
    "Verify password and send credential-purpose SMS.",
    (s, b) =>
      security.factorProofs.passwordStart(s, b.operation, b.target, b.password),
    object({ operation, target: Type.Optional(identifier), password }),
    true,
    true,
  );
  route(
    "POST",
    "/api/security/verification/password/verify",
    "Issue a password credential proof after SMS.",
    (s, b) => security.factorProofs.passwordVerify(s, b.challengeId, b.code),
    object({ challengeId: identifier, code }),
    true,
    true,
  );
  route(
    "POST",
    "/api/security/verification/totp",
    "Verify Authenticator for exactly one credential-management operation.",
    (s, b) => security.factorProofs.totp(s, b.operation, b.target, b.code),
    object({ operation, target: Type.Optional(identifier), code }),
    true,
    true,
  );
  route(
    "POST",
    "/api/security/verification/passkey/options",
    "Request user-verifying Passkey proof for one credential operation.",
    (s, b) => security.factorProofs.options(s, b.operation, b.target),
    object({ operation, target: Type.Optional(identifier) }),
    true,
    true,
  );
  route(
    "POST",
    "/api/security/verification/passkey/verify",
    "Verify Passkey and issue a single-purpose credential proof.",
    (s, b) =>
      security.factorProofs.passkey(
        s,
        b.challengeId,
        b.response as AuthenticationResponseJSON,
      ),
    object({ challengeId: identifier, response: assertion }),
    true,
    true,
  );
  route(
    "POST",
    "/api/security/authenticator/setup-with-proof",
    "Provision or replace an Authenticator using another verified factor.",
    (s, b) => security.authenticator.setupWithProof(s, b.proofIds),
    object({
      proofIds: Type.Array(identifier, {
        minItems: 1,
        maxItems: 3,
        uniqueItems: true,
      }),
    }),
    true,
    true,
  );
  route(
    "POST",
    "/api/security/password/reset",
    "Reset a password using enrolled backup options; rotate sessions.",
    (s, b, _r, reply) =>
      setSession(
        reply,
        security.authenticator.resetPassword(
          s,
          b.newPassword,
          b.proofIds,
          b.password,
        ),
      ),
    object({
      newPassword: Type.String({ minLength: 12, maxLength: 256 }),
      proofIds: Type.Array(identifier, {
        minItems: 1,
        maxItems: 3,
        uniqueItems: true,
      }),
    }),
    true,
    true,
  );
  route(
    "POST",
    "/api/security/passkeys/revocation/start",
    "Authorize removal of exactly one key with password and SMS.",
    (s, b) =>
      security.startRevocation(s, b.credentialId, b.password, b.totpCode),
    object({
      credentialId: identifier,
      password,
      totpCode: Type.Optional(code),
    }),
    true,
    true,
  );
  route(
    "POST",
    "/api/security/passkeys/revocation/verify",
    "Consume removal proof, revoke key and rotate sessions.",
    (s, b, _r, reply) =>
      setSession(
        reply,
        security.completeRevocation(
          s,
          b.challengeId,
          b.code,
          b.proofIds,
          b.credentialId,
        ),
      ),
    Type.Union([
      object({ challengeId: identifier, code }),
      object({
        proofIds: Type.Array(identifier, {
          minItems: 1,
          maxItems: 3,
          uniqueItems: true,
        }),
        credentialId: identifier,
      }),
    ]),
    true,
    true,
  );
  const registration = Type.Object({
    id: identifier,
    rawId: identifier,
    type: Type.Literal("public-key"),
    response: Type.Object({
      clientDataJSON: Type.String({ maxLength: 8192 }),
      attestationObject: Type.String({ maxLength: 32768 }),
      transports: Type.Optional(Type.Array(Type.String())),
      publicKeyAlgorithm: Type.Optional(Type.Integer()),
      publicKey: Type.Optional(Type.String()),
      authenticatorData: Type.Optional(Type.String()),
    }),
    clientExtensionResults: Type.Object({}, { additionalProperties: true }),
    authenticatorAttachment: Type.Optional(Type.String()),
  });
  for (const [prefix, recovery] of [
    ["/api/security/passkeys/enrollment", false],
    ["/api/security/recovery", true],
  ] as const) {
    route(
      "POST",
      `${prefix}/start`,
      recovery
        ? "Start password-plus-original-phone recovery."
        : "Start password-plus-SMS enrollment.",
      (s, b) => security.startEnrollment(s, b.password, recovery, b.totpCode),
      object({ password, totpCode: Type.Optional(code) }),
      true,
      true,
    );
    route(
      "POST",
      `${prefix}/options`,
      "Consume OTP and create restricted registration challenge.",
      (s, b) =>
        security.enrollmentOptions(
          s,
          b.challengeId,
          b.code,
          recovery,
          b.proofIds,
        ),
      Type.Union([
        object({ challengeId: identifier, code }),
        object({
          proofIds: Type.Array(identifier, {
            minItems: 1,
            maxItems: 3,
            uniqueItems: true,
          }),
        }),
      ]),
      true,
      true,
    );
    route(
      "POST",
      `${prefix}/verify`,
      "Verify registration; rotate session. Recovery revokes old keys and holds outgoing funds.",
      async (s, b, _r, reply) => {
        const result = await security.completeEnrollment(
          s,
          b.challengeId,
          b.response as RegistrationResponseJSON,
          b.label,
          recovery,
        );
        return { ...setSession(reply, result), recovered: result.recovered };
      },
      object({
        challengeId: identifier,
        response: registration,
        label: Type.String({ minLength: 1, maxLength: 80 }),
      }),
      true,
      true,
    );
  }
  route(
    "GET",
    "/api/tasks",
    "List owned task summaries, newest creation first, without internal model transcripts.",
    (s, _b, r) => {
      const query = r.query as Body;
      return tasks.list(s, Number(query.limit ?? 20), query.before);
    },
    undefined,
    true,
    false,
    object({
      limit: Type.Optional(
        Type.String({ pattern: "^(?:[1-9]|[1-9][0-9]|100)$" }),
      ),
      before: Type.Optional(identifier),
    }),
  );
  route(
    "POST",
    "/api/tasks",
    "Create asynchronous Pi task; API model configuration is required.",
    (s, b, _r, reply) => {
      reply.code(202);
      return tasks.create(s, b.message);
    },
    object({ message: Type.String({ minLength: 1, maxLength: 4000 }) }),
  );
  route(
    "GET",
    "/api/tasks/:id",
    "Poll task, verified events, action cards and DAG dependencies.",
    (s, _b, r) => tasks.view(tasks.owned(s, id(r))),
  );
  route(
    "GET",
    "/api/tasks/:id/events",
    "Read events after a sequence cursor.",
    (s, _b, r) => {
      const after = Number((r.query as Body).after ?? 0);
      if (!Number.isSafeInteger(after) || after < 0)
        throw new AppError("INVALID_CURSOR", "Use a nonnegative sequence.");
      const t = tasks.owned(s, id(r));
      return {
        events: t.events.filter((e) => e.sequence > after),
        running: t.running,
        status: t.status,
      };
    },
  );
  route(
    "POST",
    "/api/tasks/:id/messages",
    "Resume with clarification or current verified action results.",
    (s, b, r, reply) => {
      reply.code(202);
      return tasks.resume(s, id(r), b.message);
    },
    object({ message: Type.String({ minLength: 1, maxLength: 4000 }) }),
  );
  route(
    "POST",
    "/api/tasks/:id/stop",
    "Abort the agent and cancel unexecuted actions.",
    (s, _b, r) => tasks.stop(s, id(r)),
    empty,
  );
  route(
    "POST",
    "/api/tasks/:id/takeover",
    "Transfer the task to manual customer controls; no verification bypass.",
    (s, _b, r) => tasks.stop(s, id(r), true),
    empty,
  );
  route(
    "POST",
    "/api/tasks/:id/release",
    "Release manual control back to the agent without executing pending actions.",
    (s, _b, r) => {
      const t = tasks.owned(s, id(r));
      if (t.running || t.leaseOwner !== "HUMAN")
        throw new AppError(
          "INVALID_STATE",
          "Task is not under manual control.",
          409,
        );
      t.leaseOwner = "AGENT";
      t.status = "WAITING";
      store.put("tasks", t);
      tasks.event(t.id, "MANUAL_CONTROL_RELEASED", {});
      return tasks.view(tasks.owned(s, t.id));
    },
    empty,
  );
  route(
    "GET",
    "/api/audit",
    "Read own sanitized append-only audit events.",
    (s) => ({ events: store.auditFor(s.customerId) }),
  );
  const ownedSecurityRequest = (s: Session, requestId: string) => {
    bank.customer(s);
    const request = store.get("securityRequests", requestId);
    if (!request || request.customerId !== s.customerId)
      throw new AppError("NOT_FOUND", "Security request not found.", 404);
    return request;
  };
  route(
    "GET",
    "/api/security/requests/:id",
    "Read an owned Agent-prepared security operation.",
    (s, _b, r) => ownedSecurityRequest(s, id(r)),
  );
  route(
    "POST",
    "/api/security/requests/:id/complete",
    "Confirm completion only from authoritative credential audit evidence.",
    (s, _b, r) =>
      store.transaction(() => {
        const request = ownedSecurityRequest(s, id(r));
        if (request.status === "COMPLETED") return request;
        if (request.status !== "PENDING")
          throw new AppError(
            "INVALID_STATE",
            "Security operation was cancelled.",
            409,
          );
        const events: Record<string, string> = {
          TOTP_SETUP: "TOTP_ENROLLED",
          TOTP_REMOVE: "TOTP_REMOVED",
          PASSKEY_ENROLL: "PASSKEY_ENROLLED",
          PASSKEY_RECOVER: "PASSKEY_RECOVERED",
          PASSKEY_REVOKE: "PASSKEY_REVOKED",
          PASSWORD_RESET: "PASSWORD_CHANGED",
        };
        if (
          !store
            .auditFor(s.customerId)
            .some(
              (e) =>
                e.event === events[request.operation] &&
                e.sequence > (request.auditSequenceAtCreation ?? 0) &&
                Date.parse(e.occurredAt) >= request.createdAt &&
                (!request.target || e.data.credentialId === request.target),
            )
        )
          throw new AppError(
            "VERIFICATION_REQUIRED",
            "The requested security operation has not completed.",
            403,
          );
        request.status = "COMPLETED";
        store.put("securityRequests", request);
        tasks.event(request.taskId, "SECURITY_COMPLETED", {
          requestId: request.id,
          operation: request.operation,
          status: request.status,
        });
        const task = store.get("tasks", request.taskId)!;
        if (
          !task.running &&
          task.status === "WAITING" &&
          !store
            .all("securityRequests")
            .some((x) => x.taskId === task.id && x.status === "PENDING") &&
          !task.actionIds.some(
            (x) =>
              !["SUCCEEDED", "CANCELLED", "FAILED"].includes(
                store.get("actions", x)!.status,
              ),
          )
        ) {
          task.status = "COMPLETED";
          store.put("tasks", task);
        }
        return request;
      }),
    empty,
  );
  app.addHook("onClose", async () => {
    await tasks.close();
    store.close();
  });
  return { app, store, bank, security, tasks };
}
