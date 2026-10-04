import { randomUUID } from "node:crypto";
import { digest } from "./crypto.js";
import {
  AppError,
  type Action,
  type ActionKind,
  type Session,
  type Tier,
} from "./types.js";
import type { Store } from "./store.js";
const pending = new Set([
  "WAITING_FOR_CONFIRMATION",
  "WAITING_FOR_VERIFICATION",
  "AUTHORIZED",
  "RECONCILING",
]);
export class Bank {
  constructor(
    readonly store: Store,
    readonly now: () => number = Date.now,
  ) {}
  customer(session: Session) {
    const current = this.store.get("sessions", session.id);
    const customer = this.store.get("customers", session.customerId);
    if (
      !current ||
      current.expiresAt <= this.now() ||
      !customer ||
      current.epoch !== customer.epoch ||
      session.epoch !== customer.epoch
    )
      throw new AppError("SESSION_EXPIRED", "Sign in again.", 401);
    return customer;
  }
  account(customerId: string) {
    const account = this.store
      .all("accounts")
      .find((a) => a.customerId === customerId);
    if (!account)
      throw new AppError("ACCOUNT_NOT_FOUND", "Account unavailable.", 404);
    return account;
  }
  ownedAction(session: Session, id: string) {
    this.customer(session);
    const action = this.store.get("actions", id);
    if (!action || action.customerId !== session.customerId)
      throw new AppError("NOT_FOUND", "Action not found.", 404);
    return action;
  }
  awaitingPayment(session: Session, id: string) {
    const action = this.ownedAction(session, id);
    if (action.createdAt + 15 * 60000 <= this.now())
      throw new AppError(
        "ACTION_EXPIRED",
        "Prepare and review a new action.",
        409,
      );
    if (
      action.kind === "SUBSCRIPTION_LOOKUP" ||
      action.status !== "WAITING_FOR_VERIFICATION"
    )
      throw new AppError(
        "INVALID_STATE",
        "Payment is not awaiting verification.",
        409,
      );
    return action;
  }
  publicAction(action: Action, session?: Session) {
    const { grant: _grant, proofs: _proofs, ...view } = action;
    const methods = [
      ...new Set(
        (action.proofs ?? [])
          .filter(
            (p) =>
              p.expiresAt > this.now() &&
              p.epoch ===
                this.store.get("customers", action.customerId)?.epoch &&
              (!session || p.sessionId === session.id),
          )
          .flatMap((p) =>
            p.method === "PASSWORD_SMS" ? ["PASSWORD", "SMS"] : [p.method],
          ),
      ),
    ];
    return {
      ...view,
      verification: {
        verifiedMethods: methods,
        requiredMethods: action.tier === "RED" ? 2 : 1,
      },
      simulated: true,
    };
  }
  day(at: number) {
    return new Date(at + 8 * 3600000).toISOString().slice(0, 10);
  }
  expirePending(customerId: string) {
    for (const action of this.store.all("actions"))
      if (
        action.customerId === customerId &&
        pending.has(action.status) &&
        action.status !== "RECONCILING" &&
        action.createdAt + 15 * 60000 <= this.now()
      ) {
        action.status = "CANCELLED";
        delete action.grant;
        this.store.put("actions", action);
        this.store.audit(
          customerId,
          "ACTION_EXPIRED",
          { actionId: action.id },
          this.now(),
        );
      }
  }
  projected(customerId: string, amount: number, exclude?: string) {
    const actions = this.store
      .all("actions")
      .filter(
        (a) =>
          a.customerId === customerId &&
          a.kind === "TRANSFER" &&
          a.id !== exclude,
      );
    const total = actions.reduce((sum, a) => {
      if (pending.has(a.status)) return sum + Number(a.params.amountMinor);
      if (a.status === "SUCCEEDED" && a.receiptId) {
        const receipt = this.store.get("receipts", a.receiptId);
        if (
          receipt &&
          this.day(Date.parse(receipt.executedAt)) === this.day(this.now())
        )
          return sum + Number(a.params.amountMinor);
      }
      return sum;
    }, amount);
    return total;
  }
  risk(action: Action): Tier {
    return action.kind === "TRANSFER" &&
      this.projected(
        action.customerId,
        Number(action.params.amountMinor),
        action.id,
      ) > 100000
      ? "RED"
      : "YELLOW";
  }
  assertWritable(session: Session) {
    const customer = this.customer(session);
    if (customer.locked)
      throw new AppError(
        "ACCOUNT_LOCKED",
        "Sensitive operations require review.",
        423,
      );
    if (customer.holdUntil > this.now())
      throw new AppError(
        "RECOVERY_HOLD",
        "Sensitive operations are restricted after recovery.",
        423,
      );
    return customer;
  }
  prepare(
    session: Session,
    kind: ActionKind,
    raw: Record<string, unknown>,
    idempotencyKey: string,
    dependsOn: string[] = [],
    taskId?: string,
  ) {
    return this.store.transaction(() => {
      this.customer(session);
      this.expirePending(session.customerId);
      if (kind !== "SUBSCRIPTION_LOOKUP") this.assertWritable(session);
      let params: Record<string, unknown>;
      if (kind === "TRANSFER") {
        if (
          !Number.isSafeInteger(raw.amountMinor) ||
          Number(raw.amountMinor) <= 0 ||
          Number(raw.amountMinor) > 100000000
        )
          throw new AppError(
            "INVALID_AMOUNT",
            "Use positive integer minor units.",
          );
        const contact = this.store.get("contacts", String(raw.contactId));
        if (!contact || contact.customerId !== session.customerId)
          throw new AppError("INVALID_RECIPIENT", "Select an owned contact.");
        if (String(raw.note ?? "").length > 200)
          throw new AppError("INVALID_NOTE", "Note is too long.");
        params = {
          contactId: contact.id,
          recipientName: contact.name,
          recipientAccountId: contact.recipientAccountId,
          amountMinor: raw.amountMinor,
          currency: "CNY",
          note: String(raw.note ?? ""),
        };
      } else if (kind === "SUBSCRIPTION_LOOKUP") params = {};
      else {
        const subscription = this.store.get(
          "subscriptions",
          String(raw.subscriptionId),
        );
        if (!subscription || subscription.customerId !== session.customerId)
          throw new AppError("NOT_FOUND", "Subscription not found.", 404);
        params = {
          subscriptionId: subscription.id,
          merchant: subscription.merchant,
        };
      }
      const fingerprint = digest({ kind, params, dependsOn });
      const existing = this.store
        .all("actions")
        .find(
          (a) =>
            a.customerId === session.customerId &&
            a.idempotencyKey === idempotencyKey,
        );
      if (existing) {
        if (existing.digest !== fingerprint)
          throw new AppError(
            "IDEMPOTENCY_CONFLICT",
            "This key already identifies different action details.",
            409,
          );
        return this.publicAction(existing, session);
      }
      const ownPending = this.store
        .all("actions")
        .filter(
          (a) => a.customerId === session.customerId && pending.has(a.status),
        );
      if (ownPending.length >= 10)
        throw new AppError(
          "PENDING_LIMIT",
          "Complete or cancel existing actions.",
          429,
        );
      if (dependsOn.length > 10 || new Set(dependsOn).size !== dependsOn.length)
        throw new AppError(
          "INVALID_DEPENDENCIES",
          "Dependencies must be unique existing actions.",
        );
      for (const id of dependsOn) {
        const dependency = this.ownedAction(session, id);
        if (taskId && dependency.taskId !== taskId)
          throw new AppError(
            "INVALID_DEPENDENCIES",
            "Task dependencies cannot cross tasks.",
          );
      }
      if (kind === "TRANSFER") {
        const reserved = ownPending
          .filter((a) => a.kind === "TRANSFER")
          .reduce((sum, a) => sum + Number(a.params.amountMinor), 0);
        if (
          Number(params.amountMinor) >
          this.account(session.customerId).balanceMinor - reserved
        )
          throw new AppError(
            "INSUFFICIENT_FUNDS",
            "Insufficient available funds.",
          );
      }
      const action: Action = {
        id: randomUUID(),
        customerId: session.customerId,
        taskId,
        kind,
        params,
        dependsOn,
        idempotencyKey,
        version: 1,
        digest: fingerprint,
        tier: "YELLOW",
        status: "WAITING_FOR_CONFIRMATION",
        createdAt: this.now(),
      };
      action.tier = this.risk(action);
      this.store.put("actions", action);
      this.store.audit(
        session.customerId,
        "ACTION_PREPARED",
        {
          actionId: action.id,
          taskId,
          kind,
          tier: action.tier,
          digest: fingerprint,
          dependsOn,
        },
        this.now(),
      );
      if (taskId) {
        const task = this.store.get("tasks", taskId);
        if (task) {
          task.actionIds.push(action.id);
          this.store.put("tasks", task);
        }
      }
      return this.publicAction(action, session);
    });
  }
  confirm(session: Session, id: string, version: number) {
    return this.store.transaction(() => {
      this.expirePending(session.customerId);
      const action = this.ownedAction(session, id);
      if (action.version !== version)
        throw new AppError("ACTION_CHANGED", "Review the current action.", 409);
      if (action.status !== "WAITING_FOR_CONFIRMATION")
        throw new AppError("INVALID_STATE", "Action cannot be confirmed.", 409);
      this.dependencies(action);
      if (action.kind !== "SUBSCRIPTION_LOOKUP") this.assertWritable(session);
      action.tier = this.risk(action);
      const needsVerification =
        action.kind === "TRANSFER" ||
        (action.kind !== "SUBSCRIPTION_LOOKUP" &&
          this.store.get("totp", session.customerId)?.enabled);
      action.status = needsVerification
        ? "WAITING_FOR_VERIFICATION"
        : "AUTHORIZED";
      if (!needsVerification)
        action.grant = {
          sessionId: session.id,
          epoch: session.epoch,
          expiresAt: this.now() + 120000,
          tier: action.tier,
          method: "EXPLICIT_CONFIRMATION",
        };
      this.store.put("actions", action);
      this.store.audit(
        session.customerId,
        "ACTION_CONFIRMED",
        { actionId: id, version, tier: action.tier },
        this.now(),
      );
      return this.publicAction(action, session);
    });
  }
  dependencies(action: Action) {
    for (const id of action.dependsOn)
      if (this.store.get("actions", id)?.status !== "SUCCEEDED")
        throw new AppError(
          "DEPENDENCY_PENDING",
          "Complete dependencies before this action.",
          409,
        );
  }
  grant(session: Session, id: string, tier: Tier, method: string) {
    const action = this.awaitingPayment(session, id);
    this.assertWritable(session);
    if (action.status !== "WAITING_FOR_VERIFICATION")
      throw new AppError(
        "INVALID_STATE",
        "Action is not awaiting verification.",
        409,
      );
    if (this.risk(action) === "RED" && tier !== "RED")
      throw new AppError(
        "RISK_UPGRADED",
        "Stronger verification is required.",
        409,
      );
    action.tier = this.risk(action);
    const proofs = (action.proofs ?? []).filter(
      (p) =>
        p.sessionId === session.id &&
        p.epoch === session.epoch &&
        p.expiresAt > this.now(),
    );
    if (!proofs.some((p) => p.method === method))
      proofs.push({
        method,
        sessionId: session.id,
        epoch: session.epoch,
        expiresAt: this.now() + 120000,
      });
    action.proofs = proofs;
    const methods = new Set(
      proofs.flatMap((p) =>
        p.method === "PASSWORD_SMS" ? ["PASSWORD", "SMS"] : [p.method],
      ),
    );
    if (action.tier === "RED" && methods.size < 2) {
      this.store.put("actions", action);
      return this.publicAction(action, session);
    }
    action.grant = {
      sessionId: session.id,
      epoch: session.epoch,
      expiresAt: Math.min(...proofs.map((p) => p.expiresAt)),
      tier,
      method: [...methods].sort().join("+"),
    };
    action.status = "AUTHORIZED";
    this.store.put("actions", action);
    this.store.audit(
      session.customerId,
      "ACTION_VERIFIED",
      { actionId: id, tier, method, epoch: session.epoch },
      this.now(),
    );
    return this.publicAction(action, session);
  }
  execute(session: Session, id: string) {
    let upgraded = false;
    const result = this.store.transaction(() => {
      this.expirePending(session.customerId);
      const action = this.ownedAction(session, id);
      if (action.status === "SUCCEEDED")
        return this.publicAction(action, session);
      if (action.kind !== "SUBSCRIPTION_LOOKUP") this.assertWritable(session);
      this.dependencies(action);
      const grant = action.grant;
      if (
        action.status !== "AUTHORIZED" ||
        !grant ||
        grant.sessionId !== session.id ||
        grant.epoch !== session.epoch ||
        grant.expiresAt <= this.now()
      )
        throw new AppError(
          "VERIFICATION_REQUIRED",
          "Fresh authorization is required.",
          403,
        );
      const grantMethods =
        grant.method === "PASSWORD_SMS"
          ? ["PASSWORD", "SMS"]
          : grant.method.split("+");
      if (
        this.risk(action) === "RED" &&
        (grant.tier !== "RED" || new Set(grantMethods).size < 2)
      ) {
        action.status = "WAITING_FOR_VERIFICATION";
        action.tier = "RED";
        delete action.grant;
        this.store.put("actions", action);
        this.store.audit(
          session.customerId,
          "RISK_UPGRADED",
          { actionId: id },
          this.now(),
        );
        upgraded = true;
        return this.publicAction(action, session);
      }
      this.store.audit(
        session.customerId,
        "DISPATCH_STARTED",
        {
          actionId: id,
          kind: action.kind,
          digest: action.digest,
          method: grant.method,
        },
        this.now(),
      );
      if (action.kind === "TRANSFER") {
        const from = this.account(session.customerId);
        const to = this.store.get(
          "accounts",
          String(action.params.recipientAccountId),
        );
        const amount = Number(action.params.amountMinor);
        if (!to || to.id === from.id)
          throw new AppError("INVALID_RECIPIENT", "Recipient unavailable.");
        const reserved = this.store
          .all("actions")
          .filter(
            (a) =>
              a.id !== id &&
              a.customerId === session.customerId &&
              a.kind === "TRANSFER" &&
              pending.has(a.status),
          )
          .reduce((sum, a) => sum + Number(a.params.amountMinor), 0);
        if (from.balanceMinor - reserved < amount)
          throw new AppError(
            "INSUFFICIENT_FUNDS",
            "Insufficient available funds.",
          );
        from.balanceMinor -= amount;
        to.balanceMinor += amount;
        this.store.put("accounts", from);
        this.store.put("accounts", to);
        for (const [account, signed] of [
          [from, -amount],
          [to, amount],
        ] as const)
          this.store.put("ledger", {
            id: `${id}-${account.id}`,
            customerId: account.customerId,
            accountId: account.id,
            amountMinor: signed,
            category: "Transfer",
            merchant: "Bank transfer",
            note: String(action.params.note),
            occurredAt: new Date(this.now()).toISOString(),
            operationId: id,
          });
      } else if (action.kind === "SUBSCRIPTION_LOOKUP")
        action.result = this.store
          .all("subscriptions")
          .filter((s) => s.customerId === session.customerId);
      else {
        const sub = this.store.get(
          "subscriptions",
          String(action.params.subscriptionId),
        );
        if (!sub || sub.customerId !== session.customerId)
          throw new AppError("NOT_FOUND", "Subscription unavailable.", 404);
        if (action.kind === "SUBSCRIPTION_CANCEL") sub.status = "CANCELLED";
        else sub.mandateActive = false;
        this.store.put("subscriptions", sub);
        action.result = sub;
      }
      const receipt = {
        id: randomUUID(),
        actionId: id,
        customerId: session.customerId,
        kind: action.kind,
        status: "SUCCEEDED" as const,
        params: action.params,
        executedAt: new Date(this.now()).toISOString(),
        simulated: true as const,
      };
      this.store.put("receipts", receipt);
      action.receiptId = receipt.id;
      action.status = "SUCCEEDED";
      delete action.grant;
      this.store.put("actions", action);
      this.store.audit(
        session.customerId,
        "DISPATCH_SUCCEEDED",
        { actionId: id, receiptId: receipt.id },
        this.now(),
      );
      return this.publicAction(action, session);
    });
    if (upgraded)
      throw new AppError(
        "RISK_UPGRADED",
        "Review the red tier and verify again.",
        409,
      );
    return result;
  }
  cancel(session: Session, id: string) {
    return this.store.transaction(() => {
      const a = this.ownedAction(session, id);
      if (a.status === "SUCCEEDED" || a.status === "RECONCILING")
        throw new AppError(
          "ALREADY_DISPATCHED",
          "Completed or uncertain operations cannot be cancelled.",
          409,
        );
      a.status = "CANCELLED";
      delete a.grant;
      this.store.put("actions", a);
      this.store.audit(
        session.customerId,
        "ACTION_CANCELLED",
        { actionId: id },
        this.now(),
      );
      return this.publicAction(a, session);
    });
  }
  report(session: Session, month: string) {
    this.customer(session);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
      throw new AppError("INVALID_MONTH", "Use YYYY-MM.");
    const entries = this.store
      .all("ledger")
      .filter(
        (e) =>
          e.customerId === session.customerId &&
          this.day(Date.parse(e.occurredAt)).startsWith(month) &&
          e.amountMinor < 0,
      );
    const categories: Record<string, number> = {};
    for (const entry of entries)
      categories[entry.category] =
        (categories[entry.category] ?? 0) - entry.amountMinor;
    const groups = new Map<string, typeof entries>();
    for (const e of this.store
      .all("ledger")
      .filter(
        (e) =>
          e.customerId === session.customerId &&
          e.amountMinor < 0 &&
          e.category !== "Transfer",
      )) {
      const key = `${e.merchant}:${e.amountMinor}`;
      groups.set(key, [...(groups.get(key) ?? []), e]);
    }
    const recurringCandidates = [...groups.values()]
      .filter(
        (g) =>
          new Set(g.map((e) => this.day(Date.parse(e.occurredAt)).slice(0, 7)))
            .size >= 3,
      )
      .map((g) => ({
        merchant: g[0]!.merchant,
        amountMinor: -g[0]!.amountMinor,
        transactionIds: g.map((e) => e.id),
        certainty: "CANDIDATE",
        reason:
          "Same merchant and amount across at least three months; not proof of an active subscription.",
      }));
    const unusualCandidates = entries.flatMap((entry) => {
      const previous = this.store
        .all("ledger")
        .filter(
          (e) =>
            e.customerId === session.customerId &&
            e.merchant === entry.merchant &&
            e.amountMinor < 0 &&
            e.occurredAt < `${month}-01`,
        )
        .map((e) => -e.amountMinor)
        .sort((a, b) => a - b);
      const median = previous[Math.floor(previous.length / 2)];
      return median && previous.length >= 2 && -entry.amountMinor > median * 2
        ? [
            {
              transactionId: entry.id,
              merchant: entry.merchant,
              amountMinor: -entry.amountMinor,
              referenceMedianMinor: median,
              certainty: "CANDIDATE",
              reason:
                "Amount exceeds twice the prior merchant median; not a fraud determination.",
            },
          ]
        : [];
    });
    return {
      month,
      currency: "CNY",
      totalOutgoingMinor: entries.reduce((sum, e) => sum - e.amountMinor, 0),
      categories,
      transactionIds: entries.map((e) => e.id),
      recurringCandidates,
      unusualCandidates,
      observedAt: new Date(this.now()).toISOString(),
      simulated: true,
    };
  }
}
