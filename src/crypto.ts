import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
  createHmac,
} from "node:crypto";
export const token = () => randomBytes(32).toString("base64url");
export const digest = (data: unknown) =>
  createHash("sha256").update(JSON.stringify(data)).digest("hex");
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function checkPassword(password: string, encoded: string) {
  const [salt, hex] = encoded.split(":");
  if (!salt || !hex) return false;
  const stored = Buffer.from(hex, "hex");
  const candidate = scryptSync(password, salt, 64);
  return (
    stored.length === candidate.length && timingSafeEqual(stored, candidate)
  );
}
export const otpDigest = (secret: string, challengeId: string, code: string) =>
  createHmac("sha256", secret).update(`${challengeId}:${code}`).digest("hex");
export const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
