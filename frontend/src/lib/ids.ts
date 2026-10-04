/** One idempotency key per customer intent. Reuse it when retrying after a lost response. */
export function newIdempotencyKey() {
  return `web-${crypto.randomUUID()}`;
}
