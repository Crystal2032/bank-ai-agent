export const routes = [
  { path: "overview", label: "Overview", icon: "◎" },
  { path: "assistant", label: "Assistant", icon: "✦" },
  { path: "payments", label: "Payments", icon: "⇄" },
  { path: "transactions", label: "Transactions", icon: "≡" },
  { path: "bills", label: "Bills", icon: "▤" },
  { path: "subscriptions", label: "Subscriptions", icon: "↻" },
  { path: "security", label: "Security", icon: "⚿" },
  { path: "activity", label: "Activity", icon: "☰" },
] as const;

export type RoutePath = (typeof routes)[number]["path"];

export function readRoute(): RoutePath {
  const path = window.location.hash.replace(/^#\/?/, "").split("?")[0];
  return routes.some((r) => r.path === path) ? (path as RoutePath) : "overview";
}

export function navigate(path: RoutePath) {
  window.location.hash = `/${path}`;
}
