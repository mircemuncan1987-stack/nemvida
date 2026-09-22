"use client";

import { useRef, useState } from "react";
import { SP500_TICKERS } from "@/lib/sp500";
import { DOW30_TICKERS } from "@/lib/dow30";
import { NASDAQ100_TICKERS } from "@/lib/nasdaq100";
import { DAX40_TICKERS } from "@/lib/dax40";
import { CAC40_TICKERS } from "@/lib/cac40";
import { IBEX35_TICKERS } from "@/lib/ibex35";
import { FTSE100_TICKERS } from "@/lib/ftse100";
import { AEX_TICKERS } from "@/lib/aex";
import { OBX_TICKERS } from "@/lib/obx";
import { OMXS30_TICKERS } from "@/lib/omxs30";
import { FTSEMIB_TICKERS } from "@/lib/ftsemib";
import { WIG20_TICKERS } from "@/lib/wig20";
import { SMI_TICKERS } from "@/lib/smi";
import { DEFAULT_ASSUMPTIONS, computeModel, extractModelData, resolveFcfForYield } from "@/lib/buildModel";
import { computeFcfYield } from "@/lib/valuation";
import type { FundamentalsRating, Verdict4 } from "@/lib/model";
import { fetchStockAnalysisFcf } from "@/lib/clientData";
import { analyzeConcentration, DEFAULT_HOLDINGS, type PortfolioHolding } from "@/lib/portfolio";

const STORAGE_KEY = "nemvida_portfolio_v1";
const CONCURRENCY = 6;

type IndexKey = "sp500" | "dow30" | "nasdaq100" | "dax40" | "cac40" | "ibex35" | "ftse100" | "aex" | "obx" | "omxs30" | "ftsemib" | "wig20" | "smi";

const INDEXES: Record<IndexKey, { label: string; tickers: string[] }> = {
  sp500: { label: "S&P 500", tickers: SP500_TICKERS },
  dow30: { label: "Dow Jones (30)", tickers: DOW30_TICKERS },
  nasdaq100: { label: "Nasdaq-100", tickers: NASDAQ100_TICKERS },
  dax40: { label: "DAX 40 (Frankfurt)", tickers: DAX40_TICKERS },
  cac40: { label: "CAC 40 (Pariz)", tickers: CAC40_TICKERS },
  ibex35: { label: "IBEX 35 (Madrid)", tickers: IBEX35_TICKERS },
  ftse100: { label: "FTSE 100 (London)", tickers: FTSE100_TICKERS },
  aex: { label: "AEX (Amsterdam)", tickers: AEX_TICKERS },
  obx: { label: "OBX (Oslo)", tickers: OBX_TICKERS },
  omxs30: { label: "OMXS30 (Stokholm)", tickers: OMXS30_TICKERS },
  ftsemib: { label: "FTSE MIB (Rim/Milano)", tickers: FTSEMIB_TICKERS },
  wig20: { label: "WIG20 (Varšava)", tickers: WIG20_TICKERS },
  smi: { label: "SMI (Cirih)", tickers: SMI_TICKERS },
};

function loadHoldings(): PortfolioHolding[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_HOLDINGS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    return DEFAULT_HOLDINGS;
  } catch {
    return DEFAULT_HOLDINGS;
  }
}

interface Candidate {
  ticker: string;
  companyName: string;
  sector: string | null;
  marketCap: number | null;
  currentPrice: number;
  currency: string;
  verdictLabel: Verdict4;
  fundamentalsRating: FundamentalsRating;
  redFlagCount: number;
  fcfYield: number | null;
  evToEbitda: number | null;
  revenueCagr: number | null; // istorijski godišnji rast prihoda (CAGR) — proxy za "svake godine ~X%"
  moatScore: number; // 1-10, iz scoreMoat — širok jaz (wide moat) je >=6, isti prag kao na /pregled
  error?: string;
}

