import { NextRequest, NextResponse } from "next/server";

// Server-side proxy za Yahoo Finance. Ovo postoji zato što pozivanje Yahoo-a
// direktno iz browsera (client-side) zavisi od javnih CORS proxy servisa
// (allorigins.win, corsproxy.io i sl.) koji su nepouzdani i često padaju ili
// vraćaju 401/timeout. Pozivom sa servera nema CORS ograničenja uopšte.
//
// Yahoo od 2024. traži "crumb" token (uz odgovarajući session cookie) čak i
// za osnovni chart API kad zahtev ne dolazi iz pravog browsera — bez toga
// vraća HTTP 401/403. Ovde se cookie/crumb pribavljaju jednom i keširaju u
// memoriji procesa (dovoljno kratko da se ne moraju tražiti pri svakom
// zahtevu, a dovoljno robusno da se automatski osveže ako Yahoo odbije
// zahtev sa trenutnim crumb-om).

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

let cachedAuth: { cookie: string; crumb: string; fetchedAt: number } | null = null;
const AUTH_TTL_MS = 30 * 60 * 1000;

async function fetchYahooAuth() {
  if (cachedAuth && Date.now() - cachedAuth.fetchedAt < AUTH_TTL_MS) return cachedAuth;

  const cookieRes = await fetch("https://fc.yahoo.com", {
    headers: { "User-Agent": USER_AGENT },
    redirect: "manual",
  });
  const setCookie = cookieRes.headers.get("set-cookie");
  if (!setCookie) throw new Error("Nije moguće pribaviti Yahoo sesijski kolačić");
  const cookie = setCookie.split(";")[0];

  const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": USER_AGENT, Cookie: cookie },
  });
  if (!crumbRes.ok) throw new Error(`Nije moguće pribaviti Yahoo crumb (HTTP ${crumbRes.status})`);
  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.includes("<")) throw new Error("Yahoo crumb odgovor nije validan");

  cachedAuth = { cookie, crumb, fetchedAt: Date.now() };
  return cachedAuth;
}

async function fetchUpstream(buildUrl: (crumb: string) => string, forceRefresh = false) {
  const auth = forceRefresh ? ((cachedAuth = null), await fetchYahooAuth()) : await fetchYahooAuth();
  const res = await fetch(buildUrl(auth.crumb), {
    headers: { "User-Agent": USER_AGENT, Cookie: auth.cookie, Accept: "application/json" },
    next: { revalidate: 300 },
  });

  if ((res.status === 401 || res.status === 403) && !forceRefresh) {
    return fetchUpstream(buildUrl, true);
  }
  if (!res.ok) {
    throw new Error(`Yahoo Finance je vratio HTTP ${res.status}`);
  }
  return res.json();
}

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol");
  const type = request.nextUrl.searchParams.get("type") || "valuation";

  if (!symbol) {
    return NextResponse.json({ error: "Nedostaje parametar 'symbol'" }, { status: 400 });
  }

  try {
    if (type === "valuation") {
      const modules =
        "price,summaryDetail,defaultKeyStatistics,financialData,cashflowStatementHistory,incomeStatementHistory,balanceSheetHistory,recommendationTrend,assetProfile,earningsTrend,netSharePurchaseActivity";
      const data = await fetchUpstream(
        (crumb) =>
          `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(
            symbol
          )}?modules=${modules}&crumb=${encodeURIComponent(crumb)}`
      );
      return NextResponse.json(data);
    }

    if (type === "search") {
      const data = await fetchUpstream(
        (crumb) =>
          `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(
            symbol
          )}&quotesCount=10&newsCount=0&crumb=${encodeURIComponent(crumb)}`
      );
      return NextResponse.json(data);
    }

    return NextResponse.json({ error: "Nepoznat 'type' parametar" }, { status: 400 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Nepoznata greška pri preuzimanju podataka";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
