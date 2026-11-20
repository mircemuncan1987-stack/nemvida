// Povlačenje tržišnih cena (Yahoo chart, poslednji mesec dnevno) — deljeno
// između /api/markets (tabele na /trziste) i rezimea tržišta (lib/newsDigest.ts),
// da oba vide iste brojeve. Samo za server.

import { fetchUpstream } from "@/lib/yahooServer";
import { MARKET_GROUPS, type InstrumentQuote, type MarketInstrument } from "@/lib/marketInstruments";

interface ChartBar {
  ts: number;
  close: number;
}

function parseChart(json: unknown): { bars: ChartBar[]; price: number | null; currency: string | null; asOf: number | null } | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = (json as any)?.chart?.result?.[0];
  if (!result) return null;
  const timestamps: number[] = result.timestamp || [];
  const closes: (number | null)[] = result.indicators?.quote?.[0]?.close || [];
  const bars: ChartBar[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const c = closes[i];
    if (c != null && Number.isFinite(c)) bars.push({ ts: timestamps[i], close: c });
  }
  const meta = result.meta || {};
  const price = typeof meta.regularMarketPrice === "number" ? meta.regularMarketPrice : bars.length ? bars[bars.length - 1].close : null;
  if (price == null) return null;
  return {
    bars,
    price,
    currency: typeof meta.currency === "string" ? meta.currency : null,
    asOf: typeof meta.regularMarketTime === "number" ? meta.regularMarketTime : bars.length ? bars[bars.length - 1].ts : null,
  };
}

// Dnevna promena = u odnosu na zatvaranje prethodnog trgovačkog dana;
// nedeljna = u odnosu na zatvaranje pre 5 trgovačkih dana (jedna radna
// nedelja). Ako je poslednja dnevna sveća iz istog dana kao trenutna cena,
// ona JE današnji dan i referentna zatvaranja se broje pre nje; u
// suprotnom (npr. vikend, ili Yahoo još nije otvorio današnju sveću) sve
// sveće su prošli dani.
function buildQuote(id: string, symbol: string, parsed: NonNullable<ReturnType<typeof parseChart>>): InstrumentQuote {
  const { bars, price, currency, asOf } = parsed;
  const n = bars.length;
  const lastBar = n ? bars[n - 1] : null;
  const sameDay = lastBar && asOf != null ? new Date(lastBar.ts * 1000).toISOString().slice(0, 10) === new Date(asOf * 1000).toISOString().slice(0, 10) : false;
  const todayIdx = sameDay ? n - 1 : n;
  const prev = todayIdx - 1 >= 0 ? bars[todayIdx - 1].close : null;
  const weekRef = todayIdx - 5 >= 0 ? bars[todayIdx - 5].close : null;
  const p = price as number;
  return {
    id,
    symbol,
    price: p,
    currency,
    dayChange: prev != null ? p - prev : null,
    dayChangePercent: prev ? (p - prev) / prev : null,
    weekChange: weekRef != null ? p - weekRef : null,
    weekChangePercent: weekRef ? (p - weekRef) / weekRef : null,
    asOf,
    spark: bars.map((b) => b.close),
  };
}

export async function fetchInstrument(inst: MarketInstrument): Promise<InstrumentQuote> {
  for (const symbol of inst.symbols) {
    try {
      const json = await fetchUpstream(
        (crumb) => `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1d&crumb=${encodeURIComponent(crumb)}`
      );
      const parsed = parseChart(json);
      if (parsed) return buildQuote(inst.id, symbol, parsed);
    } catch {
      // sledeći kandidat simbol
    }
  }
  return { id: inst.id, symbol: null, price: null, currency: null, dayChange: null, dayChangePercent: null, weekChange: null, weekChangePercent: null, asOf: null, spark: [] };
}

export async function fetchAllQuotes(): Promise<InstrumentQuote[]> {
  return Promise.all(MARKET_GROUPS.flatMap((g) => g.instruments).map(fetchInstrument));
}
