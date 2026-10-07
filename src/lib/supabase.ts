"use client";
import { createBrowserClient } from "@supabase/ssr";
let instance: ReturnType<typeof createBrowserClient> | undefined;
export function supabase() {
  instance ??= createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
  return instance;
}
export async function api<T = Record<string, unknown>>(
  action: string,
  payload: Record<string, unknown> = {},
  scope: "user" | "admin" = "user",
): Promise<T> {
  const {
    data: { session },
  } = await supabase().auth.getSession();
  const res = await fetch("/api/story", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Story-Scope": scope,
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json().catch(() => {
    throw new Error("연결이 잠시 어려워요. 다시 시도해 주세요.");
  });
  if (!res.ok) throw new Error(data.error || "잠시 후 다시 시도해 주세요.");
  return data as T;
}
export function adminApi<T = Record<string, unknown>>(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  return api<T>(action, payload, "admin");
}
