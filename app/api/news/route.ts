import { NextRequest, NextResponse } from "next/server";
import { companies, findCompany } from "@/lib/companies";
import { dedupeAndSort, fetchGoogleNewsFeed, fetchYahooFinanceFeed } from "@/lib/rss";

export const revalidate = 300;

export async function GET(request: NextRequest) {
  const tickerParam = request.nextUrl.searchParams.get("ticker");
  const targets = tickerParam
    ? [findCompany(tickerParam)].filter(Boolean)
    : companies;

  if (tickerParam && targets.length === 0) {
    return NextResponse.json({ error: "Nepoznat tiker" }, { status: 404 });
  }

  const results = await Promise.all(
    targets.map(async (company) => {
      if (!company) return [];
      const feeds = await Promise.all([
        fetchGoogleNewsFeed(company.searchTerms[0], company.ticker, company.name),
        company.yahooSymbol
          ? fetchYahooFinanceFeed(company.yahooSymbol, company.ticker, company.name)
          : Promise.resolve([]),
      ]);
      return feeds.flat();
    })
  );

  const merged = dedupeAndSort(results.flat());

  return NextResponse.json({
    updatedAt: new Date().toISOString(),
    count: merged.length,
    items: merged.slice(0, 150),
  });
}
