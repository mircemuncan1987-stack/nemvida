import { NextRequest, NextResponse } from "next/server";
import { extractParagraphs, summarize } from "@/lib/summarize";

export const revalidate = 0;

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: "Nevažeći URL" }, { status: 400 });
  }

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NemvidaBot/1.0)" },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error("fetch failed");
    const html = await res.text();
    const text = extractParagraphs(html);
    const summary = text ? summarize(text, 4) : null;

    return NextResponse.json({ summary });
  } catch {
    return NextResponse.json({ summary: null });
  }
}
