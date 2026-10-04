import { hashPassword } from "./crypto.js";
import type { Store } from "./store.js";
export function seed(store: Store, password: string, now: number) {
  if (store.all("customers").length) return;
  store.transaction(() => {
    for (const [id, name, phone] of [
      ["alex", "Alex Morgan", "+8613800000001"],
      ["jordan", "Jordan Lee", "+8613800000002"],
    ]) {
      store.put("customers", {
        id: id!,
        username: id!,
        name: name!,
        phone: phone!,
        passwordHash: hashPassword(password),
        epoch: 1,
        holdUntil: 0,
        locked: false,
      });
      store.put("accounts", {
        id: `account-${id}`,
        customerId: id!,
        balanceMinor: 2000000,
        currency: "CNY",
      });
    }
    store.put("contacts", {
      id: "contact-jordan",
      customerId: "alex",
      name: "Jordan Lee",
      phone: "+8613800000002",
      note: "Shared rent",
      recipientAccountId: "account-jordan",
    });
    store.put("contacts", {
      id: "contact-alex",
      customerId: "jordan",
      name: "Alex Morgan",
      phone: "+8613800000001",
      note: "Shared rent",
      recipientAccountId: "account-alex",
    });
    for (const customerId of ["alex", "jordan"]) {
      for (const [index, merchant, category, amount] of [
        [0, "Stream Plus", "Entertainment", 3900],
        [1, "Cloud Notes", "Software", 2500],
        [2, "Green Market", "Groceries", 28600],
        [3, "City Transit", "Transport", 6000],
      ] as const) {
        for (let month = 0; month < 3; month++) {
          const date = new Date(now);
          date.setUTCDate(2 + index);
          date.setUTCMonth(date.getUTCMonth() - month);
          store.put("ledger", {
            id: `fixture-${customerId}-${index}-${month}`,
            customerId,
            accountId: `account-${customerId}`,
            amountMinor: -amount,
            category,
            merchant,
            note: "Synthetic historical transaction",
            occurredAt: date.toISOString(),
          });
        }
      }
      store.put("subscriptions", {
        id: `subscription-${customerId}-stream`,
        customerId,
        merchant: "Stream Plus",
        amountMinor: 3900,
        nextRenewal: new Date(now + 7 * 86400000).toISOString(),
        status: "ACTIVE",
        mandateActive: true,
      });
    }
  });
}
