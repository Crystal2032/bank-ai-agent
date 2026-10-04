const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});
const dateOnly = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });

/** Accepts Unix milliseconds or ISO strings, matching the backend's mixed timestamp fields. */
export function formatDateTime(value: number | string | undefined) {
  if (value === undefined || value === "") return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateTime.format(date);
}

export function formatDate(value: number | string | undefined) {
  if (value === undefined || value === "") return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateOnly.format(date);
}

export function formatRemaining(ms: number) {
  if (ms <= 0) return "expired";
  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Current month in the bank's Asia/Shanghai calendar (UTC+8, no DST). */
export function currentBankMonth(now = Date.now()) {
  return new Date(now + 8 * 3600000).toISOString().slice(0, 7);
}

export function shiftMonth(month: string, delta: number) {
  const [year, m] = month.split("-").map(Number) as [number, number];
  const date = new Date(Date.UTC(year, m - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

export function formatMonth(month: string) {
  const [year, m] = month.split("-").map(Number) as [number, number];
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, m - 1, 1)));
}

export function shortId(id: string) {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

export function humanize(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((word, index) => (index === 0 ? word[0]?.toUpperCase() + word.slice(1) : word))
    .join(" ");
}
