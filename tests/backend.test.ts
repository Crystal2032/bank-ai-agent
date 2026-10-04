import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { fixture, authenticator } from "./helpers.js";
import { buildApp } from "../src/app.js";

test("HTTP session, strict input, origin, CSRF, ownership and model-not-configured boundaries", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  assert.equal((await f.request("GET", "/api/bank/accounts")).statusCode, 200);
  const noCookie = await f.app.inject({
    method: "GET",
    url: "/api/bank/accounts",
  });
  assert.equal(noCookie.statusCode, 401);
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: "/api/actions",
        headers: {
          origin: "https://attacker.invalid",
          cookie: `bank_session=${f.auth.cookie}`,
        },
        payload: {},
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: "/api/auth/logout",
        headers: {
          origin: f.config.origin,
          cookie: `bank_session=${f.auth.cookie}`,
        },
        payload: {},
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await f.request("POST", "/api/actions", {
        kind: "TRANSFER",
        params: { contactId: "contact-jordan", amountMinor: 10.2 },
        idempotencyKey: "invalid",
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await f.request("POST", "/api/actions", {
        kind: "TRANSFER",
        params: { contactId: "contact-jordan", amountMinor: 10 },
        idempotencyKey: "invalid",
        approved: true,
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await f.request("POST", "/api/tasks", { message: "Check my balance." })
    ).json().error.code,
    "MODEL_NOT_CONFIGURED",
  );
  const action = await f.prepare(30000);
  const other = await f.login("jordan");
  assert.equal(
    (await f.request("GET", `/api/actions/${action.id}`, undefined, other))
      .statusCode,
    404,
  );
  assert.equal(
    (await f.request("POST", `/api/actions/${action.id}/execute`, {}, other))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await f.request("POST", "/api/actions", {
        kind: "TRANSFER",
        params: { contactId: "contact-alex", amountMinor: 100 },
        idempotencyKey: "foreign-contact",
      })
    ).statusCode,
    400,
  );
  assert.ok(!(await f.request("GET", "/api/actions")).body.includes("grant"));
});

