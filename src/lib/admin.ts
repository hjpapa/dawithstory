import "server-only";
import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { cookies } from "next/headers";
export const ADMIN_COOKIE = "story_admin";
export function validPassword(password: string) {
  const [salt, hash] = (process.env.STORY_ADMIN_PASSWORD_HASH || "").split(":");
  if (!salt || !hash) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function sign(body: string) {
  return createHmac("sha256", process.env.STORY_SERVER_SECRET!)
    .update(body)
    .digest("base64url");
}
export function newAdminSession() {
  const body = Buffer.from(
    JSON.stringify({
      exp: Date.now() + 8 * 60 * 60 * 1000,
      nonce: randomBytes(16).toString("hex"),
    }),
  ).toString("base64url");
  return `${body}.${sign(body)}`;
}
export async function isAdmin() {
  const value = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!value || !process.env.STORY_SERVER_SECRET) return false;
  const [body, signature] = value.split(".");
  try {
    const expected = Buffer.from(sign(body));
    const actual = Buffer.from(signature || "");
    return (
      actual.length === expected.length &&
      timingSafeEqual(actual, expected) &&
      JSON.parse(Buffer.from(body, "base64url").toString()).exp > Date.now()
    );
  } catch {
    return false;
  }
}
