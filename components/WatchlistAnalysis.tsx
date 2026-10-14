"use client";

import { useEffect, useMemo, useState } from "react";
import {
  computeModel,
  computeOverviewScores,
  computeOwnHistoricalAverages,
  extractModelData,
  resolveFcfForYield,
  type ComputedModel,
} from "@/lib/buildModel";
import { fetchPriceHistory, fetchStockAnalysisFcf } from "@/lib/clientData";
import { DEFAULT_WATCHLIST, type WatchlistTicker } from "@/lib/watchlist";
import { evaluateWatchlistTicker, type WatchlistVerdict } from "@/lib/watchlistAttractiveness";

const STORAGE_KEY = "nemvida_watchlist_v1";
const CONCURRENCY = 4;

interface WatchlistResult {
  computed: ComputedModel | null;
  verdict: WatchlistVerdict | null;
  error?: string;
}

function loadWatchlist(): WatchlistTicker[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_WATCHLIST;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    return DEFAULT_WATCHLIST;
  } catch {
    return DEFAULT_WATCHLIST;
  }
}

function toneClass(tone: string): string {
  if (tone === "povoljno") return "text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20";
  if (tone === "skupo") return "text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20";
  if (tone === "neutralno") return "text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20";
  return "text-zinc-400 bg-zinc-50 dark:bg-zinc-800/40";
}

