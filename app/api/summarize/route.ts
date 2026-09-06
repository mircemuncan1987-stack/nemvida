import { NextRequest, NextResponse } from "next/server";
import { cleanReaderText, extractParagraphs, summarize } from "@/lib/summarize";

export const revalidate = 0;

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

async function viaReader(url: string): Promise<string> {
  const res = await fetch(`https://r.jina.ai/${url}`, {
    headers: { Accept: "text/plain" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error("reader failed");
  const text = await res.text();
  return cleanReaderText(text);
}

async function viaDirectFetch(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: BROWSER_HEADERS,
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error("direct fetch failed");
  const html = await res.text();
  return extractParagraphs(html);
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: "Nevažeći URL" }, { status: 400 });
  }

  let text = "";

  try {
    text = await viaReader(url);
  } catch {
    text = "";
  }

  if (!text || text.length < 200) {
    try {
      const direct = await viaDirectFetch(url);
      if (direct.length > text.length) text = direct;
    } catch {
      // ignore, keep whatever we have from the reader attempt
    }
  }

  const summary = text ? summarize(text, 4) : null;
  return NextResponse.json({ summary });
}
