"use client";

import { useState } from "react";
import {
  DEFAULT_ASSUMPTIONS,
  computeModel,
  computeOverviewScores,
  computeOwnHistoricalAverages,
  extractModelData,
  resolveFcfForYield,
} from "@/lib/buildModel";
import { computeFcfYield } from "@/lib/valuation";
import type { FundamentalsRating, Verdict4 } from "@/lib/model";
import { fetchPriceHistory, fetchStockAnalysisFcf } from "@/lib/clientData";

const MAX_TICKERS = 5;

interface CompareResult {
  ticker: string;
  companyName: string;
  currency: string;
  currentPrice: number;
  sector: string | null;
  marketCap: number | null;
  verdict: Verdict4;
  fundamentalsRating: FundamentalsRating;
  compositeScore: number | null;
  grossMargin: number | null;
  operatingMargins: number | null;
  returnOnEquity: number | null;
  revenueCagr: number | null;
  peRatio: number | null;
  pFcf: number | null;
  evToEbitda: number | null;
  fcfYield: number | null;
  debtToEquity: number | null;
  dividendYield: number | null;
  moatScore: number;
  redFlagCount: number;
}

type ResultOrError = { ok: true; value: CompareResult } | { ok: false; error: string };

const fmtMoney = (x: number, currency: string) => `${x.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${currency}`;
const fmtPct = (x: number | null, digits = 1) => (x == null ? "—" : `${(x * 100).toFixed(digits)}%`);
const fmtRatio = (x: number | null) => (x == null ? "—" : `${x.toFixed(1)}×`);

function fmtMarketCap(x: number | null, currency: string): string {
  if (x == null) return "—";
  const abs = Math.abs(x);
  if (abs >= 1e12) return `${(x / 1e12).toFixed(2)}T ${currency}`;
  if (abs >= 1e9) return `${(x / 1e9).toFixed(1)}B ${currency}`;
  if (abs >= 1e6) return `${(x / 1e6).toFixed(0)}M ${currency}`;
  return `${x.toLocaleString("en-US")} ${currency}`;
}

async function analyzeTicker(ticker: string): Promise<CompareResult> {
  const res = await fetch(`/api/stock?symbol=${encodeURIComponent(ticker)}&type=valuation&full=1`, { cache: "no-store" });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);

  const modelData = extractModelData(data, ticker);
  const computed = computeModel(modelData, DEFAULT_ASSUMPTIONS);
  const priceHistory = await fetchPriceHistory(ticker);

  const yahooFcf = resolveFcfForYield(modelData);
  const fallbackFcf = yahooFcf == null ? await fetchStockAnalysisFcf(ticker) : null;
  const fcf = yahooFcf ?? fallbackFcf;

  const ownAvg = computeOwnHistoricalAverages(computed, priceHistory);
  const { currentPFcf, scores } = computeOverviewScores(computed, ownAvg, fallbackFcf);

  return {
    ticker,
    companyName: modelData.companyName,
    currency: modelData.currency,
    currentPrice: modelData.currentPrice,
    sector: modelData.sector,
    marketCap: modelData.marketCap,
    verdict: computed.finalVerdict.verdict,
    fundamentalsRating: computed.fundamentalsRating.rating,
    compositeScore: scores.composite,
    grossMargin: modelData.grossMargin,
    operatingMargins: modelData.operatingMargins,
    returnOnEquity: modelData.returnOnEquity,
    revenueCagr: computed.breakdown.revenueCagr,
    peRatio: modelData.peRatio,
    pFcf: currentPFcf,
    evToEbitda: modelData.evToEbitda,
    fcfYield: computeFcfYield(fcf, modelData.marketCap),
    debtToEquity: modelData.debtToEquity != null ? modelData.debtToEquity / 100 : null,
    dividendYield: modelData.dividendYield,
    moatScore: computed.moat.score,
    redFlagCount: computed.redFlags.length,
  };
}

interface MetricDef {
  label: string;
  get: (r: CompareResult) => number | null;
  format: (v: number | null) => string;
  direction: "higher" | "lower"; // koji smer je "bolji" — koristi se samo za isticanje najbolje vrednosti u redu
}

