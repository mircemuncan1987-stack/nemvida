"use client";

import { useRef, useState } from "react";
import { SP500_TICKERS } from "@/lib/sp500";
import { DOW30_TICKERS } from "@/lib/dow30";
import { NASDAQ100_TICKERS } from "@/lib/nasdaq100";
import {
  computeDcf,
  computeDdm,
  computeGrahamNumber,
  computeRelativeValuation,
  estimateFcfCagr,
  estimateWacc,
  summarizeUpside,
  type Assumptions,
  type Fundamentals,
} from "@/lib/valuation";
import { combineVerdict, summarizeQualitative, type QualitativeInputs } from "@/lib/qualitative";

const DEFAULT_ASSUMPTIONS: Assumptions = {
  growthRateY1to5: 0.08,
  terminalGrowthRate: 0.025,
  riskFreeRate: 0.045,
  equityRiskPremium: 0.05,
  costOfDebt: 0.06,
  taxRate: 0.21,
  dividendGrowthRate: 0.03,
  targetPE: 18,
};

const CONCURRENCY = 6;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h — "realno vreme" u praksi znači osveženo par puta dnevno, ne svake sekunde

type IndexKey = "sp500" | "dow30" | "nasdaq100";

const INDEXES: Record<IndexKey, { label: string; tickers: string[] }> = {
  sp500: { label: "S&P 500", tickers: SP500_TICKERS },
  dow30: { label: "Dow Jones (30)", tickers: DOW30_TICKERS },
  nasdaq100: { label: "Nasdaq-100", tickers: NASDAQ100_TICKERS },
};

interface Row {
  ticker: string;
  companyName: string;
  currentPrice: number;
  currency: string;
  fairValue: number | null;
  upside: number | null;
  verdictLabel: string;
  qualitativeLabel: string;
  error?: string;
}

const fmtPct = (x: number | null | undefined) =>
  x === null || x === undefined || Number.isNaN(x) ? "—" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;

const fmtMoney = (x: number, currency: string) => `${x.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${currency}`;

