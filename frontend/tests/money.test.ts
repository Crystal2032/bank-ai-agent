import { describe, expect, it } from "vitest";
import { formatMinor, parseAmount } from "../src/lib/money";
import { currentBankMonth, shiftMonth } from "../src/lib/format";

describe("formatMinor", () => {
  it("formats integer minor units without floating point", () => {
    expect(formatMinor(30000)).toBe("CNY 300.00");
    expect(formatMinor(5)).toBe("CNY 0.05");
    expect(formatMinor(123456789)).toBe("CNY 1,234,567.89");
    expect(formatMinor(-3900)).toBe("−CNY 39.00");
    expect(formatMinor(100, { signed: true })).toBe("+CNY 1.00");
  });
  it("refuses non-integer values", () => {
    expect(formatMinor(1.5)).toBe("CNY —");
  });
});

describe("parseAmount", () => {
  it.each([
    ["300", 30000],
    ["300.5", 30050],
    ["0.01", 1],
    ["1,000.99", 100099],
    ["0.1", 10],
    ["1000000", 100000000],
  ])("parses %s", (input, minor) => {
    expect(parseAmount(input)).toEqual({ ok: true, minor });
  });
  it.each(["", "abc", "-5", "1.234", "0", "0.00", "1000000.01", "1e3", "12.3.4"])(
    "rejects %s",
    (input) => {
      expect(parseAmount(input).ok).toBe(false);
    },
  );
  it("avoids binary rounding errors", () => {
    expect(parseAmount("0.29")).toEqual({ ok: true, minor: 29 });
    expect(parseAmount("1.15")).toEqual({ ok: true, minor: 115 });
  });
});

describe("bank months", () => {
  it("uses the Asia/Shanghai calendar", () => {
    expect(currentBankMonth(Date.parse("2026-09-30T17:00:00Z"))).toBe("2026-10");
    expect(currentBankMonth(Date.parse("2026-09-30T15:00:00Z"))).toBe("2026-09");
  });
  it("shifts across years", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2025-12", 1)).toBe("2026-01");
  });
});
