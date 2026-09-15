// Klijentske funkcije za preuzimanje podataka sa /api/stock rute — deljene
// između /model, /lista i /portfolio da se parsiranje Yahoo odgovora ne bi
// duplira na tri mesta.

import type { HistoricalPricePoint } from "@/lib/buildModel";

export async function fetchPriceHistory(symbol: string): Promise<HistoricalPricePoint[]> {
  try {
    const res = await fetch(`/api/stock?symbol=${encodeURIComponent(symbol)}&type=history`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    const chartResult = data?.chart?.result?.[0];
    const timestamps: number[] = chartResult?.timestamp || [];
    const closes: (number | null)[] = chartResult?.indicators?.quote?.[0]?.close || [];
    // "adjclose" je prilagođen dividendama i podelama akcija — koristi se kad
    // je dostupan da bi poređenje ukupnog prinosa uključilo i dividende, ne
    // samo promenu cene.
    const adjCloses: (number | null)[] = chartResult?.indicators?.adjclose?.[0]?.adjclose || [];
    const points: HistoricalPricePoint[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const c = adjCloses[i] ?? closes[i];
      if (c != null) points.push({ timestamp: timestamps[i], close: c });
    }
    return points;
  } catch {
    return [];
  }
}

// SPY istorija je ista za svaku analizu u ovoj sesiji — kešira se u memoriji
// (jedan zahtev po učitavanju stranice) umesto ponovnog preuzimanja pri
// svakoj novoj pretrazi/analizi.
let spyHistoryPromise: Promise<HistoricalPricePoint[]> | null = null;
export function fetchSpyHistory(): Promise<HistoricalPricePoint[]> {
  if (!spyHistoryPromise) spyHistoryPromise = fetchPriceHistory("SPY");
  return spyHistoryPromise;
}

export interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
}

export async function searchSymbols(query: string): Promise<SearchResult[]> {
  const res = await fetch(`/api/stock?symbol=${encodeURIComponent(query)}&type=search`, { cache: "no-store" });
  if (!res.ok) return [];
  const data = await res.json();
  const quotes = data?.quotes || [];
  return quotes
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((q: any) => q.symbol && q.quoteType === "EQUITY")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((q: any) => ({ symbol: q.symbol, name: q.shortname || q.longname || q.symbol, exchange: q.exchDisp || q.exchange || "" }));
}
