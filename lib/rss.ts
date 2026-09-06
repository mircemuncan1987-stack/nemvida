import { XMLParser } from "fast-xml-parser";

export type FeedItem = {
  title: string;
  link: string;
  source: string;
  pubDate: string;
  isoDate: string;
  ticker: string;
  companyName: string;
  description: string;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

function toArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function stripCdata(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/<!\[CDATA\[|\]\]>/g, "").trim();
}

function safeDate(value: string): string {
  const d = new Date(value);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

export async function fetchGoogleNewsFeed(
  query: string,
  ticker: string,
  companyName: string
): Promise<FeedItem[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(
    query
  )}&hl=en-US&gl=US&ceid=US:US`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NemvidaBot/1.0)" },
      next: { revalidate: 300 },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const data = parser.parse(xml);
    const items = toArray(data?.rss?.channel?.item);

    return items.map((item) => {
      const title = stripCdata(item.title);
      const sourceText =
        typeof item.source === "object" ? stripCdata(item.source?.["#text"]) : stripCdata(item.source);
      const pubDate = item.pubDate ?? "";
      return {
        title,
        link: stripCdata(item.link),
        source: sourceText || "Google News",
        pubDate,
        isoDate: safeDate(pubDate),
        ticker,
        companyName,
        description: stripCdata(item.description).replace(/<[^>]+>/g, "").trim(),
      };
    });
  } catch {
    return [];
  }
}

export async function fetchYahooFinanceFeed(
  symbol: string,
  ticker: string,
  companyName: string
): Promise<FeedItem[]> {
  const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(
    symbol
  )}&region=US&lang=en-US`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NemvidaBot/1.0)" },
      next: { revalidate: 300 },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const data = parser.parse(xml);
    const items = toArray(data?.rss?.channel?.item);

    return items.map((item) => {
      const pubDate = item.pubDate ?? "";
      return {
        title: stripCdata(item.title),
        link: stripCdata(item.link),
        source: "Yahoo Finance",
        pubDate,
        isoDate: safeDate(pubDate),
        ticker,
        companyName,
        description: stripCdata(item.description).replace(/<[^>]+>/g, "").trim(),
      };
    });
  } catch {
    return [];
  }
}

export function dedupeAndSort(items: FeedItem[]): FeedItem[] {
  const seen = new Set<string>();
  const unique: FeedItem[] = [];
  for (const item of items) {
    const key = item.title.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique.sort(
    (a, b) => new Date(b.isoDate).getTime() - new Date(a.isoDate).getTime()
  );
}
