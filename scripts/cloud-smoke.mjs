import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

// Explicitly run against synthetic accounts only. Never prints cookies/factors.
const [base, credentialsPath] = process.argv.slice(2);
const origin = new URL(base).origin;
assert.equal(new URL(origin).protocol, "https:");
const env = Object.fromEntries(
  readFileSync(credentialsPath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);
const clientOrigin = "https://localhost";
async function raw(path, method = "GET", body, identity, extraHeaders = {}) {
  return fetch(origin + path, {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(45000),
    headers: {
      Origin: clientOrigin,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(identity
        ? { Cookie: identity.cookie, "X-CSRF-Token": identity.csrf }
        : {}),
      ...extraHeaders,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
async function request(path, method, body, identity, expected = 200) {
  const response = await raw(path, method, body, identity);
  assert.equal(response.status, expected, `${method || "GET"} ${path} status`);
  return response.json();
}
async function login(username) {
  const response = await raw("/api/auth/login", "POST", {
    username,
    password: env.DEMO_PASSWORD,
  });
  assert.equal(response.status, 200);
  const setCookie = response.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /Secure/i);
  assert.match(setCookie, /SameSite=Strict/i);
  return {
    cookie: setCookie.split(";")[0],
    csrf: (await response.json()).csrfToken,
  };
}
const report = {};
const health = await request("/health");
assert.equal(health.model, "API_CONFIGURED");
assert.equal(health.banking, "SIMULATED");
report.health = health;
assert.equal((await raw("/api/bank/accounts")).status, 401);
const alex = await login(env.USERNAME || "alex");
const jordan = await login(env.ALTERNATE_USERNAME || "jordan");
try {
  const before = await request("/api/bank/accounts", "GET", undefined, alex);
  const params = {
    kind: "TRANSFER",
    params: {
      contactId: "contact-jordan",
      amountMinor: 100,
      note: "Cloud deployment smoke test",
    },
    idempotencyKey: randomUUID(),
  };
  assert.equal(
    (
      await raw("/api/actions", "POST", params, alex, {
        "X-CSRF-Token": "invalid",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await raw("/api/actions", "POST", params, alex, {
        Origin: "https://attacker.example",
      })
    ).status,
    403,
  );
  const action = await request("/api/actions", "POST", params, alex);
  assert.equal(
    (await raw(`/api/actions/${action.id}`, "GET", undefined, jordan)).status,
    404,
  );
  const confirmed = await request(
    `/api/actions/${action.id}/confirm`,
    "POST",
    { version: action.version },
    alex,
  );
  assert.equal(confirmed.status, "WAITING_FOR_VERIFICATION");
  assert.equal(
    (await raw(`/api/actions/${action.id}/execute`, "POST", {}, alex)).status,
    403,
  );
  assert.equal(
    (
      await raw(
        `/api/actions/${action.id}/verify/password`,
        "POST",
        { password: "invalid-password" },
        alex,
      )
    ).status,
    403,
  );
  const verified = await request(
    `/api/actions/${action.id}/verify/password`,
    "POST",
    { password: env.DEMO_PASSWORD },
    alex,
  );
  assert.equal(verified.status, "AUTHORIZED");
  const completed = await request(
    `/api/actions/${action.id}/execute`,
    "POST",
    {},
    alex,
  );
  assert.equal(completed.status, "SUCCEEDED");
  const retry = await request(
    `/api/actions/${action.id}/execute`,
    "POST",
    {},
    alex,
  );
  assert.equal(retry.receiptId, completed.receiptId);
  const receipt = await request(
    `/api/receipts/${completed.receiptId}`,
    "GET",
    undefined,
    alex,
  );
  assert.equal(receipt.actionId, action.id);
  const after = await request("/api/bank/accounts", "GET", undefined, alex);
  assert.equal(
    after.accounts[0].balanceMinor,
    before.accounts[0].balanceMinor - 100,
  );
  report.payment = {
    status: completed.status,
    amountMinor: 100,
    currency: "CNY",
    idempotent: true,
    receipt: completed.receiptId,
  };
  report.security = {
    secureCookie: true,
    csrf: true,
    originRestriction: true,
    ownership: true,
    freshPassword: true,
  };
  const created = await request(
    "/api/tasks",
    "POST",
    {
      message:
        "Show my current account balance. Use the banking balance tool and do not prepare any payments.",
    },
    alex,
    202,
  );
  let task = created;
  for (let n = 0; n < 80 && task.running; n++) {
    await delay(1000);
    task = await request(`/api/tasks/${created.id}`, "GET", undefined, alex);
  }
  report.agent = {
    taskId: task.id,
    status: task.status,
    error: task.error,
    events: task.events.map((e) => e.type),
    evidence: task.events
      .filter((e) => e.type === "ACCOUNTS")
      .map((e) => e.type),
  };
  assert.equal(task.running, false);
  assert.equal(task.status, "COMPLETED");
  assert.ok(
    task.events.some((e) => e.type === "ACCOUNTS"),
    "Live model must return canonical balance evidence",
  );
  report.result = "PASS";
} finally {
  await request("/api/auth/logout", "POST", {}, alex);
  await request("/api/auth/logout", "POST", {}, jordan);
  console.log(JSON.stringify(report, null, 2));
}
