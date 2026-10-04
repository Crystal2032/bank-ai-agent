import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/browser";
import { bankFetch } from "../platform/transport";
import type {
  AccountsResponse,
  ActionKind,
  ActionView,
  AuditEvent,
  BillReport,
  ContactView,
  EnrollmentResult,
  HealthResponse,
  PasskeyAuthenticationOptions,
  PasskeyMetadata,
  PasskeyRegistrationOptions,
  ReceiptView,
  SessionResponse,
  SmsChallengeResponse,
  TaskEventsResponse,
  TaskListResponse,
  TaskView,
  TransactionView,
  TotpChallengeResponse,
  AuthenticatorStatus,
  AuthenticatorSetup,
  FactorOperation,
  FactorPolicy,
  SecurityRequestView,
} from "./types";

export const API_ORIGIN = new URL(
  import.meta.env.VITE_API_ORIGIN || "http://localhost:3001",
).origin;

/** Error raised for every failed request. status 0 means the backend was unreachable. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
  /** True when the request may or may not have reached the server. */
  get responseLost() {
    return this.status === 0;
  }
}

// The CSRF token lives only in memory; the session cookie is HttpOnly and never readable here.
let csrfToken: string | null = null;
let unauthorizedListener: (() => void) | null = null;
let connectivityListener: ((online: boolean) => void) | null = null;

export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

export function onUnauthorized(listener: (() => void) | null) {
  unauthorizedListener = listener;
}

export function onConnectivity(listener: ((online: boolean) => void) | null) {
  connectivityListener = listener;
}

interface RequestOptions {
  /** Do not treat 401 as a session loss (login, initial session probe). */
  expect401?: boolean;
  /** Internal guard so a CSRF refresh retries at most once. */
  csrfRetried?: boolean;
}

async function request<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  options: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (method === "POST") {
    headers["Content-Type"] = "application/json";
    if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
  }
  let response: Response;
  try {
    response = await bankFetch(`${API_ORIGIN}${path}`, {
      method,
      headers,
      credentials: "include",
      cache: "no-store",
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
    });
  } catch {
    connectivityListener?.(false);
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      "The banking service did not respond. Check status before retrying any payment.",
    );
  }
  connectivityListener?.(true);
  const payload = (await response.json().catch(() => null)) as
    (T & { error?: { code: string; message: string } }) | null;
  if (response.ok) return payload as T;
  const code = payload?.error?.code ?? `HTTP_${response.status}`;
  const message = payload?.error?.message ?? response.statusText;
  if (response.status === 401 && !options.expect401) unauthorizedListener?.();
  // A CSRF rejection happens before the handler runs, so one retry with a fresh token is safe.
  if (code === "CSRF_REJECTED" && !options.csrfRetried) {
    const session = await request<SessionResponse>("GET", "/api/auth/me");
    setCsrfToken(session.csrfToken);
    return request<T>(method, path, body, { ...options, csrfRetried: true });
  }
  throw new ApiError(response.status, code, message);
}

const get = <T>(path: string, options?: RequestOptions) =>
  request<T>("GET", path, undefined, options);
const post = <T>(path: string, body: unknown = {}, options?: RequestOptions) =>
  request<T>("POST", path, body, options);
const enc = encodeURIComponent;

/** Applies a session response that may carry a rotated CSRF token. */
function withSession<T extends SessionResponse>(promise: Promise<T>) {
  return promise.then((session) => {
    setCsrfToken(session.csrfToken);
    return session;
  });
}

export type PrepareBody =
  | {
      kind: "TRANSFER";
      params: { contactId: string; amountMinor: number; note?: string };
    }
  | { kind: "SUBSCRIPTION_LOOKUP"; params: Record<string, never> }
  | {
      kind: Extract<ActionKind, "SUBSCRIPTION_CANCEL" | "MANDATE_REVOKE">;
      params: { subscriptionId: string };
    };

