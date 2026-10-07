import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
export const maxDuration = 60;
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (
    origin &&
    origin !== req.nextUrl.origin &&
    new URL(origin).host !== req.headers.get("host")
  )
    return NextResponse.json(
      { error: "허용되지 않은 요청이에요." },
      { status: 403 },
    );
  try {
    const raw = await req.text();
    if (raw.length > 16000)
      return NextResponse.json(
        { error: "내용이 너무 길어요." },
        { status: 413 },
      );
    const body = JSON.parse(raw);
    if (["configure", "worker", "auth_limit", "register"].includes(body.action))
      return NextResponse.json(
        { error: "허용되지 않은 요청이에요." },
        { status: 403 },
      );
    const admin = req.headers.get("x-story-scope") === "admin";
    if (admin && !(await isAdmin()))
      return NextResponse.json(
        { error: "운영자 로그인이 필요해요." },
        { status: 401 },
      );
    const upstream = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/story-api`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
          ...(admin
            ? { "x-story-admin": process.env.STORY_SERVER_SECRET! }
            : { Authorization: req.headers.get("authorization") || "" }),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(50000),
        cache: "no-store",
      },
    );
    return new NextResponse(await upstream.text(), {
      status: upstream.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "연결이 잠시 어려워요. 다시 시도해 주세요." },
      { status: 503 },
    );
  }
}
