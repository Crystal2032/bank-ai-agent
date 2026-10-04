import { afterEach, describe, expect, it, vi } from "vitest";
import {
  api,
  ApiError,
  onUnauthorized,
  setCsrfToken,
  isTotpChallenge,
  isSmsChallenge,
} from "../src/api/client";

type Call = { url: string; init: RequestInit };

function mockFetch(responses: (() => Response | Promise<Response>)[]) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const next = responses.shift();
      if (!next) throw new Error("Unexpected request");
      return next();
    }),
  );
  return calls;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const session = (csrfToken: string) => ({
  csrfToken,
  customer: {
    id: "alex",
    name: "Alex Morgan",
    username: "alex",
    maskedPhone: "***0001",
  },
  security: { holdUntil: 0, locked: false },
  bankingSimulated: true,
});

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken(null);
  onUnauthorized(null);
});

describe("api client", () => {
  it("keeps Authenticator factors on dedicated routes and adopts rotated enrollment sessions", async () => {
    setCsrfToken("before");
    const calls = mockFetch([
      () =>
        json(200, {
          verificationRequired: "TOTP",
          challengeId: "c1",
          expiresAt: 999,
        }),
      () => json(200, { id: "a1", status: "AUTHORIZED" }),
      () =>
        json(200, {
          ...session("after"),
          recoveryCodes: ["private-recovery-code"],
        }),
      () => json(200, { signedOut: true }),
    ]);
    const result = await api.verifyPaymentPassword("a1", "private-password");
    expect(isTotpChallenge(result)).toBe(true);
    expect(isSmsChallenge(result)).toBe(false);
    await api.verifyPaymentTotp("c1", "123456");
    await api.authenticatorVerify("setup", "234567");
    await api.logout();
    expect(calls[1]!.url).toContain("/api/security/payment/totp/verify");
    expect(calls[2]!.url).toContain("/api/security/authenticator/verify");
    expect(
      (calls[3]!.init.headers as Record<string, string>)["X-CSRF-Token"],
    ).toBe("after");
    expect(calls.every((c) => !c.url.includes("tasks"))).toBe(true);
  });
  it("sends credentials and the in-memory CSRF token on POST", async () => {
    const calls = mockFetch([
      () => json(200, session("token-1")),
      () => json(200, { signedOut: true }),
    ]);
    await api.login("alex", "secret-password");
    await api.logout();
    expect(calls[0]!.init.credentials).toBe("include");
    expect(calls[0]!.url).toBe("http://localhost:3001/api/auth/login");
    expect(
      (calls[1]!.init.headers as Record<string, string>)["X-CSRF-Token"],
    ).toBe("token-1");
    expect(calls[1]!.init.body).toBe("{}");
  });

  it("refreshes the CSRF token once and retries a rejected POST", async () => {
    setCsrfToken("stale");
    const calls = mockFetch([
      () =>
        json(403, {
          error: {
            code: "CSRF_REJECTED",
            message: "Refresh your security token.",
          },
        }),
      () => json(200, session("fresh")),
      () => json(200, { id: "a1", status: "CANCELLED" }),
    ]);
    const result = await api.cancelAction("a1");
    expect(result.status).toBe("CANCELLED");
    expect(calls[1]!.url).toContain("/api/auth/me");
    expect(
      (calls[2]!.init.headers as Record<string, string>)["X-CSRF-Token"],
    ).toBe("fresh");
  });

  it("adopts the rotated CSRF token after Passkey enrollment", async () => {
    setCsrfToken("old");
    const calls = mockFetch([
      () => json(200, { ...session("rotated"), recovered: false }),
      () => json(200, { signedOut: true }),
    ]);
    await api.enrollmentVerify("c1", {} as never, "Laptop", false);
    await api.logout();
    expect(
      (calls[1]!.init.headers as Record<string, string>)["X-CSRF-Token"],
    ).toBe("rotated");
  });

  it("reports a lost response distinctly from a server rejection", async () => {
    mockFetch([() => Promise.reject(new TypeError("Failed to fetch"))]);
    const error = await api.executeAction("a1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).responseLost).toBe(true);
    expect((error as ApiError).code).toBe("NETWORK_ERROR");
  });

  it("notifies on 401 except for login", async () => {
    const listener = vi.fn();
    onUnauthorized(listener);
    mockFetch([
      () =>
        json(401, {
          error: {
            code: "INVALID_CREDENTIALS",
            message: "Invalid sign-in details.",
          },
        }),
      () =>
        json(401, {
          error: { code: "SESSION_EXPIRED", message: "Sign in again." },
        }),
    ]);
    await expect(api.login("alex", "wrong")).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
    expect(listener).not.toHaveBeenCalled();
    await expect(api.accounts()).rejects.toMatchObject({ status: 401 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("surfaces backend error codes", async () => {
    mockFetch([
      () =>
        json(409, {
          error: { code: "RISK_UPGRADED", message: "Review the red tier." },
        }),
    ]);
    await expect(api.executeAction("a1")).rejects.toMatchObject({
      status: 409,
      code: "RISK_UPGRADED",
    });
  });
});
