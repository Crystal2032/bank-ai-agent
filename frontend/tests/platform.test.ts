import { afterEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({
  native: false,
  request: vi.fn(),
  authenticate: vi.fn(),
  register: vi.fn(),
  browserAuthentication: vi.fn(),
  browserRegistration: vi.fn(),
}));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => platform.native },
  CapacitorHttp: { request: platform.request },
  registerPlugin: () => ({
    authenticate: platform.authenticate,
    register: platform.register,
  }),
}));
vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: () => true,
  startAuthentication: platform.browserAuthentication,
  startRegistration: platform.browserRegistration,
}));
afterEach(() => {
  platform.native = false;
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("shared Android adapters", () => {
  it("disables browser Passkeys on an HTTPS IP address but retains localhost support", async () => {
    vi.stubGlobal("window", { location: { hostname: "38.55.104.33" } });
    const ip = await import("../src/platform/passkeys");
    expect(ip.browserSupportsWebAuthn()).toBe(false);
    expect(ip.passkeyUnavailableMessage).toContain("domain name");
    vi.resetModules();
    vi.stubGlobal("window", { location: { hostname: "localhost" } });
    const local = await import("../src/platform/passkeys");
    expect(local.browserSupportsWebAuthn()).toBe(true);
  });
  it("preserves browser fetch without adding native headers", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    const { bankFetch } = await import("../src/platform/transport");
    const options = {
      method: "POST",
      credentials: "include" as const,
      body: "{}",
    };
    await bankFetch("http://localhost:3001/api/auth/logout", options);
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:3001/api/auth/logout",
      options,
    );
    expect(platform.request).not.toHaveBeenCalled();
  });
  it("uses native cookies/Origin and preserves CSRF without exposing cookie headers or following redirects", async () => {
    platform.native = true;
    vi.stubGlobal("window", { location: { origin: "https://localhost" } });
    platform.request.mockResolvedValue({
      status: 200,
      data: { csrfToken: "new-token" },
      headers: { "Set-Cookie": "private-session" },
    });
    const { bankFetch } = await import("../src/platform/transport");
    const response = await bankFetch("http://localhost:3001/api/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": "token" },
      body: "{}",
    });
    expect(platform.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        data: {},
        disableRedirects: true,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": "token",
          Origin: "https://localhost",
        },
      }),
    );
    expect(response.headers.has("Set-Cookie")).toBe(false);
    expect(await response.json()).toEqual({ csrfToken: "new-token" });
  });
  it("disables unconfigured native Passkeys and refuses a different RP", async () => {
    platform.native = true;
    vi.stubEnv("VITE_ANDROID_PASSKEY_RP_ID", "");
    const adapter = await import("../src/platform/passkeys");
    expect(adapter.browserSupportsWebAuthn()).toBe(false);
    await expect(
      adapter.startAuthentication({
        optionsJSON: { rpId: "bank.example", challenge: "challenge" },
      }),
    ).rejects.toThrow("verified domain");
    expect(platform.authenticate).not.toHaveBeenCalled();
  });
  it("passes server options to Credential Manager and returns its credential for server verification", async () => {
    platform.native = true;
    vi.stubEnv("VITE_ANDROID_PASSKEY_RP_ID", "bank.example");
    platform.authenticate.mockResolvedValue({
      credential: { id: "signed-credential" },
    });
    const adapter = await import("../src/platform/passkeys");
    const options = {
      rpId: "bank.example",
      challenge: "server-challenge",
      userVerification: "required" as const,
    };
    expect(await adapter.startAuthentication({ optionsJSON: options })).toEqual(
      { id: "signed-credential" },
    );
    expect(platform.authenticate).toHaveBeenCalledWith({
      optionsJSON: JSON.stringify(options),
    });
    await expect(
      adapter.startAuthentication({
        optionsJSON: { ...options, rpId: "attacker.example" },
      }),
    ).rejects.toThrow("verified domain");
    expect(platform.authenticate).toHaveBeenCalledTimes(1);
  });
});