const fmtPct = (x: number | null, digits = 1) => (x == null ? "—" : `${(x * 100).toFixed(digits)}%`);
const fmtRatio = (x: number | null) => (x == null ? "—" : `${x.toFixed(1)}×`);
const fmtMoney = (x: number, currency: string) => `${x.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${currency}`;

function fmtMarketCap(x: number | null, currency: string): string {
  if (x == null) return "—";
  const abs = Math.abs(x);
  if (abs >= 1e12) return `${(x / 1e12).toFixed(2)}T ${currency}`;
  if (abs >= 1e9) return `${(x / 1e9).toFixed(1)}B ${currency}`;
  if (abs >= 1e6) return `${(x / 1e6).toFixed(0)}M ${currency}`;
  return `${x.toLocaleString("en-US")} ${currency}`;
}

async function scoreCandidate(ticker: string): Promise<Candidate> {
  const res = await fetch(`/api/stock?symbol=${encodeURIComponent(ticker)}&type=valuation`, { cache: "no-store" });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);

  const modelData = extractModelData(data, ticker);
  const computed = computeModel(modelData, DEFAULT_ASSUMPTIONS);

  let fcf = resolveFcfForYield(modelData);
  if (fcf == null) fcf = await fetchStockAnalysisFcf(ticker);

  return {
    ticker,
    companyName: modelData.companyName,
    sector: modelData.sector,
    marketCap: modelData.marketCap,
    currentPrice: modelData.currentPrice,
    currency: modelData.currency,
    verdictLabel: computed.finalVerdict.verdict,
    fundamentalsRating: computed.fundamentalsRating.rating,
    redFlagCount: computed.redFlags.length,
    fcfYield: computeFcfYield(fcf, modelData.marketCap),
    evToEbitda: modelData.evToEbitda,
    revenueCagr: computed.breakdown.revenueCagr,
    moatScore: computed.moat.score,
  };
}

interface Recommendation extends Candidate {
  existingSectorWeight: number; // 0-1, tvoj trenutni udeo u tom sektoru
  fitScore: number; // 0-1, veći = bolje popunjava prazninu u portfelju
  fitLabel: "Odlično popunjava prazninu" | "Dobro dopunjuje" | "Već dobro zastupljeno";
}

function fitLabelFor(weight: number): Recommendation["fitLabel"] {
  if (weight < 0.05) return "Odlično popunjava prazninu";
  if (weight < 0.2) return "Dobro dopunjuje";
  return "Već dobro zastupljeno";
}

