import test from "node:test";
import assert from "node:assert/strict";
import { TOTP, Secret, URI } from "otpauth";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture, authenticator as passkey } from "./helpers.js";
import { buildApp } from "../src/app.js";

test("TOTP SHA-1 matches published RFC 6238 Appendix B vectors", () => {
  const otp = new TOTP({
    secret: Secret.fromUTF8("12345678901234567890"),
    algorithm: "SHA1",
    digits: 8,
    period: 30,
  });
  for (const [seconds, expected] of [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ] as const)
    assert.equal(otp.generate({ timestamp: seconds * 1000 }), expected);
});
async function enroll(f: Awaited<ReturnType<typeof fixture>>) {
  const start = await f.request("POST", "/api/security/authenticator/start", {
    password: f.password,
  });
  assert.equal(start.statusCode, 200, start.body);
  const setup = await f.request("POST", "/api/security/authenticator/setup", {
    challengeId: start.json().challengeId,
    code: f.otp(start.json().challengeId),
  });
  assert.equal(setup.statusCode, 200, setup.body);
  const parsed = URI.parse(setup.json().uri) as TOTP;
  const finish = await f.request("POST", "/api/security/authenticator/verify", {
    challengeId: setup.json().challengeId,
    code: parsed.generate({ timestamp: f.bank.now() }),
  });
  assert.equal(finish.statusCode, 200, finish.body);
  const auth = {
    cookie: finish.cookies.find((c) => c.name === "bank_session")!.value,
    csrf: finish.json().csrfToken,
  };
  return {
    otp: parsed,
    auth,
    recoveryCodes: finish.json().recoveryCodes as string[],
    secret: setup.json().secret as string,
  };
}
test("Authenticator provisioning requires password and purpose/session-bound SMS; secrets are encrypted and hidden", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  assert.equal(
    (
      await f.request("POST", "/api/security/authenticator/start", {
        password: "incorrect",
      })
    ).statusCode,
    403,
  );
  const started = await f.request("POST", "/api/security/authenticator/start", {
    password: f.password,
  });
  const other = await f.login();
  assert.equal(
    (
      await f.request(
        "POST",
        "/api/security/authenticator/setup",
        {
          challengeId: started.json().challengeId,
          code: f.otp(started.json().challengeId),
        },
        other,
      )
    ).statusCode,
    403,
  );
  const setup = (
    await f.request("POST", "/api/security/authenticator/setup", {
      challengeId: started.json().challengeId,
      code: f.otp(started.json().challengeId),
    })
  ).json();
  assert.equal(
    (
      await f.request("POST", "/api/security/authenticator/setup", {
        challengeId: started.json().challengeId,
        code: f.otp(started.json().challengeId),
      })
    ).statusCode,
    403,
  );
  const wrong = (URI.parse(setup.uri) as TOTP).generate({
    timestamp: f.bank.now() + 300000,
  });
  assert.equal(
    (
      await f.request("POST", "/api/security/authenticator/verify", {
        challengeId: setup.challengeId,
        code: wrong,
      })
    ).statusCode,
    403,
  );
  assert.equal(f.store.get("totp", "alex"), undefined);
  f.advance(300001);
  assert.equal(
    (
      await f.request("POST", "/api/security/authenticator/verify", {
        challengeId: setup.challengeId,
        code: (URI.parse(setup.uri) as TOTP).generate({
          timestamp: f.bank.now(),
        }),
      })
    ).statusCode,
    403,
  );
  f.advance(60001);
  const enrolled = await enroll(f);
  assert.equal((await f.request("GET", "/api/auth/me")).statusCode, 401);
  const row = f.store.get("totp", "alex")!;
  assert.ok(!JSON.stringify(row).includes(enrolled.secret));
  assert.ok(
    enrolled.recoveryCodes.every((c) => !JSON.stringify(row).includes(c)),
  );
  const status = await f.request(
    "GET",
    "/api/security/authenticator",
    undefined,
    enrolled.auth,
  );
  assert.deepEqual(status.json(), { enabled: true, recoveryCodesRemaining: 8 });
  assert.ok(
    !JSON.stringify(f.store.auditFor("alex")).includes(enrolled.secret),
  );
  assert.ok(!JSON.stringify(f.store.all("tasks")).includes(enrolled.secret));
  // Enrollment does not add a login factor.
  const login = await f.login();
  assert.equal(
    (await f.request("GET", "/api/auth/me", undefined, login)).statusCode,
    200,
  );
});
type Fixture = Awaited<ReturnType<typeof fixture>>;
function addKey(f: Fixture) {
  const key = passkey();
  f.store.put("passkeys", {
    id: key.id,
    customerId: "alex",
    label: "Device",
    publicKey: key.publicKey,
    counter: 0,
    revoked: false,
    createdAt: f.bank.now(),
  });
  return key;
}
function rotate(f: Fixture, r: any) {
  assert.equal(r.statusCode, 200, r.body);
  Object.assign(f.auth, {
    cookie: r.cookies.find((c: any) => c.name === "bank_session").value,
    csrf: r.json().csrfToken,
  });
}
async function passwordProof(f: Fixture, operation: string, target?: string) {
  const c = await f.request(
    "POST",
    "/api/security/verification/password/start",
    { operation, password: f.password, ...(target ? { target } : {}) },
  );
  assert.equal(c.statusCode, 200, c.body);
  const p = await f.request(
    "POST",
    "/api/security/verification/password/verify",
    { challengeId: c.json().challengeId, code: f.otp(c.json().challengeId) },
  );
  assert.equal(p.statusCode, 200, p.body);
  return p.json().proofId as string;
}
async function keyProof(
  f: Fixture,
  key: ReturnType<typeof passkey>,
  operation: string,
  target?: string,
) {
  const c = await f.request(
    "POST",
    "/api/security/verification/passkey/options",
    { operation, ...(target ? { target } : {}) },
  );
  assert.equal(c.statusCode, 200, c.body);
  const p = await f.request(
    "POST",
    "/api/security/verification/passkey/verify",
    {
      challengeId: c.json().challengeId,
      response: key.assertion(c.json().options.challenge, {
        counter: f.store.get("passkeys", key.id)!.counter + 1,
      }),
    },
  );
  assert.equal(p.statusCode, 200, p.body);
  return p.json().proofId as string;
}
async function totpProof(
  f: Fixture,
  otp: TOTP,
  operation: string,
  target?: string,
) {
  const p = await f.request("POST", "/api/security/verification/totp", {
    operation,
    code: otp.generate({ timestamp: f.bank.now() }),
    ...(target ? { target } : {}),
  });
  assert.equal(p.statusCode, 200, p.body);
  return p.json().proofId as string;
}
async function ready(f: Fixture, amount = 100) {
  const a = await f.prepare(amount);
  assert.equal(
    (
      await f.request("POST", `/api/actions/${a.id}/confirm`, {
        version: a.version,
      })
    ).statusCode,
    200,
  );
  return a;
}
async function paymentTotp(f: Fixture, id: string, code: string) {
  const c = await f.request(
    "POST",
    `/api/actions/${id}/verify/totp/options`,
    {},
  );
  assert.equal(c.statusCode, 200, c.body);
  return f.request("POST", "/api/security/payment/totp/verify", {
    challengeId: c.json().challengeId,
    code,
  });
}
test("small transfers accept password, Passkey or TOTP independently; action/session/counter replay fails", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const e = await enroll(f);
  Object.assign(f.auth, e.auth);
  f.advance(30000);
  const key = addKey(f);
  const a = await ready(f);
  const pwd = await f.request("POST", `/api/actions/${a.id}/verify/password`, {
    password: f.password,
  });
  assert.equal(pwd.json().status, "AUTHORIZED");
  assert.equal(pwd.json().verificationRequired, undefined);
  assert.equal(
    (await f.request("POST", `/api/actions/${a.id}/execute`, {})).json().status,
    "SUCCEEDED",
  );
  const b = await ready(f);
  const pk = (
    await f.request("POST", `/api/actions/${b.id}/verify/passkey/options`, {})
  ).json();
  assert.equal(
    (
      await f.request("POST", "/api/security/payment/passkey/verify", {
        challengeId: pk.challengeId,
        response: key.assertion(pk.options.challenge),
      })
    ).json().status,
    "AUTHORIZED",
  );
  await f.request("POST", `/api/actions/${b.id}/execute`, {});
  const c = await ready(f);
  const options = (
    await f.request("POST", `/api/actions/${c.id}/verify/totp/options`, {})
  ).json();
  const code = e.otp.generate({ timestamp: f.bank.now() });
  const other = await f.login();
  const body = { challengeId: options.challengeId, code };
  assert.equal(
    (await f.request("POST", "/api/security/payment/totp/verify", body, other))
      .statusCode,
    403,
  );
  assert.equal(
    (await f.request("POST", "/api/security/payment/totp/verify", body)).json()
      .status,
    "AUTHORIZED",
  );
  assert.equal(
    (await f.request("POST", "/api/security/payment/totp/verify", body))
      .statusCode,
    403,
  );
  await f.request("POST", `/api/actions/${c.id}/execute`, {});
  const d = await ready(f);
  assert.equal((await paymentTotp(f, d.id, code)).statusCode, 403);
  f.advance(30000);
  assert.equal(
    (
      await paymentTotp(f, d.id, e.otp.generate({ timestamp: f.bank.now() }))
    ).json().status,
    "AUTHORIZED",
  );
});
test("higher-risk payments require two distinct options and still support password/SMS when no other option is enrolled", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const e = await enroll(f);
  Object.assign(f.auth, e.auth);
  f.advance(60001);
  const a = await ready(f, 100001);
  for (let i = 0; i < 2; i++) {
    const r = await f.request("POST", `/api/actions/${a.id}/verify/password`, {
      password: f.password,
    });
    assert.equal(r.json().status, "WAITING_FOR_VERIFICATION");
    assert.deepEqual(r.json().verification.verifiedMethods, ["PASSWORD"]);
  }
  assert.equal(
    (await f.request("POST", `/api/actions/${a.id}/execute`, {})).statusCode,
    403,
  );
  assert.equal(
    (
      await paymentTotp(f, a.id, e.otp.generate({ timestamp: f.bank.now() }))
    ).json().status,
    "AUTHORIZED",
  );
  assert.equal(
    (await f.request("POST", `/api/actions/${a.id}/execute`, {})).json().status,
    "SUCCEEDED",
  );
  const lone = await fixture();
  t.after(() => lone.app.close());
  const b = await ready(lone, 100001);
  const sms = (
    await lone.request("POST", `/api/actions/${b.id}/verify/password`, {
      password: lone.password,
    })
  ).json();
  assert.equal(sms.verificationRequired, "SMS");
  assert.equal(
    (
      await lone.request("POST", "/api/security/payment/sms/verify", {
        challengeId: sms.challengeId,
        code: lone.otp(sms.challengeId),
      })
    ).json().status,
    "AUTHORIZED",
  );
  assert.equal(
    (await lone.request("POST", `/api/actions/${b.id}/execute`, {})).json()
      .status,
    "SUCCEEDED",
  );
  const legacy = await ready(lone, 100001);
  const row = lone.store.get("actions", legacy.id)!;
  const session = lone.security.session(lone.auth.cookie);
  row.status = "AUTHORIZED";
  row.grant = {
    sessionId: session.id,
    epoch: session.epoch,
    expiresAt: lone.bank.now() + 120000,
    tier: "RED",
    method: "PASSKEY_UV",
  };
  lone.store.put("actions", row);
  assert.equal(
    (await lone.request("POST", `/api/actions/${row.id}/execute`, {})).json()
      .error.code,
    "RISK_UPGRADED",
  );
});
test("recovering an option uses two other enrolled options; duplicate, wrong-purpose and cross-session proofs cannot substitute", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const e = await enroll(f);
  Object.assign(f.auth, e.auth);
  const key = addKey(f);
  f.advance(60001);
  const policy = (
    await f.request(
      "GET",
      "/api/security/verification/policy?operation=TOTP_SETUP",
    )
  ).json();
  assert.equal(policy.requiredMethods, 2);
  assert.deepEqual(policy.availableMethods, ["PASSWORD", "PASSKEY_UV"]);
  assert.equal(
    (
      await f.request("POST", "/api/security/authenticator/start", {
        password: f.password,
      })
    ).json().error.code,
    "RECOVERY_FACTORS_REQUIRED",
  );
  const pwd = await passwordProof(f, "TOTP_SETUP");
  assert.equal(
    (
      await f.request("POST", "/api/security/authenticator/setup-with-proof", {
        proofIds: [pwd],
      })
    ).statusCode,
    403,
  );
  const second = await f.login();
  assert.equal(
    (
      await f.request(
        "POST",
        "/api/security/authenticator/setup-with-proof",
        { proofIds: [pwd] },
        second,
      )
    ).statusCode,
    403,
  );
  f.advance(60001);
  const duplicate = await passwordProof(f, "TOTP_SETUP");
  assert.equal(
    (
      await f.request("POST", "/api/security/authenticator/setup-with-proof", {
        proofIds: [pwd, duplicate],
      })
    ).statusCode,
    403,
  );
  const wrong = await keyProof(f, key, "PASSKEY_ENROLL");
  assert.equal(
    (
      await f.request("POST", "/api/security/authenticator/setup-with-proof", {
        proofIds: [pwd, wrong],
      })
    ).statusCode,
    403,
  );
  const pk = await keyProof(f, key, "TOTP_SETUP");
  const setup = await f.request(
    "POST",
    "/api/security/authenticator/setup-with-proof",
    { proofIds: [pwd, pk] },
  );
  assert.equal(setup.statusCode, 200, setup.body);
  assert.equal(
    (
      await f.request("POST", "/api/security/authenticator/setup-with-proof", {
        proofIds: [pwd, pk],
      })
    ).statusCode,
    403,
  );
  assert.equal(f.store.get("totp", "alex")!.enabled, true); // The old credential remains active until replacement is confirmed.
  const otp = URI.parse(setup.json().uri) as TOTP;
  const done = await f.request("POST", "/api/security/authenticator/verify", {
    challengeId: setup.json().challengeId,
    code: otp.generate({ timestamp: f.bank.now() }),
  });
  rotate(f, done);
  assert.equal(done.json().security.holdUntil, 0);
  assert.equal(f.store.get("passkeys", key.id)!.revoked, false);
});
test("limited backup enrollment permits password/SMS recovery with no routine funds hold; removal cannot bypass two-option recovery", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const old = addKey(f);
  const replacement = passkey();
  const policy = (
    await f.request(
      "GET",
      "/api/security/verification/policy?operation=PASSKEY_RECOVER",
    )
  ).json();
  assert.equal(policy.requiredMethods, 1);
  assert.equal(policy.limitedOptions, true);
  const pwd = await passwordProof(f, "PASSKEY_RECOVER");
  const options = await f.request("POST", "/api/security/recovery/options", {
    proofIds: [pwd],
  });
  assert.equal(options.statusCode, 200, options.body);
  const done = await f.request("POST", "/api/security/recovery/verify", {
    challengeId: options.json().challengeId,
    response: replacement.registration(options.json().options.challenge),
    label: "Replacement",
  });
  rotate(f, done);
  assert.equal(done.json().security.holdUntil, 0);
  assert.equal(f.store.get("passkeys", old.id)!.revoked, true);
  const a = await ready(f);
  assert.equal(
    (
      await f.request("POST", `/api/actions/${a.id}/verify/password`, {
        password: f.password,
      })
    ).json().status,
    "AUTHORIZED",
  );
  f.advance(60001);
  const e = await enroll(f);
  Object.assign(f.auth, e.auth);
  f.advance(60001);
  const removal = (
    await f.request(
      "GET",
      "/api/security/verification/policy?operation=TOTP_REMOVE",
    )
  ).json();
  assert.equal(removal.requiredMethods, 2);
  assert.ok(!removal.availableMethods.includes("TOTP"));
  assert.equal(
    (
      await f.request("POST", "/api/security/authenticator/remove", {
        password: f.password,
      })
    ).statusCode,
    403,
  );
  const one = await passwordProof(f, "TOTP_REMOVE");
  assert.equal(
    (
      await f.request("POST", "/api/security/authenticator/remove", {
        proofIds: [one],
      })
    ).statusCode,
    403,
  );
  const pk = await keyProof(f, replacement, "TOTP_REMOVE");
  const removed = await f.request(
    "POST",
    "/api/security/authenticator/remove",
    { proofIds: [one, pk] },
  );
  rotate(f, removed);
  assert.equal(removed.json().security.holdUntil, 0);
  assert.equal(f.store.get("totp", "alex"), undefined);
});
test("subscription writes can use TOTP alone; password reset uses enrolled backups and invalidates prior sessions", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const e = await enroll(f);
  Object.assign(f.auth, e.auth);
  const key = addKey(f);
  f.advance(30000);
  const a = (
    await f.request("POST", "/api/actions", {
      kind: "MANDATE_REVOKE",
      params: { subscriptionId: "subscription-alex-stream" },
      idempotencyKey: "totp-mandate",
    })
  ).json();
  await f.request("POST", `/api/actions/${a.id}/confirm`, {
    version: a.version,
  });
  assert.equal(
    (await paymentTotp(f, a.id, e.recoveryCodes[0]!)).statusCode,
    400,
  );
  assert.equal(
    (
      await paymentTotp(f, a.id, e.otp.generate({ timestamp: f.bank.now() }))
    ).json().status,
    "AUTHORIZED",
  );
  assert.equal(
    (await f.request("POST", `/api/actions/${a.id}/execute`, {})).json().status,
    "SUCCEEDED",
  );
  f.advance(30000);
  const totp = await totpProof(f, e.otp, "PASSWORD_RESET");
  const pk = await keyProof(f, key, "PASSWORD_RESET");
  const newPassword = "Replacement-password-for-test";
  const old = { ...f.auth };
  const done = await f.request("POST", "/api/security/password/reset", {
    proofIds: [totp, pk],
    newPassword,
  });
  rotate(f, done);
  assert.equal(done.json().security.holdUntil, 0);
  assert.equal(
    (await f.request("GET", "/api/auth/me", undefined, old)).statusCode,
    401,
  );
  assert.throws(() => f.security.login("alex", f.password));
  assert.ok(f.security.login("alex", newPassword));
  const lone = await fixture();
  t.after(() => lone.app.close());
  const p = (
    await lone.request(
      "GET",
      "/api/security/verification/policy?operation=PASSWORD_RESET",
    )
  ).json();
  assert.equal(p.requiredMethods, 0);
  assert.equal(p.limitedOptions, true);
});
test("offline recovery codes cannot authorize transfers and do not impose a routine hold", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const e = await enroll(f);
  Object.assign(f.auth, e.auth);
  f.advance(30000);
  assert.equal(
    (
      await f.request("POST", "/api/security/authenticator/recover", {
        password: f.password,
        recoveryCode: "0".repeat(20),
      })
    ).statusCode,
    403,
  );
  const done = await f.request("POST", "/api/security/authenticator/recover", {
    password: f.password,
    recoveryCode: e.recoveryCodes[0],
  });
  rotate(f, done);
  assert.equal(done.json().security.holdUntil, 0);
  assert.equal(f.store.get("totp", "alex"), undefined);
});
test("TOTP replay and failure budget survive restart; valid clock drift is bounded", async (t) => {
  const path = join(mkdtempSync(join(tmpdir(), "bank-totp-")), "bank.sqlite");
  const f = await fixture({ databasePath: path });
  const enrolled = await enroll(f);
  Object.assign(f.auth, enrolled.auth);
  f.advance(30000);
  const a = await f.prepare(100);
  await f.request("POST", `/api/actions/${a.id}/confirm`, {
    version: a.version,
  });
  const c = (
    await f.request("POST", `/api/actions/${a.id}/verify/totp/options`, {})
  ).json();
  const oldTime = f.bank.now();
  for (let n = 0; n < 5; n++)
    assert.equal(
      (
        await f.request("POST", "/api/security/payment/totp/verify", {
          challengeId: c.challengeId,
          code: enrolled.otp.generate({ timestamp: oldTime + 300000 }),
        })
      ).statusCode,
      403,
    );
  assert.equal(
    (
      await f.request("POST", "/api/security/payment/totp/verify", {
        challengeId: c.challengeId,
        code: enrolled.otp.generate({ timestamp: oldTime }),
      })
    ).statusCode,
    429,
  );
  await f.app.close();
  let now = oldTime;
  const restarted = await buildApp(f.config, { now: () => now });
  t.after(() => restarted.app.close());
  assert.throws(
    () =>
      restarted.security.authenticator.verifyCurrent(
        restarted.security.session(f.auth.cookie),
        enrolled.otp.generate({ timestamp: now }),
      ),
    /Wait/,
  );
  now += 300001;
  const session = restarted.security.session(f.auth.cookie);
  restarted.security.authenticator.verifyCurrent(
    session,
    enrolled.otp.generate({ timestamp: now + 30000 }),
  );
  assert.throws(
    () =>
      restarted.security.authenticator.verifyCurrent(
        session,
        enrolled.otp.generate({ timestamp: now + 30000 }),
      ),
    /already used/,
  );
  assert.throws(
    () =>
      restarted.security.authenticator.verifyCurrent(
        session,
        enrolled.otp.generate({ timestamp: now + 90000 }),
      ),
    /Invalid/,
  );
});