test("fresh password approval, immutable parameters and idempotent repeated execution", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const action = await f.prepare(30000, "rent-key");
  assert.equal(
    (await f.request("POST", `/api/actions/${action.id}/execute`, {}))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await f.request("POST", `/api/actions/${action.id}/confirm`, {
        version: 2,
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await f.request("POST", `/api/actions/${action.id}/confirm`, {
        version: 1,
      })
    ).json().status,
    "WAITING_FOR_VERIFICATION",
  );
  assert.equal(
    (await f.request("POST", `/api/actions/${action.id}/execute`, {}))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await f.request("POST", `/api/actions/${action.id}/verify/password`, {
        password: randomBytes(12).toString("hex"),
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await f.request("POST", `/api/actions/${action.id}/verify/password`, {
        password: f.password,
      })
    ).json().status,
    "AUTHORIZED",
  );
  const before = f.bank.account("alex").balanceMinor;
  const results = await Promise.all(
    Array.from({ length: 4 }, () =>
      f.request("POST", `/api/actions/${action.id}/execute`, {}),
    ),
  );
  assert.ok(
    results.every(
      (r) => r.statusCode === 200 && r.json().status === "SUCCEEDED",
    ),
  );
  assert.equal(f.bank.account("alex").balanceMinor, before - 30000);
  assert.equal(
    f.store.all("ledger").filter((e) => e.operationId === action.id).length,
    2,
  );
  assert.equal(new Set(results.map((r) => r.json().receiptId)).size, 1);
  assert.equal(
    (await f.request("POST", `/api/actions/${action.id}/cancel`, {}))
      .statusCode,
    409,
  );
  const duplicate = await f.prepare(30000, "rent-key");
  assert.equal(duplicate.id, action.id);
  assert.equal(
    (
      await f.request("POST", "/api/actions", {
        kind: "TRANSFER",
        params: {
          contactId: "contact-jordan",
          amountMinor: 30001,
          note: "Shared rent",
        },
        idempotencyKey: "rent-key",
      })
    ).statusCode,
    409,
  );
  const second = await f.prepare(100);
  await f.request("POST", `/api/actions/${second.id}/confirm`, { version: 1 });
  assert.equal(
    (await f.request("POST", `/api/actions/${second.id}/execute`, {}))
      .statusCode,
    403,
  );
});

test("daily boundary, concurrent reservations, risk upgrade and password-plus-SMS", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const first = await f.prepare(100000);
  assert.equal(first.tier, "YELLOW");
  await f.request("POST", `/api/actions/${first.id}/confirm`, { version: 1 });
  await f.request("POST", `/api/actions/${first.id}/verify/password`, {
    password: f.password,
  });
  const second = await f.prepare(1);
  assert.equal(second.tier, "RED");
  const upgrade = await f.request(
    "POST",
    `/api/actions/${first.id}/execute`,
    {},
  );
  assert.equal(upgrade.json().error.code, "RISK_UPGRADED");
  const proof = await f.request(
    "POST",
    `/api/actions/${first.id}/verify/password`,
    { password: f.password },
  );
  assert.equal(proof.json().verificationRequired, "SMS");
  assert.equal(
    (await f.request("POST", `/api/actions/${first.id}/execute`, {}))
      .statusCode,
    403,
  );
  const challengeId = proof.json().challengeId;
  assert.equal(
    (
      await f.request("POST", "/api/security/payment/sms/verify", {
        challengeId,
        code: "000000",
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await f.request("POST", "/api/security/payment/sms/verify", {
        challengeId,
        code: f.otp(challengeId),
      })
    ).json().status,
    "AUTHORIZED",
  );
  assert.equal(
    (
      await f.request("POST", "/api/security/payment/sms/verify", {
        challengeId,
        code: f.otp(challengeId),
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await f.request("POST", `/api/actions/${first.id}/execute`, {})).json()
      .status,
    "SUCCEEDED",
  );
  assert.equal(
    (await f.request("GET", `/api/actions/${second.id}`)).json().tier,
    "RED",
  );
});

test("expired grants, session-bound proof, funds and atomic ledger rollback", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const action = await f.prepare(500);
  await f.request("POST", `/api/actions/${action.id}/confirm`, { version: 1 });
  await f.request("POST", `/api/actions/${action.id}/verify/password`, {
    password: f.password,
  });
  const secondSession = await f.login();
  assert.equal(
    (
      await f.request(
        "POST",
        `/api/actions/${action.id}/execute`,
        {},
        secondSession,
      )
    ).statusCode,
    403,
  );
  f.advance(120001);
  assert.equal(
    (await f.request("POST", `/api/actions/${action.id}/execute`, {}))
      .statusCode,
    403,
  );
  const big = await f.request("POST", "/api/actions", {
    kind: "TRANSFER",
    params: { contactId: "contact-jordan", amountMinor: 2000001 },
    idempotencyKey: "too-much",
  });
  assert.equal(big.json().error.code, "INSUFFICIENT_FUNDS");
  const next = await f.prepare(1000);
  await f.request("POST", `/api/actions/${next.id}/confirm`, { version: 1 });
  await f.request("POST", `/api/actions/${next.id}/verify/password`, {
    password: f.password,
  });
  const before = f.bank.account("alex").balanceMinor;
  const original = f.store.audit.bind(f.store);
  f.store.audit = (customer, event, data, now) => {
    if (event === "DISPATCH_SUCCEEDED")
      throw new Error("Injected durable-write failure");
    return original(customer, event, data, now);
  };
  assert.equal(
    (await f.request("POST", `/api/actions/${next.id}/execute`, {})).statusCode,
    500,
  );
  assert.equal(f.bank.account("alex").balanceMinor, before);
  assert.equal(f.store.all("receipts").length, 0);
  f.store.audit = original;
  assert.equal(
    (await f.request("POST", `/api/actions/${next.id}/execute`, {})).json()
      .status,
    "SUCCEEDED",
  );
});

test("subscription lookup is yellow; cancellation and mandate revocation have distinct effects", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const create = (
    kind: string,
    params: object = {},
    dependsOn: string[] = [],
  ) =>
    f.request("POST", "/api/actions", {
      kind,
      params,
      dependsOn,
      idempotencyKey: randomBytes(8).toString("hex"),
    });
  const lookup = (await create("SUBSCRIPTION_LOOKUP")).json();
  assert.equal(lookup.tier, "YELLOW");
  assert.equal(
    (await f.request("POST", `/api/actions/${lookup.id}/execute`, {}))
      .statusCode,
    403,
  );
  const cancellation = (
    await create(
      "SUBSCRIPTION_CANCEL",
      { subscriptionId: "subscription-alex-stream" },
      [lookup.id],
    )
  ).json();
  assert.equal(
    (
      await f.request("POST", `/api/actions/${cancellation.id}/confirm`, {
        version: 1,
      })
    ).json().error.code,
    "DEPENDENCY_PENDING",
  );
  await f.request("POST", `/api/actions/${lookup.id}/confirm`, { version: 1 });
  const result = await f.request(
    "POST",
    `/api/actions/${lookup.id}/execute`,
    {},
  );
  assert.equal(result.json().result[0].status, "ACTIVE");
  await f.request("POST", `/api/actions/${cancellation.id}/confirm`, {
    version: 1,
  });
  await f.request("POST", `/api/actions/${cancellation.id}/execute`, {});
  assert.equal(
    f.store.get("subscriptions", "subscription-alex-stream")!.status,
    "CANCELLED",
  );
  assert.equal(
    f.store.get("subscriptions", "subscription-alex-stream")!.mandateActive,
    true,
  );
  const revoke = (
    await create("MANDATE_REVOKE", {
      subscriptionId: "subscription-alex-stream",
    })
  ).json();
  await f.request("POST", `/api/actions/${revoke.id}/confirm`, { version: 1 });
  await f.request("POST", `/api/actions/${revoke.id}/execute`, {});
  assert.equal(
    f.store.get("subscriptions", "subscription-alex-stream")!.mandateActive,
    false,
  );
  const report = (
    await f.request("GET", "/api/bank/bill-report?month=2026-10")
  ).json();
  assert.equal(report.totalOutgoingMinor, 41000);
  assert.equal(report.transactionIds.length, 4);
  assert.equal(report.recurringCandidates[0].certainty, "CANDIDATE");
});

test("cryptographic Passkey assertions reject wrong origin, missing UV and replay", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const key = authenticator();
  f.store.put("passkeys", {
    id: key.id,
    customerId: "alex",
    label: "Software test authenticator",
    publicKey: key.publicKey,
    counter: 0,
    revoked: false,
    createdAt: f.bank.now(),
  });
  const action = await f.prepare(100001);
  await f.request("POST", `/api/actions/${action.id}/confirm`, { version: 1 });
  const options = (
    await f.request(
      "POST",
      `/api/actions/${action.id}/verify/passkey/options`,
      {},
    )
  ).json();
  const verify = (response: unknown) =>
    f.request("POST", "/api/security/payment/passkey/verify", {
      challengeId: options.challengeId,
      response,
    });
  assert.equal(
    (
      await verify(
        key.assertion(options.options.challenge, {
          origin: "https://attacker.invalid",
        }),
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (await verify(key.assertion(options.options.challenge, { uv: false })))
      .statusCode,
    403,
  );
  assert.equal(
    (await verify(key.assertion(options.options.challenge))).json().status,
    "WAITING_FOR_VERIFICATION",
  );
  assert.equal(
    (await verify(key.assertion(options.options.challenge))).statusCode,
    403,
  );
  assert.equal(
    (
      await f.request("POST", `/api/actions/${action.id}/verify/password`, {
        password: f.password,
      })
    ).json().status,
    "AUTHORIZED",
  );
  assert.equal(
    (await f.request("POST", `/api/actions/${action.id}/execute`, {})).json()
      .status,
    "SUCCEEDED",
  );
  assert.equal(f.store.get("passkeys", key.id)!.counter, 1);
});

test("password-plus-original-phone recovery rotates epoch and restricts payments only after repeated factor failures", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const oldKey = authenticator();
  const newKey = authenticator();
  f.store.put("passkeys", {
    id: oldKey.id,
    customerId: "alex",
    label: "Old key",
    publicKey: oldKey.publicKey,
    counter: 0,
    revoked: false,
    createdAt: f.bank.now(),
  });
  const action = await f.prepare(100);
  await f.request("POST", `/api/actions/${action.id}/confirm`, { version: 1 });
  await f.request("POST", `/api/actions/${action.id}/verify/password`, {
    password: f.password,
  });
  assert.equal(
    (
      await f.request("POST", "/api/security/recovery/start", {
        password: f.password,
        phone: "+8613999999999",
      })
    ).statusCode,
    400,
  );
  const start = (
    await f.request("POST", "/api/security/recovery/start", {
      password: f.password,
    })
  ).json();
  assert.equal(
    (
      await f.request("POST", "/api/security/passkeys/enrollment/options", {
        challengeId: start.challengeId,
        code: f.otp(start.challengeId),
      })
    ).statusCode,
    403,
  );
  const options = (
    await f.request("POST", "/api/security/recovery/options", {
      challengeId: start.challengeId,
      code: f.otp(start.challengeId),
    })
  ).json();
  assert.equal(
    (
      await f.request("POST", "/api/security/recovery/verify", {
        challengeId: options.challengeId,
        response: newKey.registration(
          options.options.challenge,
          "https://attacker.invalid",
        ),
        label: "Replacement",
      })
    ).statusCode,
    403,
  );
  for (let i = 0; i < 5; i++)
    f.store.audit(
      "alex",
      "FACTOR_REJECTED",
      { method: "PASSWORD" },
      f.bank.now(),
    );
  const finish = await f.request("POST", "/api/security/recovery/verify", {
    challengeId: options.challengeId,
    response: newKey.registration(options.options.challenge),
    label: "Replacement",
  });
  assert.equal(finish.statusCode, 200, finish.body);
  const identity = {
    cookie: finish.cookies.find((c) => c.name === "bank_session")!.value,
    csrf: finish.json().csrfToken,
  };
  assert.equal(f.store.get("passkeys", oldKey.id)!.revoked, true);
  assert.equal(f.store.get("passkeys", newKey.id)!.revoked, false);
  assert.equal((await f.request("GET", "/api/auth/me")).statusCode, 401);
  assert.equal(
    (
      await f.request("GET", "/api/actions/" + action.id, undefined, identity)
    ).json().status,
    "WAITING_FOR_VERIFICATION",
  );
  assert.equal(
    (
      await f.request("POST", `/api/actions/${action.id}/execute`, {}, identity)
    ).json().error.code,
    "RECOVERY_HOLD",
  );
  assert.equal(
    (
      await f.request(
        "POST",
        `/api/actions/${action.id}/verify/password`,
        { password: f.password },
        identity,
      )
    ).json().error.code,
    "RECOVERY_HOLD",
  );
  assert.equal(
    (await f.request("GET", "/api/bank/accounts", undefined, identity))
      .statusCode,
    200,
  );
  f.advance(86400001);
  assert.equal(
    (await f.request("GET", "/api/auth/me", undefined, identity)).statusCode,
    401,
  );
  const afterHold = await f.login();
  assert.equal(
    (
      await f.request(
        "POST",
        `/api/actions/${action.id}/execute`,
        {},
        afterHold,
      )
    ).statusCode,
    403,
  );
  const freshResponse = await f.request(
    "POST",
    "/api/actions",
    {
      kind: "TRANSFER",
      params: { contactId: "contact-jordan", amountMinor: 100 },
      idempotencyKey: "after-recovery-hold",
    },
    afterHold,
  );
  assert.equal(freshResponse.statusCode, 200);
  const fresh = freshResponse.json();
  await f.request(
    "POST",
    `/api/actions/${fresh.id}/confirm`,
    { version: 1 },
    afterHold,
  );
  assert.equal(
    (
      await f.request(
        "POST",
        `/api/actions/${fresh.id}/verify/password`,
        { password: f.password },
        afterHold,
      )
    ).json().status,
    "AUTHORIZED",
  );
  assert.equal(
    (
      await f.request("POST", `/api/actions/${fresh.id}/execute`, {}, afterHold)
    ).json().status,
    "SUCCEEDED",
  );
});

test("OTP failure budget and resend controls persist; recovery cannot authorize a payment", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const start = (
    await f.request("POST", "/api/security/recovery/start", {
      password: f.password,
    })
  ).json();
  assert.equal(
    (
      await f.request("POST", "/api/security/recovery/start", {
        password: f.password,
      })
    ).statusCode,
    429,
  );
  assert.equal(
    (
      await f.request("POST", "/api/security/payment/sms/verify", {
        challengeId: start.challengeId,
        code: f.otp(start.challengeId),
      })
    ).statusCode,
    403,
  );
  for (let n = 0; n < 5; n++)
    assert.equal(
      (
        await f.request("POST", "/api/security/recovery/options", {
          challengeId: start.challengeId,
          code: "000000",
        })
      ).statusCode,
      403,
    );
  assert.equal(f.store.get("challenges", start.challengeId)!.attempts, 5);
  assert.equal(
    (
      await f.request("POST", "/api/security/recovery/options", {
        challengeId: start.challengeId,
        code: f.otp(start.challengeId),
      })
    ).statusCode,
    403,
  );
  assert.equal(f.store.get("customers", "alex")!.holdUntil, 0);
});

test("restart preserves sessions, approval and receipts; response-loss retry never duplicates money", async (t) => {
  const base = await fixture();
  await base.app.close();
  const path = join(base.directory, "persistent.sqlite");
  const f = await fixture({ databasePath: path });
  const action = await f.prepare(1000);
  await f.request("POST", `/api/actions/${action.id}/confirm`, { version: 1 });
  await f.request("POST", `/api/actions/${action.id}/verify/password`, {
    password: f.password,
  });
  await f.request("POST", `/api/actions/${action.id}/execute`, {});
  const balance = f.bank.account("alex").balanceMinor;
  await f.app.close();
  const restarted = await buildApp(f.config, { now: f.bank.now });
  t.after(() => restarted.app.close());
  const response = await restarted.app.inject({
    method: "POST",
    url: `/api/actions/${action.id}/execute`,
    headers: {
      origin: f.config.origin,
      cookie: `bank_session=${f.auth.cookie}`,
      "x-csrf-token": f.auth.csrf,
    },
    payload: {},
  });
  assert.equal(response.json().status, "SUCCEEDED");
  assert.equal(restarted.bank.account("alex").balanceMinor, balance);
  assert.equal(restarted.store.all("receipts").length, 1);
  assert.throws(
    () => restarted.store.db.exec("DELETE FROM audit"),
    /append-only/,
  );
});
