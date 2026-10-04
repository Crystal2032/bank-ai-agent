// Money is always integer CNY minor units (fen). Never use floating-point arithmetic here.

const grouping = new Intl.NumberFormat("en-US", { useGrouping: true });

export function formatMinor(minor: number, options: { signed?: boolean } = {}) {
  if (!Number.isSafeInteger(minor)) return "CNY —";
  const negative = minor < 0;
  const absolute = Math.abs(minor);
  const major = grouping.format(Math.trunc(absolute / 100));
  const cents = String(absolute % 100).padStart(2, "0");
  const sign = negative ? "−" : options.signed && minor > 0 ? "+" : "";
  return `${sign}CNY ${major}.${cents}`;
}

export type ParsedAmount =
  | { ok: true; minor: number }
  | { ok: false; reason: string };

export const MAX_TRANSFER_MINOR = 100_000_000;

/** Parses a typed CNY amount such as "1,234.5" into integer minor units without floats. */
export function parseAmount(input: string): ParsedAmount {
  const text = input.trim().replace(/,/g, "");
  if (!text) return { ok: false, reason: "Enter an amount." };
  const match = /^(\d{1,9})(?:\.(\d{0,2}))?$/.exec(text);
  if (!match) {
    return /^\d*\.\d{3,}$/.test(text)
      ? { ok: false, reason: "Use at most two decimal places." }
      : { ok: false, reason: "Enter a positive amount in CNY, e.g. 300.00." };
  }
  const minor =
    Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || "0");
  if (minor < 1) return { ok: false, reason: "Amount must be at least CNY 0.01." };
  if (minor > MAX_TRANSFER_MINOR)
    return { ok: false, reason: "Amount exceeds the CNY 1,000,000.00 limit." };
  return { ok: true, minor };
}
