import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
export async function GET(req: NextRequest) {
  const next =
    req.nextUrl.searchParams.get("next") === "/reset-password"
      ? "/reset-password"
      : "/dashboard";
  const response = NextResponse.redirect(new URL(next, req.url));
  const client = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (values) =>
          values.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          ),
      },
    },
  );
  const code = req.nextUrl.searchParams.get("code");
  if (code) {
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (!error) return response;
  }
  return NextResponse.redirect(new URL("/login", req.url));
}
