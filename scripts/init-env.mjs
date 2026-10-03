import fs from "node:fs";
import crypto from "node:crypto";
const path = ".env.local";
let text = fs.readFileSync(path, "utf8");
function put(name, value) {
  const line = `${name}=${value}`;
  const re = new RegExp(`^${name}=.*$`, "m");
  text = re.test(text)
    ? text.replace(re, line)
    : text.trimEnd() + "\n" + line + "\n";
}
put("NEXT_PUBLIC_SUPABASE_URL", "https://ftvrortfrobyfekmiwve.supabase.co");
put(
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "sb_publishable_td1JRlIo4J16GiurISMy1Q_H8OQe28L",
);
let secret = text.match(/^STORY_SERVER_SECRET=(.+)$/m)?.[1];
if (!secret) {
  secret = crypto.randomBytes(48).toString("hex");
  put("STORY_SERVER_SECRET", secret);
}
if (!text.includes("STORY_ADMIN_PASSWORD_HASH=")) {
  if (!process.env.STORY_INITIAL_PASSWORD)
    throw new Error("Initial password required");
  const salt = crypto.randomBytes(16).toString("hex");
  put(
    "STORY_ADMIN_PASSWORD_HASH",
    salt +
      ":" +
      crypto
        .scryptSync(process.env.STORY_INITIAL_PASSWORD, salt, 64)
        .toString("hex"),
  );
}
fs.writeFileSync(path, text);
console.log(
  JSON.stringify({
    backend_hash: crypto.createHash("sha256").update(secret).digest("hex"),
    saved: path,
  }),
);
