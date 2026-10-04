import { Capacitor, CapacitorHttp } from "@capacitor/core";

// Keep browser fetch/cookies unchanged. Native HTTP uses Android's private cookie
// jar; the app never copies session cookies into JavaScript or local storage.
export async function bankFetch(
  url: string,
  init: RequestInit,
): Promise<Response> {
  if (!Capacitor.isNativePlatform()) return fetch(url, init);
  const method = init.method ?? "GET";
  const result = await CapacitorHttp.request({
    url,
    method,
    headers: {
      ...(init.headers as Record<string, string>),
      Origin: window.location.origin,
    },
    ...(method === "POST"
      ? { data: JSON.parse(String(init.body ?? "{}")) }
      : {}),
    responseType: "json",
    connectTimeout: 10000,
    readTimeout: 30000,
    disableRedirects: true,
  });
  // Never forward Set-Cookie or native transport headers to application code.
  return new Response(JSON.stringify(result.data), {
    status: result.status,
    headers: { "Content-Type": "application/json" },
  });
}
