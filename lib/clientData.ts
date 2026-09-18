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

// Prevodi tekst (samo opis poslovanja kompanije) sa engleskog na srpski
// preko servera (vidi app/api/translate) — besplatan mašinski prevod
// (MyMemory), bez API ključa. Vraća null ako prevod ne uspe, da bi pozivalac
// mogao da prikaže originalni tekst kao rezervu.
export async function translateToSerbian(text: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/translate?text=${encodeURIComponent(text)}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.translated === "string" ? data.translated : null;
  } catch {
    return null;
  }
}

// Rezervni izvor za TTM slobodan novčani tok kad Yahoo nema podatak (vidi
// app/api/stockanalysis) — poziva se SAMO kad je Yahoo-ova vrednost null,
// nikad kao zamena za Yahoo kad podatak postoji. Vraća null i kad rezerva
// nije primenjiva (npr. tiker van SAD) ili kad ne uspe da pronađe vrednost.
export async function fetchStockAnalysisFcf(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(`/api/stockanalysis?symbol=${encodeURIComponent(symbol)}&type=fcf`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.freeCashflowTtm === "number" ? data.freeCashflowTtm : null;
  } catch {
    return null;
  }
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
