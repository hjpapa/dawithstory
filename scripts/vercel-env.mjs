import fs from "node:fs";
import { spawnSync } from "node:child_process";
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
for (const name of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "STORY_SERVER_SECRET",
  "STORY_ADMIN_PASSWORD_HASH",
]) {
  const args = [
    "node_modules/vercel/dist/vc.js",
    "env",
    "add",
    name,
    "preview,production",
    "--force",
    "--yes",
    name.startsWith("NEXT_PUBLIC_") ? "--no-sensitive" : "--sensitive",
  ];
  const result = spawnSync(process.execPath, args, {
    input: env[name],
    encoding: "utf8",
    env: process.env,
  });
  if (result.status !== 0) {
    console.error("Environment setup failed for " + name);
    process.exit(1);
  }
  console.log("Saved " + name + " for preview and production.");
}