export const api = {
  securityRequest: (id: string) =>
    get<SecurityRequestView>(`/api/security/requests/${enc(id)}`),
  securityRequestComplete: (id: string) =>
    post<SecurityRequestView>(`/api/security/requests/${enc(id)}/complete`),
  factorPolicy: (operation: FactorOperation) =>
    get<FactorPolicy>(
      `/api/security/verification/policy?operation=${operation}`,
    ),
  factorPasswordStart: (
    operation: FactorOperation,
    password: string,
    target?: string,
  ) =>
    post<SmsChallengeResponse>("/api/security/verification/password/start", {
      operation,
      password,
      ...(target ? { target } : {}),
    }),
  factorPasswordVerify: (challengeId: string, code: string) =>
    post<{ proofId: string; expiresAt: number }>(
      "/api/security/verification/password/verify",
      { challengeId, code },
    ),
  factorTotp: (operation: FactorOperation, code: string, target?: string) =>
    post<{ proofId: string; expiresAt: number }>(
      "/api/security/verification/totp",
      { operation, code, ...(target ? { target } : {}) },
    ),
  factorPasskeyOptions: (operation: FactorOperation, target?: string) =>
    post<PasskeyAuthenticationOptions>(
      "/api/security/verification/passkey/options",
      { operation, ...(target ? { target } : {}) },
    ),
  factorPasskeyVerify: (
    challengeId: string,
    response: AuthenticationResponseJSON,
  ) =>
    post<{ proofId: string; expiresAt: number }>(
      "/api/security/verification/passkey/verify",
      { challengeId, response },
    ),
  authenticatorSetupWithProof: (proofIds: string[]) =>
    post<AuthenticatorSetup>("/api/security/authenticator/setup-with-proof", {
      proofIds,
    }),
  authenticatorRemoveWithProof: (proofIds: string[]) =>
    withSession(
      post<SessionResponse>("/api/security/authenticator/remove", { proofIds }),
    ),
  passwordReset: (proofIds: string[], newPassword: string) =>
    withSession(
      post<SessionResponse>("/api/security/password/reset", {
        proofIds,
        newPassword,
      }),
    ),
  enrollmentWithProof: (proofIds: string[], recovery: boolean) =>
    post<PasskeyRegistrationOptions>(
      `${recovery ? "/api/security/recovery" : "/api/security/passkeys/enrollment"}/options`,
      { proofIds },
    ),
  revocationWithProof: (proofIds: string[], credentialId: string) =>
    withSession(
      post<SessionResponse>("/api/security/passkeys/revocation/verify", {
        proofIds,
        credentialId,
      }),
    ),
  paymentTotpOptions: (id: string) =>
    post<TotpChallengeResponse>(`/api/actions/${enc(id)}/verify/totp/options`),
  health: () => get<HealthResponse>("/health"),

  login: (username: string, password: string) =>
    withSession(
      post<SessionResponse>(
        "/api/auth/login",
        { username, password },
        { expect401: true },
      ),
    ),
  me: () =>
    withSession(get<SessionResponse>("/api/auth/me", { expect401: true })),
  logout: () => post<{ signedOut: true }>("/api/auth/logout"),

  accounts: () => get<AccountsResponse>("/api/bank/accounts"),
  transactions: () =>
    get<{ transactions: TransactionView[]; simulated: true }>(
      "/api/bank/transactions",
    ),
  contacts: () => get<{ contacts: ContactView[] }>("/api/bank/contacts"),
  billReport: (month: string) =>
    get<BillReport>(`/api/bank/bill-report?month=${enc(month)}`),

  prepareAction: (
    body: PrepareBody & { idempotencyKey: string; dependsOn?: string[] },
  ) => post<ActionView>("/api/actions", body),
  actions: () => get<{ actions: ActionView[] }>("/api/actions"),
  action: (id: string) => get<ActionView>(`/api/actions/${enc(id)}`),
  confirmAction: (id: string, version: number) =>
    post<ActionView>(`/api/actions/${enc(id)}/confirm`, { version }),
  executeAction: (id: string) =>
    post<ActionView>(`/api/actions/${enc(id)}/execute`),
  cancelAction: (id: string) =>
    post<ActionView>(`/api/actions/${enc(id)}/cancel`),
  receipt: (id: string) => get<ReceiptView>(`/api/receipts/${enc(id)}`),

  verifyPaymentPassword: (id: string, password: string) =>
    post<ActionView | SmsChallengeResponse | TotpChallengeResponse>(
      `/api/actions/${enc(id)}/verify/password`,
      { password },
    ),
  verifyPaymentSms: (challengeId: string, code: string) =>
    post<ActionView | TotpChallengeResponse>(
      "/api/security/payment/sms/verify",
      { challengeId, code },
    ),
  paymentPasskeyOptions: (id: string) =>
    post<PasskeyAuthenticationOptions>(
      `/api/actions/${enc(id)}/verify/passkey/options`,
    ),
  verifyPaymentPasskey: (
    challengeId: string,
    response: AuthenticationResponseJSON,
  ) =>
    post<ActionView | TotpChallengeResponse>(
      "/api/security/payment/passkey/verify",
      {
        challengeId,
        response,
      },
    ),
  authenticator: () => get<AuthenticatorStatus>("/api/security/authenticator"),
  authenticatorStart: (password: string) =>
    post<SmsChallengeResponse>("/api/security/authenticator/start", {
      password,
    }),
  authenticatorSetup: (challengeId: string, code: string) =>
    post<AuthenticatorSetup>("/api/security/authenticator/setup", {
      challengeId,
      code,
    }),
  authenticatorVerify: (challengeId: string, code: string) =>
    withSession(
      post<SessionResponse & { recoveryCodes: string[] }>(
        "/api/security/authenticator/verify",
        { challengeId, code },
      ),
    ),
  authenticatorRemove: (password: string, code: string) =>
    withSession(
      post<SessionResponse>("/api/security/authenticator/remove", {
        password,
        code,
      }),
    ),
  authenticatorRecover: (password: string, recoveryCode: string) =>
    withSession(
      post<SessionResponse>("/api/security/authenticator/recover", {
        password,
        recoveryCode,
      }),
    ),
  verifyPaymentTotp: (challengeId: string, code: string) =>
    post<ActionView>("/api/security/payment/totp/verify", {
      challengeId,
      code,
    }),

  passkeys: () =>
    get<{ passkeys: PasskeyMetadata[] }>("/api/security/passkeys"),
  enrollmentStart: (password: string, recovery: boolean, totpCode?: string) =>
    post<SmsChallengeResponse>(
      `${recovery ? "/api/security/recovery" : "/api/security/passkeys/enrollment"}/start`,
      { password, ...(totpCode ? { totpCode } : {}) },
    ),
  enrollmentOptions: (challengeId: string, code: string, recovery: boolean) =>
    post<PasskeyRegistrationOptions>(
      `${recovery ? "/api/security/recovery" : "/api/security/passkeys/enrollment"}/options`,
      { challengeId, code },
    ),
  enrollmentVerify: (
    challengeId: string,
    response: RegistrationResponseJSON,
    label: string,
    recovery: boolean,
  ) =>
    withSession(
      post<EnrollmentResult>(
        `${recovery ? "/api/security/recovery" : "/api/security/passkeys/enrollment"}/verify`,
        { challengeId, response, label },
      ),
    ),
  revocationStart: (
    credentialId: string,
    password: string,
    totpCode?: string,
  ) =>
    post<SmsChallengeResponse>("/api/security/passkeys/revocation/start", {
      credentialId,
      password,
      ...(totpCode ? { totpCode } : {}),
    }),
  revocationVerify: (challengeId: string, code: string) =>
    withSession(
      post<SessionResponse>("/api/security/passkeys/revocation/verify", {
        challengeId,
        code,
      }),
    ),

  createTask: (message: string) => post<TaskView>("/api/tasks", { message }),
  tasks: (before?: string) =>
    get<TaskListResponse>(
      `/api/tasks?limit=20${before ? `&before=${enc(before)}` : ""}`,
    ),
  task: (id: string) => get<TaskView>(`/api/tasks/${enc(id)}`),
  taskEvents: (id: string, after: number) =>
    get<TaskEventsResponse>(`/api/tasks/${enc(id)}/events?after=${after}`),
  sendTaskMessage: (id: string, message: string) =>
    post<TaskView>(`/api/tasks/${enc(id)}/messages`, { message }),
  stopTask: (id: string) => post<TaskView>(`/api/tasks/${enc(id)}/stop`),
  takeoverTask: (id: string) =>
    post<TaskView>(`/api/tasks/${enc(id)}/takeover`),
  releaseTask: (id: string) => post<TaskView>(`/api/tasks/${enc(id)}/release`),

  audit: () => get<{ events: AuditEvent[] }>("/api/audit"),
};

export function isSmsChallenge(
  value: ActionView | SmsChallengeResponse | TotpChallengeResponse,
): value is SmsChallengeResponse {
  return "maskedPhone" in value;
}
export function isTotpChallenge(
  value: ActionView | SmsChallengeResponse | TotpChallengeResponse,
): value is TotpChallengeResponse {
  return (
    "verificationRequired" in value && value.verificationRequired === "TOTP"
  );
}