export default function WatchlistAnalysis() {
  const [items, setItems] = useState<WatchlistTicker[]>(DEFAULT_WATCHLIST);
  const [loaded, setLoaded] = useState(false);
  const [results, setResults] = useState<Map<string, WatchlistResult>>(new Map());
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- jednokratno učitavanje iz localStorage pri montiranju
    setItems(loadWatchlist());
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      /* nije kritično ako localStorage nije dostupan */
    }
  }, [items, loaded]);

  function updateItem(id: string, patch: Partial<WatchlistTicker>) {
    setItems((prev) => prev.map((h) => (h.id === id ? { ...h, ...patch } : h)));
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((h) => h.id !== id));
  }

  function addItem() {
    setItems((prev) => [...prev, { id: `custom-${Date.now()}`, ticker: "", name: "Nova pozicija" }]);
  }

  function resetToDefault() {
    setItems(DEFAULT_WATCHLIST);
  }

  async function runAnalysis() {
    setRunning(true);
    setProgress(0);
    const tickers = Array.from(new Set(items.map((h) => h.ticker).filter((t): t is string => !!t)));
    const newResults = new Map<string, WatchlistResult>();

    for (let i = 0; i < tickers.length; i += CONCURRENCY) {
      const batch = tickers.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map(async (ticker) => {
          const res = await fetch(`/api/stock?symbol=${encodeURIComponent(ticker)}&type=valuation&full=1`, { cache: "no-store" });
          const data = await res.json();
          if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
          const modelData = extractModelData(data, ticker);
          const computed = computeModel(modelData);
          const priceHistory = await fetchPriceHistory(ticker);
          let resolvedFcf = resolveFcfForYield(modelData);
          if (resolvedFcf == null) resolvedFcf = await fetchStockAnalysisFcf(ticker);
          const ownAvg = computeOwnHistoricalAverages(computed, priceHistory);
          const overview = computeOverviewScores(computed, ownAvg, resolvedFcf);
          const verdict = evaluateWatchlistTicker(overview.multiplesTable, computed.growthPotential);
          return { ticker, computed, verdict };
        })
      );
      settled.forEach((s, idx) => {
        const ticker = batch[idx];
        if (s.status === "fulfilled") {
          newResults.set(ticker, { computed: s.value.computed, verdict: s.value.verdict });
        } else {
          newResults.set(ticker, { computed: null, verdict: null, error: s.reason instanceof Error ? s.reason.message : "Greška" });
        }
      });
      setResults(new Map(newResults));
      setProgress(Math.min(100, Math.round(((i + batch.length) / Math.max(1, tickers.length)) * 100)));
    }

    setRunning(false);
  }

  const hasResults = results.size > 0;

  const ranked = useMemo(() => {
    const rows: { item: WatchlistTicker; result: WatchlistResult }[] = [];
    for (const it of items) {
      if (!it.ticker) continue;
      const r = results.get(it.ticker);
      if (!r) continue;
      rows.push({ item: it, result: r });
    }
    return rows.sort((a, b) => {
      const av = a.result.verdict?.verdict === "Atraktivno" ? 0 : 1;
      const bv = b.result.verdict?.verdict === "Atraktivno" ? 0 : 1;
      return av - bv;
    });
  }, [items, results]);

  return (
    <div className="max-w-4xl mx-auto px-4 pb-16">
      <div className="overflow-x-auto mb-4">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              <th className="text-left text-xs uppercase text-zinc-500 py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800">Naziv</th>
              <th className="text-left text-xs uppercase text-zinc-500 py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800">Ticker</th>
              <th className="py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td className="py-1 px-2 border-b border-zinc-200 dark:border-zinc-800">
                  <input
                    value={it.name}
                    onChange={(e) => updateItem(it.id, { name: e.target.value })}
                    className="w-full min-w-[160px] bg-transparent border-b border-transparent focus:border-zinc-400 text-sm"
                  />
                </td>
                <td className="py-1 px-2 border-b border-zinc-200 dark:border-zinc-800">
                  <input
                    value={it.ticker}
                    onChange={(e) => updateItem(it.id, { ticker: e.target.value.toUpperCase() })}
                    placeholder="npr. AAPL"
                    className="w-24 bg-transparent border-b border-transparent focus:border-zinc-400 text-sm"
                  />
                </td>
                <td className="py-1 px-2 border-b border-zinc-200 dark:border-zinc-800">
                  <button onClick={() => removeItem(it.id)} className="text-xs text-red-600 dark:text-red-400">✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        <button onClick={addItem} className="text-sm px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700">
          + Dodaj poziciju
        </button>
        <button onClick={resetToDefault} className="text-sm px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700">
          Vrati na polaznu listu
        </button>
        <button onClick={runAnalysis} disabled={running} className="text-sm px-4 py-1.5 rounded-lg bg-blue-600 disabled:opacity-60 text-white font-semibold">
          {running ? `Analiziram... (${progress}%)` : hasResults ? "Osveži analizu" : "Pokreni analizu"}
        </button>
      </div>

      {hasResults && (
        <div className="space-y-3">
          {ranked.map(({ item, result }) => {
            if (result.error) {
              return (
                <div key={item.id} className="p-3 rounded border border-zinc-200 dark:border-zinc-800 text-xs italic text-zinc-500 dark:text-zinc-400">
                  {item.name} ({item.ticker}): greška — {result.error}
                </div>
              );
            }
            const v = result.verdict;
            if (!v) return null;
            return (
              <div
                key={item.id}
                className={`p-3 rounded border ${v.verdict === "Atraktivno" ? "border-emerald-300 dark:border-emerald-700" : "border-zinc-200 dark:border-zinc-800"}`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1.5">
                  <div className="text-sm font-bold">
                    <a href={`/pregled?ticker=${item.ticker}`} className="hover:underline">{item.name}</a>
                    {result.computed?.data.sector && (
                      <span className="ml-1.5 text-xs font-normal text-zinc-500 dark:text-zinc-400">({result.computed.data.sector})</span>
                    )}
                  </div>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${toneClass(v.verdict === "Atraktivno" ? "povoljno" : "skupo")}`}>
                    {v.verdict}
                  </span>
                </div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
                  {v.favorableCount} od {v.knownCount} poznatih pokazatelja čita povoljno, {v.expensiveCount} čita skupo
                  {v.tieBreakByGrowth ? " — izjednačeno, presudio potencijal rasta." : "."}
                </div>
                <ul className="text-sm text-zinc-700 dark:text-zinc-300 space-y-1">
                  {v.reasons.map((r, i) => (
                    <li key={i} className="flex gap-1.5">
                      <span className="text-zinc-400 shrink-0">•</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-zinc-400 mt-6 italic">
        Metodologija je namerno drugačija od /portfolio — P/E i P/FCF se prvenstveno porede sa SOPSTVENOM istorijskom prosečnom vrednošću svake
        kompanije (ne samo sa sektorom), isti princip koji se prikazuje na /model. Verdikt je namerno binaran (Atraktivno / Skupo — sačekaj): kad je
        broj povoljnih i skupih pokazatelja izjednačen, odlučuje potencijal rasta, a kod nerešenog ishoda podrazumevano se ne juri cena.
      </p>
    </div>
  );
}