export default function RecommendationsScreener() {
  const [indexKey, setIndexKey] = useState<IndexKey>("sp500");
  const [minGrowthPercent, setMinGrowthPercent] = useState(15);
  const [requireWideMoat, setRequireWideMoat] = useState(true);
  const [holdings, setHoldings] = useState<PortfolioHolding[] | null>(null);
  const [sectorWeights, setSectorWeights] = useState<Map<string, number> | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [scanned, setScanned] = useState(0);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<"idle" | "portfolio" | "screening" | "done">("idle");
  const [progress, setProgress] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const stopRef = useRef(false);

  async function runAnalysis() {
    setRunning(true);
    stopRef.current = false;
    setRecommendations([]);
    setProgress(0);
    setFailedCount(0);
    setScanned(0);

    // Korak 1: analiziraj postojeći portfolio (samo sektor po tikeru je potreban
    // za "prazninu" — koristi se ista logika kao na /portfolio, ali bez punog
    // sveobuhvatnog izračuna po poziciji, jer ovde nije potrebna ocena portfelja
    // već samo njegov sektorski sastav).
    setPhase("portfolio");
    const loadedHoldings = loadHoldings();
    setHoldings(loadedHoldings);
    const portfolioTickers = Array.from(new Set(loadedHoldings.map((h) => h.ticker).filter((t): t is string => !!t)));
    const sectorByTicker = new Map<string, string | null>();
    for (let i = 0; i < portfolioTickers.length; i += CONCURRENCY) {
      if (stopRef.current) break;
      const batch = portfolioTickers.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map(async (ticker) => {
          const res = await fetch(`/api/stock?symbol=${encodeURIComponent(ticker)}&type=valuation`, { cache: "no-store" });
          const data = await res.json();
          if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
          return extractModelData(data, ticker);
        })
      );
      settled.forEach((s, idx) => {
        sectorByTicker.set(batch[idx], s.status === "fulfilled" ? s.value.sector : null);
      });
    }
    const concentration = analyzeConcentration(loadedHoldings, sectorByTicker);
    const sectorWeightMap = new Map<string, number>(concentration.sectorWeights.map((r) => [r.label, r.weight]));
    setSectorWeights(sectorWeightMap);
    const heldTickers = new Set(portfolioTickers.map((t) => t.toUpperCase()));

    // Korak 2: skeniraj izabrani indeks istim modelom kao /pregled i /lista, i
    // zadrži samo kompanije koje ispunjavaju uslove ("Kupovina", jaki fundamenti,
    // bez crvenih zastavica) i koje već nisu u portfelju.
    setPhase("screening");
    const tickers = INDEXES[indexKey].tickers;
    const found: Recommendation[] = [];
    let failed = 0;
    let done = 0;

    for (let i = 0; i < tickers.length; i += CONCURRENCY) {
      if (stopRef.current) break;
      const batch = tickers.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(batch.map((t) => scoreCandidate(t)));
      settled.forEach((s, idx) => {
        done++;
        if (s.status !== "fulfilled") {
          failed++;
          return;
        }
        const c = s.value;
        if (heldTickers.has(batch[idx].toUpperCase())) return; // već u portfelju
        if (c.verdictLabel !== "Kupovina") return;
        if (c.fundamentalsRating !== "Jaki") return;
        if (c.redFlagCount > 0) return;
        if (c.revenueCagr == null || c.revenueCagr < minGrowthPercent / 100) return;
        if (requireWideMoat && c.moatScore < 6) return;

        const sectorKey = c.sector || "Nepoznat sektor";
        const existingSectorWeight = sectorWeightMap.get(sectorKey) || 0;
        found.push({
          ...c,
          existingSectorWeight,
          fitScore: 1 - Math.min(1, existingSectorWeight),
          fitLabel: fitLabelFor(existingSectorWeight),
        });
      });
      setScanned(done);
      setFailedCount(failed);
      found.sort((a, b) => b.fitScore - a.fitScore || (b.fcfYield ?? -1) - (a.fcfYield ?? -1));
      setRecommendations([...found]);
      setProgress(Math.min(100, Math.round((done / tickers.length) * 100)));
    }

    setPhase("done");
    setRunning(false);
  }

  function stopScan() {
    stopRef.current = true;
    setRunning(false);
  }

  return (
    <div className="max-w-5xl mx-auto px-4 pb-16">
      <div className="mt-4 mb-5 text-sm leading-relaxed rounded-xl border border-amber-300/60 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/15 text-amber-800 dark:text-amber-300 p-4">
        <b>⚠ Ovo NIJE finansijski savet.</b> Prikazane su kompanije iz izabranog indeksa koje (1) ispunjavaju uslove
        istog sveobuhvatnog modela kao <a href="/pregled" className="underline">pregled kompanije</a> (sud
        &quot;Kupovina&quot;, fundamenti &quot;Jaki&quot;, nula crvenih zastavica), (2) imaju istorijski godišnji rast
        prihoda (CAGR) najmanje onoliko koliko si podesio ispod i, ako je uključeno, širok jaz (moat skor ≥ 6/10 — isti
        prag kao oznaka &quot;Širok jaz&quot; na pregledu kompanije), (3) još nisu u tvom{" "}
        <a href="/portfolio" className="underline">portfelju</a>, i (4) rangirane su po tome koliko dobro popunjavaju
        sektorsku prazninu u portfelju — kompanija iz sektora kojeg uopšte nemaš (ili ga imaš malo) rangira se više od
        kompanije iz sektora u kom si već koncentrisan, čak i ako je pojedinačno &quot;jača&quot; po modelu. &quot;Rast
        prihoda (CAGR)&quot; je istorijski prosečan godišnji rast (iz dostupnih godišnjih izveštaja), ne garancija da će
        se ponoviti svake godine unapred. Uklapanje u portfelj je pojednostavljena mera diverzifikacije (samo sektorska
        koncentracija) — ne uzima u obzir korelaciju cena, valutnu izloženost ili tvoje lične ciljeve.
      </div>

      <div className="border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 rounded-xl p-4 mb-4 flex flex-wrap gap-3 items-center">
        <select
          value={indexKey}
          onChange={(e) => !running && setIndexKey(e.target.value as IndexKey)}
          disabled={running}
          className="px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent text-sm"
        >
          {(Object.keys(INDEXES) as IndexKey[]).map((k) => (
            <option key={k} value={k}>
              {INDEXES[k].label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm">
          Min. rast prihoda (CAGR):
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={minGrowthPercent}
            onChange={(e) => !running && setMinGrowthPercent(Math.max(0, parseFloat(e.target.value) || 0))}
            disabled={running}
            className="w-16 px-2 py-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent text-sm text-right tabular-nums"
          />
          %/god.
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={requireWideMoat}
            onChange={(e) => !running && setRequireWideMoat(e.target.checked)}
            disabled={running}
          />
          Samo širok jaz (moat ≥ 6/10)
        </label>
        {!running ? (
          <button onClick={runAnalysis} className="bg-blue-600 text-white font-semibold px-5 py-2 rounded-lg text-sm">
            {recommendations.length || phase === "done" ? "Osveži preporuke" : "Pronađi preporuke"}
          </button>
        ) : (
          <button onClick={stopScan} className="bg-red-600 text-white font-semibold px-5 py-2 rounded-lg text-sm">
            Zaustavi ({progress}%)
          </button>
        )}
        {phase === "portfolio" && running && (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">Korak 1/2: analiziram sastav tvog portfelja...</span>
        )}
        {phase === "screening" && (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            Korak 2/2: skeniram {INDEXES[indexKey].label} ({scanned}/{INDEXES[indexKey].tickers.length})
            {failedCount > 0 ? ` — ${failedCount} preskočeno` : ""}
          </span>
        )}
      </div>

      {running && (
        <div className="mb-4 h-2 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
          <div className="h-full bg-blue-600 transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}

      {holdings && sectorWeights && phase !== "idle" && (
        <div className="mb-4 text-xs text-zinc-500 dark:text-zinc-400">
          Portfolio: {holdings.length} pozicija, {Array.from(sectorWeights.keys()).length} zastupljenih sektora.
        </div>
      )}

      {recommendations.length > 0 && (
        <div className="border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr>
                  <th className="text-left text-xs uppercase text-zinc-500 dark:text-zinc-400 py-2 px-3 border-b border-zinc-200 dark:border-zinc-800">Ticker</th>
                  <th className="text-left text-xs uppercase text-zinc-500 dark:text-zinc-400 py-2 px-3 border-b border-zinc-200 dark:border-zinc-800">Kompanija</th>
                  <th className="text-left text-xs uppercase text-zinc-500 dark:text-zinc-400 py-2 px-3 border-b border-zinc-200 dark:border-zinc-800">Sektor</th>
                  <th className="text-right text-xs uppercase text-zinc-500 dark:text-zinc-400 py-2 px-3 border-b border-zinc-200 dark:border-zinc-800">Tvoj udeo u sektoru</th>
                  <th className="text-left text-xs uppercase text-zinc-500 dark:text-zinc-400 py-2 px-3 border-b border-zinc-200 dark:border-zinc-800">Uklapanje u portfelj</th>
                  <th className="text-right text-xs uppercase text-zinc-500 dark:text-zinc-400 py-2 px-3 border-b border-zinc-200 dark:border-zinc-800">Rast prihoda (CAGR)</th>
                  <th className="text-right text-xs uppercase text-zinc-500 dark:text-zinc-400 py-2 px-3 border-b border-zinc-200 dark:border-zinc-800">Moat</th>
                  <th className="text-right text-xs uppercase text-zinc-500 dark:text-zinc-400 py-2 px-3 border-b border-zinc-200 dark:border-zinc-800">Cena</th>
                  <th className="text-right text-xs uppercase text-zinc-500 dark:text-zinc-400 py-2 px-3 border-b border-zinc-200 dark:border-zinc-800">Tržišna kap.</th>
                  <th className="text-right text-xs uppercase text-zinc-500 dark:text-zinc-400 py-2 px-3 border-b border-zinc-200 dark:border-zinc-800">FCF prinos</th>
                  <th className="text-right text-xs uppercase text-zinc-500 dark:text-zinc-400 py-2 px-3 border-b border-zinc-200 dark:border-zinc-800">EV/EBITDA</th>
                </tr>
              </thead>
              <tbody>
                {recommendations.map((r) => (
                  <tr key={r.ticker}>
                    <td className="py-2 px-3 border-b border-zinc-200 dark:border-zinc-800 font-semibold">
                      <a href={`/pregled?ticker=${r.ticker}`} className="hover:underline">{r.ticker}</a>
                    </td>
                    <td className="py-2 px-3 border-b border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400">{r.companyName}</td>
                    <td className="py-2 px-3 border-b border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400">{r.sector || "—"}</td>
                    <td className="py-2 px-3 border-b border-zinc-200 dark:border-zinc-800 text-right tabular-nums">{fmtPct(r.existingSectorWeight)}</td>
                    <td
                      className={`py-2 px-3 border-b border-zinc-200 dark:border-zinc-800 text-xs font-medium ${
                        r.fitLabel === "Odlično popunjava prazninu"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : r.fitLabel === "Dobro dopunjuje"
                            ? "text-blue-600 dark:text-blue-400"
                            : "text-zinc-500 dark:text-zinc-400"
                      }`}
                    >
                      {r.fitLabel}
                    </td>
                    <td className="py-2 px-3 border-b border-zinc-200 dark:border-zinc-800 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{fmtPct(r.revenueCagr)}</td>
                    <td className="py-2 px-3 border-b border-zinc-200 dark:border-zinc-800 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{r.moatScore}/10</td>
                    <td className="py-2 px-3 border-b border-zinc-200 dark:border-zinc-800 text-right tabular-nums">{fmtMoney(r.currentPrice, r.currency)}</td>
                    <td className="py-2 px-3 border-b border-zinc-200 dark:border-zinc-800 text-right tabular-nums">{fmtMarketCap(r.marketCap, r.currency)}</td>
                    <td
                      className={`py-2 px-3 border-b border-zinc-200 dark:border-zinc-800 text-right tabular-nums ${
                        r.fcfYield != null && r.fcfYield < 0 ? "text-red-600 dark:text-red-400" : ""
                      }`}
                    >
                      {fmtPct(r.fcfYield)}
                    </td>
                    <td
                      className={`py-2 px-3 border-b border-zinc-200 dark:border-zinc-800 text-right tabular-nums ${
                        r.evToEbitda != null && r.evToEbitda > 30 ? "text-red-600 dark:text-red-400" : ""
                      }`}
                    >
                      {fmtRatio(r.evToEbitda)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {phase === "done" && recommendations.length === 0 && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Nijedna kompanija iz {INDEXES[indexKey].label} trenutno ne ispunjava sve uslove (Kupovina + jaki fundamenti +
          nula crvenih zastavica + rast prihoda ≥{minGrowthPercent}%/god.{requireWideMoat ? " + širok jaz" : ""}) i
          istovremeno nije već u tvom portfelju. Probaj drugi indeks ili spusti prag rasta.
        </p>
      )}

      {!running && phase === "idle" && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Klikni &quot;Pronađi preporuke&quot; — prvo se analizira sastav tvog portfelja (sektor po poziciji), zatim se
          skenira {INDEXES[indexKey].tickers.length} kompanija iz izabranog indeksa. Traje otprilike 2-4 minuta.
        </p>
      )}
    </div>
  );
}
