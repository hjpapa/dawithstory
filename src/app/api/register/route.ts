import { NextRequest, NextResponse } from "next/server";

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
    if (raw.length > 2048)
      return NextResponse.json(
        { error: "입력 내용이 너무 길어요." },
        { status: 413 },
      );
    const { email, password } = JSON.parse(raw);
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
          action: "register",
          email,
          password,
          client_ip:
            req.headers.get("x-real-ip") ||
            req.headers.get("x-forwarded-for")?.split(",")[0] ||
            "unknown",
        }),
        signal: AbortSignal.timeout(20000),
      },
    );
    return new NextResponse(await response.text(), {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      {
        error:
          "가입 연결을 확인해 주세요. 다시 시도하거나 운영자에게 문의해 주세요.",
      },
      { status: 503 },
    );
  }
}