const METRICS: MetricDef[] = [
  { label: "Kompozitni skor", get: (r) => r.compositeScore, format: (v) => (v != null ? `${v.toFixed(1)}/5` : "—"), direction: "higher" },
  { label: "Bruto marža", get: (r) => r.grossMargin, format: (v) => fmtPct(v), direction: "higher" },
  { label: "Operativna marža", get: (r) => r.operatingMargins, format: (v) => fmtPct(v), direction: "higher" },
  { label: "ROE", get: (r) => r.returnOnEquity, format: (v) => fmtPct(v), direction: "higher" },
  { label: "Rast prihoda (CAGR)", get: (r) => r.revenueCagr, format: (v) => fmtPct(v), direction: "higher" },
  { label: "P/E", get: (r) => r.peRatio, format: (v) => fmtRatio(v), direction: "lower" },
  { label: "P/FCF", get: (r) => r.pFcf, format: (v) => fmtRatio(v), direction: "lower" },
  { label: "EV/EBITDA", get: (r) => r.evToEbitda, format: (v) => fmtRatio(v), direction: "lower" },
  { label: "FCF prinos", get: (r) => r.fcfYield, format: (v) => fmtPct(v), direction: "higher" },
  { label: "Dug/kapital", get: (r) => r.debtToEquity, format: (v) => fmtRatio(v), direction: "lower" },
  { label: "Dividendni prinos", get: (r) => r.dividendYield, format: (v) => fmtPct(v), direction: "higher" },
  { label: "Moat skor", get: (r) => r.moatScore, format: (v) => (v != null ? `${v}/10` : "—"), direction: "higher" },
  { label: "Crvene zastavice", get: (r) => r.redFlagCount, format: (v) => (v != null ? `${v}` : "—"), direction: "lower" },
];

function bestIndexFor(metric: MetricDef, values: (CompareResult | null)[]): number | null {
  let bestIdx: number | null = null;
  let bestVal: number | null = null;
  values.forEach((r, i) => {
    if (!r) return;
    const v = metric.get(r);
    if (v == null) return;
    if (bestVal == null || (metric.direction === "higher" ? v > bestVal : v < bestVal)) {
      bestVal = v;
      bestIdx = i;
    }
  });
  // Ne ističe se "najbolja" vrednost kad su svi tikeri identični po tom metriku.
  if (bestIdx != null && values.every((r) => !r || metric.get(r) === bestVal)) return null;
  return bestIdx;
}

