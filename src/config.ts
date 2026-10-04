export interface Config {
  host: string;
  port: number;
  origin: string;
  androidOrigin?: string;
  androidPasskeyOrigin?: string;
  rpId: string;
  secureCookie: boolean;
  proxyHops?: 0 | 1;
  databasePath: string;
  authSecret: string;
  demoPassword?: string;
  smsMode: "disabled" | "file";
  smsOutboxPath: string;
  recoveryHoldMs: number;
  model?: {
    baseUrl: string;
    id: string;
    apiKey: string;
    contextWindow: number;
    maxTokens: number;
  };
  modelTimeoutMs: number;
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const integer = (key: string, fallback: number, minimum = 1) => {
    const n = Number(env[key] ?? fallback);
    if (!Number.isSafeInteger(n) || n < minimum)
      throw new Error(`Invalid ${key}`);
    return n;
  };
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32)
    throw new Error("AUTH_SECRET must contain at least 32 characters.");
  const origin = new URL(env.CLIENT_ORIGIN ?? "http://localhost:5173").origin;
  const secureCookie = env.COOKIE_SECURE === "true";
  const proxyHops = integer("TRUST_PROXY_HOPS", 0, 0);
  if (proxyHops > 1) throw new Error("TRUST_PROXY_HOPS must be 0 or 1.");
  const androidOrigin = env.ANDROID_CLIENT_ORIGIN;
  if (androidOrigin && androidOrigin !== "https://localhost")
    throw new Error(
      "ANDROID_CLIENT_ORIGIN must be the packaged client origin https://localhost.",
    );
  const androidCert = env.ANDROID_CERT_SHA256?.replaceAll(":", "");
  if (androidCert && (!androidOrigin || !/^[0-9a-fA-F]{64}$/.test(androidCert)))
    throw new Error(
      "Android Passkeys require an enabled Android client and a SHA-256 signing certificate fingerprint.",
    );
  if (androidCert && (env.RP_ID ?? "localhost") === "localhost")
    throw new Error("Android Passkeys require a real verified RP domain.");
  if (
    !secureCookie &&
    !["127.0.0.1", "localhost", "::1"].includes(env.HOST ?? "127.0.0.1")
  )
    throw new Error("Insecure development must bind to loopback.");
  if (
    !["localhost", "127.0.0.1"].includes(new URL(origin).hostname) &&
    new URL(origin).protocol !== "https:"
  )
    throw new Error("Non-local client origin requires HTTPS.");
  if (
    !secureCookie &&
    !["localhost", "127.0.0.1"].includes(new URL(origin).hostname)
  )
    throw new Error("Non-local clients require HTTPS and secure cookies.");
  const smsMode = env.SMS_MODE ?? "disabled";
  if (smsMode !== "disabled" && smsMode !== "file")
    throw new Error("Unsupported SMS_MODE.");
  const modelBaseUrl = env.MODEL_BASE_URL || "https://api.deepseek.com";
  const modelId = env.MODEL_ID || "deepseek-flash";
  {
    const u = new URL(modelBaseUrl);
    if (
      u.protocol !== "https:" &&
      !(
        u.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(u.hostname)
      )
    )
      throw new Error(
        "Model API requires HTTPS except for loopback development.",
      );
    if (u.username || u.password || u.search)
      throw new Error(
        "Model URL must not contain credentials or query parameters.",
      );
  }
  return {
    host: env.HOST ?? "127.0.0.1",
    port: integer("PORT", 3001),
    origin,
    androidOrigin,
    androidPasskeyOrigin: androidCert
      ? `android:apk-key-hash:${Buffer.from(androidCert, "hex").toString("base64url")}`
      : undefined,
    rpId: env.RP_ID ?? "localhost",
    secureCookie,
    proxyHops: proxyHops === 1 ? 1 : 0,
    databasePath: env.DATABASE_PATH ?? ".data/bank.sqlite",
    authSecret: env.AUTH_SECRET,
    demoPassword: env.DEMO_PASSWORD,
    smsMode,
    smsOutboxPath: env.SMS_OUTBOX_PATH ?? ".data/sms-outbox.jsonl",
    recoveryHoldMs: integer("RECOVERY_HOLD_MS", 86400000),
    modelTimeoutMs: integer("MODEL_TIMEOUT_MS", 30000),
    model: env.MODEL_API_KEY
      ? {
          baseUrl: modelBaseUrl,
          id: modelId,
          apiKey: env.MODEL_API_KEY!,
          contextWindow: integer("MODEL_CONTEXT_WINDOW", 32768),
          maxTokens: integer("MODEL_MAX_TOKENS", 2048),
        }
      : undefined,
  };
}
