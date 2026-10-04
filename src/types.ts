export type Tier = "GREEN" | "YELLOW" | "RED";
export type ActionKind =
  "TRANSFER" | "SUBSCRIPTION_LOOKUP" | "SUBSCRIPTION_CANCEL" | "MANDATE_REVOKE";
export type ActionStatus =
  | "WAITING_FOR_CONFIRMATION"
  | "WAITING_FOR_VERIFICATION"
  | "AUTHORIZED"
  | "RECONCILING"
  | "SUCCEEDED"
  | "CANCELLED"
  | "FAILED";
export interface Customer {
  id: string;
  username: string;
  name: string;
  phone: string;
  passwordHash: string;
  epoch: number;
  holdUntil: number;
  locked: boolean;
}
export interface Account {
  id: string;
  customerId: string;
  balanceMinor: number;
  currency: "CNY";
}
export interface Contact {
  id: string;
  customerId: string;
  name: string;
  phone: string;
  note: string;
  recipientAccountId: string;
}
export interface LedgerEntry {
  id: string;
  customerId: string;
  accountId: string;
  amountMinor: number;
  category: string;
  merchant: string;
  note: string;
  occurredAt: string;
  operationId?: string;
}
export interface Subscription {
  id: string;
  customerId: string;
  merchant: string;
  amountMinor: number;
  nextRenewal: string;
  status: "ACTIVE" | "CANCELLED";
  mandateActive: boolean;
}
export interface Session {
  id: string;
  customerId: string;
  epoch: number;
  csrfToken: string;
  expiresAt: number;
}
export interface Action {
  id: string;
  customerId: string;
  taskId?: string;
  kind: ActionKind;
  params: Record<string, unknown>;
  dependsOn: string[];
  idempotencyKey: string;
  version: number;
  digest: string;
  tier: Tier;
  status: ActionStatus;
  createdAt: number;
  receiptId?: string;
  result?: unknown;
  grant?: {
    sessionId: string;
    epoch: number;
    expiresAt: number;
    tier: Tier;
    method: string;
  };
  proofs?: {
    method: string;
    sessionId: string;
    epoch: number;
    expiresAt: number;
  }[];
}
export interface Receipt {
  id: string;
  actionId: string;
  customerId: string;
  kind: ActionKind;
  status: "SUCCEEDED";
  params: Record<string, unknown>;
  executedAt: string;
  simulated: true;
}
export interface Challenge {
  id: string;
  customerId: string;
  sessionId: string;
  epoch: number;
  purpose:
    | "PAYMENT"
    | "ENROLLMENT"
    | "RECOVERY"
    | "KEY_REVOCATION"
    | "TOTP_ENROLLMENT"
    | "TOTP_SETUP"
    | "TOTP_PAYMENT"
    | "FACTOR_MANAGEMENT"
    | "FACTOR_PASSKEY"
    | "FACTOR_PASSWORD";
  challenge?: string;
  actionId?: string;
  digest?: string;
  tier?: Tier;
  otpHash?: string;
  attempts: number;
  expiresAt: number;
  createdAt?: number;
  consumed: boolean;
  recoveryId?: string;
  encryptedSecret?: string;
  method?: "PASSWORD" | "PASSWORD_SMS" | "PASSKEY_UV" | "TOTP";
}
export interface TotpCredential {
  id: string;
  encryptedSecret: string;
  enabled: boolean;
  createdAt: number;
  lastCounter: number;
  recoveryHashes: string[];
}
export interface TotpAttempts {
  id: string;
  failures: number;
  windowStart: number;
}
export interface SecurityRequest {
  id: string;
  customerId: string;
  taskId: string;
  operation: import("./factor-proofs.js").FactorOperation;
  target?: string;
  createdAt: number;
  auditSequenceAtCreation: number;
  status: "PENDING" | "COMPLETED" | "CANCELLED";
}
export interface Passkey {
  id: string;
  customerId: string;
  label: string;
  publicKey: string;
  counter: number;
  transports?: string[];
  revoked: boolean;
  createdAt: number;
}
export interface Recovery {
  id: string;
  customerId: string;
  sessionId: string;
  epoch: number;
  state:
    "VERIFYING_FACTORS" | "ENROLLING_REPLACEMENT" | "RESTRICTED" | "COMPLETED";
  expiresAt: number;
  holdUntil?: number;
}
export interface Task {
  id: string;
  customerId: string;
  status:
    "RUNNING" | "WAITING" | "COMPLETED" | "STOPPED" | "NEEDS_REVIEW" | "FAILED";
  input: string;
  createdAt: number;
  updatedAt: number;
  messages: unknown[];
  actionIds: string[];
  events: { sequence: number; type: string; at: string; data: unknown }[];
  leaseOwner: "AGENT" | "HUMAN";
  running: boolean;
  runs: number;
  failures: number;
  error?: string;
}
export interface Collections {
  customers: Customer;
  accounts: Account;
  contacts: Contact;
  ledger: LedgerEntry;
  subscriptions: Subscription;
  sessions: Session;
  actions: Action;
  receipts: Receipt;
  challenges: Challenge;
  passkeys: Passkey;
  recoveries: Recovery;
  tasks: Task;
  totp: TotpCredential;
  totpAttempts: TotpAttempts;
  securityRequests: SecurityRequest;
}
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public retryAfterSeconds?: number,
  ) {
    super(message);
  }
}
