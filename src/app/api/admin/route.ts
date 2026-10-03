import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_COOKIE,
  isAdmin,
  newAdminSession,
  validPassword,
} from "@/lib/admin";
export async function GET() {
  return NextResponse.json(
    { admin: await isAdmin() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host"))
    return NextResponse.json(
      { error: "허용되지 않은 요청이에요." },
      { status: 403 },
    );
  const { id, password, logout } = await req.json();
  if (logout) {
    const res = NextResponse.json({ ok: true });
    res.cookies.delete(ADMIN_COOKIE);
    return res;
  }
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/story-api`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
          "x-story-admin": process.env.STORY_SERVER_SECRET!,
        },
        body: JSON.stringify({
          action: "auth_limit",
          key:
            req.headers.get("x-real-ip") ||
            req.headers.get("x-forwarded-for")?.split(",")[0] ||
            "local",
        }),
      },
    );
    if (!response.ok)
      return NextResponse.json(
        { error: "잠시 기다린 뒤 다시 시도해 주세요." },
        { status: 429 },
      );
    if (
      id !== "dawithstory" ||
      typeof password !== "string" ||
      password.length > 200 ||
      !validPassword(password)
    )
      return NextResponse.json(
        { error: "아이디와 비밀번호를 확인해 주세요." },
        { status: 401 },
      );
    const res = NextResponse.json({ ok: true });
    res.cookies.set(ADMIN_COOKIE, newAdminSession(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 28800,
    });
    return res;
  } catch {
    return NextResponse.json(
      { error: "연결을 확인해 주세요." },
      { status: 503 },
    );
  }
}
