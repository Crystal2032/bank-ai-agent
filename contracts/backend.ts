// Browser-safe response contracts. Type-only WebAuthn imports are erased; no runtime imports or secrets.
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/server";
export type RiskTier = "GREEN" | "YELLOW" | "RED";
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
export interface ApiError {
  error: { code: string; message: string; retryAfterSeconds?: number };
}
export interface HealthResponse {
  status: "ok";
  banking: "SIMULATED";
  model: "API_CONFIGURED" | "NOT_CONFIGURED";
  sms: "LOCAL_TEST_OUTBOX" | "DISABLED";
}
export interface SessionResponse {
  csrfToken: string;
  customer: { id: string; name: string; username: string; maskedPhone: string };
  security: { holdUntil: number; locked: boolean };
  bankingSimulated: true;
}
export interface ActionView {
  verification?: { verifiedMethods: string[]; requiredMethods: number };
  id: string;
  customerId: string;
  taskId?: string;
  kind: ActionKind;
  params: Record<string, unknown>;
  dependsOn: string[];
  idempotencyKey: string;
  version: number;
  digest: string;
  tier: RiskTier;
  status: ActionStatus;
  createdAt: number;
  receiptId?: string;
  result?: unknown;
  simulated: true;
}
export interface AccountView {
  id: string;
  customerId: string;
  balanceMinor: number;
  currency: "CNY";
}
export interface AccountsResponse {
  accounts: AccountView[];
  observedAt: string;
  simulated: true;
}
export interface ContactsResponse {
  contacts: ContactView[];
}
export interface TransactionsResponse {
  transactions: TransactionView[];
  simulated: true;
}
export interface ActionsResponse {
  actions: ActionView[];
}
export interface PasskeyMetadata {
  id: string;
  customerId: string;
  label: string;
  transports?: string[];
  revoked: boolean;
  createdAt: number;
}
export interface PasskeysResponse {
  passkeys: PasskeyMetadata[];
}
export interface PasskeyAuthenticationOptions {
  challengeId: string;
  options: PublicKeyCredentialRequestOptionsJSON;
  expiresAt: number;
}
export interface PasskeyRegistrationOptions {
  challengeId: string;
  options: PublicKeyCredentialCreationOptionsJSON;
  expiresAt: number;
}
export type EnrollmentResult = SessionResponse & { recovered: boolean };
export interface AuditEvent {
  sequence: number;
  event: string;
  occurredAt: string;
  data: Record<string, unknown>;
}
export interface AuditResponse {
  events: AuditEvent[];
}
export interface ContactView {
  id: string;
  customerId: string;
  name: string;
  phone: string;
  note: string;
  recipientAccountId: string;
}
export interface SubscriptionView {
  id: string;
  customerId: string;
  merchant: string;
  amountMinor: number;
  nextRenewal: string;
  status: "ACTIVE" | "CANCELLED";
  mandateActive: boolean;
}
export interface TransactionView {
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
export interface ReceiptView {
  id: string;
  actionId: string;
  customerId: string;
  kind: ActionKind;
  status: "SUCCEEDED";
  params: Record<string, unknown>;
  executedAt: string;
  simulated: true;
}
export interface TaskEvent {
  sequence: number;
  type:
    | "RUN_STARTED"
    | "SECURITY_OPTIONS"
    | "SECURITY_REQUEST"
    | "SECURITY_COMPLETED"
    | "ACCOUNTS"
    | "CONTACTS"
    | "BILL_REPORT"
    | "ACTION"
    | "CLARIFICATION"
    | "RUN_FINISHED"
    | "RUN_FAILED"
    | "INTERRUPTED"
    | "MANUAL_TAKEOVER"
    | "MANUAL_CONTROL_RELEASED"
    | "STOPPED";
  at: string;
  data: unknown;
}
export interface TaskView {
  id: string;
  customerId: string;
  input: string;
  createdAt: number;
  updatedAt: number;
  status:
    "RUNNING" | "WAITING" | "COMPLETED" | "STOPPED" | "NEEDS_REVIEW" | "FAILED";
  actions: ActionView[];
  actionIds: string[];
  events: TaskEvent[];
  leaseOwner: "AGENT" | "HUMAN";
  running: boolean;
  runs: number;
  failures: number;
  error?: string;
  modelMode: "API" | "TEST_STREAM";
  simulatedBanking: true;
}
export interface TaskEventsResponse {
  events: TaskEvent[];
  running: boolean;
  status: TaskView["status"];
}
export interface TaskRunStartedData {
  model: string;
  inference: "API" | "TEST_STREAM";
  // Customer-supplied display text, never model prose or an authorization instruction.
  // Absent on events written before durable customer-message history was added.
  customerMessage?: string;
}
export interface TaskSummary {
  id: string;
  input: string;
  status: TaskView["status"];
  leaseOwner: TaskView["leaseOwner"];
  running: boolean;
  runs: number;
  failures: number;
  error?: string;
  actionCount: number;
  createdAt: number;
  updatedAt: number;
}
export interface TaskListResponse {
  tasks: TaskSummary[];
  nextCursor: string | null;
}
export interface SmsChallengeResponse {
  challengeId: string;
  expiresAt: number;
  maskedPhone: string;
  smsSimulated: true;
  verificationRequired?: "SMS";
  recoveryId?: string;
  resendAvailableAt: number;
}
export interface TotpChallengeResponse {
  verificationRequired: "TOTP";
  challengeId: string;
  expiresAt: number;
}
export interface AuthenticatorStatus {
  enabled: boolean;
  recoveryCodesRemaining: number;
}
export interface AuthenticatorSetup {
  challengeId: string;
  secret: string;
  uri: string;
  expiresAt: number;
}
export type FactorOperation =
  | "TOTP_SETUP"
  | "TOTP_REMOVE"
  | "PASSKEY_ENROLL"
  | "PASSKEY_RECOVER"
  | "PASSKEY_REVOKE"
  | "PASSWORD_RESET";
export interface FactorPolicy {
  availableMethods: string[];
  requiredMethods: number;
  recovering: boolean;
  limitedOptions: boolean;
}
export interface SecurityRequestView {
  id: string;
  customerId: string;
  taskId: string;
  operation: FactorOperation;
  target?: string;
  createdAt: number;
  status: "PENDING" | "COMPLETED" | "CANCELLED";
}
export interface BillReport {
  month: string;
  currency: "CNY";
  totalOutgoingMinor: number;
  categories: Record<string, number>;
  transactionIds: string[];
  recurringCandidates: {
    merchant: string;
    amountMinor: number;
    transactionIds: string[];
    certainty: "CANDIDATE";
    reason: string;
  }[];
  unusualCandidates: {
    transactionId: string;
    merchant: string;
    amountMinor: number;
    referenceMedianMinor: number;
    certainty: "CANDIDATE";
    reason: string;
  }[];
  observedAt: string;
  simulated: true;
}