async function fetchAndScore(ticker: string, assumptions: Assumptions): Promise<Row> {
  const res = await fetch(`/api/stock?symbol=${encodeURIComponent(ticker)}&type=valuation`, { cache: "no-store" });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  const result = data?.quoteSummary?.result?.[0];
  if (!result) throw new Error("Nema podataka");

  const price = result.price || {};
  const summaryDetail = result.summaryDetail || {};
  const keyStats = result.defaultKeyStatistics || {};
  const financialData = result.financialData || {};
  const cashflowStatements = result.cashflowStatementHistory?.cashflowStatements || [];
  const incomeStatements = result.incomeStatementHistory?.incomeStatementHistory || [];
  const recTrend = result.recommendationTrend?.trend?.[0] || null;

  const fcfHistory: number[] = cashflowStatements
    .slice()
    .reverse()
    .map((s: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const ocf = s.totalCashFromOperatingActivities?.raw;
      const capex = s.capitalExpenditures?.raw;
      if (ocf == null || capex == null) return null;
      return ocf + capex;
    })
    .filter((v: number | null): v is number => v != null);

  const revenueHistory: number[] = incomeStatements
    .slice()
    .reverse()
    .map((s: any) => s.totalRevenue?.raw) // eslint-disable-line @typescript-eslint/no-explicit-any
    .filter((v: number | null | undefined): v is number => v != null);

  const currentPrice = price.regularMarketPrice?.raw ?? financialData.currentPrice?.raw;
  if (!currentPrice) throw new Error("Cena nedostupna");

  const fundamentals: Fundamentals = {
    companyName: price.longName || price.shortName || ticker,
    currency: price.currency || "USD",
    currentPrice,
    sharesOutstanding: keyStats.sharesOutstanding?.raw ?? null,
    trailingEps: keyStats.trailingEps?.raw ?? null,
    forwardEps: keyStats.forwardEps?.raw ?? null,
    bookValuePerShare: keyStats.bookValue?.raw ?? null,
    trailingPE: summaryDetail.trailingPE?.raw ?? null,
    forwardPE: summaryDetail.forwardPE?.raw ?? null,
    dividendRate: summaryDetail.dividendRate?.raw ?? null,
    beta: keyStats.beta?.raw ?? null,
    totalDebt: financialData.totalDebt?.raw ?? null,
    totalCash: financialData.totalCash?.raw ?? null,
    freeCashflowTtm: financialData.freeCashflow?.raw ?? null,
    fcfHistory,
    revenueGrowth: financialData.revenueGrowth?.raw ?? null,
  };

  const localAssumptions: Assumptions = {
    ...assumptions,
    growthRateY1to5: estimateFcfCagr(fcfHistory) ?? (fundamentals.revenueGrowth != null ? Math.max(-0.1, Math.min(0.3, fundamentals.revenueGrowth)) : assumptions.growthRateY1to5),
    targetPE: fundamentals.trailingPE ?? assumptions.targetPE,
  };

  const wacc = estimateWacc(fundamentals, localAssumptions);
  const dcf = computeDcf(fundamentals, localAssumptions, wacc);
  const graham = computeGrahamNumber(fundamentals);
  const ddm = computeDdm(fundamentals, localAssumptions);
  const relative = computeRelativeValuation(fundamentals, localAssumptions);
  const values = [dcf.intrinsicValuePerShare, graham, ddm, relative].filter((v): v is number => v != null);
  const fairValue = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const upside = fairValue != null ? summarizeUpside(currentPrice, fairValue) : null;

  const qualitativeInputs: QualitativeInputs = {
    currentRatio: financialData.currentRatio?.raw ?? null,
    quickRatio: financialData.quickRatio?.raw ?? null,
    debtToEquity: financialData.debtToEquity?.raw ?? null,
    returnOnEquity: financialData.returnOnEquity?.raw ?? null,
    returnOnAssets: financialData.returnOnAssets?.raw ?? null,
    grossMargins: financialData.grossMargins?.raw ?? null,
    operatingMargins: financialData.operatingMargins?.raw ?? null,
    profitMargins: financialData.profitMargins?.raw ?? null,
    revenueGrowth: financialData.revenueGrowth?.raw ?? null,
    earningsGrowth: financialData.earningsGrowth?.raw ?? null,
    revenueHistory,
    targetMeanPrice: financialData.targetMeanPrice?.raw ?? null,
    currentPrice,
    recommendation: recTrend
      ? { strongBuy: recTrend.strongBuy ?? 0, buy: recTrend.buy ?? 0, hold: recTrend.hold ?? 0, sell: recTrend.sell ?? 0, strongSell: recTrend.strongSell ?? 0 }
      : null,
  };
  const qualitative = summarizeQualitative(qualitativeInputs);
  const verdict = combineVerdict(upside, qualitative);

  return {
    ticker,
    companyName: fundamentals.companyName,
    currentPrice,
    currency: fundamentals.currency,
    fairValue,
    upside,
    verdictLabel: verdict.label,
    qualitativeLabel: qualitative.overallLabel,
  };
}

