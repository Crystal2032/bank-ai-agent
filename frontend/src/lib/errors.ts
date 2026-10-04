import { ApiError } from "../api/client";

// Customer-facing explanations for backend error codes. The backend message is the fallback.
const messages: Record<string, string> = {
  NETWORK_ERROR:
    "The banking service did not respond. Nothing is assumed to have happened; the status will be checked before any retry.",
  INVALID_CREDENTIALS: "The username or password is incorrect.",
  UNAUTHENTICATED: "Please sign in.",
  SESSION_EXPIRED: "Your session ended. Please sign in again.",
  ORIGIN_REJECTED:
    "This page's address is not allowed by the banking service. Open the app at its configured address.",
  CSRF_REJECTED: "Your security token expired. Please try again.",
  RATE_LIMITED: "Too many requests. Wait a minute and try again.",
  INVALID_REQUEST: "The request was not accepted. Check the details and try again.",
  INTERNAL_ERROR:
    "The banking service hit an error. Check the action status before retrying any payment.",
  INVALID_AMOUNT: "Use a positive amount with at most two decimal places.",
  INVALID_RECIPIENT: "Select one of your saved contacts.",
  INSUFFICIENT_FUNDS:
    "Insufficient available funds, including amounts reserved by pending transfers.",
  IDEMPOTENCY_CONFLICT:
    "This request key already belongs to different details. Start a new review.",
  PENDING_LIMIT: "You have ten pending actions. Complete or cancel some first.",
  INVALID_DEPENDENCIES: "One of the required earlier steps is unavailable.",
  DEPENDENCY_PENDING: "Complete the earlier steps this action depends on first.",
  ACTION_CHANGED: "The action changed since you reviewed it. Review the current version.",
  ACTION_EXPIRED: "This action expired after 15 minutes. Prepare and review a new one.",
  INVALID_STATE: "This action is no longer in a state that allows that step.",
  VERIFICATION_REQUIRED: "Fresh verification is required before this can run.",
  RISK_UPGRADED:
    "Today's transfer total moved this payment to the red tier. Verify again with a Passkey, or password plus SMS code.",
  ALREADY_DISPATCHED:
    "This operation already completed or is being reconciled; it cannot be cancelled.",
  ACCOUNT_LOCKED: "Sensitive operations on this account require bank review.",
  RECOVERY_HOLD:
    "Sensitive operations are restricted until the recovery hold ends.",
  FACTOR_REJECTED: "Verification failed. Check the details and try again.",
  CHALLENGE_INVALID:
    "This verification request expired or was used up. Start verification again.",
  PASSKEY_UNAVAILABLE:
    "No active Passkey is registered. Use your password instead, or add a Passkey in Security.",
  SMS_UNAVAILABLE:
    "SMS verification is not configured on this banking service.",
  SMS_RATE_LIMIT: "Wait about a minute before requesting another code.",
  RECOVERY_EXPIRED: "The recovery window expired. Start recovery again.",
  CREDENTIAL_EXISTS: "This Passkey is already registered.",
  NOT_FOUND: "The requested item was not found.",
  MODEL_NOT_CONFIGURED:
    "The assistant is unavailable: no model API is configured on the backend. Banking screens remain available.",
  TASK_BUSY:
    "The assistant is busy, stopped, or under manual control for this task.",
  TASK_LOCKED:
    "This conversation reached its run or failure limit. Use the manual controls or start a new conversation.",
  INVALID_CURSOR: "The conversation could not be refreshed.",
  INVALID_MONTH: "Choose a month in YYYY-MM format.",
};

export function describeError(error: unknown): string {
  if (error instanceof ApiError) return messages[error.code] ?? error.message;
  if (error instanceof Error) {
    // WebAuthn ceremonies surface DOMException names.
    if (error.name === "NotAllowedError")
      return "The Passkey prompt was cancelled or timed out.";
    if (error.name === "InvalidStateError")
      return "This authenticator is already registered for your account.";
    if (error.name === "SecurityError")
      return "Passkeys are blocked on this address. Use http://localhost or a configured HTTPS origin.";
    return error.message;
  }
  return "Something went wrong.";
}

export function errorCode(error: unknown) {
  return error instanceof ApiError ? error.code : undefined;
}
