import {
  randomBytes,
  createHash,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import { buildApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import type { StreamFn } from "@earendil-works/pi-agent-core";
export async function fixture(
  options: {
    testStream?: StreamFn;
    databasePath?: string;
    config?: Partial<Config>;
    beforeReady?: (app: Awaited<ReturnType<typeof buildApp>>["app"]) => void;
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "bank-backend-test-"));
  let now = Date.parse("2026-10-03T10:00:00Z");
  const password = randomBytes(20).toString("base64url");
  const config: Config = {
    host: "127.0.0.1",
    port: 3001,
    origin: "http://localhost:5173",
    rpId: "localhost",
    secureCookie: false,
    databasePath: options.databasePath ?? ":memory:",
    authSecret: randomBytes(32).toString("base64url"),
    demoPassword: password,
    smsMode: "file",
    smsOutboxPath: join(directory, "sms.jsonl"),
    recoveryHoldMs: 86400000,
    modelTimeoutMs: 5000,
    ...options.config,
  };
  const backend = await buildApp(config, {
    now: () => now,
    testStream: options.testStream,
  });
  options.beforeReady?.(backend.app);
  await backend.app.ready();
  const login = async (username = "alex") => {
    const response = await backend.app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: config.origin },
      payload: { username, password },
    });
    if (response.statusCode !== 200) throw new Error(response.body);
    return {
      cookie: response.cookies.find((c) => c.name === "bank_session")!.value,
      csrf: response.json().csrfToken,
    };
  };
  const auth = await login();
  const request = (
    method: "GET" | "POST",
    url: string,
    payload?: object,
    identity = auth,
  ) =>
    backend.app.inject({
      method,
      url,
      headers: {
        origin: config.origin,
        cookie: `bank_session=${identity.cookie}`,
        "x-csrf-token": identity.csrf,
      },
      ...(payload !== undefined ? { payload } : {}),
    });
  const prepare = async (
    amountMinor: number,
    key = randomBytes(12).toString("hex"),
  ) => {
    const r = await request("POST", "/api/actions", {
      kind: "TRANSFER",
      params: { contactId: "contact-jordan", amountMinor, note: "Shared rent" },
      idempotencyKey: key,
    });
    if (r.statusCode !== 200) throw new Error(r.body);
    return r.json();
  };
  const otp = (id: string) =>
    readFileSync(config.smsOutboxPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .find((c) => c.challengeId === id).code as string;
  return {
    ...backend,
    directory,
    config,
    password,
    auth,
    login,
    request,
    prepare,
    otp,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}
const sha = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest();
export function authenticator() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const jwk = publicKey.export({ format: "jwk" });
  const id = randomBytes(32).toString("base64url");
  const cose = isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, new Uint8Array(Buffer.from(jwk.x!, "base64url"))],
      [-3, new Uint8Array(Buffer.from(jwk.y!, "base64url"))],
    ]),
  );
  const client = (
    type: string,
    challenge: string,
    origin = "http://localhost:5173",
  ) =>
    Buffer.from(
      JSON.stringify({ type, challenge, origin, crossOrigin: false }),
    );
  const authData = (flags: number, counter: number) => {
    const n = Buffer.alloc(4);
    n.writeUInt32BE(counter);
    return Buffer.concat([sha("localhost"), Buffer.from([flags]), n]);
  };
  return {
    id,
    publicKey: Buffer.from(cose).toString("base64url"),
    registration(challenge: string, origin = "http://localhost:5173") {
      const idBytes = Buffer.from(id, "base64url");
      const size = Buffer.alloc(2);
      size.writeUInt16BE(idBytes.length);
      const data = Buffer.concat([
        authData(0x45, 0),
        Buffer.alloc(16),
        size,
        idBytes,
        Buffer.from(cose),
      ]);
      const attestation = isoCBOR.encode(
        new Map<string, any>([
          ["fmt", "none"],
          ["attStmt", new Map()],
          ["authData", new Uint8Array(data)],
        ]),
      );
      return {
        id,
        rawId: id,
        type: "public-key" as const,
        response: {
          clientDataJSON: client("webauthn.create", challenge, origin).toString(
            "base64url",
          ),
          attestationObject: Buffer.from(attestation).toString("base64url"),
          transports: ["internal" as const],
        },
        clientExtensionResults: {},
      };
    },
    assertion(
      challenge: string,
      options: { origin?: string; uv?: boolean; counter?: number } = {},
    ) {
      const bytes = client("webauthn.get", challenge, options.origin);
      const data = authData(options.uv === false ? 1 : 5, options.counter ?? 1);
      const signature = sign(
        "sha256",
        Buffer.concat([data, sha(bytes)]),
        privateKey,
      );
      return {
        id,
        rawId: id,
        type: "public-key" as const,
        response: {
          clientDataJSON: bytes.toString("base64url"),
          authenticatorData: data.toString("base64url"),
          signature: signature.toString("base64url"),
        },
        clientExtensionResults: {},
      };
    },
  };
}