export default function Sp500Screener() {
  const [indexKey, setIndexKey] = useState<IndexKey>("sp500");
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<"upside" | "ticker">("upside");
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const stopRef = useRef(false);

  const cacheKeyFor = (idx: IndexKey) => `nemvida_screener_v1_${idx}`;

  function loadFromCache(idx: IndexKey): boolean {
    try {
      const raw = localStorage.getItem(cacheKeyFor(idx));
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      // eslint-disable-next-line react-hooks/purity -- poziva se iz event handlera, ne iz render-a
      if (!parsed.timestamp || Date.now() - parsed.timestamp > CACHE_TTL_MS) return false;
      setRows(parsed.rows);
      setLastUpdated(parsed.timestamp);
      return true;
    } catch {
      return false;
    }
  }

  function saveToCache(idx: IndexKey, finalRows: Row[]) {
    try {
      // eslint-disable-next-line react-hooks/purity -- poziva se iz event handlera, ne iz render-a
      const timestamp = Date.now();
      localStorage.setItem(cacheKeyFor(idx), JSON.stringify({ rows: finalRows, timestamp }));
      setLastUpdated(timestamp);
    } catch {
      /* nije kritično ako localStorage nije dostupan */
    }
  }

  function switchIndex(idx: IndexKey) {
    setIndexKey(idx);
    setRows([]);
    setLastUpdated(null);
    setProgress(0);
    loadFromCache(idx);
  }

  async function runScreener(force: boolean) {
    if (!force && loadFromCache(indexKey)) return;

    setRunning(true);
    stopRef.current = false;
    setRows([]);
    setProgress(0);
    const results: Row[] = [];
    const tickers = INDEXES[indexKey].tickers;

    for (let i = 0; i < tickers.length; i += CONCURRENCY) {
      if (stopRef.current) break;
      const batch = tickers.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(batch.map((t) => fetchAndScore(t, DEFAULT_ASSUMPTIONS)));
      settled.forEach((s, idx) => {
        if (s.status === "fulfilled") {
          results.push(s.value);
        } else {
          results.push({
            ticker: batch[idx],
            companyName: batch[idx],
            currentPrice: 0,
            currency: "",
            fairValue: null,
            upside: null,
            verdictLabel: "—",
            qualitativeLabel: "—",
            error: s.reason instanceof Error ? s.reason.message : "Greška",
          });
        }
      });
      setRows([...results]);
      setProgress(Math.min(100, Math.round(((i + batch.length) / tickers.length) * 100)));
    }

    setRunning(false);
    if (!stopRef.current) saveToCache(indexKey, results);
  }

  function stopScreener() {
    stopRef.current = true;
    setRunning(false);
  }

  const filteredRows = rows
    .filter((r) => !r.error)
    .filter((r) => !search || r.ticker.includes(search.toUpperCase()) || r.companyName.toUpperCase().includes(search.toUpperCase()))
    .sort((a, b) => {
      if (sortKey === "ticker") return a.ticker.localeCompare(b.ticker);
      return (b.upside ?? -Infinity) - (a.upside ?? -Infinity);
    });

  const failedCount = rows.filter((r) => r.error).length;

  return (
    <div className="max-w-5xl mx-auto px-4 pb-16">
      <div className="mt-4 mb-5 text-sm leading-relaxed rounded-xl border border-amber-300/60 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/15 text-amber-800 dark:text-amber-300 p-4">
        <b>⚠ Ovo NIJE finansijski savet.</b> Fer vrednost je prosek nekoliko modela sa podrazumevanim pretpostavkama
        (nisu ručno prilagođene po kompaniji) — za detaljniju analizu pojedinačne akcije koristi{" "}
        <a href="/vrednost" className="underline">stranicu za procenu vrednosti</a>. Liste tikera po indeksima su
        snimci iz opšteg znanja i mogu odstupati od trenutnog zvaničnog sastava (kompozicije se povremeno menjaju).
        &quot;Osveženo&quot; znači vreme poslednjeg preuzimanja podataka (keširano lokalno do 12h), ne doslovno live
        tik-po-tik cena.
      </div>

      <div className="border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 rounded-xl p-4 mb-4 flex flex-wrap gap-3 items-center">
        <div className="flex gap-1 rounded-lg border border-zinc-300 dark:border-zinc-700 p-1">
          {(Object.keys(INDEXES) as IndexKey[]).map((k) => (
            <button
              key={k}
              onClick={() => !running && switchIndex(k)}
              disabled={running}
              className={`px-3 py-1.5 rounded-md text-sm font-medium ${
                indexKey === k ? "bg-blue-600 text-white" : "text-zinc-600 dark:text-zinc-400"
              }`}
            >
              {INDEXES[k].label}
            </button>
          ))}
        </div>
        {!running ? (
          <button onClick={() => runScreener(false)} className="bg-blue-600 text-white font-semibold px-5 py-2 rounded-lg text-sm">
            {rows.length ? "Osveži analizu" : "Pokreni analizu"}
          </button>
        ) : (
          <button onClick={stopScreener} className="bg-red-600 text-white font-semibold px-5 py-2 rounded-lg text-sm">
            Zaustavi ({progress}%)
          </button>
        )}
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Pretraži ticker ili ime..."
          className="flex-1 min-w-[160px] px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent text-sm"
        />
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as "upside" | "ticker")}
          className="px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent text-sm"
        >
          <option value="upside">Sortiraj: najviše potcenjene prvo</option>
          <option value="ticker">Sortiraj: abecedno</option>
        </select>
        {lastUpdated && (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            Osveženo: {new Date(lastUpdated).toLocaleString("sr-RS")}
          </span>
        )}
      </div>

      {running && (
        <div className="mb-4 h-2 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
          <div className="h-full bg-blue-600 transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}

      {failedCount > 0 && !running && (
        <div className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">{failedCount} tikera nije uspelo da se učita (preskočeno).</div>
      )}

      {filteredRows.length > 0 && (
        <div className="border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr>
                  <th className="text-left text-xs uppercase text-zinc-500 dark:text-zinc-400 py-2 px-3 border-b border-zinc-200 dark:border-zinc-800">Ticker</th>
                  <th className="text-left text-xs uppercase text-zinc-500 dark:text-zinc-400 py-2 px-3 border-b border-zinc-200 dark:border-zinc-800">Kompanija</th>
                  <th className="text-right text-xs uppercase text-zinc-500 dark:text-zinc-400 py-2 px-3 border-b border-zinc-200 dark:border-zinc-800">Cena</th>
                  <th className="text-right text-xs uppercase text-zinc-500 dark:text-zinc-400 py-2 px-3 border-b border-zinc-200 dark:border-zinc-800">Fer vrednost</th>
                  <th className="text-right text-xs uppercase text-zinc-500 dark:text-zinc-400 py-2 px-3 border-b border-zinc-200 dark:border-zinc-800">Razlika</th>
                  <th className="text-left text-xs uppercase text-zinc-500 dark:text-zinc-400 py-2 px-3 border-b border-zinc-200 dark:border-zinc-800">Sud</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => (
                  <tr key={r.ticker}>
                    <td className="py-2 px-3 border-b border-zinc-200 dark:border-zinc-800 font-semibold">
                      <a href={`/vrednost?ticker=${r.ticker}`} className="hover:underline">{r.ticker}</a>
                    </td>
                    <td className="py-2 px-3 border-b border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400">{r.companyName}</td>
                    <td className="py-2 px-3 border-b border-zinc-200 dark:border-zinc-800 text-right tabular-nums">{fmtMoney(r.currentPrice, r.currency)}</td>
                    <td className="py-2 px-3 border-b border-zinc-200 dark:border-zinc-800 text-right tabular-nums">{r.fairValue != null ? fmtMoney(r.fairValue, r.currency) : "—"}</td>
                    <td className={`py-2 px-3 border-b border-zinc-200 dark:border-zinc-800 text-right tabular-nums ${r.upside != null ? (r.upside >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400") : ""}`}>
                      {fmtPct(r.upside)}
                    </td>
                    <td className="py-2 px-3 border-b border-zinc-200 dark:border-zinc-800 text-xs">{r.verdictLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!running && !rows.length && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Klikni &quot;Pokreni analizu&quot; — obrađuje se {INDEXES[indexKey].tickers.length} kompanija u grupama, traje otprilike
          1-2 minuta. Rezultat se pamti lokalno 12 sati, tako da sledeći put učitavanje bude trenutno.
        </p>
      )}
    </div>
  );
}