export default function CompareTickers() {
  const [tickers, setTickers] = useState<string[]>(["", ""]);
  const [results, setResults] = useState<ResultOrError[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  function updateTicker(i: number, value: string) {
    setTickers((prev) => prev.map((t, idx) => (idx === i ? value.toUpperCase() : t)));
  }

  function addTicker() {
    setTickers((prev) => (prev.length < MAX_TICKERS ? [...prev, ""] : prev));
  }

  function removeTicker(i: number) {
    setTickers((prev) => (prev.length > 2 ? prev.filter((_, idx) => idx !== i) : prev));
  }

  async function runCompare() {
    const cleaned = tickers.map((t) => t.trim()).filter((t) => t.length > 0);
    const unique = Array.from(new Set(cleaned));
    if (unique.length < 2) {
      setError("Unesi bar dva različita tikera za poređenje.");
      return;
    }
    setError("");
    setRunning(true);
    setResults([]);
    const settled = await Promise.allSettled(unique.map((t) => analyzeTicker(t)));
    setResults(
      settled.map((s) => (s.status === "fulfilled" ? { ok: true, value: s.value } : { ok: false, error: s.reason instanceof Error ? s.reason.message : "Greška" }))
    );
    setRunning(false);
  }

  const successResults: (CompareResult | null)[] = results.map((r) => (r.ok ? r.value : null));
  const hasResults = results.length >= 2;

  return (
    <div className="max-w-5xl mx-auto px-4 pb-16">
      <div className="mt-4 mb-5 text-sm leading-relaxed rounded-xl border border-amber-300/60 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/15 text-amber-800 dark:text-amber-300 p-4">
        <b>⚠ Ovo NIJE finansijski savet.</b> Uporedi do {MAX_TICKERS} kompanija koje ti biraš (npr. direktni
        konkurenti, ili kompanije iz istog sektora) — isti sveobuhvatni model kao na{" "}
        <a href="/pregled" className="underline">pregledu kompanije</a>, prikazan jedno pored drugog. Najbolja
        vrednost u svakom redu je istaknuta zeleno (osim kad su svi tikeri identični po tom metriku, ili nemaju
        dovoljno podataka) — &quot;najbolja&quot; znači samo veća/manja u očekivanom smeru (npr. niži P/E, viša
        marža), ne i da je ta kompanija bolja kupovina u celini. Ovaj alat ne predlaže sam konkurente — ti odlučuješ
        koga poredi, da se ne bi izmišljalo poređenje koje ne možemo da proverimo.
      </div>

      <div className="border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 rounded-xl p-4 mb-4">
        <div className="flex flex-wrap gap-2 mb-3">
          {tickers.map((t, i) => (
            <div key={i} className="flex items-center gap-1">
              <input
                type="text"
                value={t}
                onChange={(e) => updateTicker(i, e.target.value)}
                placeholder={`Ticker ${i + 1}`}
                className="w-28 px-2 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent text-sm"
              />
              {tickers.length > 2 && (
                <button onClick={() => removeTicker(i)} className="text-xs text-red-600 dark:text-red-400">✕</button>
              )}
            </div>
          ))}
          {tickers.length < MAX_TICKERS && (
            <button onClick={addTicker} className="text-sm px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700">
              + Dodaj tiker
            </button>
          )}
        </div>
        <button onClick={runCompare} disabled={running} className="bg-blue-600 text-white font-semibold px-5 py-2 rounded-lg text-sm disabled:opacity-60">
          {running ? "Analiziram..." : "Uporedi"}
        </button>
        {error && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{error}</p>}
      </div>

      {hasResults && (
        <div className="border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr>
                  <th className="text-left text-xs uppercase text-zinc-500 dark:text-zinc-400 py-2 px-3 border-b border-zinc-200 dark:border-zinc-800">Metrika</th>
                  {results.map((r, i) => (
                    <th key={i} className="text-right text-xs uppercase text-zinc-500 dark:text-zinc-400 py-2 px-3 border-b border-zinc-200 dark:border-zinc-800">
                      {r.ok ? (
                        <a href={`/pregled?ticker=${r.value.ticker}`} className="hover:underline font-semibold text-zinc-900 dark:text-zinc-50 normal-case">
                          {r.value.ticker}
                        </a>
                      ) : (
                        tickers.filter((t) => t.trim())[i]
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="py-1.5 px-3 border-b border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400">Kompanija</td>
                  {results.map((r, i) => (
                    <td key={i} className="py-1.5 px-3 border-b border-zinc-200 dark:border-zinc-800 text-right text-xs text-zinc-600 dark:text-zinc-400">
                      {r.ok ? r.value.companyName : <span className="italic text-red-500">Greška: {r.error}</span>}
                    </td>
                  ))}
                </tr>
                {results.some((r) => r.ok) && (
                  <>
                    <tr>
                      <td className="py-1.5 px-3 border-b border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400">Cena</td>
                      {results.map((r, i) => (
                        <td key={i} className="py-1.5 px-3 border-b border-zinc-200 dark:border-zinc-800 text-right tabular-nums">
                          {r.ok ? fmtMoney(r.value.currentPrice, r.value.currency) : "—"}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="py-1.5 px-3 border-b border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400">Tržišna kap.</td>
                      {results.map((r, i) => (
                        <td key={i} className="py-1.5 px-3 border-b border-zinc-200 dark:border-zinc-800 text-right tabular-nums">
                          {r.ok ? fmtMarketCap(r.value.marketCap, r.value.currency) : "—"}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="py-1.5 px-3 border-b border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400">Sektor</td>
                      {results.map((r, i) => (
                        <td key={i} className="py-1.5 px-3 border-b border-zinc-200 dark:border-zinc-800 text-right text-xs text-zinc-600 dark:text-zinc-400">
                          {r.ok ? r.value.sector || "—" : "—"}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="py-1.5 px-3 border-b border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400">Sud</td>
                      {results.map((r, i) => (
                        <td
                          key={i}
                          className={`py-1.5 px-3 border-b border-zinc-200 dark:border-zinc-800 text-right text-xs font-medium ${
                            !r.ok
                              ? ""
                              : r.value.verdict === "Kupovina"
                                ? "text-emerald-600 dark:text-emerald-400"
                                : r.value.verdict === "Izbegavanje"
                                  ? "text-red-600 dark:text-red-400"
                                  : r.value.verdict === "Čekaj — preskupo"
                                    ? "text-amber-600 dark:text-amber-400"
                                    : "text-zinc-600 dark:text-zinc-400"
                          }`}
                        >
                          {r.ok ? r.value.verdict : "—"}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="py-1.5 px-3 border-b border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400">Fundamenti</td>
                      {results.map((r, i) => (
                        <td
                          key={i}
                          className={`py-1.5 px-3 border-b border-zinc-200 dark:border-zinc-800 text-right text-xs font-medium ${
                            !r.ok ? "" : r.value.fundamentalsRating === "Jaki" ? "text-emerald-600 dark:text-emerald-400" : r.value.fundamentalsRating === "Slabi" ? "text-red-600 dark:text-red-400" : "text-zinc-600 dark:text-zinc-400"
                          }`}
                        >
                          {r.ok ? r.value.fundamentalsRating : "—"}
                        </td>
                      ))}
                    </tr>
                    {METRICS.map((metric) => {
                      const bestIdx = bestIndexFor(metric, successResults);
                      return (
                        <tr key={metric.label}>
                          <td className="py-1.5 px-3 border-b border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400">{metric.label}</td>
                          {results.map((r, i) => (
                            <td
                              key={i}
                              className={`py-1.5 px-3 border-b border-zinc-200 dark:border-zinc-800 text-right tabular-nums ${
                                i === bestIdx ? "font-semibold text-emerald-600 dark:text-emerald-400" : ""
                              }`}
                            >
                              {r.ok ? metric.format(metric.get(r.value)) : "—"}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
