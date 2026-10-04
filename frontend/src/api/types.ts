// Shared response contracts come from the backend-owned file; never edit them here.
import type {
  ActionView,
  SubscriptionView,
} from "../../../contracts/backend";

export type * from "../../../contracts/backend";

// Transfer params are canonicalised by the backend at preparation time.
export interface TransferParams {
  contactId: string;
  recipientName: string;
  recipientAccountId: string;
  amountMinor: number;
  currency: "CNY";
  note: string;
}

export interface SubscriptionChangeParams {
  subscriptionId: string;
  merchant: string;
}

export function isTransfer(
  action: ActionView,
): action is ActionView & { params: TransferParams } {
  return action.kind === "TRANSFER";
}

export function lookupResult(action: ActionView): SubscriptionView[] | null {
  return action.kind === "SUBSCRIPTION_LOOKUP" &&
    action.status === "SUCCEEDED" &&
    Array.isArray(action.result)
    ? (action.result as SubscriptionView[])
    : null;
}
