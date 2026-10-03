import fs from "node:fs";
const env = Object.fromEntries(
  fs
    .readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [
      l.slice(0, l.indexOf("=")),
      l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, ""),
    ]),
);
const res = await fetch(
  env.NEXT_PUBLIC_SUPABASE_URL + "/functions/v1/story-api",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-story-admin": env.STORY_SERVER_SECRET,
      apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify({
      action: "configure",
      openai_key: env.OPENAI_API_KEY,
    }),
  },
);
if (!res.ok)
  throw new Error(
    "Provisioning failed: " + res.status + " " + (await res.text()),
  );
console.log("AI credential stored in encrypted Supabase Vault.");
